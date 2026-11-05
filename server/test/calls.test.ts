import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { incidentsOf, type AdminState, type EventPackage, type LiveIncident, type LiveRequest, type LiveState, type NewIncident, type PushPayload } from '@ehbo/shared';
import { buildApp } from '../src/app.ts';
import type { Schedule } from '../src/calls.ts';
import { DEMO, seedDemo } from '../src/demo.ts';
import { openEventDb, type EventDb } from '../src/event-db.ts';
import { generateVapidKeys } from '../src/webpush.ts';

let app: ReturnType<typeof buildApp>;
let db: EventDb;
let dir: string;
let pushes: { phones: string[]; payload: PushPayload }[];
let timers: { fn: () => void; ms: number; cancelled: boolean }[];
let clock: Date;
const cookies = new Map<string, string>();

const schedule: Schedule = (fn, ms) => {
  const timer = { fn, ms, cancelled: false };
  timers.push(timer);
  return () => { timer.cancelled = true; };
};

/** De volgende timer laten aflopen, met de klok mee. */
function runNextTimer() {
  const timer = timers.find((t) => !t.cancelled);
  assert.ok(timer, 'er staat een timer');
  timer.cancelled = true;
  clock = new Date(clock.getTime() + timer.ms);
  timer.fn();
  return timer;
}

const pending = () => timers.filter((t) => !t.cancelled);

function makeApp() {
  return buildApp({
    db,
    vapid: { ...generateVapidKeys(), subject: 'mailto:test@example.org' },
    build: { version: 'test', commit: 'x', builtAt: '' },
    calls: { notify: (phones, payload) => pushes.push({ phones: [...phones], payload }), schedule, now: () => clock },
  });
}

async function login(phone: string) {
  if (!cookies.has(phone)) {
    const res = await app.inject({ url: '/api/session', method: 'POST', payload: { phone, code: '31' } });
    assert.equal(res.statusCode, 200, res.body);
    cookies.set(phone, `session=${res.cookies.find((c) => c.name === 'session')!.value}`);
  }
  return cookies.get(phone)!;
}

async function call(phone: string, method: 'GET' | 'POST' | 'PUT', url: string, payload?: object) {
  return app.inject({ method, url, payload, headers: { cookie: await login(phone) } });
}

async function ok<T = LiveState>(phone: string, method: 'GET' | 'POST' | 'PUT', url: string, payload?: object) {
  const res = await call(phone, method, url, payload);
  assert.ok(res.statusCode < 300, `${method} ${url}: ${res.statusCode} ${res.body}`);
  return res.json() as T;
}

const idOf = (table: string, name: string) => (db.raw.prepare(`SELECT id FROM ${table} WHERE name = ?`).get(name) as { id: number }).id;
const WATER = () => idOf('locations', 'Waterpost 3 · brug');
const TEAM1 = () => idOf('teams', 'Team 1');
const TEAM2 = () => idOf('teams', 'Team 2');

let clientIds = 0;
const request = (details: Partial<NewIncident> = {}): NewIncident => ({
  type: 'first_aid', locationId: WATER(), clientId: `test-${++clientIds}-abcdef`, what: 'unwell', persons: '1', responsive: null, note: null, ...details,
});

const pushesTo = (phone: string) => pushes.filter((p) => p.phones.includes(phone));
const incident = async (id: number) => incidentsOf(await ok(DEMO.coordinator, 'GET', '/api/live/state')).find((i) => i.id === id)!;

test('a team that becomes available gets a waiting call at once, unless another available team has it', async () => {
  await ok(DEMO.locationLead, 'PUT', `/api/locations/${WATER()}/open`, { open: true });
  const waiting = await ok<LiveIncident>(DEMO.locationLead, 'POST', '/api/help-requests', request());
  assert.equal(waiting.dispatches.length, 0, 'nobody on duty');
  pushes.length = 0;

  await ok(DEMO.mobileEhbo, 'PUT', `/api/teams/${TEAM2()}/availability`, { availability: 'available' });
  assert.deepEqual((await incident(waiting.id)).dispatches.map((d) => d.teamId), [TEAM2()]);
  assert.ok(pushesTo(DEMO.mobileEhbo).some((p) => p.payload.urgent), 'with the alarm, straight away');

  // Team 2 has it and can still react: Team 1 waits for the round to all teams.
  pushes.length = 0;
  await ok(DEMO.ehbo, 'PUT', `/api/teams/${TEAM1()}/availability`, { availability: 'available' });
  assert.deepEqual((await incident(waiting.id)).dispatches.map((d) => d.teamId), [TEAM2()]);
  assert.equal(pushesTo(DEMO.ehbo).length, 0);
});

