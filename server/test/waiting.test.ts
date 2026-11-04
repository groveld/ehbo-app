// Waiting calls: a busy team isn't rung for the next one, a team that becomes free gets one at a time (the worst, then the nearest),
// and a call near a busy team stays with that team until it waited Delen na.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { incidentsOf, type IncidentDetails, type Me, type PushPayload } from '@ehbo/shared';
import { createCalls, type Calls } from '../src/calls.ts';
import { DEMO, seedDemo } from '../src/demo.ts';
import { openEventDb, type EventDb } from '../src/event-db.ts';

let db: EventDb;
let dir: string;
let calls: Calls;
let clock: Date;
let pushes: { phones: string[]; payload: PushPayload }[];
let timers: { fn: () => void; ms: number; cancelled: boolean }[];

const set = (query: string, ...params: (string | number | null)[]) => db.raw.prepare(query).run(...params);
const idOf = (table: string, name: string) => (db.raw.prepare(`SELECT id FROM ${table} WHERE name = ?`).get(name) as { id: number }).id;
const WATER = () => idOf('locations', 'Waterpost 3 · brug');
const START = () => idOf('locations', 'Start/finish De Trilker');
const TEAM1 = () => idOf('teams', 'Team 1');
const TEAM2 = () => idOf('teams', 'Team 2');

const member = (phone: string, teamId: number): Me => ({ phone, name: phone, isAdmin: false, assignments: [{ kind: 'team', teamId, title: '', letter: '+', color: '' }], home: 'first_aid' }) as Me;
const team1 = () => member(DEMO.ehbo, TEAM1());
const team2 = () => member(DEMO.mobileEhbo, TEAM2());
const coordinator = (): Me => ({ phone: DEMO.coordinator, name: 'Cor', isAdmin: false, assignments: [], home: 'map' }) as Me;

let clientIds = 0;
const report = (locationId: number, details: Partial<IncidentDetails> = {}) =>
  calls.report(coordinator(), { type: 'first_aid', locationId, clientId: `waiting-${++clientIds}`, what: 'unwell', persons: '1', responsive: null, note: null, ...details }).id;
const incident = (id: number) => incidentsOf(calls.state()).find((i) => i.id === id)!;
const asked = (id: number) => incident(id).dispatches.filter((d) => !d.declinedAt && !d.acceptedAt).map((d) => d.teamId);
const close = (me: Me, id: number) => calls.close(me, id, { outcome: 'treated', persons: '1', note: null, stayHere: false });
const alarmed = (phone: string) => pushes.filter((p) => p.phones.includes(phone) && p.payload.urgent);
const minutes = (n: number) => { clock = new Date(clock.getTime() + n * 60_000); };

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ehbo-waiting-'));
  db = openEventDb(dir, 'test', { name: 'Test' });
  seedDemo(db);
  set('UPDATE locations SET is_open = 1');
  pushes = [];
  timers = [];
  clock = new Date('2026-12-31T11:00:00.000Z');
  calls = createCalls(db, {
    notify: (phones, payload) => pushes.push({ phones: [...phones], payload }),
    schedule: (fn, ms) => { const timer = { fn, ms, cancelled: false }; timers.push(timer); return () => { timer.cancelled = true; }; },
    now: () => clock,
  });
});

afterEach(() => {
  calls.stop();
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Let every timer run out, again and again, as if nobody does anything for a long time. */
function waitLong() {
  for (let n = 0; n < 50; n++) {
    const timer = timers.find((t) => !t.cancelled);
    if (!timer) return;
    timer.cancelled = true;
    clock = new Date(clock.getTime() + timer.ms);
    timer.fn();
  }
}

test('the only team: busy with one, not rung for the next; that one waits and comes after closing', () => {
  calls.setAvailability(team2(), TEAM2(), 'available');
  const first = report(WATER());
  const second = report(WATER());
  assert.deepEqual([asked(first), asked(second)], [[TEAM2()], [TEAM2()]], 'free, so asked for both');

  calls.accept(team2(), first, TEAM2());
  assert.equal(incident(second).stage, 'all', 'nobody else can answer: on at once, without waiting for the escalation time');
  assert.ok(pushes.some((p) => p.phones.includes(DEMO.coordinator) && p.payload.body.includes('Alle EHBO-eenheden zijn bezig')));

  pushes.length = 0;
  waitLong();
  assert.equal(alarmed(DEMO.mobileEhbo).length, 0, 'no alarm during the call');
  assert.equal(incident(second).status, 'sent', 'still waiting');

  close(team2(), first);
  assert.ok(alarmed(DEMO.mobileEhbo).some((p) => p.payload.title.includes('Waterpost')), 'the waiting call, once free');
});

test('a team that becomes free gets one call at a time: the worst, then the nearest', () => {
  calls.setAvailability(team2(), TEAM2(), 'available');
  const busy = report(WATER());
  calls.accept(team2(), busy, TEAM2());
  const far = report(START());
  const near = report(WATER());
  const worst = report(START(), { responsive: 'no' });

  close(team2(), busy);
  assert.deepEqual([asked(far), asked(near), asked(worst)], [[], [], [TEAM2()]], 'not responsive first, even further away');

  calls.accept(team2(), worst, TEAM2());
  close(team2(), worst);
  assert.deepEqual([asked(far), asked(near)], [[], [TEAM2()]], 'then the nearest: without GPS a mobile team counts from its standplaats, near the water post');
});

test('a call near a busy team stays with it, until it waited Delen na; not responsive goes at once', () => {
  set('UPDATE event SET share_after_min = 5 WHERE id = 1');
  calls.setAvailability(team1(), TEAM1(), 'available');
  const atStart = report(START());
  calls.accept(team1(), atStart, TEAM1());
  const waiting = report(START());
  assert.deepEqual(asked(waiting), []);

  // Team 2 is on the other side of the route: the call near Team 1 is Team 1's.
  calls.setAvailability(team2(), TEAM2(), 'available');
  assert.deepEqual(asked(waiting), [], 'kept for Team 1');
  const worst = report(START(), { responsive: 'no' });
  assert.deepEqual(asked(worst), [TEAM2()], 'not responsive: whoever is free');
  calls.decline(team2(), worst, TEAM2());

  minutes(4);
  calls.sweep();
  assert.deepEqual(asked(waiting), [], 'not yet');
  minutes(1);
  calls.sweep();
  assert.deepEqual(asked(waiting), [TEAM2()], 'waited 5 minutes: shared');
  assert.ok(incident(waiting).events.some((e) => e.text.includes('Team 1 is nog bezig')));
});

test('its own call goes to a team at once, also when another team is free', () => {
  calls.setAvailability(team1(), TEAM1(), 'available');
  const atStart = report(START());
  calls.accept(team1(), atStart, TEAM1());
  const nearWater = report(WATER());
  const nearStart = report(START());
  calls.setAvailability(team2(), TEAM2(), 'available');
  assert.deepEqual([asked(nearWater), asked(nearStart)], [[TEAM2()], []], 'its own, near the water post');
  calls.accept(team2(), nearWater, TEAM2());
  close(team1(), atStart);
  assert.deepEqual(asked(nearStart), [TEAM1()]);
});
