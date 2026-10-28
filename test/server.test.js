import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.js';
import { openDb } from '../src/db.js';
import { generateVapidKeys, b64url } from '../src/webpush.js';

let app, base, db, pushServer, pushEndpoint, dir;
const received = [];

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ehbo-test-'));
  db = openDb(dir);
  const vapid = { ...generateVapidKeys(), subject: 'mailto:test@example.org' };
  app = http.createServer(createApp({ db, vapid, allowInsecureEndpoints: true }));
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.address().port}`;

  pushServer = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => { received.push({ url: req.url, headers: req.headers, body: Buffer.concat(chunks) }); res.writeHead(req.url.includes('gone') ? 410 : 201); res.end(); });
  });
  await new Promise((r) => pushServer.listen(0, '127.0.0.1', r));
  pushEndpoint = `http://127.0.0.1:${pushServer.address().port}/push/device-1`;
});

after(() => { app.close(); pushServer.close(); db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

const json = (p, method = 'GET', body) => fetch(base + p, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
function fakeSubscription(endpoint) {
  const ua = crypto.createECDH('prime256v1');
  ua.generateKeys();
  return { endpoint, keys: { p256dh: b64url.encode(ua.getPublicKey()), auth: b64url.encode(crypto.randomBytes(16)) } };
}

test('healthz en info', async () => {
  assert.equal((await fetch(base + '/healthz')).status, 200);
  const info = await (await json('/api/info')).json();
  assert.equal(b64url.decode(info.vapidPublicKey).length, 65);
  assert.equal(info.subscriptions, 0);
});

test('statische bestanden, versie in service worker en juiste cache-headers', async () => {
  const index = await fetch(base + '/');
  assert.equal(index.status, 200);
  assert.match(index.headers.get('content-type'), /text\/html/);
  assert.doesNotMatch(await index.text(), /__APP_VERSION__/);
  const sw = await fetch(base + '/sw.js');
  assert.equal(sw.headers.get('cache-control'), 'no-cache');
  assert.doesNotMatch(await sw.text(), /__APP_VERSION__/);
  const manifest = await fetch(base + '/manifest.webmanifest');
  assert.equal(manifest.headers.get('content-type'), 'application/manifest+json');
  assert.equal((await manifest.json()).display, 'standalone');
  assert.equal((await fetch(base + '/icons/icon-512.png')).status, 200);
  assert.equal((await fetch(base + '/bestaat-niet.png')).status, 404);
  assert.equal((await fetch(base + '/een/app/route')).status, 200, 'app-routes vallen terug op index.html');
  assert.equal((await fetch(base + '/..%2fsrc/server.js')).status, 400, 'geen toegang buiten public/');
});

test('ongeldig abonnement wordt geweigerd', async () => {
  assert.equal((await json('/api/subscriptions', 'POST', { subscription: { endpoint: 'ftp://x' } })).status, 400);
  assert.equal((await fetch(base + '/api/subscriptions', { method: 'POST', body: 'geen json' })).status, 400);
});

test('aanmelden, testmelding versturen en bericht komt versleuteld aan', async () => {
  const sub = fakeSubscription(pushEndpoint);
  assert.equal((await json('/api/subscriptions', 'POST', { subscription: sub })).status, 200);
  assert.equal((await (await json('/api/info')).json()).subscriptions, 1);

  const res = await json('/api/test-push', 'POST', { endpoint: sub.endpoint });
  assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
  const msg = received.at(-1);
  assert.equal(msg.url, '/push/device-1');
  assert.equal(msg.headers['content-encoding'], 'aes128gcm');
  assert.equal(msg.headers.urgency, 'high');
  assert.match(msg.headers.authorization, /^vapid t=.+, k=.+$/);

  // Direct opnieuw: wordt afgeremd.
  assert.equal((await json('/api/test-push', 'POST', { endpoint: sub.endpoint })).status, 429);
});

test('verlopen abonnement (410) wordt opgeruimd', async () => {
  const sub = fakeSubscription(pushEndpoint.replace('device-1', 'gone'));
  await json('/api/subscriptions', 'POST', { subscription: sub });
  const res = await json('/api/test-push', 'POST', { endpoint: sub.endpoint });
  assert.equal(res.status, 502);
  assert.equal((await res.json()).gone, true);
  assert.equal(db.getSubscription(sub.endpoint), undefined);
});

test('testmelding voor onbekend abonnement geeft 404', async () => {
  assert.equal((await json('/api/test-push', 'POST', { endpoint: 'https://onbekend.example/x' })).status, 404);
});
