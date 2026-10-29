import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { LiveIncident, LiveState, NewIncident, PushPayload } from '@ehbo/shared';
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
    const res = await app.inject({ url: '/api/session', method: 'POST', payload: { phone } });
    assert.equal(res.statusCode, 200, res.body);
    cookies.set(phone, `ehbo_sessie=${res.cookies.find((c) => c.name === 'ehbo_sessie')!.value}`);
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
const WATER = () => idOf('posts', 'Waterpost 3 · brug');
const TEAM1 = () => idOf('ehbo_units', 'Team 1');
const TEAM2 = () => idOf('ehbo_units', 'Team 2');

let clientIds = 0;
const request = (details: Partial<NewIncident> = {}): NewIncident => ({
  postId: WATER(), clientId: `test-${++clientIds}-abcdef`, what: 'onwel', persons: '1', responsive: null, note: null, ...details,
});

const pushesTo = (phone: string) => pushes.filter((p) => p.phones.includes(phone));
const incident = async (id: number) => (await ok(DEMO.coordinator, 'GET', '/api/live/state')).incidents.find((i) => i.id === id)!;

/** Waterpost open, beide eenheden in dienst. */
async function onDuty() {
  await ok(DEMO.postLead, 'PUT', `/api/posts/${WATER()}/open`, { open: true });
  await ok(DEMO.ehbo, 'PUT', `/api/units/${TEAM1()}/availability`, { availability: 'vrij' });
  await ok(DEMO.mobileEhbo, 'PUT', `/api/units/${TEAM2()}/availability`, { availability: 'vrij' });
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

test('post open en dicht: alleen de postverantwoordelijke; een dichte post kan geen verzoek doen', async () => {
  assert.equal((await call(DEMO.postLead, 'POST', '/api/incidents', request())).statusCode, 409, 'post is nog dicht');
  const traffic = idOf('posts', 'Kruising 4');
  assert.equal((await call(DEMO.postMember, 'PUT', `/api/posts/${traffic}/open`, { open: true })).statusCode, 403, 'lid, geen verantwoordelijke');
  const state = await ok(DEMO.postLead, 'PUT', `/api/posts/${WATER()}/open`, { open: true });
  assert.equal(state.posts.find((p) => p.id === WATER())?.isOpen, true);
  assert.equal((await call(DEMO.postMember, 'POST', '/api/incidents', request())).statusCode, 403, 'niet je eigen post');
});

test('vaste eenheid: in dienst en de eigen EHBO-post open zijn hetzelfde', async () => {
  const ehboPost = idOf('posts', 'EHBO-post 1 · start');
  let state = await ok(DEMO.ehbo, 'PUT', `/api/units/${TEAM1()}/availability`, { availability: 'vrij' });
  assert.equal(state.posts.find((p) => p.id === ehboPost)?.isOpen, true);
  state = await ok(DEMO.ehbo, 'PUT', `/api/posts/${ehboPost}/open`, { open: false });
  assert.equal(state.units.find((u) => u.id === TEAM1())?.availability, 'uit_dienst');
  assert.equal((await call(DEMO.ehbo, 'PUT', `/api/units/${TEAM2()}/availability`, { availability: 'vrij' })).statusCode, 403, 'niet je eigen eenheid');
});

test('oproep naar de dichtstbijzijnde beschikbare eenheid, kopie naar de coördinator, accepteren', async () => {
  await onDuty();
  const created = await call(DEMO.postLead, 'POST', '/api/incidents', request());
  assert.equal(created.statusCode, 201, created.body);
  const inc = created.json() as LiveIncident;
  assert.equal(inc.status, 'verstuurd');
  assert.equal(inc.stage, 'dichtstbij');
  assert.deepEqual(inc.dispatches.map((d) => [d.unitId, d.reason]), [[TEAM2(), 'dichtstbij']], 'Team 2 staat bij Kruising 4, vlak bij de waterpost');
  assert.equal(inc.escalatesAt, '2026-12-31T11:02:30.000Z');
  assert.equal(pending()[0]?.ms, 30_000);

  const alarm = pushesTo(DEMO.mobileEhbo)[0]!.payload;
  assert.equal(alarm.urgent, true);
  assert.match(alarm.title, /EHBO-oproep · Waterpost 3/);
  assert.match(alarm.body, /Onwel \/ flauw · 1 persoon · \d+,\d km/);
  assert.equal(pushesTo(DEMO.ehbo).length, 0, 'Team 1 nog niet');
  assert.match(pushesTo(DEMO.coordinator)[0]!.payload.body, /Naar Team 2/);

  const state = await ok(DEMO.mobileEhbo, 'POST', `/api/incidents/${inc.id}/accept`, { unitId: TEAM2() });
  const accepted = state.incidents.find((i) => i.id === inc.id)!;
  assert.equal(accepted.status, 'geaccepteerd');
  assert.equal(accepted.unitId, TEAM2());
  assert.equal(accepted.acceptedBy?.name, 'Mo Mobiel');
  assert.equal(state.units.find((u) => u.id === TEAM2())?.incidentId, inc.id, 'Team 2 is bezet');
  assert.equal(pending().length, 0, 'geen escalatie meer');
  assert.match(pushesTo(DEMO.postLead).at(-1)!.payload.body, /Team 2 \(Mo Mobiel\) komt eraan/);

  const late = await call(DEMO.ehbo, 'POST', `/api/incidents/${inc.id}/accept`, { unitId: TEAM1() });
  assert.equal(late.statusCode, 409);
  assert.match(late.json().error, /al aangenomen door Team 2/);
});

test('geen reactie binnen de escalatietijd: naar alle beschikbare eenheden; de eerste die accepteert gaat', async () => {
  await onDuty();
  const inc = await ok<LiveIncident>(DEMO.postLead, 'POST', '/api/incidents', request());
  runNextTimer();
  let current = await incident(inc.id);
  assert.equal(current.stage, 'alle');
  assert.equal(current.escalatesAt, null);
  assert.deepEqual(current.dispatches.map((d) => d.unitId).sort(), [TEAM1(), TEAM2()].sort());
  assert.match(pushesTo(DEMO.ehbo)[0]!.payload.title, /alle eenheden/);
  assert.match(pushesTo(DEMO.coordinator).at(-1)!.payload.body, /Geen reactie binnen 30 s/);

  await ok(DEMO.ehbo, 'POST', `/api/incidents/${inc.id}/accept`, { unitId: TEAM1() });
  current = await incident(inc.id);
  assert.equal(current.unitId, TEAM1());
  const released = pushesTo(DEMO.mobileEhbo).at(-1)!.payload;
  assert.equal(released.title, 'Oproep is al aangenomen');
  assert.equal(released.tag, `oproep-${inc.id}`, 'vervangt het alarm');
  assert.ok(current.events.some((e) => e.type === 'geescaleerd'));
});

test('"Kan niet" gaat meteen naar alle eenheden', async () => {
  await onDuty();
  const inc = await ok<LiveIncident>(DEMO.postLead, 'POST', '/api/incidents', request());
  const state = await ok(DEMO.mobileEhbo, 'POST', `/api/incidents/${inc.id}/decline`, { unitId: TEAM2() });
  const current = state.incidents.find((i) => i.id === inc.id)!;
  assert.equal(current.stage, 'alle');
  assert.ok(current.dispatches.find((d) => d.unitId === TEAM2())?.declinedAt);
  assert.equal(pushesTo(DEMO.ehbo).length, 1, 'Team 1 krijgt de oproep');
  assert.equal(pushesTo(DEMO.mobileEhbo).length, 1, 'wie weigerde, krijgt niet opnieuw een alarm');
});

test('niet aanspreekbaar: ook de dichtstbijzijnde AED-eenheid, die blijft opgeroepen tot er een AED komt', async () => {
  await onDuty();
  const inc = await ok<LiveIncident>(DEMO.postLead, 'POST', '/api/incidents', request({ responsive: 'nee' }));
  assert.equal(inc.aed, true);
  assert.deepEqual(inc.dispatches.map((d) => [d.unitId, d.reason]), [[TEAM2(), 'dichtstbij'], [TEAM1(), 'aed']]);
  assert.match(pushesTo(DEMO.ehbo)[0]!.payload.body, /^AED meenemen/);
  assert.doesNotMatch(pushesTo(DEMO.mobileEhbo)[0]!.payload.body, /AED/, 'Team 2 heeft geen AED');

  await ok(DEMO.mobileEhbo, 'POST', `/api/incidents/${inc.id}/accept`, { unitId: TEAM2() });
  assert.equal(pushesTo(DEMO.ehbo).length, 1, 'Team 1 hoort niet "al aangenomen": de AED moet nog komen');
  const state = await ok(DEMO.ehbo, 'POST', `/api/incidents/${inc.id}/accept`, { unitId: TEAM1() });
  const current = state.incidents.find((i) => i.id === inc.id)!;
  assert.equal(current.unitId, TEAM2(), 'Team 2 blijft de eerste');
  assert.equal(current.dispatches.filter((d) => d.acceptedAt).length, 2);
});

test('aanvullen met "niet aanspreekbaar" roept alsnog de AED-eenheid op', async () => {
  await onDuty();
  const inc = await ok<LiveIncident>(DEMO.postLead, 'POST', '/api/incidents', request());
  await ok(DEMO.mobileEhbo, 'POST', `/api/incidents/${inc.id}/accept`, { unitId: TEAM2() });
  pushes.length = 0;
  const state = await ok(DEMO.postLead, 'PUT', `/api/incidents/${inc.id}`, { what: 'onwel', persons: '1', responsive: 'nee', note: 'Reageert niet meer' });
  const current = state.incidents.find((i) => i.id === inc.id)!;
  assert.equal(current.aed, true);
  assert.equal(current.note, 'Reageert niet meer');
  assert.ok(current.dispatches.some((d) => d.unitId === TEAM1() && d.reason === 'aed'));
  assert.match(pushesTo(DEMO.ehbo)[0]!.payload.title, /AED nodig/);
  assert.equal(pushesTo(DEMO.mobileEhbo)[0]!.payload.title, 'Melding aangevuld');
});

test('ter plaatse en afronden; een vaste eenheid die blijft, telt vanaf die post', async () => {
  await onDuty();
  // Team 2 ver weg: dan is Team 1 het dichtstbij.
  assert.equal((await call(DEMO.mobileEhbo, 'PUT', `/api/units/${TEAM2()}/position`, { lat: 52.0, lng: 4.0 })).statusCode, 204);
  const inc = await ok<LiveIncident>(DEMO.postLead, 'POST', '/api/incidents', request());
  assert.equal(inc.dispatches[0]?.unitId, TEAM1(), 'recente GPS-positie telt boven de standplaats');

  assert.equal((await call(DEMO.mobileEhbo, 'POST', `/api/incidents/${inc.id}/on-site`)).statusCode, 403);
  await ok(DEMO.ehbo, 'POST', `/api/incidents/${inc.id}/accept`, { unitId: TEAM1() });
  clock = new Date(clock.getTime() + 4 * 60_000);
  let state = await ok(DEMO.ehbo, 'POST', `/api/incidents/${inc.id}/on-site`);
  assert.equal(state.incidents[0]?.status, 'ter_plaatse');
  assert.equal(state.incidents[0]?.onSiteAt, '2026-12-31T11:06:00.000Z');

  state = await ok(DEMO.ehbo, 'POST', `/api/incidents/${inc.id}/close`, { outcome: 'geholpen', persons: '1', note: 'Gekoeld en drinken gegeven', stayHere: true });
  assert.equal(state.incidents[0]?.status, 'afgerond');
  assert.equal(state.incidents[0]?.outcome, 'geholpen');
  const team1 = state.units.find((u) => u.id === TEAM1())!;
  assert.deepEqual([team1.incidentId, team1.stayPostId, team1.availability], [null, WATER(), 'vrij'], 'weer vrij, bij de waterpost');

  // Een GPS-positie ouder dan 3 minuten telt niet meer: Team 2 staat weer bij zijn standplaats.
  clock = new Date(clock.getTime() + 4 * 60_000);
  const next = await ok<LiveIncident>(DEMO.postLead, 'POST', '/api/incidents', request());
  assert.equal(next.dispatches[0]?.unitId, TEAM1(), 'Team 1 blijft bij de waterpost en is nu het dichtstbij');
  assert.equal(next.dispatches[0]?.distanceKm, 0);
});

test('melding intrekken: opgeroepen eenheden horen het, de escalatie stopt', async () => {
  await onDuty();
  const inc = await ok<LiveIncident>(DEMO.postLead, 'POST', '/api/incidents', request());
  assert.equal((await call(DEMO.postMember, 'POST', `/api/incidents/${inc.id}/withdraw`)).statusCode, 403);
  const state = await ok(DEMO.postLead, 'POST', `/api/incidents/${inc.id}/withdraw`);
  assert.equal(state.incidents[0]?.status, 'ingetrokken');
  assert.equal(pending().length, 0);
  assert.equal(pushesTo(DEMO.mobileEhbo).at(-1)!.payload.title, 'Melding ingetrokken');
  assert.equal((await call(DEMO.mobileEhbo, 'POST', `/api/incidents/${inc.id}/accept`, { unitId: TEAM2() })).statusCode, 409);
});

test('dezelfde melding twee keer versturen (zonder bereik bewaard) telt één keer', async () => {
  await onDuty();
  const body = request({ reportedAt: '2026-12-31T11:01:30.000Z' });
  const first = await ok<LiveIncident>(DEMO.postLead, 'POST', '/api/incidents', body);
  const again = await ok<LiveIncident>(DEMO.postLead, 'POST', '/api/incidents', body);
  assert.equal(again.id, first.id);
  assert.equal(first.reportedAt, '2026-12-31T11:01:30.000Z', 'tijd van de post');
  assert.equal(first.sentAt, '2026-12-31T11:02:00.000Z', 'tijd van aankomst bij de server');
  assert.equal((await ok(DEMO.coordinator, 'GET', '/api/live/state')).incidents.length, 1);
});

test('geen beschikbare eenheid: meteen alle eenheden, de coördinator krijgt een alarm; daarna blijft het herhalen', async () => {
  await ok(DEMO.postLead, 'PUT', `/api/posts/${WATER()}/open`, { open: true });
  const inc = await ok<LiveIncident>(DEMO.postLead, 'POST', '/api/incidents', request());
  assert.equal(inc.stage, 'alle');
  assert.equal(inc.dispatches.length, 0);
  const alarm = pushesTo(DEMO.coordinator).at(-1)!.payload;
  assert.equal(alarm.urgent, true);
  assert.match(alarm.body, /Geen beschikbare EHBO-eenheid/);

  // Team 2 komt in dienst en krijgt bij de herhaling alsnog de oproep.
  await ok(DEMO.mobileEhbo, 'PUT', `/api/units/${TEAM2()}/availability`, { availability: 'vrij' });
  runNextTimer();
  const current = await incident(inc.id);
  assert.deepEqual(current.dispatches.map((d) => d.unitId), [TEAM2()]);
  assert.match(pushesTo(DEMO.mobileEhbo).at(-1)!.payload.title, /nog niemand/);
  assert.match(pushesTo(DEMO.coordinator).at(-1)!.payload.body, /Bel de eenheden/);
  assert.equal(pending().length, 1, 'volgende herhaling staat klaar');
});

test('de coördinator wijst een eenheid toe', async () => {
  await onDuty();
  const inc = await ok<LiveIncident>(DEMO.postLead, 'POST', '/api/incidents', request());
  assert.equal((await call(DEMO.postLead, 'POST', `/api/incidents/${inc.id}/assign`, { unitId: TEAM1() })).statusCode, 403);
  const state = await ok(DEMO.coordinator, 'POST', `/api/incidents/${inc.id}/assign`, { unitId: TEAM1() });
  const current = state.incidents[0]!;
  assert.equal(current.unitId, TEAM1());
  assert.equal(current.dispatches.find((d) => d.unitId === TEAM1())?.reason, 'handmatig');
  assert.match(pushesTo(DEMO.ehbo).at(-1)!.payload.title, /^Ingezet/);
  assert.equal(pushesTo(DEMO.mobileEhbo).at(-1)!.payload.title, 'Oproep is al aangenomen');
});

test('na een herstart gaat de escalatie verder', async () => {
  await onDuty();
  const inc = await ok<LiveIncident>(DEMO.postLead, 'POST', '/api/incidents', request());
  await app.close();
  timers = [];
  clock = new Date(clock.getTime() + 10_000);
  app = makeApp();
  await app.ready();
  assert.equal(pending()[0]?.ms, 20_000, 'de resterende tijd');
  runNextTimer();
  assert.equal((await incident(inc.id)).stage, 'alle');
});

test('live stand via SSE: direct de stand, en elke wijziging', async () => {
  await app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = app.server.address() as { port: number };
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/live`)).status, 401);

  const res = await fetch(`http://127.0.0.1:${port}/api/live`, { headers: { cookie: await login(DEMO.postMember) } });
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
  assert.equal(first.posts.find((p) => p.id === WATER())?.isOpen, false);
  await ok(DEMO.postLead, 'PUT', `/api/posts/${WATER()}/open`, { open: true });
  const second = await nextState();
  assert.equal(second.posts.find((p) => p.id === WATER())?.isOpen, true);
  assert.ok(second.version > first.version);
  await reader.cancel();
});