test('a team that finishes a call gets the one that was waiting, and a team that said no gets asked again', async () => {
  await onDuty();
  await ok(DEMO.ehbo, 'PUT', `/api/teams/${TEAM1()}/availability`, { availability: 'unavailable' });
  const first = await ok<LiveIncident>(DEMO.locationLead, 'POST', '/api/help-requests', request());
  await ok(DEMO.mobileEhbo, 'POST', `/api/help-requests/${first.id}/accept`, { teamId: TEAM2() });
  const second = await ok<LiveIncident>(DEMO.locationLead, 'POST', '/api/help-requests', request());
  assert.equal((await incident(second.id)).dispatches.length, 0, 'nobody free');

  await ok(DEMO.mobileEhbo, 'POST', `/api/help-requests/${first.id}/close`, { outcome: 'treated', persons: '1', note: null, stayHere: false });
  assert.deepEqual((await incident(second.id)).dispatches.map((d) => d.teamId), [TEAM2()]);

  await ok(DEMO.mobileEhbo, 'POST', `/api/help-requests/${second.id}/decline`, { teamId: TEAM2() });
  await ok(DEMO.mobileEhbo, 'PUT', `/api/teams/${TEAM2()}/availability`, { availability: 'unavailable' });
  await ok(DEMO.mobileEhbo, 'PUT', `/api/teams/${TEAM2()}/availability`, { availability: 'available' });
  assert.equal((await incident(second.id)).dispatches.find((d) => d.teamId === TEAM2())?.declinedAt, null);
});

test('a status picked during a call waits until the call is over, unless closing says otherwise', async () => {
  await onDuty();
  await ok(DEMO.ehbo, 'PUT', `/api/teams/${TEAM1()}/availability`, { availability: 'unavailable' });
  const team2 = (state: LiveState) => state.teams.find((u) => u.id === TEAM2())!;
  const take = async () => {
    const inc = await ok<LiveIncident>(DEMO.locationLead, 'POST', '/api/help-requests', request());
    await ok(DEMO.mobileEhbo, 'POST', `/api/help-requests/${inc.id}/accept`, { teamId: TEAM2() });
    return inc.id;
  };
  const close = (id: number, then?: string) => ok(DEMO.mobileEhbo, 'POST', `/api/help-requests/${id}/close`, { outcome: 'treated', persons: '1', note: null, stayHere: false, then });

  let id = await take();
  let state = await ok(DEMO.mobileEhbo, 'PUT', `/api/teams/${TEAM2()}/availability`, { availability: 'unavailable' });
  assert.deepEqual([team2(state).availability, team2(state).nextAvailability, team2(state).incidentId], ['available', 'unavailable', id], 'still on the call');
  state = await close(id);
  assert.deepEqual([team2(state).availability, team2(state).nextAvailability], ['unavailable', null], 'a break after the call');
  assert.equal(incidentsOf(state).find((i) => i.id === id)?.events.at(-1)?.text, 'Afgerond door Team 2, daarna pauze');

  await ok(DEMO.mobileEhbo, 'PUT', `/api/teams/${TEAM2()}/availability`, { availability: 'available' });
  id = await take();
  await ok(DEMO.mobileEhbo, 'PUT', `/api/teams/${TEAM2()}/availability`, { availability: 'unavailable' });
  assert.equal(team2(await close(id, 'available')).availability, 'available', 'closing says otherwise');

  id = await take();
  await ok(DEMO.mobileEhbo, 'PUT', `/api/teams/${TEAM2()}/availability`, { availability: 'off_duty' });
  state = await ok(DEMO.locationLead, 'POST', `/api/help-requests/${id}/withdraw`);
  assert.deepEqual([team2(state).availability, team2(state).nextAvailability], ['off_duty', null], 'withdrawn ends the call too');
});

/** Waterpost open, beide eenheden in dienst. */
async function onDuty() {
  await ok(DEMO.locationLead, 'PUT', `/api/locations/${WATER()}/open`, { open: true });
  await ok(DEMO.ehbo, 'PUT', `/api/teams/${TEAM1()}/availability`, { availability: 'available' });
  await ok(DEMO.mobileEhbo, 'PUT', `/api/teams/${TEAM2()}/availability`, { availability: 'available' });
  pushes.length = 0;
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ehbo-calls-'));
  db = openEventDb(dir, 'test', { name: 'Testloop' });
  seedDemo(db);
  pushes = [];
  timers = [];
  clock = new Date('2026-12-31T11:02:00Z');
  cookies.clear();
  app = makeApp();
  await app.ready();
});

