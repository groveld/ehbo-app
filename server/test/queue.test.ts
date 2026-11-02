// Changes from a phone without signal: applied on the phone at once, carried out once by the server, with the time they really happened.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyAction, type ActionContext, type LiveAction, type LiveIncident, type LiveState, type NewIncident } from '@ehbo/shared';
import { buildApp } from '../src/app.ts';
import { DEMO, seedDemo } from '../src/demo.ts';
import { openEventDb } from '../src/event-db.ts';
import { generateVapidKeys } from '../src/webpush.ts';

const AT = '2026-12-31T11:00:00.000Z';
const context: ActionContext = {
  me: { name: 'Mo', phone: '0600000006' },
  units: [
    { id: 1, name: 'Team 1', kind: 'vast', postId: 10, members: [{ phone: '0600000005' }] },
    { id: 2, name: 'Team 2', kind: 'mobiel', postId: 11, members: [{ phone: '0600000006' }] },
  ],
};

const incident = (changes: Partial<LiveIncident> = {}): LiveIncident => ({
  id: 7, isTest: false, postId: 20, post: { typeId: 1, name: 'Waterpost', km: 3, lat: 53, lng: 5 }, status: 'verstuurd', stage: 'dichtstbij', aed: false,
  reportedAt: AT, sentAt: AT, escalatesAt: AT, unitId: null, acceptedBy: null, acceptedAt: null, onSiteAt: null, closedAt: null, outcome: null,
  dispatches: [{ unitId: 2, at: AT, reason: 'dichtstbij', distanceKm: 1, declinedAt: null, acceptedAt: null }], events: [],
  what: 'onwel', persons: '1', responsive: null, note: null, ...changes,
});

const state = (changes: Partial<LiveState> = {}): LiveState => ({
  version: 1, dataVersion: '1.1', serverTime: AT, incidents: [incident()], testMode: false, requests: [], posts: [{ id: 10, isOpen: false, closesAt: null, autoClosedAt: null }],
  units: [{ id: 1, availability: 'uit_dienst', incidentId: null, stayPostId: null, position: null, closesAt: null }, { id: 2, availability: 'vrij', incidentId: null, stayPostId: null, position: null, closesAt: null }],
  ...changes,
});

const apply = (start: LiveState, ...actions: LiveAction[]) => actions.reduce((s, action, n) => applyAction(s, { id: `${n}`, at: `2026-12-31T11:0${n + 1}:00.000Z`, action }, context), start);

test('accept, on site and close on the phone: the unit is free again', () => {
  const after = apply(state(), { type: 'accept', incidentId: 7, unitId: 2 }, { type: 'onSite', incidentId: 7 });
  assert.equal(after.incidents[0]?.status, 'ter_plaatse');
  assert.equal(after.units[1]?.incidentId, 7, 'busy with the call');

  const closed = apply(after, { type: 'close', incidentId: 7, body: { outcome: 'geholpen', persons: '1', note: null, stayHere: false } });
  assert.equal(closed.incidents[0]?.status, 'afgerond');
  assert.deepEqual([closed.units[1]?.incidentId, closed.units[1]?.availability], [null, 'vrij']);
  assert.deepEqual(closed.incidents[0]?.events.map((e) => e.type), ['geaccepteerd', 'ter_plaatse', 'afgerond']);
});

test('applying is pure, and an action already in the state adds no second log line', () => {
  const start = state();
  const once = apply(start, { type: 'onSite', incidentId: 7 });
  assert.equal(start.incidents[0]?.status, 'verstuurd');
  assert.equal(apply(once, { type: 'onSite', incidentId: 7 }).incidents[0]?.events.length, 1);
});

test('closing and taking a break; a fixed unit can stay where it was', () => {
  const fixed = state({ incidents: [incident({ status: 'ter_plaatse', dispatches: [{ unitId: 1, at: AT, reason: 'alle', distanceKm: 1, declinedAt: null, acceptedAt: AT }] })] });
  const after = applyAction(fixed, { id: 'x', at: AT, action: { type: 'close', incidentId: 7, body: { outcome: 'loos', persons: null, note: null, stayHere: true, pause: true } } }, { ...context, me: { name: 'Eva', phone: '0600000005' } });
  assert.deepEqual([after.units[0]?.availability, after.units[0]?.stayPostId], ['pauze', 20]);
});

