import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { PushSubscriptionData } from '@ehbo/shared';
import { buildApp } from '../src/app.ts';
import { openDb, type Db } from '../src/db.ts';
import { generateVapidKeys, b64url } from '../src/webpush.ts';

let app: ReturnType<typeof buildApp>;
let db: Db;
let pushServer: http.Server;
let pushEndpoint: string;
let dir: string;
const received: { url: string; headers: http.IncomingHttpHeaders; body: Buffer }[] = [];

// Een minimale "gebouwde" webapp, zoals Vite die in web/dist zet.
function fakeWebDir(root: string) {
  const web = path.join(root, 'web');
  fs.mkdirSync(path.join(web, 'assets'), { recursive: true });
  fs.mkdirSync(path.join(web, 'icons'));
  fs.writeFileSync(path.join(web, 'index.html'), '<!doctype html><title>EHBO-app</title>');
  fs.writeFileSync(path.join(web, 'sw.js'), 'self.addEventListener("push", () => {});');
  fs.writeFileSync(path.join(web, 'manifest.webmanifest'), JSON.stringify({ display: 'standalone' }));
  fs.writeFileSync(path.join(web, 'assets', 'index-abc123.js'), 'console.log(1)');
  fs.writeFileSync(path.join(web, 'icons', 'icon-512.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  return web;
}

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ehbo-test-'));
  db = openDb(dir);
  app = buildApp({
    db,
    vapid: { ...generateVapidKeys(), subject: 'mailto:test@example.org' },
    build: { version: 'test', commit: 'abcdef0', builtAt: '' },
    webDir: fakeWebDir(dir),
    allowInsecureEndpoints: true,
  });
  await app.ready();

  pushServer = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      received.push({ url: req.url ?? '', headers: req.headers, body: Buffer.concat(chunks) });
      res.writeHead(req.url?.includes('gone') ? 410 : 201);
      res.end();
    });
  });
  await new Promise<void>((r) => pushServer.listen(0, '127.0.0.1', r));
  pushEndpoint = `http://127.0.0.1:${(pushServer.address() as AddressInfo).port}/push/device-1`;
});

after(async () => {
  await app.close();
  pushServer.close();
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const api = (url: string, method: 'GET' | 'POST' | 'DELETE' = 'GET', payload?: object) => app.inject({ url, method, payload });

function fakeSubscription(endpoint: string): PushSubscriptionData {
  const ua = crypto.createECDH('prime256v1');
  ua.generateKeys();
  return { endpoint, keys: { p256dh: b64url.encode(ua.getPublicKey()), auth: b64url.encode(crypto.randomBytes(16)) } };
}

test('healthz en info', async () => {
  assert.equal((await api('/healthz')).statusCode, 200);
  const res = await api('/api/info');
  assert.equal(res.headers['cache-control'], 'no-store');
  const info = res.json();
  assert.equal(b64url.decode(info.vapidPublicKey).length, 65);
  assert.equal(info.version, 'test');
  assert.equal(info.subscriptions, 0);
});

test('webapp: bestanden, cache-headers en terugval op index.html', async () => {
  const index = await api('/');
  assert.equal(index.statusCode, 200);
  assert.match(String(index.headers['content-type']), /text\/html/);
  assert.equal(index.headers['cache-control'], 'no-cache');

  const sw = await api('/sw.js');
  assert.equal(sw.headers['cache-control'], 'no-cache');
  assert.equal(sw.headers['service-worker-allowed'], '/');

  const manifest = await api('/manifest.webmanifest');
  assert.equal(manifest.headers['cache-control'], 'no-cache');
  assert.equal(manifest.json().display, 'standalone');

  assert.match(String((await api('/assets/index-abc123.js')).headers['cache-control']), /immutable/);
  assert.equal((await api('/icons/icon-512.png')).headers['cache-control'], 'public, max-age=3600');
  assert.equal((await api('/bestaat-niet.png')).statusCode, 404);
  assert.equal((await api('/api/bestaat-niet')).statusCode, 404);

  const route = await api('/een/app/route');
  assert.equal(route.statusCode, 200, 'app-routes vallen terug op index.html');
  assert.match(route.body, /<title>EHBO-app/);
  assert.notEqual((await api('/..%2f..%2fapp.sqlite')).statusCode, 200, 'geen toegang buiten de webmap');
});

test('ongeldig abonnement wordt geweigerd', async () => {
  assert.equal((await api('/api/subscriptions', 'POST', { subscription: { endpoint: 'ftp://x', keys: { p256dh: 'a', auth: 'b' } } })).statusCode, 400);
  assert.equal((await api('/api/subscriptions', 'POST', { subscription: { endpoint: 'https://x' } })).statusCode, 400);
  const badJson = await app.inject({ url: '/api/subscriptions', method: 'POST', headers: { 'content-type': 'application/json' }, payload: 'geen json' });
  assert.equal(badJson.statusCode, 400);
  assert.ok(badJson.json().error);
});

test('aanmelden, testmelding versturen en bericht komt versleuteld aan', async () => {
  const sub = fakeSubscription(pushEndpoint);
  assert.equal((await api('/api/subscriptions', 'POST', { subscription: sub })).statusCode, 200);
  assert.equal((await api('/api/info')).json().subscriptions, 1);

  const res = await api('/api/test-push', 'POST', { endpoint: sub.endpoint });
  assert.equal(res.statusCode, 200, res.body);
  const msg = received.at(-1)!;
  assert.equal(msg.url, '/push/device-1');
  assert.equal(msg.headers['content-encoding'], 'aes128gcm');
  assert.equal(msg.headers.urgency, 'high');
  assert.match(String(msg.headers.authorization), /^vapid t=.+, k=.+$/);

  // Direct opnieuw: wordt afgeremd.
  assert.equal((await api('/api/test-push', 'POST', { endpoint: sub.endpoint })).statusCode, 429);
});

test('vertraagde testmelding wordt ingepland, te lange vertraging geweigerd', async () => {
  const sub = fakeSubscription(pushEndpoint.replace('device-1', 'device-2'));
  await api('/api/subscriptions', 'POST', { subscription: sub });
  assert.equal((await api('/api/test-push', 'POST', { endpoint: sub.endpoint, delaySeconds: 3600 })).statusCode, 400);
  const res = await api('/api/test-push', 'POST', { endpoint: sub.endpoint, delaySeconds: 10 });
  assert.equal(res.statusCode, 202);
  assert.equal(res.json().scheduledInSeconds, 10);
});

test('verlopen abonnement (410) wordt opgeruimd', async () => {
  const sub = fakeSubscription(pushEndpoint.replace('device-1', 'gone'));
  await api('/api/subscriptions', 'POST', { subscription: sub });
  const res = await api('/api/test-push', 'POST', { endpoint: sub.endpoint });
  assert.equal(res.statusCode, 502);
  assert.equal(res.json().gone, true);
  assert.equal(db.getSubscription(sub.endpoint), undefined);
});

test('afmelden verwijdert het abonnement', async () => {
  const sub = fakeSubscription(pushEndpoint.replace('device-1', 'device-3'));
  await api('/api/subscriptions', 'POST', { subscription: sub });
  assert.equal((await api('/api/subscriptions', 'DELETE', { endpoint: sub.endpoint })).statusCode, 200);
  assert.equal(db.getSubscription(sub.endpoint), undefined);
});

test('testmelding voor onbekend abonnement geeft 404', async () => {
  assert.equal((await api('/api/test-push', 'POST', { endpoint: 'https://onbekend.example/x' })).statusCode, 404);
});
