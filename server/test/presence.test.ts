// Logged in or not: a post or team with nobody logged in is closed. Also logging everyone out, and test sessions that end at midnight.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { PushPayload } from '@ehbo/shared';
import { buildApp } from '../src/app.ts';
import { nextMidnight, sessionExpiry } from '../src/auth.ts';
import { DEMO, seedDemo } from '../src/demo.ts';
import { openEventDb, type EventDb } from '../src/event-db.ts';
import { generateVapidKeys } from '../src/webpush.ts';

let app: ReturnType<typeof buildApp>;
let db: EventDb;
let dir: string;
let pushes: { phones: string[]; payload: PushPayload }[];

const set = (query: string, ...params: (string | number | null)[]) => db.raw.prepare(query).run(...params);
const isOpen = (name: string) => (db.raw.prepare('SELECT is_open FROM posts WHERE name = ?').get(name) as { is_open: number }).is_open === 1;
const availability = (name: string) => (db.raw.prepare('SELECT availability FROM ehbo_units WHERE name = ?').get(name) as { availability: string }).availability;
const subscriptions = (phone: string) => (db.raw.prepare('SELECT COUNT(*) AS n FROM subscriptions WHERE phone = ?').get(phone) as { n: number }).n;
const WATER = 'Waterpost 3 · brug';
const CROSSING = 'Kruising 4';
const EHBO_POST = 'EHBO-post 1 · start';

const start = async () => {
  app = buildApp({
    db,
    vapid: { ...generateVapidKeys(), subject: 'mailto:test@example.org' },
    build: { version: 'test', commit: 'abcdef0', builtAt: '' },
    calls: { notify: (phones, payload) => pushes.push({ phones: [...phones], payload }) },
  });
  await app.ready();
};

async function login(phone: string) {
  const res = await app.inject({ url: '/api/session', method: 'POST', payload: { phone } });
  assert.equal(res.statusCode, 200, res.body);
  return `ehbo_sessie=${res.cookies.find((c) => c.name === 'ehbo_sessie')!.value}`;
}
const logout = (cookie: string, payload?: object) => app.inject({ url: '/api/session', method: 'DELETE', payload, headers: { cookie } });
const me = (cookie: string) => app.inject({ url: '/api/me', headers: { cookie } });
const subscribe = (phone: string, endpoint: string) => set("INSERT INTO subscriptions (endpoint, phone, p256dh, auth) VALUES (?, ?, 'k', 'a')", endpoint, phone);

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ehbo-presence-'));
  db = openEventDb(dir, 'test', { name: 'Test' });
  seedDemo(db);
  pushes = [];
  await start();
});

afterEach(async () => {
  await app.close();
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the last one to log out closes the post, and the coordinator hears it', async () => {
  const wim = await login(DEMO.postLead);
  const vera = await login(DEMO.postMember);
  set('UPDATE posts SET is_open = 1 WHERE name IN (?, ?)', WATER, CROSSING);

  await logout(vera);
  assert.equal(isOpen(CROSSING), true, 'Wim is still at Kruising 4');
  await logout(wim);
  assert.equal(isOpen(CROSSING), false);
  assert.equal(isOpen(WATER), false);
  assert.ok(pushes.some((p) => p.phones.includes(DEMO.coordinator) && p.payload.body.includes(WATER)));
});

test('the first one to log in finds the post closed; a second device changes nothing', async () => {
  set('UPDATE posts SET is_open = 1 WHERE name = ?', WATER);
  await login(DEMO.postLead);
  assert.equal(isOpen(WATER), false, 'a wrong status from before is gone');
  set('UPDATE posts SET is_open = 1 WHERE name = ?', WATER);
  await login(DEMO.postLead);
  assert.equal(isOpen(WATER), true);
});

test('an EHBO team goes off duty with its post when its last member logs out', async () => {
  const eva = await login(DEMO.ehbo);
  set("UPDATE ehbo_units SET availability = 'vrij' WHERE name = 'Team 1'");
  set('UPDATE posts SET is_open = 1 WHERE name = ?', EHBO_POST);
  await logout(eva);
  assert.equal(availability('Team 1'), 'uit_dienst');
  assert.equal(isOpen(EHBO_POST), false);
});

test('logging out stops the pushes of that phone, and of a number logged in nowhere', async () => {
  const phone = await login(DEMO.postLead);
  const tablet = await login(DEMO.postLead);
  subscribe(DEMO.postLead, 'https://push.example/phone');
  subscribe(DEMO.postLead, 'https://push.example/tablet');
  await logout(phone, { endpoint: 'https://push.example/phone' });
  assert.equal(subscriptions(DEMO.postLead), 1, 'the tablet still gets calls');
  await logout(tablet);
  assert.equal(subscriptions(DEMO.postLead), 0);
});

test('sessions that ran out count as logging out', async () => {
  await login(DEMO.postLead);
  set('UPDATE posts SET is_open = 1 WHERE name = ?', WATER);
  set("UPDATE sessions SET expires_at = '2000-01-01 00:00:00'");
  await app.close();
  await start();
  assert.equal(isOpen(WATER), false);
});

test('in the test mode a session lasts until midnight, also one that was already there', async () => {
  assert.equal(sessionExpiry('2026-12-31', new Date('2026-12-30T15:00:00Z'), true).toISOString(), '2026-12-30T23:00:00.000Z');
  assert.equal(nextMidnight(new Date('2026-07-01T10:00:00Z')).toISOString(), '2026-07-01T22:00:00.000Z', 'summer time');

  await login(DEMO.postLead);
  const admin = await login(DEMO.admin);
  await app.inject({ url: '/api/admin/test-mode', method: 'PUT', payload: { on: true }, headers: { cookie: admin } });
  const latest = (db.raw.prepare('SELECT MAX(expires_at) AS at FROM sessions').get() as { at: string }).at;
  assert.ok(new Date(`${latest.replace(' ', 'T')}Z`) <= nextMidnight());
});

test('everyone logged out, except the admin who pressed it', async () => {
  const wim = await login(DEMO.postLead);
  const admin = await login(DEMO.admin);
  subscribe(DEMO.postLead, 'https://push.example/wim');
  subscribe(DEMO.admin, 'https://push.example/admin');
  set('UPDATE posts SET is_open = 1 WHERE name = ?', WATER);

  const state = await app.inject({ url: '/api/admin/logout-all', method: 'POST', headers: { cookie: admin } });
  assert.equal(state.statusCode, 200);
  assert.equal(state.json().sessions, 1);
  assert.equal((await me(wim)).statusCode, 401);
  assert.equal((await me(admin)).statusCode, 200);
  assert.equal(subscriptions(DEMO.postLead), 0);
  assert.equal(subscriptions(DEMO.admin), 1);
  assert.equal(isOpen(WATER), false);
});
