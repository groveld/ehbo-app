// Closing by time: always after a warning, never during an open call, and only by the planned time.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { incidentsOf, plannedClose, type Me, type PushPayload } from '@ehbo/shared';
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
const TEAM2 = () => idOf('teams', 'Team 2');
const post = () => calls.state().posts.find((p) => p.id === WATER())!;
const teamNow = () => calls.state().teams.find((u) => u.id === TEAM2())!;
const lead = (): Me => ({ phone: DEMO.postLead, name: 'Wim', isAdmin: false, assignments: [{ kind: 'post', postId: WATER(), role: 'lead', title: '', letter: 'W', color: '' }], home: 'post' }) as Me;
const coordinator = (): Me => ({ phone: DEMO.coordinator, name: 'Cor', isAdmin: false, assignments: [], home: 'overzicht' }) as Me;

/** An incident at the water post as the server stores it: a help request of the first-aid type with its dispatch details. */
function addIncident(clientId: string, status: 'sent' | 'accepted', teamId: number | null = null) {
  const id = Number(db.raw.prepare(`INSERT INTO help_requests (client_id, type_id, post_id, reported_by, status, reported_at, is_test)
    VALUES (?, (SELECT id FROM help_request_types WHERE key = 'first_aid'), ?, ?, ?, ?, 0)`).run(clientId, WATER(), DEMO.postLead, status, clock.toISOString()).lastInsertRowid);
  set("INSERT INTO dispatch_details (help_request_id, stage, sent_at, team_id) VALUES (?, 'all', ?, ?)", id, clock.toISOString(), teamId);
  if (teamId !== null) set("INSERT INTO dispatches (help_request_id, team_id, at, reason, accepted_at) VALUES (?, ?, ?, 'all', ?)", id, teamId, clock.toISOString(), clock.toISOString());
  return id;
}

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
  addIncident('close-1', 'sent');
  sweepAt('14:00');
  assert.equal(post().isOpen, true);
  assert.equal(post().closesAt, null);
  set("UPDATE help_requests SET status = 'closed'");
  sweepAt('15:00');
  assert.equal(post().isOpen, true, 'a new warning first');
  assert.ok(post().closesAt);
});

test('a team closes by its own shift, and a call keeps it on', () => {
  set("UPDATE teams SET availability = 'available', time_to = '12:00' WHERE id = ?", TEAM2());
  sweepAt('12:20');
  assert.ok(teamNow().closesAt);
  sweepAt('12:30');
  assert.equal(teamNow().availability, 'off_duty');

  set("UPDATE teams SET availability = 'available' WHERE id = ?", TEAM2());
  addIncident('close-2', 'accepted', TEAM2());
  sweepAt('13:00');
  assert.equal(teamNow().availability, 'available');
  assert.equal(teamNow().closesAt, null);
});

