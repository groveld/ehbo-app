// Closing by time: always after a warning, never during an open call, and only by the planned time.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { plannedClose, type Me, type PushPayload } from '@ehbo/shared';
import { createCalls, type Calls } from '../src/calls.ts';
import { DEMO, seedDemo } from '../src/demo.ts';
import { openEventDb, type EventDb } from '../src/event-db.ts';

let db: EventDb;
let dir: string;
let calls: Calls;
let clock: Date;
let pushes: { phones: string[]; payload: PushPayload }[];

const at = (time: string, day = '2026-12-31') => new Date(new Date(`${day}T${time}:00+01:00`).getTime());
const set = (query: string, ...params: (string | number | null)[]) => db.raw.prepare(query).run(...params);
const idOf = (table: string, name: string) => (db.raw.prepare(`SELECT id FROM ${table} WHERE name = ?`).get(name) as { id: number }).id;
const WATER = () => idOf('posts', 'Waterpost 3 · brug');
const TEAM2 = () => idOf('ehbo_units', 'Team 2');
const post = () => calls.state().posts.find((p) => p.id === WATER())!;
const team = () => calls.state().units.find((u) => u.id === TEAM2())!;
const lead = (): Me => ({ phone: DEMO.postLead, name: 'Wim', isAdmin: false, assignments: [{ kind: 'post', postId: WATER(), role: 'verantwoordelijke', title: '', letter: 'W', color: '' }], home: 'post' }) as Me;
const coordinator = (): Me => ({ phone: DEMO.coordinator, name: 'Cor', isAdmin: false, assignments: [], home: 'overzicht' }) as Me;

function sweepAt(time: string) {
  clock = at(time);
  calls.sweep();
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ehbo-closing-'));
  db = openEventDb(dir, 'test', { name: 'Test' });
  seedDemo(db);
  set("UPDATE event SET start_date = '2026-12-31', end_date = '2026-12-31' WHERE id = 1");
  // The demo's end time of this post is 13:30, so it closes at 14:00 with a warning at 13:50.
  set('UPDATE posts SET is_open = 1 WHERE id = ?', WATER());
  pushes = [];
  clock = at('12:00');
  calls = createCalls(db, { notify: (phones, payload) => pushes.push({ phones: [...phones], payload }), schedule: () => () => {}, now: () => clock });
});

afterEach(() => {
  calls.stop();
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the planned close is 30 minutes after the end time, in Dutch time', () => {
  const event = { startDate: '2026-12-31', endDate: '2026-12-31' };
  assert.equal(plannedClose({ timeTo: '13:30' }, event, at('12:00').getTime()), at('14:00').getTime());
  assert.equal(plannedClose({ timeTo: '13:30' }, event, at('12:00', '2026-12-30').getTime()), null, 'not before the event');
  assert.equal(plannedClose({ timeTo: null }, event, at('23:00').getTime()), null, 'no end time: a person closes it');
  assert.ok(plannedClose({ timeTo: null }, event, at('00:30', '2027-01-01').getTime()), 'but not after the event');
  assert.equal(plannedClose({ timeTo: '13:30' }, { startDate: null, endDate: null }, at('23:00').getTime()), null);
});

test('warning first, closing 10 minutes later, and the coordinator hears it', () => {
  sweepAt('13:49');
  assert.equal(post().closesAt, null);
  sweepAt('13:50');
  assert.equal(post().closesAt, at('14:00').toISOString());
  assert.ok(pushes.some((p) => p.phones.includes(DEMO.postLead) && p.payload.title.includes('sluit om 14:00')));
  sweepAt('13:59');
  assert.equal(post().isOpen, true);
  sweepAt('14:00');
  assert.equal(post().isOpen, false);
  assert.equal(post().autoClosedAt, at('14:00').toISOString());
  assert.ok(pushes.some((p) => p.phones.includes(DEMO.coordinator) && p.payload.body.includes('Waterpost 3')));
});

test('a server that was off still warns first', () => {
  sweepAt('18:00');
  assert.equal(post().isOpen, true);
  assert.equal(post().closesAt, at('18:10').toISOString());
});

test('keep open gives 30 minutes, then a new warning', () => {
  sweepAt('13:50');
  clock = at('13:55');
  calls.keepPost(lead(), WATER());
  assert.equal(post().closesAt, null);
  sweepAt('14:14');
  assert.equal(post().closesAt, null);
  sweepAt('14:15');
  assert.ok(post().closesAt);
});