afterEach(async () => {
  await app.close();
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('post open en dicht: alleen de locatieverantwoordelijke; een dichte post kan geen verzoek doen', async () => {
  assert.equal((await call(DEMO.locationLead, 'POST', '/api/help-requests', request())).statusCode, 409, 'post is nog dicht');
  const traffic = idOf('locations', 'Kruising 4');
  assert.equal((await call(DEMO.locationMember, 'PUT', `/api/locations/${traffic}/open`, { open: true })).statusCode, 403, 'lid, geen verantwoordelijke');
  const state = await ok(DEMO.locationLead, 'PUT', `/api/locations/${WATER()}/open`, { open: true });
  assert.equal(state.locations.find((p) => p.id === WATER())?.isOpen, true);
  assert.equal((await call(DEMO.locationMember, 'POST', '/api/help-requests', request())).statusCode, 403, 'niet je eigen post');
});

test('vaste eenheid: in dienst en de eigen EHBO-post open zijn hetzelfde', async () => {
  const ehboLocation = idOf('locations', 'EHBO-post 1 · start');
  let state = await ok(DEMO.ehbo, 'PUT', `/api/teams/${TEAM1()}/availability`, { availability: 'available' });
  assert.equal(state.locations.find((p) => p.id === ehboLocation)?.isOpen, true);
  state = await ok(DEMO.ehbo, 'PUT', `/api/locations/${ehboLocation}/open`, { open: false });
  assert.equal(state.teams.find((u) => u.id === TEAM1())?.availability, 'off_duty');
  // Not available is on duty too: the post opens, only the team isn't free.
  state = await ok(DEMO.ehbo, 'PUT', `/api/teams/${TEAM1()}/availability`, { availability: 'unavailable' });
  assert.equal(state.locations.find((p) => p.id === ehboLocation)?.isOpen, true);
  state = await ok(DEMO.ehbo, 'PUT', `/api/teams/${TEAM1()}/availability`, { availability: 'off_duty' });
  assert.equal(state.locations.find((p) => p.id === ehboLocation)?.isOpen, false);
  assert.equal((await call(DEMO.ehbo, 'PUT', `/api/teams/${TEAM2()}/availability`, { availability: 'available' })).statusCode, 403, 'niet je eigen eenheid');
});

test('oproep naar de dichtstbijzijnde beschikbare eenheid, kopie naar de coördinator, accepteren', async () => {
  await onDuty();
  const created = await call(DEMO.locationLead, 'POST', '/api/help-requests', request());
  assert.equal(created.statusCode, 201, created.body);
  const inc = created.json() as LiveIncident;
  assert.equal(inc.status, 'sent');
  assert.equal(inc.stage, 'nearest');
  assert.deepEqual(inc.dispatches.map((d) => [d.teamId, d.reason]), [[TEAM2(), 'nearest']], 'Team 2 staat bij Kruising 4, vlak bij de waterpost');
  assert.equal(inc.escalatesAt, '2026-12-31T11:02:30.000Z');
  assert.equal(pending()[0]?.ms, 30_000);

  const alarm = pushesTo(DEMO.mobileEhbo)[0]!.payload;
  assert.equal(alarm.urgent, true);
  assert.match(alarm.title, /EHBO-oproep · Waterpost 3/);
  assert.match(alarm.body, /Onwel \/ flauw · 1 persoon · \d+,\d km/);
  assert.equal(pushesTo(DEMO.ehbo).length, 0, 'Team 1 nog niet');
  assert.match(pushesTo(DEMO.coordinator)[0]!.payload.body, /Naar Team 2/);

  const state = await ok(DEMO.mobileEhbo, 'POST', `/api/help-requests/${inc.id}/accept`, { teamId: TEAM2() });
  const accepted = incidentsOf(state).find((i) => i.id === inc.id)!;
  assert.equal(accepted.status, 'accepted');
  assert.equal(accepted.teamId, TEAM2());
  assert.equal(accepted.acceptedBy?.name, 'Mo Mobiel');
  assert.equal(state.teams.find((u) => u.id === TEAM2())?.incidentId, inc.id, 'Team 2 is bezet');
  assert.equal(pending().length, 0, 'geen escalatie meer');
  assert.match(pushesTo(DEMO.locationLead).at(-1)!.payload.body, /Team 2 \(Mo Mobiel\) komt eraan/);

  const late = await call(DEMO.ehbo, 'POST', `/api/help-requests/${inc.id}/accept`, { teamId: TEAM1() });
  assert.equal(late.statusCode, 409);
  assert.match(late.json().error, /al aangenomen door Team 2/);
});

test('geen reactie binnen de escalatietijd: naar alle beschikbare eenheden; de eerste die accepteert gaat', async () => {
  await onDuty();
  const inc = await ok<LiveIncident>(DEMO.locationLead, 'POST', '/api/help-requests', request());
  runNextTimer();
  let current = await incident(inc.id);
  assert.equal(current.stage, 'all');
  assert.equal(current.escalatesAt, null);
  assert.deepEqual(current.dispatches.map((d) => d.teamId).sort(), [TEAM1(), TEAM2()].sort());
  assert.match(pushesTo(DEMO.ehbo)[0]!.payload.title, /alle eenheden/);
  assert.match(pushesTo(DEMO.coordinator).at(-1)!.payload.body, /Geen reactie binnen 30 s/);

  await ok(DEMO.ehbo, 'POST', `/api/help-requests/${inc.id}/accept`, { teamId: TEAM1() });
  current = await incident(inc.id);
  assert.equal(current.teamId, TEAM1());
  const released = pushesTo(DEMO.mobileEhbo).at(-1)!.payload;
  assert.equal(released.title, 'Oproep is al aangenomen');
  assert.equal(released.tag, `oproep-${inc.id}`, 'vervangt het alarm');
  assert.ok(current.events.some((e) => e.type === 'escalated'));
});

test('"Kan niet" gaat meteen naar alle eenheden', async () => {
  await onDuty();
  const inc = await ok<LiveIncident>(DEMO.locationLead, 'POST', '/api/help-requests', request());
  const state = await ok(DEMO.mobileEhbo, 'POST', `/api/help-requests/${inc.id}/decline`, { teamId: TEAM2() });
  const current = incidentsOf(state).find((i) => i.id === inc.id)!;
  assert.equal(current.stage, 'all');
  assert.ok(current.dispatches.find((d) => d.teamId === TEAM2())?.declinedAt);
  assert.equal(pushesTo(DEMO.ehbo).length, 1, 'Team 1 krijgt de oproep');
  assert.equal(pushesTo(DEMO.mobileEhbo).length, 1, 'wie weigerde, krijgt niet opnieuw een alarm');
});

test('niet aanspreekbaar: ook de dichtstbijzijnde AED-eenheid, die blijft opgeroepen tot er een AED komt', async () => {
  await onDuty();
  const inc = await ok<LiveIncident>(DEMO.locationLead, 'POST', '/api/help-requests', request({ responsive: 'no' }));
  assert.equal(inc.aed, true);
  assert.deepEqual(inc.dispatches.map((d) => [d.teamId, d.reason]), [[TEAM2(), 'nearest'], [TEAM1(), 'aed']]);
  assert.match(pushesTo(DEMO.ehbo)[0]!.payload.body, /^AED meenemen/);
  assert.doesNotMatch(pushesTo(DEMO.mobileEhbo)[0]!.payload.body, /AED/, 'Team 2 heeft geen AED');

  await ok(DEMO.mobileEhbo, 'POST', `/api/help-requests/${inc.id}/accept`, { teamId: TEAM2() });
  assert.equal(pushesTo(DEMO.ehbo).length, 1, 'Team 1 hoort niet "al aangenomen": de AED moet nog komen');
  const state = await ok(DEMO.ehbo, 'POST', `/api/help-requests/${inc.id}/accept`, { teamId: TEAM1() });
  const current = incidentsOf(state).find((i) => i.id === inc.id)!;
  assert.equal(current.teamId, TEAM2(), 'Team 2 blijft de eerste');
  assert.equal(current.dispatches.filter((d) => d.acceptedAt).length, 2);
});

test('aanvullen met "niet aanspreekbaar" roept alsnog de AED-eenheid op', async () => {
  await onDuty();
  const inc = await ok<LiveIncident>(DEMO.locationLead, 'POST', '/api/help-requests', request());
  await ok(DEMO.mobileEhbo, 'POST', `/api/help-requests/${inc.id}/accept`, { teamId: TEAM2() });
  pushes.length = 0;
  const state = await ok(DEMO.locationLead, 'PUT', `/api/help-requests/${inc.id}`, { what: 'unwell', persons: '1', responsive: 'no', note: 'Reageert niet meer' });
  const current = incidentsOf(state).find((i) => i.id === inc.id)!;
  assert.equal(current.aed, true);
  assert.equal(current.note, 'Reageert niet meer');
  assert.ok(current.dispatches.some((d) => d.teamId === TEAM1() && d.reason === 'aed'));
  assert.match(pushesTo(DEMO.ehbo)[0]!.payload.title, /AED nodig/);
  const push = pushesTo(DEMO.mobileEhbo)[0]!.payload;
  assert.equal(push.title, 'Melding aangevuld · Waterpost 3 · brug');
  assert.equal(push.body, 'Niet aanspreekbaar · Notitie toegevoegd', 'what changed, never the note itself');
  assert.equal(push.quietInApp, true);
  assert.ok(current.events.some((e) => e.text === 'Aangevuld: niet aanspreekbaar, notitie toegevoegd'));

  pushes.length = 0;
  const again = await ok(DEMO.locationLead, 'PUT', `/api/help-requests/${inc.id}`, { what: 'unwell', persons: '1', responsive: 'no', note: 'Reageert niet meer ' });
  assert.equal(pushes.length, 0, 'nothing changed: no alert');
  assert.equal(incidentsOf(again).find((i) => i.id === inc.id)!.events.length, current.events.length);
});

test('ter plaatse en afronden; een vaste eenheid die blijft, telt vanaf die post', async () => {
  await onDuty();
  // Team 2 ver weg: dan is Team 1 het dichtstbij.
  assert.equal((await call(DEMO.mobileEhbo, 'PUT', '/api/position', { lat: 52.0, lng: 4.0 })).statusCode, 204);
  const inc = await ok<LiveIncident>(DEMO.locationLead, 'POST', '/api/help-requests', request());
  assert.equal(inc.dispatches[0]?.teamId, TEAM1(), 'recente GPS-positie telt boven de standplaats');

  assert.equal((await call(DEMO.mobileEhbo, 'POST', `/api/help-requests/${inc.id}/on-site`)).statusCode, 403);
  await ok(DEMO.ehbo, 'POST', `/api/help-requests/${inc.id}/accept`, { teamId: TEAM1() });
  clock = new Date(clock.getTime() + 4 * 60_000);
  let state = await ok(DEMO.ehbo, 'POST', `/api/help-requests/${inc.id}/on-site`);
  assert.equal(incidentsOf(state)[0]?.status, 'on_site');
  assert.equal(incidentsOf(state)[0]?.onSiteAt, '2026-12-31T11:06:00.000Z');

  state = await ok(DEMO.ehbo, 'POST', `/api/help-requests/${inc.id}/close`, { outcome: 'treated', persons: '1', note: 'Gekoeld en drinken gegeven', stayHere: true });
  assert.equal(incidentsOf(state)[0]?.status, 'closed');
  assert.equal(incidentsOf(state)[0]?.outcome, 'treated');
  const firstTeam = state.teams.find((u) => u.id === TEAM1())!;
  assert.deepEqual([firstTeam.incidentId, firstTeam.stayLocationId, firstTeam.availability], [null, WATER(), 'available'], 'weer vrij, bij de waterpost');

  // Een GPS-positie ouder dan 3 minuten telt niet meer: Team 2 staat weer bij zijn standplaats.
  clock = new Date(clock.getTime() + 4 * 60_000);
  const next = await ok<LiveIncident>(DEMO.locationLead, 'POST', '/api/help-requests', request());
  assert.equal(next.dispatches[0]?.teamId, TEAM1(), 'Team 1 blijft bij de waterpost en is nu het dichtstbij');
  assert.equal(next.dispatches[0]?.distanceKm, 0);
});

test('melding intrekken: opgeroepen eenheden horen het, de escalatie stopt', async () => {
  await onDuty();
  const inc = await ok<LiveIncident>(DEMO.locationLead, 'POST', '/api/help-requests', request());
  assert.equal((await call(DEMO.locationMember, 'POST', `/api/help-requests/${inc.id}/withdraw`)).statusCode, 403);
  const state = await ok(DEMO.locationLead, 'POST', `/api/help-requests/${inc.id}/withdraw`);
  assert.equal(incidentsOf(state)[0]?.status, 'withdrawn');
  assert.equal(pending().length, 0);
  assert.equal(pushesTo(DEMO.mobileEhbo).at(-1)!.payload.title, 'Melding ingetrokken');
  assert.equal((await call(DEMO.mobileEhbo, 'POST', `/api/help-requests/${inc.id}/accept`, { teamId: TEAM2() })).statusCode, 409);
});

test('dezelfde melding twee keer versturen (zonder bereik bewaard) telt één keer', async () => {
  await onDuty();
  const body = request({ reportedAt: '2026-12-31T11:01:30.000Z' });
  const first = await ok<LiveIncident>(DEMO.locationLead, 'POST', '/api/help-requests', body);
  const again = await ok<LiveIncident>(DEMO.locationLead, 'POST', '/api/help-requests', body);
  assert.equal(again.id, first.id);
  assert.equal(first.reportedAt, '2026-12-31T11:01:30.000Z', 'tijd van de post');
  assert.equal(first.sentAt, '2026-12-31T11:02:00.000Z', 'tijd van aankomst bij de server');
  assert.equal(incidentsOf(await ok(DEMO.coordinator, 'GET', '/api/live/state')).length, 1);
});

test('geen beschikbare eenheid: meteen alle eenheden, de coördinator krijgt een alarm; daarna blijft het herhalen', async () => {
  await ok(DEMO.locationLead, 'PUT', `/api/locations/${WATER()}/open`, { open: true });
  const inc = await ok<LiveIncident>(DEMO.locationLead, 'POST', '/api/help-requests', request());
  assert.equal(inc.stage, 'all');
  assert.equal(inc.dispatches.length, 0);
  const alarm = pushesTo(DEMO.coordinator).at(-1)!.payload;
  assert.equal(alarm.urgent, true);
  assert.match(alarm.body, /Geen beschikbare EHBO-eenheid/);

  // Team 2 komt in dienst en krijgt bij de herhaling alsnog de oproep.
  await ok(DEMO.mobileEhbo, 'PUT', `/api/teams/${TEAM2()}/availability`, { availability: 'available' });
  runNextTimer();
  const current = await incident(inc.id);
  assert.deepEqual(current.dispatches.map((d) => d.teamId), [TEAM2()]);
  assert.match(pushesTo(DEMO.mobileEhbo).at(-1)!.payload.title, /nog niemand/);
  assert.match(pushesTo(DEMO.coordinator).at(-1)!.payload.body, /Bel de eenheden/);
  assert.equal(pending().length, 1, 'volgende herhaling staat klaar');
});

test('de coördinator wijst een eenheid toe', async () => {
  await onDuty();
  const inc = await ok<LiveIncident>(DEMO.locationLead, 'POST', '/api/help-requests', request());
  assert.equal((await call(DEMO.locationLead, 'POST', `/api/help-requests/${inc.id}/assign`, { teamId: TEAM1() })).statusCode, 403);
  const state = await ok(DEMO.coordinator, 'POST', `/api/help-requests/${inc.id}/assign`, { teamId: TEAM1() });
  const current = incidentsOf(state)[0]!;
  assert.equal(current.teamId, TEAM1());
  assert.equal(current.dispatches.find((d) => d.teamId === TEAM1())?.reason, 'manual');
  assert.match(pushesTo(DEMO.ehbo).at(-1)!.payload.title, /^Ingezet/);
  assert.equal(pushesTo(DEMO.mobileEhbo).at(-1)!.payload.title, 'Oproep is al aangenomen');
});

test('na een herstart gaat de escalatie verder', async () => {
  await onDuty();
  const inc = await ok<LiveIncident>(DEMO.locationLead, 'POST', '/api/help-requests', request());
  await app.close();
  timers = [];
  clock = new Date(clock.getTime() + 10_000);
  app = makeApp();
  await app.ready();
  assert.equal(pending()[0]?.ms, 20_000, 'de resterende tijd');
  runNextTimer();
  assert.equal((await incident(inc.id)).stage, 'all');
});

test('live stand via SSE: direct de stand, en elke wijziging', async () => {
  await app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = app.server.address() as { port: number };
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/live`)).status, 401);

  const res = await fetch(`http://127.0.0.1:${port}/api/live`, { headers: { cookie: await login(DEMO.locationMember) } });
  assert.equal(res.headers.get('content-type'), 'text/event-stream; charset=utf-8');
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  async function nextState(): Promise<LiveState> {
    for (;;) {
      const match = /event: state\ndata: (.*)\n\n/.exec(buffer);
      if (match) {
        buffer = buffer.slice(match.index + match[0].length);
        return JSON.parse(match[1]!) as LiveState;
      }
      const { value, done } = await reader.read();
      assert.ok(!done, 'verbinding blijft open');
      buffer += decoder.decode(value, { stream: true });
    }
  }

  const first = await nextState();
  assert.equal(first.locations.find((p) => p.id === WATER())?.isOpen, false);
  await ok(DEMO.locationLead, 'PUT', `/api/locations/${WATER()}/open`, { open: true });
  const second = await nextState();
  assert.equal(second.locations.find((p) => p.id === WATER())?.isOpen, true);
  assert.ok(second.version > first.version);
  await reader.cancel();
});

test('participants see Bel EHBO only while the coordinator it calls is logged in', async () => {
  const open = async () => (await app.inject({ url: '/api/first-aid-status' })).json().open;
  await ok(DEMO.locationLead, 'PUT', `/api/locations/${WATER()}/open`, { open: true });
  assert.equal(await open(), false, 'an open post is not enough');
  await login(DEMO.coordinator);
  assert.equal(await open(), true, 'the coordinator is logged in');
  assert.ok((await app.inject({ method: 'DELETE', url: '/api/session', headers: { cookie: await login(DEMO.coordinator) } })).statusCode < 300);
  cookies.delete(DEMO.coordinator);
  assert.equal(await open(), false, 'after logging out');

  // Without a number Bel EHBO calls 112, which follows the event being open.
  db.raw.prepare('UPDATE core_team SET phone = NULL').run();
  assert.equal(await open(), true, 'a post is open');
  await ok(DEMO.locationLead, 'PUT', `/api/locations/${WATER()}/open`, { open: false });
  assert.equal(await open(), false);
});

test('deelnemers zien welke standplaats leeg is, zonder posities of namen', async () => {
  const KRUISING = () => idOf('locations', 'Kruising 4');
  const status = async () => {
    const res = await app.inject({ url: '/api/first-aid-status' });
    assert.equal(res.statusCode, 200, 'ook zonder aanmelding');
    return res.json().awayLocationIds;
  };
  await onDuty();
  assert.deepEqual(await status(), [], 'zonder GPS-positie telt de standplaats');

  // 20 m van Kruising 4 (53.1488, 5.8279) is thuis; 1 km verderop is onderweg.
  await call(DEMO.mobileEhbo, 'PUT', '/api/position', { lat: 53.14898, lng: 5.8279 });
  assert.deepEqual(await status(), []);
  await call(DEMO.mobileEhbo, 'PUT', '/api/position', { lat: 53.1578, lng: 5.8279 });
  assert.deepEqual(await status(), [KRUISING()]);

  // Een positie ouder dan 3 minuten telt niet meer.
  clock = new Date(clock.getTime() + 4 * 60_000);
  assert.deepEqual(await status(), []);

  const pkg = (await app.inject({ url: '/api/package' })).json() as EventPackage;
  const secondTeam = pkg.teams.find((u) => u.id === TEAM2())!;
  assert.deepEqual([secondTeam.locationId, secondTeam.name, secondTeam.members], [KRUISING(), '', []], 'wel de standplaats, niet wie');
});

test('the data version in the live state and for participants follows changes in admin', async () => {
  const before = await ok(DEMO.admin, 'GET', '/api/live/state');
  const pkg = (await app.inject({ url: '/api/package' })).json() as EventPackage;
  assert.ok(pkg.version.startsWith(`${before.dataVersion}.`), 'the package version starts with it');

  await ok(DEMO.admin, 'PUT', '/api/admin/event', {
    name: 'Nieuwe naam', startLocation: null, startDate: null, endDate: null, escalationSeconds: 30, atLocationM: 30, shareAfterMin: 5, loginCode: '31',
    style: (await ok<AdminState>(DEMO.admin, 'GET', '/api/admin')).event.style,
  });

  const after = await ok(DEMO.admin, 'GET', '/api/live/state');
  assert.notEqual(after.dataVersion, before.dataVersion);
  assert.equal((await app.inject({ url: '/api/first-aid-status' })).json().dataVersion, after.dataVersion);
  const fresh = (await app.inject({ url: '/api/package' })).json() as EventPackage;
  assert.ok(fresh.version.startsWith(`${after.dataVersion}.`));
});

test('a call and a request say which post they are about, for a phone without the new package', async () => {
  await onDuty();
  const { id } = await ok<LiveIncident>(DEMO.locationLead, 'POST', '/api/help-requests', request());
  const state = await ok(DEMO.ehbo, 'GET', '/api/live/state');
  const incident = incidentsOf(state).find((i) => i.id === id)!;
  assert.deepEqual({ name: incident.location.name, km: Math.round(incident.location.km! * 10) / 10 }, { name: 'Waterpost 3 · brug', km: 2 });
  assert.equal(typeof incident.location.lat, 'number');
  assert.equal(typeof incident.location.typeId, 'number');

  const water = await ok<LiveRequest>(DEMO.locationLead, 'POST', '/api/help-requests', { type: 'water', locationId: WATER(), detail: null, clientId: 'test-sync-abcdef' });
  assert.equal(water.locationName, 'Waterpost 3 · brug');
});

test('a position is shared by a person, and only on a mobile team on duty', async () => {
  assert.equal((await call(DEMO.locationLead, 'PUT', '/api/position', { lat: 53.15, lng: 5.83 })).statusCode, 409, 'a post is never tracked');
  assert.equal((await call(DEMO.mobileEhbo, 'PUT', '/api/position', { lat: 53.15, lng: 5.83 })).statusCode, 409, 'off duty');
  await onDuty();
  assert.equal((await call(DEMO.mobileEhbo, 'PUT', '/api/position', { lat: 53.15, lng: 5.83 })).statusCode, 204);
  const teamNow = async () => (await ok(DEMO.coordinator, 'GET', '/api/live/state')).teams.find((u) => u.id === TEAM2())!;
  assert.equal((await teamNow()).position?.lat, 53.15);
  await ok(DEMO.mobileEhbo, 'PUT', `/api/teams/${TEAM2()}/availability`, { availability: 'off_duty' });
  assert.equal((await teamNow()).position, null, 'off duty: the position is gone');
});

test('help from where you are: the nearest team from that position, the place kept, and the reporter follows it', async () => {
  await onDuty();
  assert.equal((await call(DEMO.locationMember, 'POST', '/api/help-requests', request({ locationId: null }))).statusCode, 400, 'a position is needed');

  // About 400 m north of the start, far from Kruising 4: Team 1 at the EHBO post by the start is nearest.
  const [lat, lng] = [53.1445, 5.8111];
  const inc = await ok<LiveIncident>(DEMO.locationMember, 'POST', '/api/help-requests', request({ locationId: null, lat, lng, accuracyM: 12 }));
  assert.equal(inc.offLocation, true);
  assert.equal(inc.accuracyM, 12);
  assert.match(inc.location.name, /^\d+ m van /);
  assert.deepEqual([inc.location.lat, inc.location.lng], [lat, lng]);
  assert.equal(inc.dispatches[0]?.teamId, TEAM1());
  assert.match(pushesTo(DEMO.ehbo)[0]!.payload.title, / m van /);
  assert.match(inc.events[0]!.text, /^Gemeld door Vera Verkeer · \d+ m van /);

  await ok(DEMO.ehbo, 'POST', `/api/help-requests/${inc.id}/accept`, { teamId: TEAM1() });
  assert.ok(pushesTo(DEMO.locationMember).some((p) => p.payload.title === 'Hulp is onderweg'), 'the reporter hears it');
  await ok(DEMO.locationMember, 'POST', `/api/help-requests/${inc.id}/withdraw`);

  // Within 30 m of a post (the default) it counts as that post, which needn't be open.
  const atLocation = await ok<LiveIncident>(DEMO.locationMember, 'POST', '/api/help-requests', request({ locationId: null, lat: 53.1512, lng: 5.8345, accuracyM: 30 }));
  assert.deepEqual([atLocation.offLocation, atLocation.locationId, atLocation.location.name], [false, WATER(), 'Waterpost 3 · brug']);
});

test('how close counts as at a post follows the setting', async () => {
  await onDuty();
  // About 80 m north of the water post.
  const near = { locationId: null, lat: 53.15192, lng: 5.8344, accuracyM: 10 };
  const off = await ok<LiveIncident>(DEMO.locationMember, 'POST', '/api/help-requests', request(near));
  assert.equal(off.offLocation, true, 'outside the default 30 m');
  await ok(DEMO.locationMember, 'POST', `/api/help-requests/${off.id}/withdraw`);
  db.raw.prepare('UPDATE event SET at_location_m = 100').run();
  const at = await ok<LiveIncident>(DEMO.locationMember, 'POST', '/api/help-requests', request(near));
  assert.deepEqual([at.offLocation, at.locationId], [false, WATER()]);
});

test('a location with EHBO and water: the water lead opening it does not make the EHBO team available', async () => {
  const EHBO_LOCATION = () => idOf('locations', 'EHBO-post 1 · start');
  const water = (db.raw.prepare("SELECT id FROM function_types WHERE key = 'water'").get() as { id: number }).id;
  db.raw.prepare('INSERT INTO location_functions (location_id, type_id, sort) VALUES (?, ?, 1)').run(EHBO_LOCATION(), water);
  db.raw.prepare("INSERT INTO location_contacts (location_id, phone, role) VALUES (?, ?, 'lead')").run(EHBO_LOCATION(), DEMO.locationLead);
  const firstTeam = async () => (await ok(DEMO.coordinator, 'GET', '/api/live/state')).teams.find((u) => u.id === TEAM1())!.availability;

  await ok(DEMO.locationLead, 'PUT', `/api/locations/${EHBO_LOCATION()}/open`, { open: true });
  assert.equal(await firstTeam(), 'off_duty', 'the team says itself when it is there');
  await ok(DEMO.ehbo, 'PUT', `/api/teams/${TEAM1()}/availability`, { availability: 'available' });
  await ok(DEMO.locationLead, 'PUT', `/api/locations/${EHBO_LOCATION()}/open`, { open: false });
  assert.equal(await firstTeam(), 'available', 'and closing the water post does not take it off duty');
});

test('one list of help requests, and each way of handling refuses the other one\'s actions', async () => {
  await onDuty();
  const inc = await ok<LiveIncident>(DEMO.locationLead, 'POST', '/api/help-requests', request());
  const water = await ok<LiveRequest>(DEMO.locationLead, 'POST', '/api/help-requests', { type: 'water', locationId: WATER(), detail: null, clientId: 'one-list-abcdef' });
  const state = await ok(DEMO.coordinator, 'GET', '/api/live/state');
  assert.deepEqual(state.helpRequests.map((h) => [h.id, h.type, h.handling]), [[water.id, 'water', 'queue'], [inc.id, 'first_aid', 'dispatch']], 'newest first');

  assert.equal((await call(DEMO.mobileEhbo, 'POST', `/api/help-requests/${water.id}/accept`, { teamId: TEAM2() })).statusCode, 409, 'a request goes to the queue, not a team');
  assert.equal((await call(DEMO.coordinator, 'POST', `/api/help-requests/${inc.id}/pick`)).statusCode, 409, 'an incident is not picked from the queue');
  assert.equal((await call(DEMO.coordinator, 'POST', '/api/help-requests/999999/pick')).statusCode, 404);
  assert.equal((await call(DEMO.locationLead, 'PUT', `/api/help-requests/${water.id}`, { detail: 'lots' })).statusCode, 200, 'adding to a request');
  assert.equal((await call(DEMO.locationLead, 'PUT', `/api/help-requests/${inc.id}`, { detail: 'lots' })).statusCode, 400, 'an incident needs its details');
  assert.equal((await call(DEMO.locationLead, 'POST', '/api/help-requests', { type: 'water', locationId: WATER(), clientId: 'no-detail-abcdef' })).statusCode, 400, 'a request says its detail, or null');
  for (const id of [inc.id, water.id]) await ok(DEMO.locationLead, 'POST', `/api/help-requests/${id}/withdraw`);
});