test('a phone that missed the closing can still ask for help; a post closed by a person cannot', () => {
  sweepAt('13:50');
  sweepAt('14:00');
  const report = { type: 'first_aid' as const, postId: WATER(), clientId: 'close-report-1', what: null, persons: null, responsive: null, note: null };
  assert.equal(calls.report(lead(), report).postId, WATER());
  assert.equal(post().isOpen, true);
  assert.equal(post().autoClosedAt, null);
  set("UPDATE help_requests SET status = 'closed'");

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

const logIn = (...phones: string[]) => {
  for (const phone of phones) set("INSERT INTO sessions (token_hash, phone, expires_at) VALUES (?, ?, '2099-01-01 00:00:00')", `hash-${phone}`, phone);
};

test('coordinator: everything at once, and not while a call is open', () => {
  assert.throws(() => calls.openAll(lead()), /coördinator/);
  logIn(DEMO.coordinator, DEMO.ehbo, DEMO.postLead, DEMO.mobileEhbo);
  calls.openAll(coordinator());
  assert.ok(calls.state().posts.every((p) => p.isOpen));
  assert.ok(calls.state().teams.every((u) => u.availability === 'available'));

  addIncident('close-3', 'sent');
  assert.throws(() => calls.closeDay(coordinator(), () => {}), /Eerst afronden: Waterpost 3/);
  const { skipped } = calls.closeAll(coordinator());
  assert.deepEqual(skipped, ['Waterpost 3 · brug']);
  assert.equal(post().isOpen, true);

  set("UPDATE help_requests SET status = 'closed'");
  let finished = false;
  calls.closeDay(coordinator(), () => { finished = true; });
  assert.ok(finished);
  assert.ok(calls.state().posts.every((p) => !p.isOpen));
});

test('open all skips what nobody is logged in for, and names it', () => {
  set('UPDATE posts SET is_open = 0');
  logIn(DEMO.postLead, DEMO.ehbo);
  const { skipped } = calls.openAll(coordinator());
  assert.deepEqual(skipped, ['Start/finish De Trilker', 'Team 2']);
  assert.equal(calls.state().posts.filter((p) => p.isOpen).length, 3, 'the EHBO post, the water post and Kruising 4, where Wim is a member');
});

test('the last member logging out during a call: the team goes off duty once the call is over', () => {
  logIn(DEMO.mobileEhbo);
  set("UPDATE teams SET availability = 'available' WHERE id = ?", TEAM2());
  addIncident('left-1', 'accepted', TEAM2());
  set('DELETE FROM sessions');
  calls.leave([DEMO.mobileEhbo]);
  assert.equal(teamNow().availability, 'available');
  sweepAt('12:01');
  assert.equal(teamNow().availability, 'available');
  set("UPDATE help_requests SET status = 'closed'");
  sweepAt('12:02');
  assert.equal(teamNow().availability, 'off_duty');
});

test('a team starts an incident itself: on site at once, the place by GPS, and no call to anyone else', () => {
  const mo = (): Me => ({ phone: DEMO.mobileEhbo, name: 'Mo', isAdmin: false, assignments: [{ kind: 'ehbo', teamId: TEAM2(), title: '', letter: '+', color: '' }], home: 'ehbo' }) as Me;
  const [lat, lng] = [53.1512, 5.8344];
  const body = { clientId: 'self-start-1', teamId: TEAM2(), postId: WATER(), what: 'cramp' as const, persons: '1' as const, responsive: null, note: null };

  // Within the radius of the post: the post itself.
  const atPost = calls.selfStart(mo(), { ...body, lat: lat + 0.0002, lng });
  assert.deepEqual([atPost.status, atPost.post.name, atPost.offPost, atPost.selfStarted, atPost.teamId], ['on_site', 'Waterpost 3 · brug', false, true, TEAM2()]);
  assert.equal(teamNow().incidentId, atPost.id);
  assert.equal(incidentsOf(calls.state()).length, 1);
  assert.equal(calls.selfStart(mo(), { ...body, lat, lng }).id, atPost.id, 'sent twice counts once');
  assert.throws(() => calls.selfStart(mo(), { ...body, clientId: 'self-start-2', lat, lng }), /al bezig/);
  assert.ok(!pushes.some((p) => p.payload.urgent), 'no alarm for anyone');
  assert.ok(pushes.some((p) => p.phones.includes(DEMO.coordinator) && p.payload.body.includes('zelf een incident')));
  set("UPDATE help_requests SET status = 'closed'");

  // Further away: the distance to the nearest post, and that post only for the report.
  const away = calls.selfStart(mo(), { ...body, clientId: 'self-start-3', lat: lat + 0.002, lng });
  assert.equal(away.offPost, true);
  assert.match(away.post.name, /^\d+ m van /);
  assert.equal(away.post.lat, lat + 0.002);
});

test('last contact is only for the coordinator, and only of what is open', () => {
  assert.throws(() => calls.lastSeen(lead()), /coördinator/);
  set("INSERT INTO sessions (token_hash, phone, user_agent, expires_at, last_seen_at) VALUES ('h', ?, 'x', '2099-01-01 00:00:00', '2026-12-31 11:00:00')", DEMO.postLead);
  const seen = calls.lastSeen(coordinator());
  assert.equal(seen.posts[WATER()], '2026-12-31T11:00:00Z');
  assert.equal(seen.teams[TEAM2()], undefined, 'off duty');
});
