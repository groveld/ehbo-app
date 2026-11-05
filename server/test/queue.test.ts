// Changes from a phone without signal: applied on the phone at once, carried out once by the server, with the time they really happened.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { incidentsOf, requestsOf, applyAction, type ActionContext, type LiveAction, type LiveIncident, type LiveState, type NewIncident } from '@ehbo/shared';
import { buildApp } from '../src/app.ts';
import { DEMO, seedDemo } from '../src/demo.ts';
import { openEventDb } from '../src/event-db.ts';
import { generateVapidKeys } from '../src/webpush.ts';

const AT = '2026-12-31T11:00:00.000Z';
const context: ActionContext = {
  me: { name: 'Mo', phone: '0600000006' },
  teams: [
    { id: 1, name: 'Team 1', kind: 'fixed', locationId: 10, members: [{ phone: '0600000005' }] },
    { id: 2, name: 'Team 2', kind: 'mobile', locationId: 11, members: [{ phone: '0600000006' }] },
  ],
};

const incident = (changes: Partial<LiveIncident> = {}): LiveIncident => ({
  id: 7, type: 'first_aid', handling: 'dispatch', isTest: false, selfStarted: false, offLocation: false, accuracyM: null, reportedBy: '0600000004', locationId: 20, location: { typeId: 1, name: 'Waterpost', km: 3, lat: 53, lng: 5 }, status: 'sent', stage: 'nearest', aed: false,
  reportedAt: AT, sentAt: AT, escalatesAt: AT, teamId: null, acceptedBy: null, acceptedAt: null, onSiteAt: null, closedAt: null, outcome: null,
  dispatches: [{ teamId: 2, at: AT, reason: 'nearest', distanceKm: 1, declinedAt: null, acceptedAt: null }], events: [],
  what: 'unwell', persons: '1', responsive: null, note: null, ...changes,
});

const state = (changes: Partial<LiveState> = {}): LiveState => ({
  version: 1, dataVersion: '1.1', serverTime: AT, helpRequests: [incident()], testMode: false, locations: [{ id: 10, isOpen: false, closesAt: null, autoClosedAt: null }],
  teams: [{ id: 1, availability: 'off_duty', incidentId: null, stayLocationId: null, position: null, closesAt: null, nextAvailability: null }, { id: 2, availability: 'available', incidentId: null, stayLocationId: null, position: null, closesAt: null, nextAvailability: null }],
  ...changes,
});

const apply = (start: LiveState, ...actions: LiveAction[]) => actions.reduce((s, action, n) => applyAction(s, { id: `${n}`, at: `2026-12-31T11:0${n + 1}:00.000Z`, action }, context), start);

test('accept, on site and close on the phone: the team is free again', () => {
  const after = apply(state(), { type: 'accept', incidentId: 7, teamId: 2 }, { type: 'onSite', incidentId: 7 });
  assert.equal(incidentsOf(after)[0]?.status, 'on_site');
  assert.equal(after.teams[1]?.incidentId, 7, 'busy with the call');

  const closed = apply(after, { type: 'close', incidentId: 7, body: { outcome: 'treated', persons: '1', note: null, stayHere: false } });
  assert.equal(incidentsOf(closed)[0]?.status, 'closed');
  assert.deepEqual([closed.teams[1]?.incidentId, closed.teams[1]?.availability], [null, 'available']);
  assert.deepEqual(incidentsOf(closed)[0]?.events.map((e) => e.type), ['accepted', 'on_site', 'closed']);
});

test('applying is pure, and an action already in the state adds no second log line', () => {
  const start = state();
  const once = apply(start, { type: 'onSite', incidentId: 7 });
  assert.equal(incidentsOf(start)[0]?.status, 'sent');
  assert.equal(incidentsOf(apply(once, { type: 'onSite', incidentId: 7 }))[0]?.events.length, 1);
});

