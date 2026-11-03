// An event file from before keeps everything when the schema changes: values in English (21), units as teams (22), and incidents
// and requests as one help request with a type (23), with nothing lost.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { MIGRATIONS, openEventDb } from '../src/event-db.ts';

test('team and contact values become English, and a rebuilt table keeps what refers to it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ehbo-migrate-'));
  fs.mkdirSync(path.join(dir, 'events'));
  const file = path.join(dir, 'events', 'old.sqlite');

  // An event file as it was before migration 21, with the old Dutch values.
  const old = new DatabaseSync(file);
  old.exec('PRAGMA foreign_keys = ON');
  for (const step of MIGRATIONS.slice(0, 20)) typeof step === 'string' ? old.exec(step) : step(old);
  old.exec(`
    PRAGMA user_version = 20;
    INSERT INTO event (id, name) VALUES (1, 'Oud');
    INSERT INTO post_types (id, key, name, letter, color) VALUES (1, 'ehbo', 'EHBO-post', '+', '#0A7D4F');
    INSERT INTO posts (id, type_id, name) VALUES (1, 1, 'EHBO-post 1');
    INSERT INTO post_functions (post_id, type_id) VALUES (1, 1);
    INSERT INTO people (phone, name) VALUES ('+31600000003', 'Eva'), ('+31600000004', 'Wim');
    INSERT INTO post_contacts (post_id, phone, role) VALUES (1, '+31600000004', 'verantwoordelijke');
    INSERT INTO ehbo_units (id, name, kind, mobility, post_id, availability) VALUES (1, 'Team 1', 'vast', NULL, 1, 'vrij'), (2, 'Team 2', 'mobiel', 'te_voet', 1, 'pauze');
    INSERT INTO ehbo_unit_members (unit_id, phone) VALUES (1, '+31600000003');
    INSERT INTO incidents (id, client_id, post_id, reported_by, status, stage, reported_at, sent_at, unit_id) VALUES (1, 'c1', 1, '+31600000004', 'afgerond', 'dichtstbij', 'x', 'x', 1);
    INSERT INTO incident_dispatches (incident_id, unit_id, at, reason) VALUES (1, 1, 'x', 'dichtstbij');
    UPDATE incidents SET what = 'onwel', responsive = 'nee', outcome = 'geholpen' WHERE id = 1;
    INSERT INTO incident_events (incident_id, at, type, unit_id, text) VALUES (1, 'x', 'gemeld', NULL, 'Gemeld door EHBO-post 1');
    INSERT INTO requests (id, client_id, post_id, kind, detail, status, reported_by, created_at, picked_at, picked_by)
      VALUES (1, 'r1', 1, 'verkeer', 'druk', 'opgepakt', '+31600000004', 'y', 'z', '+31600000003');
  `);
  old.close();

  const db = openEventDb(dir, 'old', { name: 'Oud' });
  const rows = (sql: string) => db.raw.prepare(sql).all();
  assert.deepEqual(rows('SELECT name, kind, mobility, availability FROM teams ORDER BY id').map((r) => Object.values(r)),
    [['Team 1', 'fixed', null, 'available'], ['Team 2', 'mobile', 'on_foot', 'unavailable']]);
  assert.deepEqual(rows('SELECT role FROM location_contacts').map((r) => r.role), ['lead']);
  assert.deepEqual(rows('SELECT key FROM function_types').map((r) => r.key), ['first_aid'], 'a post type is a function type, with an English key');
  assert.deepEqual(rows('SELECT location_id FROM help_requests ORDER BY id').map((r) => r.location_id), [1, 1], 'a help request keeps its location');
  assert.deepEqual(rows('SELECT team_id, phone FROM team_members').map((r) => Object.values(r)), [[1, '+31600000003']], 'members are still there');
  assert.deepEqual(rows('SELECT team_id, reason FROM dispatches').map((r) => Object.values(r)), [[1, 'nearest']], 'and so are the dispatches of the report');
  assert.deepEqual(rows('SELECT id, team_id, status, stage, what, responsive, outcome FROM incidents').map((r) => Object.values(r)),
    [[1, 1, 'closed', 'nearest', 'unwell', 'no', 'treated']], 'an incident keeps its id, in English');
  assert.deepEqual(rows('SELECT type, text FROM help_request_events').map((r) => Object.values(r)), [['reported', 'Gemeld door EHBO-post 1']]);
  assert.deepEqual(rows('SELECT id, kind, detail, status, created_at, picked_at, picked_by FROM queue_requests').map((r) => Object.values(r)),
    [[1000001, 'traffic', 'busy', 'accepted', 'y', 'z', '+31600000003']], 'a request moves up by 1,000,000');
  assert.equal((db.raw.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys, 1, 'foreign keys are back on');
  assert.throws(() => db.raw.prepare("INSERT INTO teams (name, kind) VALUES ('X', 'vast')").run(), /CHECK/);
  // Deleting a team still clears its members: the reference moved along with the table.
  db.raw.prepare('DELETE FROM teams WHERE id = 2').run();
  db.raw.prepare('DELETE FROM dispatches').run();
  db.raw.prepare('UPDATE dispatch_details SET team_id = NULL').run();
  db.raw.prepare('DELETE FROM teams WHERE id = 1').run();
  assert.equal(rows('SELECT * FROM team_members').length, 0);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