test('a fixed unit and its post go together; a phone with no state yet still shows its own change', () => {
  assert.equal(apply(state(), { type: 'availability', unitId: 1, availability: 'vrij' }).posts[0]?.isOpen, true);
  const closedPost = apply(state({ units: [{ id: 1, availability: 'vrij', incidentId: null, stayPostId: null, position: null, closesAt: null }] }), { type: 'postOpen', postId: 10, open: false });
  assert.equal(closedPost.units[0]?.availability, 'uit_dienst');
  assert.equal(apply(state({ units: [] }), { type: 'availability', unitId: 2, availability: 'pauze' }).units[0]?.availability, 'pauze');
});

test('a request made without signal is there at once, and follows its steps', () => {
  const after = apply(state(), { type: 'requestNew', tempId: -5, clientId: 'abc', postId: 20, postName: 'Waterpost', kind: 'water' }, { type: 'requestDetail', requestId: -5, detail: 'flink' }, { type: 'requestWithdraw', requestId: -5 });
  assert.deepEqual([after.requests[0]?.id, after.requests[0]?.detail, after.requests[0]?.status], [-5, 'flink', 'ingetrokken']);
});

test('the server carries out a queued change once, with the time it happened', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ehbo-queue-'));
  const db = openEventDb(dir, 'test', { name: 'Test' });
  seedDemo(db);
  const clock = new Date('2026-12-31T12:00:00.000Z');
  const app = buildApp({
    db, vapid: { ...generateVapidKeys(), subject: 'mailto:test@example.org' }, build: { version: 'test', commit: 'x', builtAt: '' },
    calls: { notify: () => {}, schedule: () => () => {}, now: () => clock },
  });
  const cookie = async (phone: string) => {
    const res = await app.inject({ url: '/api/session', method: 'POST', payload: { phone } });
    return `ehbo_sessie=${res.cookies.find((c) => c.name === 'ehbo_sessie')!.value}`;
  };
  const id = (table: string, name: string) => (db.raw.prepare(`SELECT id FROM ${table} WHERE name = ?`).get(name) as { id: number }).id;
  const [post, unit] = [id('posts', 'Waterpost 3 · brug'), id('ehbo_units', 'Team 2')];
  const [lead, ehbo] = [await cookie(DEMO.postLead), await cookie(DEMO.mobileEhbo)];
  const send = (who: string, method: 'POST' | 'PUT', url: string, payload?: object, headers: Record<string, string> = {}) => app.inject({ method, url, payload, headers: { cookie: who, ...headers } });

  await send(lead, 'PUT', `/api/posts/${post}/open`, { open: true });
  await send(ehbo, 'PUT', `/api/units/${unit}/availability`, { availability: 'vrij' });
  const report: NewIncident = { postId: post, clientId: 'queue-test-1', what: 'onwel', persons: '1', responsive: null, note: null };
  const created = (await send(lead, 'POST', '/api/incidents', report)).json<LiveIncident>();
  await send(ehbo, 'POST', `/api/incidents/${created.id}/accept`, { unitId: unit });

  const body = { outcome: 'geholpen', persons: '1', note: null, stayHere: false };
  const queued = { 'x-action-id': 'action-close-1', 'x-action-at': '2026-12-31T11:40:00.000Z' };
  const first = await send(ehbo, 'POST', `/api/incidents/${created.id}/close`, body, queued);
  assert.equal(first.statusCode, 200, first.body);
  const closed = first.json<LiveState>().incidents.find((i) => i.id === created.id)!;
  assert.equal(closed.closedAt, queued['x-action-at'], 'the time on the phone, not of arrival');
  assert.equal(closed.events.at(-1)?.at, queued['x-action-at']);
  assert.equal(first.json<LiveState>().serverTime, clock.toISOString(), 'the state itself still has the real time');

  // The answer got lost, so the phone sends it again: no error, and nothing happens twice.
  const again = await send(ehbo, 'POST', `/api/incidents/${created.id}/close`, body, queued);
  assert.equal(again.statusCode, 200, again.body);
  assert.equal(again.json<LiveState>().incidents.find((i) => i.id === created.id)?.events.filter((e) => e.type === 'afgerond').length, 1);

  // A time that can't be right is not believed.
  const second = (await send(lead, 'POST', '/api/incidents', { ...report, clientId: 'queue-test-2' })).json<LiveIncident>();
  const future = await send(lead, 'POST', `/api/incidents/${second.id}/withdraw`, undefined, { 'x-action-at': '2027-01-01T00:00:00.000Z' });
  assert.equal(future.json<LiveState>().incidents.find((i) => i.id === second.id)?.closedAt, clock.toISOString());

  await app.close();
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
