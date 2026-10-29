import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Me, PushSubscriptionData } from '@ehbo/shared';
import { buildApp } from '../src/app.ts';
import { sessionExpiry } from '../src/auth.ts';
import { DEMO, seedDemo } from '../src/demo.ts';
import { openEventDb, type EventDb } from '../src/event-db.ts';
import { generateVapidKeys, b64url } from '../src/webpush.ts';

let app: ReturnType<typeof buildApp>;
let db: EventDb;
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
  fs.writeFileSync(path.join(web, 'assets', 'index-abc123.js'), 'console.log(1)');
  fs.writeFileSync(path.join(web, 'icons', 'icon-512.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  return web;
}

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ehbo-test-'));
  db = openEventDb(dir, 'test', { name: 'Testloop', adminPhone: '+31699999999' });
  seedDemo(db);
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

type Method = 'GET' | 'POST' | 'DELETE';
const api = (url: string, method: Method = 'GET', payload?: object, cookie?: string) =>
  app.inject({ url, method, payload, headers: cookie ? { cookie } : {} });

/** Meldt aan en geeft de cookie terug voor volgende verzoeken. */
async function login(phone: string, remoteAddress = '10.0.0.1') {
  const res = await app.inject({ url: '/api/session', method: 'POST', payload: { phone }, remoteAddress });
  assert.equal(res.statusCode, 200, res.body);
  const cookie = res.cookies.find((c) => c.name === 'ehbo_sessie');
  assert.ok(cookie, 'sessiecookie gezet');
  return { me: res.json() as Me, cookie: `ehbo_sessie=${cookie.value}`, raw: cookie };
}

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
  assert.equal(manifest.json().name, 'Silvesterloop 2026', 'manifest komt van de server, met de naam van het evenement');
  assert.equal(manifest.json().short_name, 'Silvesterloo', 'zonder korte naam de eerste 12 tekens');
  assert.match(manifest.json().icons[0].src, /^\/brand\/icon-192\.png\?v=\d+$/);
  const icon = await api('/brand/icon-192.png');
  assert.equal(icon.statusCode, 302, 'zonder eigen logo het standaardicoon');
  assert.equal(icon.headers.location, '/icons/icon-192.png');
  assert.equal((await api('/brand/logo.png')).statusCode, 404);
  assert.equal((await api('/brand/onzin.png')).statusCode, 404);
  assert.match(String((await api('/assets/index-abc123.js')).headers['cache-control']), /immutable/);
  assert.equal((await api('/icons/icon-512.png')).headers['cache-control'], 'public, max-age=3600');
  assert.equal((await api('/bestaat-niet.png')).statusCode, 404);
  assert.equal((await api('/api/bestaat-niet')).statusCode, 404);

  const route = await api('/aanmelden');
  assert.equal(route.statusCode, 200, 'app-routes vallen terug op index.html');
  assert.match(route.body, /<title>EHBO-app/);
  assert.notEqual((await api('/..%2f..%2fevents%2ftest.sqlite')).statusCode, 200, 'geen toegang buiten de webmap');
});

test('openbare evenementgegevens met ingevulde info-tekst', async () => {
  const event = (await api('/api/event')).json();
  assert.equal(event.name, 'Silvesterloop 2026');
  assert.equal(event.startDate, '2026-12-31');
  assert.match(event.info[0].body, /tijdens Silvesterloop 2026/);
  assert.doesNotMatch(JSON.stringify(event), /\{evenement\}|\+316/, 'geen plaatshouders en geen telefoonnummers');
});

test('nieuw evenement krijgt standaardsoorten, kernteam en de eerste beheerder', () => {
  const types = db.raw.prepare('SELECT name FROM post_types ORDER BY sort').all().map((r) => r.name);
  assert.deepEqual(types, ['Start/finish', 'Waterpost', 'Stempelpost', 'Verkeer', 'EHBO-post', 'Anders']);
  assert.equal(db.coordinatorPhone(), DEMO.coordinator);
  assert.ok(db.isAdmin('+31699999999'), 'ADMIN_PHONE is beheerder');

  // Opnieuw openen voegt geen tweede set toe en maakt een verwijderde beheerder niet opnieuw aan.
  db.raw.prepare('DELETE FROM admins WHERE phone = ?').run('+31699999999');
  const again = openEventDb(dir, 'test', { name: 'Testloop', adminPhone: '+31699999999' });
  assert.equal((again.raw.prepare('SELECT COUNT(*) AS n FROM post_types').get() as { n: number }).n, 6);
  assert.equal(again.isAdmin('+31699999999'), false);
  again.close();
});