test('closing and taking a break; a fixed team can stay where it was', () => {
  const fixed = state({ helpRequests: [incident({ status: 'on_site', dispatches: [{ teamId: 1, at: AT, reason: 'all', distanceKm: 1, declinedAt: null, acceptedAt: AT }] })] });
  const after = applyAction(fixed, { id: 'x', at: AT, action: { type: 'close', incidentId: 7, body: { outcome: 'false_alarm', persons: null, note: null, stayHere: true, then: 'unavailable' } } }, { ...context, me: { name: 'Eva', phone: '0600000005' } });
  assert.deepEqual([after.teams[0]?.availability, after.teams[0]?.stayLocationId], ['unavailable', 20]);
});

test('a status picked during a call waits until it is over, as on the server', () => {
  const busy = state({
    teams: [{ id: 1, availability: 'available', incidentId: 7, stayLocationId: null, position: null, closesAt: null, nextAvailability: null }],
    helpRequests: [incident({ status: 'on_site', dispatches: [{ teamId: 1, at: AT, reason: 'all', distanceKm: 1, declinedAt: null, acceptedAt: AT }] })],
  });
  const planned = apply(busy, { type: 'availability', teamId: 1, availability: 'off_duty' });
  assert.deepEqual([planned.teams[0]?.availability, planned.teams[0]?.nextAvailability], ['available', 'off_duty']);
  const after = applyAction(planned, { id: 'x', at: AT, action: { type: 'close', incidentId: 7, body: { outcome: 'treated', persons: null, note: null, stayHere: false } } }, { ...context, me: { name: 'Eva', phone: '0600000005' } });
  assert.deepEqual([after.teams[0]?.availability, after.teams[0]?.nextAvailability, after.teams[0]?.incidentId], ['off_duty', null, null]);
});

test('a fixed team and its post go together; a phone with no state yet still shows its own change', () => {
  assert.equal(apply(state(), { type: 'availability', teamId: 1, availability: 'available' }).locations[0]?.isOpen, true);
  const closedLocation = apply(state({ teams: [{ id: 1, availability: 'available', incidentId: null, stayLocationId: null, position: null, closesAt: null, nextAvailability: null }] }), { type: 'locationOpen', locationId: 10, open: false });
  assert.equal(closedLocation.teams[0]?.availability, 'off_duty');
  assert.equal(apply(state({ teams: [] }), { type: 'availability', teamId: 2, availability: 'unavailable' }).teams[0]?.availability, 'unavailable');
});

test('a request made without signal is there at once, and follows its steps', () => {
  const after = apply(state(), { type: 'requestNew', tempId: -5, clientId: 'abc', locationId: 20, locationName: 'Waterpost', kind: 'water' }, { type: 'requestDetail', requestId: -5, detail: 'lots' }, { type: 'requestWithdraw', requestId: -5 });
  assert.deepEqual([requestsOf(after)[0]?.id, requestsOf(after)[0]?.detail, requestsOf(after)[0]?.status], [-5, 'lots', 'withdrawn']);
});

test('an incident started without signal is there at once, on site, and can be closed', () => {
  const started = apply(state({ helpRequests: [] }), {
    type: 'selfStart', tempId: -9, locationId: 20, offLocation: true, location: { typeId: 1, name: '120 m van Waterpost', km: 3, lat: 53, lng: 5 },
    body: { clientId: 'abcdefgh', teamId: 2, locationId: 20, lat: 53, lng: 5, what: 'cramp', persons: '1', responsive: null, note: null, enRoute: false },
  });
  assert.deepEqual([incidentsOf(started)[0]?.status, incidentsOf(started)[0]?.teamId, started.teams[1]?.incidentId], ['on_site', 2, -9]);
  const closed = apply(started, { type: 'close', incidentId: -9, body: { outcome: 'treated', persons: '1', note: null, stayHere: false } });
  assert.equal(incidentsOf(closed)[0]?.status, 'closed');
  assert.equal(closed.teams[1]?.incidentId, null);
});

