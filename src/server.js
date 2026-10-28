// EHBO Evenementen-app — testversie ("hello world") voor installatie en pushmeldingen.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { generateVapidKeys, sendPush } from './webpush.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(ROOT, '..', 'public');

export const config = {
  port: Number(process.env.PORT ?? 8080),
  host: process.env.HOST ?? '0.0.0.0',
  dataDir: process.env.DATA_DIR ?? path.resolve(ROOT, '..', 'data'),
  vapidSubject: process.env.VAPID_SUBJECT ?? '',
  version: process.env.APP_VERSION ?? 'dev',
  commit: process.env.GIT_SHA ?? 'onbekend',
  builtAt: process.env.BUILD_DATE ?? '',
};

const log = (...args) => console.log(new Date().toISOString(), ...args);

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};
// Bestanden die nooit lang in een cache (ook niet bij Cloudflare) mogen blijven.
const NO_CACHE = new Set(['/index.html', '/sw.js', '/manifest.webmanifest', '/app.js', '/style.css']);

function loadVapid(db) {
  let publicKey = process.env.VAPID_PUBLIC_KEY;
  let privateKey = process.env.VAPID_PRIVATE_KEY;
  if (publicKey && privateKey) return { publicKey, privateKey, source: 'omgevingsvariabelen' };
  publicKey = db.getSetting('vapid_public_key');
  privateKey = db.getSetting('vapid_private_key');
  if (publicKey && privateKey) return { publicKey, privateKey, source: 'database' };
  const keys = generateVapidKeys();
  db.setSetting('vapid_public_key', keys.publicKey);
  db.setSetting('vapid_private_key', keys.privateKey);
  return { ...keys, source: 'nieuw aangemaakt' };
}