test('aanmelden met een bekend nummer: rollen, startscherm en cookie', async () => {
  const lead = await login('06-00 00 00 04');
  assert.equal(lead.me.name, 'Wim Water');
  assert.equal(lead.me.home, 'post', 'postverantwoordelijke start bij de eigen post');
  assert.equal(lead.raw.httpOnly, true);
  assert.equal(lead.raw.sameSite, 'Lax');
  const [first, second] = lead.me.assignments;
  assert.equal(first?.title, 'Verkeersregelaar', 'vroegste dienst eerst; verkeerspost toont de eigen benaming');
  assert.equal(first?.times, '08:30 – 10:00');
  assert.equal(second?.title, 'Postverantwoordelijke');
  assert.equal(second?.detail, 'Waterpost 3 · brug · km 10,5');
  assert.equal(second?.letter, 'W');

  assert.equal((await login(DEMO.ehbo)).me.home, 'ehbo');
  assert.equal((await login(DEMO.postMember)).me.home, 'post', 'ook een lid van een post begint bij de post');
  const coordinator = (await login(DEMO.coordinator)).me;
  assert.equal(coordinator.home, 'post', 'kernteam met een post begint bij de post');
  assert.equal(coordinator.assignments[0]?.title, 'Evenementcoördinator');
  const admin = (await login(DEMO.admin)).me;
  assert.equal(admin.isAdmin, true);
  assert.equal(admin.home, 'overzicht');

  const me = await api('/api/me', 'GET', undefined, lead.cookie);
  assert.equal(me.statusCode, 200);
  assert.equal(me.json().phone, DEMO.postLead);
});

test('onbekend en ongeldig nummer', async () => {
  const unknown = await app.inject({ url: '/api/session', method: 'POST', payload: { phone: '0611111111' }, remoteAddress: '10.0.0.2' });
  assert.equal(unknown.statusCode, 404);
  assert.deepEqual(unknown.json(), { error: 'Dit nummer staat niet in de lijst', phone: '+31611111111', coordinatorPhone: DEMO.coordinator });
  assert.equal(unknown.cookies.length, 0);
  const invalid = await app.inject({ url: '/api/session', method: 'POST', payload: { phone: '12345' }, remoteAddress: '10.0.0.2' });
  assert.equal(invalid.statusCode, 400);
  const log = db.raw.prepare('SELECT phone, result FROM login_log WHERE phone = ?').all('+31611111111');
  assert.deepEqual(log.map((r) => r.result), ['onbekend']);
});

test('mislukte aanmeldpogingen vanaf één adres worden afgeremd, gelukte niet', async () => {
  for (let i = 0; i < 12; i++) await login(DEMO.postMember, '10.0.0.98');
  const attempt = () => app.inject({ url: '/api/session', method: 'POST', payload: { phone: '0611111111' }, remoteAddress: '10.0.0.99' });
  for (let i = 0; i < 10; i++) assert.equal((await attempt()).statusCode, 404);
  assert.equal((await attempt()).statusCode, 429);
  const known = await app.inject({ url: '/api/session', method: 'POST', payload: { phone: DEMO.postMember }, remoteAddress: '10.0.0.99' });
  assert.equal(known.statusCode, 429, 'ook een bekend nummer moet even wachten');
});

test('zonder aanmelding geen persoonlijke routes', async () => {
  assert.equal((await api('/api/me')).statusCode, 401);
  assert.equal((await api('/api/me', 'GET', undefined, 'ehbo_sessie=verzonnen')).statusCode, 401);
  assert.equal((await api('/api/subscriptions', 'POST', { subscription: fakeSubscription(pushEndpoint) })).statusCode, 401);
  assert.equal((await api('/api/test-push', 'POST', { endpoint: pushEndpoint })).statusCode, 401);
});

test('afmelden maakt de sessie ongeldig', async () => {
  const { cookie } = await login(DEMO.postMember);
  const out = await api('/api/session', 'DELETE', undefined, cookie);
  assert.equal(out.statusCode, 204);
  assert.equal((await api('/api/me', 'GET', undefined, cookie)).statusCode, 401);
});

test('wie nergens meer is ingepland, is direct afgemeld', async () => {
  db.raw.prepare('INSERT INTO people (phone, name) VALUES (?, ?)').run('+31600000099', 'Tijdelijk');
  const traffic = db.raw.prepare("SELECT id FROM posts WHERE name = 'Kruising 4'").get() as { id: number };
  db.raw.prepare("INSERT INTO post_contacts (post_id, phone, role) VALUES (?, ?, 'reserve')").run(traffic.id, '+31600000099');
  const { cookie } = await login('+31600000099');
  db.raw.prepare('DELETE FROM post_contacts WHERE phone = ?').run('+31600000099');
  assert.equal((await api('/api/me', 'GET', undefined, cookie)).statusCode, 401);
});

test('info en voorwaarden eenmalig bevestigen', async () => {
  const { me, cookie } = await login(DEMO.ehbo);
  assert.equal(me.infoAccepted, false);
  assert.equal((await api('/api/me/info-accepted', 'POST', undefined, cookie)).statusCode, 204);
  assert.equal((await api('/api/me', 'GET', undefined, cookie)).json().infoAccepted, true);
});