test('never closes during an open call; a warning is taken back', () => {
  sweepAt('13:50');
  set(`INSERT INTO incidents (client_id, post_id, reported_by, status, stage, reported_at, sent_at, is_test) VALUES ('close-1', ?, ?, 'verstuurd', 'alle', ?, ?, 0)`, WATER(), DEMO.postLead, clock.toISOString(), clock.toISOString());
  sweepAt('14:00');
  assert.equal(post().isOpen, true);
  assert.equal(post().closesAt, null);
  set("UPDATE incidents SET status = 'afgerond'");
  sweepAt('15:00');
  assert.equal(post().isOpen, true, 'a new warning first');
  assert.ok(post().closesAt);
});

test('a team closes by its own shift, and a call keeps it on', () => {
  set("UPDATE ehbo_units SET availability = 'vrij', time_to = '12:00' WHERE id = ?", TEAM2());
  sweepAt('12:20');
  assert.ok(team().closesAt);
  sweepAt('12:30');
  assert.equal(team().availability, 'uit_dienst');

  set("UPDATE ehbo_units SET availability = 'vrij' WHERE id = ?", TEAM2());
  set(`INSERT INTO incidents (client_id, post_id, reported_by, status, stage, reported_at, sent_at, is_test, unit_id) VALUES ('close-2', ?, ?, 'geaccepteerd', 'alle', ?, ?, 0, ?)`, WATER(), DEMO.postLead, clock.toISOString(), clock.toISOString(), TEAM2());
  const incident = (db.raw.prepare("SELECT id FROM incidents WHERE client_id = 'close-2'").get() as { id: number }).id;
  set(`INSERT INTO incident_dispatches (incident_id, unit_id, at, reason, accepted_at) VALUES (?, ?, ?, 'alle', ?)`, incident, TEAM2(), clock.toISOString(), clock.toISOString());
  sweepAt('13:00');
  assert.equal(team().availability, 'vrij');
  assert.equal(team().closesAt, null);
});

test('a phone that missed the closing can still ask for help; a post closed by a person cannot', () => {
  sweepAt('13:50');
  sweepAt('14:00');
  const report = { postId: WATER(), clientId: 'close-report-1', what: null, persons: null, responsive: null, note: null };
  assert.equal(calls.report(lead(), report).postId, WATER());
  assert.equal(post().isOpen, true);
  assert.equal(post().autoClosedAt, null);
  set("UPDATE incidents SET status = 'afgerond'");

  calls.setPostOpen(lead(), WATER(), false);
  assert.throws(() => calls.report(lead(), { ...report, clientId: 'close-report-2' }), /dicht/);
});

test('opening again after the end time stays open for a while', () => {
  sweepAt('13:50');
  sweepAt('14:00');
  clock = at('14:30');
  calls.setPostOpen(lead(), WATER(), true);
  sweepAt('14:45');
  assert.equal(post().closesAt, null);
  sweepAt('14:50');
  assert.ok(post().closesAt);
});

test('coordinator: everything at once, and not while a call is open', () => {
  assert.throws(() => calls.openAll(lead()), /coördinator/);
  calls.openAll(coordinator());
  assert.ok(calls.state().posts.every((p) => p.isOpen));
  assert.ok(calls.state().units.every((u) => u.availability === 'vrij'));

  set(`INSERT INTO incidents (client_id, post_id, reported_by, status, stage, reported_at, sent_at, is_test) VALUES ('close-3', ?, ?, 'verstuurd', 'alle', ?, ?, 0)`, WATER(), DEMO.postLead, clock.toISOString(), clock.toISOString());
  assert.throws(() => calls.closeDay(coordinator(), () => {}), /Eerst afronden: Waterpost 3/);
  const { skipped } = calls.closeAll(coordinator());
  assert.deepEqual(skipped, ['Waterpost 3 · brug']);
  assert.equal(post().isOpen, true);

  set("UPDATE incidents SET status = 'afgerond'");
  let finished = false;
  calls.closeDay(coordinator(), () => { finished = true; });
  assert.ok(finished);
  assert.ok(calls.state().posts.every((p) => !p.isOpen));
});

test('last contact is only for the coordinator, and only of what is open', () => {
  assert.throws(() => calls.lastSeen(lead()), /coördinator/);
  set("INSERT INTO sessions (token_hash, phone, user_agent, expires_at, last_seen_at) VALUES ('h', ?, 'x', '2099-01-01 00:00:00', '2026-12-31 11:00:00')", DEMO.postLead);
  const seen = calls.lastSeen(coordinator());
  assert.equal(seen.posts[WATER()], '2026-12-31T11:00:00Z');
  assert.equal(seen.units[TEAM2()], undefined, 'off duty');
});