function send(res, status, body, headers = {}) {
  const isJson = typeof body === 'object' && !Buffer.isBuffer(body);
  const data = isJson ? JSON.stringify(body) : body;
  res.writeHead(status, { 'Content-Type': isJson ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(data);
}

async function readJson(req, limit = 16 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('Te groot'), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch { throw Object.assign(new Error('Ongeldige JSON'), { status: 400 }); }
}

function validSubscription(s, allowInsecure = false) {
  return s && typeof s.endpoint === 'string' && (allowInsecure ? /^https?:\/\//: /^https:\/\//).test(s.endpoint) && s.endpoint.length < 2048
    && typeof s.keys?.p256dh === 'string' && typeof s.keys?.auth === 'string';
}

function serveStatic(req, res, pathname) {
  if (pathname === '/') pathname = '/index.html';
  const file = path.resolve(PUBLIC_DIR, '.' + decodeURIComponent(pathname));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 400, 'Ongeldig pad');
  let target = file;
  if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) {
    if (path.extname(pathname)) return send(res, 404, 'Niet gevonden');
    target = path.join(PUBLIC_DIR, 'index.html'); // app-routes vallen terug op de app
    pathname = '/index.html';
  }
  let body = fs.readFileSync(target);
  if (pathname === '/sw.js' || pathname === '/index.html') {
    // Versie in service worker en pagina, zodat elke nieuwe build ook een nieuwe cache krijgt.
    body = Buffer.from(body.toString().replaceAll('__APP_VERSION__', `${config.version}-${config.commit.slice(0, 7)}`));
  }
  const headers = {
    'Content-Type': TYPES[path.extname(target)] ?? 'application/octet-stream',
    'Cache-Control': NO_CACHE.has(pathname) ? 'no-cache' : 'public, max-age=3600',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
  };
  if (pathname === '/sw.js') headers['Service-Worker-Allowed'] = '/';
  res.writeHead(200, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
}

export function createApp({ db, vapid, allowInsecureEndpoints = false }) {
  const lastTestPush = new Map();

  async function pushTo(sub, payload) {
    const result = await sendPush(sub, payload, vapid, { ttl: 120, urgency: 'high' });
    db.markPush(sub.endpoint, result.status);
    if (result.gone) db.deleteSubscription(sub.endpoint);
    log('push', result.status, new URL(sub.endpoint).host, result.ok ? '' : result.body);
    return result;
  }

  return async function handler(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const { pathname } = url;
    try {
      if (pathname === '/healthz') return send(res, 200, { ok: true });

      if (pathname === '/api/info' && req.method === 'GET') {
        return send(res, 200, {
          version: config.version, commit: config.commit, builtAt: config.builtAt,
          vapidPublicKey: vapid.publicKey, subscriptions: db.countSubscriptions(),
        });
      }

      if (pathname === '/api/subscriptions' && req.method === 'POST') {
        const { subscription } = await readJson(req);
        if (!validSubscription(subscription, allowInsecureEndpoints)) return send(res, 400, { error: 'Ongeldig abonnement' });
        db.upsertSubscription(subscription, req.headers['user-agent']);
        return send(res, 200, { ok: true });
      }

      if (pathname === '/api/subscriptions' && req.method === 'DELETE') {
        const { endpoint } = await readJson(req);
        if (typeof endpoint === 'string') db.deleteSubscription(endpoint);
        return send(res, 200, { ok: true });
      }

      if (pathname === '/api/test-push' && req.method === 'POST') {
        const { endpoint, delaySeconds = 0 } = await readJson(req);
        const sub = typeof endpoint === 'string' ? db.getSubscription(endpoint) : undefined;
        if (!sub) return send(res, 404, { error: 'Abonnement niet gevonden; zet meldingen opnieuw aan' });
        const now = Date.now();
        if (now - (lastTestPush.get(endpoint) ?? 0) < 5000) return send(res, 429, { error: 'Wacht een paar seconden tussen testmeldingen' });
        lastTestPush.set(endpoint, now);
        const delay = Math.min(Math.max(Number(delaySeconds) || 0, 0), 60);
        const payload = {
          title: delay ? 'Testoproep (vertraagd)' : 'Testmelding',
          body: `Pushmeldingen werken. Verstuurd om ${new Date(now + delay * 1000).toLocaleTimeString('nl-NL', { timeZone: 'Europe/Amsterdam' })}.`,
          tag: 'test', url: '/', urgent: delay > 0,
        };
        if (delay) {
          setTimeout(() => pushTo(sub, payload).catch((e) => log('push fout', e.message)), delay * 1000);
          return send(res, 202, { ok: true, scheduledInSeconds: delay });
        }
        const result = await pushTo(sub, payload);
        return send(res, result.ok ? 200 : 502, result.ok ? { ok: true } : { error: `Push-dienst gaf status ${result.status}`, detail: result.body, gone: result.gone });
      }

      if (pathname.startsWith('/api/')) return send(res, 404, { error: 'Onbekend' });
      if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, pathname);
      return send(res, 405, 'Methode niet toegestaan');
    } catch (err) {
      log('fout', req.method, pathname, err.message);
      return send(res, err.status ?? 500, { error: err.status ? err.message : 'Serverfout' });
    }
  };
}

export function start() {
  const db = openDb(config.dataDir);
  const keys = loadVapid(db);
  if (!config.vapidSubject) log('LET OP: VAPID_SUBJECT is niet ingesteld (bijv. mailto:beheer@jouwdomein.nl). Apple weigert dan meldingen.');
  const vapid = { publicKey: keys.publicKey, privateKey: keys.privateKey, subject: config.vapidSubject || 'mailto:beheer@example.org' };
  const server = http.createServer(createApp({ db, vapid }));
  server.listen(config.port, config.host, () => {
    log(`EHBO-app ${config.version} (${config.commit.slice(0, 7)}) luistert op ${config.host}:${config.port}; data in ${config.dataDir}; VAPID-sleutels: ${keys.source}`);
  });
  const stop = () => { log('stoppen'); server.close(() => { db.close(); process.exit(0); }); setTimeout(() => process.exit(0), 5000).unref(); };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) start();
