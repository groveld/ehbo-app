import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { requestsOf, type HelpRequestType, type LiveRequest, type LiveState, type PushPayload } from '@ehbo/shared';
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
    const res = await app.inject({ url: '/api/session', method: 'POST', payload: { phone, code: '31' } });
    cookies.set(phone, `session=${res.cookies.find((c) => c.name === 'session')!.value}`);
  }
  return app.inject({ method, url, payload, headers: { cookie: cookies.get(phone)! } });
}

async function ok<T = LiveState>(phone: string, method: 'GET' | 'POST' | 'PUT', url: string, payload?: object) {
  const res = await call(phone, method, url, payload);
  assert.ok(res.statusCode < 300, `${method} ${url}: ${res.statusCode} ${res.body}`);
  return res.json() as T;
}

const WATER = () => (db.raw.prepare("SELECT id FROM locations WHERE name = 'Waterpost 3 · brug'").get() as { id: number }).id;
let n = 0;
const water = (detail: string | null = null) => ({ type: 'water', locationId: WATER(), detail, clientId: `aanvraag-${++n}-abcdef` });

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
  await ok(DEMO.locationLead, 'PUT', `/api/locations/${WATER()}/open`, { open: true });
});

afterEach(async () => {
  await app.close();
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('aanvraag van de post komt in de wachtrij van de coördinator, zonder alarm', async () => {
  const created = await call(DEMO.locationLead, 'POST', '/api/help-requests', water('lots'));
  assert.equal(created.statusCode, 201, created.body);
  const req = created.json() as LiveRequest;
  assert.deepEqual([req.status, req.type, req.detail, req.position], ['sent', 'water', 'lots', 1]);
  const push = pushes.find((p) => p.phones.includes(DEMO.coordinator))!.payload;
  assert.match(push.title, /Water · Waterpost 3/);
  assert.match(push.body, /Flink/);
  assert.ok(!push.urgent, 'geen alarm');

  const second = await ok<LiveRequest>(DEMO.locationLead, 'POST', '/api/help-requests', { ...water(), type: 'volunteer', detail: 'relief' });
  assert.equal(second.position, 2, 'plek 2 in de wachtrij');
  const state = await ok(DEMO.coordinator, 'GET', '/api/live/state');
  assert.equal(requestsOf(state).length, 2);
});

test('oppakken en afhandelen: alleen de coördinator, de post hoort het', async () => {
  const req = await ok<LiveRequest>(DEMO.locationLead, 'POST', '/api/help-requests', water());
  assert.equal((await call(DEMO.locationMember, 'POST', `/api/help-requests/${req.id}/pick`)).statusCode, 403);

  let state = await ok(DEMO.coordinator, 'POST', `/api/help-requests/${req.id}/pick`);
  assert.equal(requestsOf(state)[0]?.status, 'accepted');
  assert.equal(requestsOf(state)[0]?.acceptedBy?.name, 'Cor Coördinator');
  assert.equal(pushes.at(-1)!.payload.title, 'Water wordt geregeld');
  assert.ok(pushes.at(-1)!.phones.includes(DEMO.locationLead));
  assert.equal((await call(DEMO.admin, 'POST', `/api/help-requests/${req.id}/pick`)).statusCode, 409, 'al opgepakt');

  state = await ok(DEMO.coordinator, 'POST', `/api/help-requests/${req.id}/done`);
  assert.equal(requestsOf(state)[0]?.status, 'closed');
  assert.equal(requestsOf(state)[0]?.position, null);
  assert.equal(pushes.at(-1)!.payload.title, 'Water: afgehandeld');
});

test('de post vult aan of trekt in; een dichte post kan niets aanvragen; dubbel versturen telt één keer', async () => {
  const body = water();
  const req = await ok<LiveRequest>(DEMO.locationLead, 'POST', '/api/help-requests', body);
  assert.equal((await ok<LiveRequest>(DEMO.locationLead, 'POST', '/api/help-requests', body)).id, req.id);

  let state = await ok(DEMO.locationLead, 'PUT', `/api/help-requests/${req.id}`, { detail: 'almost_empty' });
  assert.equal(requestsOf(state)[0]?.detail, 'almost_empty');
  assert.equal((await call(DEMO.locationLead, 'PUT', `/api/help-requests/${req.id}`, { detail: 'relief' })).statusCode, 400, 'hoort bij vrijwilliger');
  state = await ok(DEMO.locationLead, 'POST', `/api/help-requests/${req.id}/withdraw`);
  assert.equal(requestsOf(state)[0]?.status, 'withdrawn');

  await ok(DEMO.locationLead, 'PUT', `/api/locations/${WATER()}/open`, { open: false });
  assert.equal((await call(DEMO.locationLead, 'POST', '/api/help-requests', water())).statusCode, 409);
  assert.equal((await call(DEMO.locationMember, 'POST', '/api/help-requests', water())).statusCode, 403, 'niet je eigen post');
});

test('a new kind of help request is a row, not code: its name, choices and handling come from the table', async () => {
  const add = db.raw.prepare('INSERT INTO help_request_types (key, name, handling, sort, sub, ask, choices_json, icon) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  add.run('parking', 'Parkeren', 'queue', 4, 'Hulp bij parkeren', 'Wat is er?', JSON.stringify([{ key: 'full', label: 'Vol' }]), 'more');
  add.run('lost_child', 'Kind kwijt', 'dispatch', 5, null, null, '[]', 'more');

  const pkg = await ok<{ helpRequestTypes: HelpRequestType[] }>(DEMO.locationLead, 'GET', '/api/package');
  assert.deepEqual(pkg.helpRequestTypes.map((t) => t.key), ['first_aid', 'water', 'traffic', 'volunteer', 'parking', 'lost_child']);
  assert.equal(pkg.helpRequestTypes.find((t) => t.key === 'parking')!.colors.bg, '#F0EFEA', 'no colours of its own: the plain ones');

  const req = await ok<LiveRequest>(DEMO.locationLead, 'POST', '/api/help-requests', { ...water('full'), type: 'parking' });
  assert.deepEqual([req.type, req.handling, req.detail], ['parking', 'queue', 'full']);
  const push = pushes.find((p) => p.phones.includes(DEMO.coordinator))!.payload;
  assert.match(push.title, /Parkeren · Waterpost 3/);
  assert.match(push.body, /Vol/);
  assert.equal((await call(DEMO.locationLead, 'PUT', `/api/help-requests/${req.id}`, { detail: 'lots' })).statusCode, 400, 'a choice of water');

  const incident = await call(DEMO.locationLead, 'POST', '/api/help-requests', {
    type: 'lost_child', locationId: WATER(), clientId: `kind-${++n}-abcdef`, what: 'unknown', persons: '1', responsive: null, note: null,
  });
  assert.equal(incident.statusCode, 201, incident.body);
  assert.deepEqual([incident.json().type, incident.json().handling, incident.json().status], ['lost_child', 'dispatch', 'sent']);
  assert.equal((await call(DEMO.locationLead, 'POST', '/api/help-requests', { ...water(), type: 'pizza' })).statusCode, 400, 'unknown kind');
});
