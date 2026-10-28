import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { LiveRequest, LiveState, PushPayload } from '@ehbo/shared';
import { buildApp } from '../src/app.ts';
import { DEMO, seedDemo } from '../src/demo.ts';
import { openEventDb, type EventDb } from '../src/event-db.ts';
import { generateVapidKeys } from '../src/webpush.ts';

let app: ReturnType<typeof buildApp>;
let db: EventDb;
let dir: string;
let pushes: { phones: string[]; payload: PushPayload }[];
const cookies = new Map<string, string>();

async function call(phone: string, method: 'GET' | 'POST' | 'PUT', url: string, payload?: object) {
  if (!cookies.has(phone)) {
    const res = await app.inject({ url: '/api/session', method: 'POST', payload: { phone } });
    cookies.set(phone, `ehbo_sessie=${res.cookies.find((c) => c.name === 'ehbo_sessie')!.value}`);
  }
  return app.inject({ method, url, payload, headers: { cookie: cookies.get(phone)! } });
}

async function ok<T = LiveState>(phone: string, method: 'GET' | 'POST' | 'PUT', url: string, payload?: object) {
  const res = await call(phone, method, url, payload);
  assert.ok(res.statusCode < 300, `${method} ${url}: ${res.statusCode} ${res.body}`);
  return res.json() as T;
}

const WATER = () => (db.raw.prepare("SELECT id FROM posts WHERE name = 'Waterpost 3 · brug'").get() as { id: number }).id;
let n = 0;
const water = (detail: string | null = null) => ({ postId: WATER(), kind: 'water', detail, clientId: `aanvraag-${++n}-abcdef` });

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ehbo-requests-'));
  db = openEventDb(dir, 'test', { name: 'Testloop' });
  seedDemo(db);
  pushes = [];
  cookies.clear();
  app = buildApp({
    db,
    vapid: { ...generateVapidKeys(), subject: 'mailto:test@example.org' },
    build: { version: 'test', commit: 'x', builtAt: '' },
    calls: { notify: (phones, payload) => pushes.push({ phones: [...phones], payload }) },
  });
  await app.ready();
  await ok(DEMO.postLead, 'PUT', `/api/posts/${WATER()}/open`, { open: true });
});

afterEach(async () => {
  await app.close();
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('aanvraag van de post komt in de wachtrij van de coördinator, zonder alarm', async () => {
  const created = await call(DEMO.postLead, 'POST', '/api/requests', water('flink'));
  assert.equal(created.statusCode, 201, created.body);
  const req = created.json() as LiveRequest;
  assert.deepEqual([req.status, req.kind, req.detail, req.position], ['aangevraagd', 'water', 'flink', 1]);
  const push = pushes.find((p) => p.phones.includes(DEMO.coordinator))!.payload;
  assert.match(push.title, /Water · Waterpost 3/);
  assert.match(push.body, /Flink/);
  assert.ok(!push.urgent, 'geen alarm');

  const second = await ok<LiveRequest>(DEMO.postLead, 'POST', '/api/requests', { ...water(), kind: 'vrijwilliger', detail: 'aflossing' });
  assert.equal(second.position, 2, 'plek 2 in de wachtrij');
  const state = await ok(DEMO.coordinator, 'GET', '/api/live/state');
  assert.equal(state.requests.length, 2);
});

test('oppakken en afhandelen: alleen de coördinator, de post hoort het', async () => {
  const req = await ok<LiveRequest>(DEMO.postLead, 'POST', '/api/requests', water());
  assert.equal((await call(DEMO.postMember, 'POST', `/api/requests/${req.id}/pick`)).statusCode, 403);

  let state = await ok(DEMO.coordinator, 'POST', `/api/requests/${req.id}/pick`);
  assert.equal(state.requests[0]?.status, 'opgepakt');
  assert.equal(state.requests[0]?.pickedBy?.name, 'Cor Coördinator');
  assert.equal(pushes.at(-1)!.payload.title, 'Water wordt geregeld');
  assert.ok(pushes.at(-1)!.phones.includes(DEMO.postLead));
  assert.equal((await call(DEMO.admin, 'POST', `/api/requests/${req.id}/pick`)).statusCode, 409, 'al opgepakt');

  state = await ok(DEMO.coordinator, 'POST', `/api/requests/${req.id}/done`);
  assert.equal(state.requests[0]?.status, 'afgehandeld');
  assert.equal(state.requests[0]?.position, null);
  assert.equal(pushes.at(-1)!.payload.title, 'Water: afgehandeld');
});

test('de post vult aan of trekt in; een dichte post kan niets aanvragen; dubbel versturen telt één keer', async () => {
  const body = water();
  const req = await ok<LiveRequest>(DEMO.postLead, 'POST', '/api/requests', body);
  assert.equal((await ok<LiveRequest>(DEMO.postLead, 'POST', '/api/requests', body)).id, req.id);

  let state = await ok(DEMO.postLead, 'PUT', `/api/requests/${req.id}`, { detail: 'bijna_op' });
  assert.equal(state.requests[0]?.detail, 'bijna_op');
  assert.equal((await call(DEMO.postLead, 'PUT', `/api/requests/${req.id}`, { detail: 'aflossing' })).statusCode, 400, 'hoort bij vrijwilliger');
  state = await ok(DEMO.postLead, 'POST', `/api/requests/${req.id}/withdraw`);
  assert.equal(state.requests[0]?.status, 'ingetrokken');

  await ok(DEMO.postLead, 'PUT', `/api/posts/${WATER()}/open`, { open: false });
  assert.equal((await call(DEMO.postLead, 'POST', '/api/requests', water())).statusCode, 409);
  assert.equal((await call(DEMO.postMember, 'POST', '/api/requests', water())).statusCode, 403, 'niet je eigen post');
});
