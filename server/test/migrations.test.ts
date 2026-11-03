// An event file from before keeps everything when the schema changes: the values in English (migration 21), with nothing lost.
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
  `);
  old.close();

  const db = openEventDb(dir, 'old', { name: 'Oud' });
  const rows = (sql: string) => db.raw.prepare(sql).all();
  assert.deepEqual(rows('SELECT name, kind, mobility, availability FROM ehbo_units ORDER BY id').map((r) => Object.values(r)),
    [['Team 1', 'fixed', null, 'available'], ['Team 2', 'mobile', 'on_foot', 'unavailable']]);
  assert.deepEqual(rows('SELECT role FROM post_contacts').map((r) => r.role), ['lead']);
  assert.equal(rows('SELECT * FROM ehbo_unit_members').length, 1, 'members are still there');
  assert.equal(rows('SELECT * FROM incident_dispatches').length, 1, 'and so are the dispatches of the report');
  assert.equal((db.raw.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys, 1, 'foreign keys are back on');
  assert.throws(() => db.raw.prepare("INSERT INTO ehbo_units (name, kind) VALUES ('X', 'vast')").run(), /CHECK/);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