test('an incident started for a post further away begins en route', () => {
  const started = apply(state({ helpRequests: [] }), {
    type: 'selfStart', tempId: -9, locationId: 20, offLocation: false, location: { typeId: 1, name: 'Waterpost', km: 3, lat: 53, lng: 5 },
    body: { clientId: 'abcdefgh', teamId: 2, locationId: 20, lat: null, lng: null, what: null, persons: null, responsive: null, note: null, enRoute: true },
  }, { type: 'onSite', incidentId: -9 });
  assert.deepEqual([incidentsOf(started)[0]?.status, started.teams[1]?.incidentId], ['on_site', -9]);
  const going = apply(state({ helpRequests: [] }), {
    type: 'selfStart', tempId: -9, locationId: 20, offLocation: false, location: { typeId: 1, name: 'Waterpost', km: 3, lat: 53, lng: 5 },
    body: { clientId: 'abcdefgh', teamId: 2, locationId: 20, lat: null, lng: null, what: null, persons: null, responsive: null, note: null, enRoute: true },
  });
  assert.deepEqual([incidentsOf(going)[0]?.status, incidentsOf(going)[0]?.onSiteAt], ['accepted', null]);
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
    const res = await app.inject({ url: '/api/session', method: 'POST', payload: { phone, code: '31' } });
    return `session=${res.cookies.find((c) => c.name === 'session')!.value}`;
  };
  const id = (table: string, name: string) => (db.raw.prepare(`SELECT id FROM ${table} WHERE name = ?`).get(name) as { id: number }).id;
  const [location, team] = [id('locations', 'Waterpost 3 · brug'), id('teams', 'Team 2')];
  const [lead, ehbo] = [await cookie(DEMO.locationLead), await cookie(DEMO.mobileEhbo)];
  const send = (who: string, method: 'POST' | 'PUT', url: string, payload?: object, headers: Record<string, string> = {}) => app.inject({ method, url, payload, headers: { cookie: who, ...headers } });

  await send(lead, 'PUT', `/api/locations/${location}/open`, { open: true });
  await send(ehbo, 'PUT', `/api/teams/${team}/availability`, { availability: 'available' });
  const report: NewIncident = { type: 'first_aid', locationId: location, clientId: 'queue-test-1', what: 'unwell', persons: '1', responsive: null, note: null };
  const created = (await send(lead, 'POST', '/api/help-requests', report)).json<LiveIncident>();
  await send(ehbo, 'POST', `/api/help-requests/${created.id}/accept`, { teamId: team });

  const body = { outcome: 'treated', persons: '1', note: null, stayHere: false };
  const queued = { 'x-action-id': 'action-close-1', 'x-action-at': '2026-12-31T11:40:00.000Z' };
  const first = await send(ehbo, 'POST', `/api/help-requests/${created.id}/close`, body, queued);
  assert.equal(first.statusCode, 200, first.body);
  const closed = incidentsOf(first.json<LiveState>()).find((i) => i.id === created.id)!;
  assert.equal(closed.closedAt, queued['x-action-at'], 'the time on the phone, not of arrival');
  assert.equal(closed.events.at(-1)?.at, queued['x-action-at']);
  assert.equal(first.json<LiveState>().serverTime, clock.toISOString(), 'the state itself still has the real time');

  // The answer got lost, so the phone sends it again: no error, and nothing happens twice.
  const again = await send(ehbo, 'POST', `/api/help-requests/${created.id}/close`, body, queued);
  assert.equal(again.statusCode, 200, again.body);
  assert.equal(incidentsOf(again.json<LiveState>()).find((i) => i.id === created.id)?.events.filter((e) => e.type === 'closed').length, 1);

  // A time that can't be right is not believed.
  const second = (await send(lead, 'POST', '/api/help-requests', { ...report, clientId: 'queue-test-2' })).json<LiveIncident>();
  const future = await send(lead, 'POST', `/api/help-requests/${second.id}/withdraw`, undefined, { 'x-action-at': '2027-01-01T00:00:00.000Z' });
  assert.equal(incidentsOf(future.json<LiveState>()).find((i) => i.id === second.id)?.closedAt, clock.toISOString());

  await app.close();
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