test('sessie loopt tot de dag na het evenement, zonder einddatum 60 dagen', () => {
  const now = new Date('2026-10-28T12:00:00Z');
  assert.equal(sessionExpiry('2026-12-31', now).toISOString(), '2027-01-02T00:00:00.000Z');
  assert.equal(sessionExpiry(null, now).toISOString(), '2026-12-27T12:00:00.000Z');
  assert.equal(sessionExpiry('2026-01-01', now).toISOString(), '2026-10-29T12:00:00.000Z', 'evenement voorbij: nog één dag');
});

test('ongeldig abonnement wordt geweigerd', async () => {
  const { cookie } = await login(DEMO.ehbo);
  const bad = await api('/api/subscriptions', 'POST', { subscription: { endpoint: 'ftp://x', keys: { p256dh: 'a', auth: 'b' } } }, cookie);
  assert.equal(bad.statusCode, 400);
  assert.equal((await api('/api/subscriptions', 'POST', { subscription: { endpoint: 'https://x' } }, cookie)).statusCode, 400);
  const badJson = await app.inject({ url: '/api/subscriptions', method: 'POST', headers: { 'content-type': 'application/json', cookie }, payload: 'geen json' });
  assert.equal(badJson.statusCode, 400);
});

test('aanmelden voor meldingen, testmelding komt versleuteld aan', async () => {
  const { cookie } = await login(DEMO.ehbo);
  const sub = fakeSubscription(pushEndpoint);
  assert.equal((await api('/api/subscriptions', 'POST', { subscription: sub }, cookie)).statusCode, 200);
  assert.equal(db.getSubscription(sub.endpoint)?.phone, DEMO.ehbo, 'abonnement hoort bij de medewerker');

  const res = await api('/api/test-push', 'POST', { endpoint: sub.endpoint }, cookie);
  assert.equal(res.statusCode, 200, res.body);
  const msg = received.at(-1)!;
  assert.equal(msg.url, '/push/device-1');
  assert.equal(msg.headers['content-encoding'], 'aes128gcm');
  assert.match(String(msg.headers.authorization), /^vapid t=.+, k=.+$/);

  // Direct opnieuw: wordt afgeremd.
  assert.equal((await api('/api/test-push', 'POST', { endpoint: sub.endpoint }, cookie)).statusCode, 429);
});

test('testmelding alleen naar je eigen toestel', async () => {
  const owner = await login(DEMO.coordinator);
  const other = await login(DEMO.postMember);
  const sub = fakeSubscription(pushEndpoint.replace('device-1', 'device-4'));
  await api('/api/subscriptions', 'POST', { subscription: sub }, owner.cookie);
  assert.equal((await api('/api/test-push', 'POST', { endpoint: sub.endpoint }, other.cookie)).statusCode, 404);
  await api('/api/subscriptions', 'DELETE', { endpoint: sub.endpoint }, other.cookie);
  assert.ok(db.getSubscription(sub.endpoint), 'een ander kan je abonnement niet verwijderen');
});

test('vertraagde testmelding wordt ingepland, te lange vertraging geweigerd', async () => {
  const { cookie } = await login(DEMO.ehbo);
  const sub = fakeSubscription(pushEndpoint.replace('device-1', 'device-2'));
  await api('/api/subscriptions', 'POST', { subscription: sub }, cookie);
  assert.equal((await api('/api/test-push', 'POST', { endpoint: sub.endpoint, delaySeconds: 3600 }, cookie)).statusCode, 400);
  const res = await api('/api/test-push', 'POST', { endpoint: sub.endpoint, delaySeconds: 10 }, cookie);
  assert.equal(res.statusCode, 202);
  assert.equal(res.json().scheduledInSeconds, 10);
});

test('verlopen abonnement (410) wordt opgeruimd', async () => {
  const { cookie } = await login(DEMO.ehbo);
  const sub = fakeSubscription(pushEndpoint.replace('device-1', 'gone'));
  await api('/api/subscriptions', 'POST', { subscription: sub }, cookie);
  const res = await api('/api/test-push', 'POST', { endpoint: sub.endpoint }, cookie);
  assert.equal(res.statusCode, 502);
  assert.equal(res.json().gone, true);
  assert.equal(db.getSubscription(sub.endpoint), undefined);
});

test('afmelden voor meldingen verwijdert het abonnement', async () => {
  const { cookie } = await login(DEMO.ehbo);
  const sub = fakeSubscription(pushEndpoint.replace('device-1', 'device-3'));
  await api('/api/subscriptions', 'POST', { subscription: sub }, cookie);
  assert.equal((await api('/api/subscriptions', 'DELETE', { endpoint: sub.endpoint }, cookie)).statusCode, 200);
  assert.equal(db.getSubscription(sub.endpoint), undefined);
});
