import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AdminState, LiveIncident, LiveState, PushPayload, Report } from '@ehbo/shared';
import { buildApp } from '../src/app.ts';
import { DEMO, seedDemo } from '../src/demo.ts';
import { openEventDb, type EventDb } from '../src/event-db.ts';
import { generateVapidKeys } from '../src/webpush.ts';

let app: ReturnType<typeof buildApp>;
let db: EventDb;
let dir: string;
let pushes: PushPayload[];
let clock: Date;
const cookies = new Map<string, string>();

async function call(phone: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: object) {
  if (!cookies.has(phone)) {
    const res = await app.inject({ url: '/api/session', method: 'POST', payload: { phone } });
    cookies.set(phone, `ehbo_sessie=${res.cookies.find((c) => c.name === 'ehbo_sessie')!.value}`);
  }
  return app.inject({ method, url, payload, headers: { cookie: cookies.get(phone)! } });
}

async function ok<T = LiveState>(phone: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: object) {
  const res = await call(phone, method, url, payload);
  assert.ok(res.statusCode < 300, `${method} ${url}: ${res.statusCode} ${res.body}`);
  return res.json() as T;
}

const id = (table: string, name: string) => (db.raw.prepare(`SELECT id FROM ${table} WHERE name = ?`).get(name) as { id: number }).id;
const later = (seconds: number) => { clock = new Date(clock.getTime() + seconds * 1000); };
let n = 0;

/** Melding van de waterpost; Team 2 accepteert na `accept` s, is na `travel` s ter plaatse en rondt af. */
async function incident(accept: number, travel: number, outcome = 'geholpen') {
  const inc = await ok<LiveIncident>(DEMO.postLead, 'POST', '/api/incidents', {
    postId: id('posts', 'Waterpost 3 · brug'), clientId: `rapport-${++n}-abcdef`, what: 'onwel', persons: '1', responsive: null, note: null,
  });
  later(accept);
  await ok(DEMO.mobileEhbo, 'POST', `/api/incidents/${inc.id}/accept`, { unitId: id('ehbo_units', 'Team 2') });
  later(travel);
  await ok(DEMO.mobileEhbo, 'POST', `/api/incidents/${inc.id}/on-site`);
  later(300);
  await ok(DEMO.mobileEhbo, 'POST', `/api/incidents/${inc.id}/close`, { outcome, persons: '1', note: 'Gekoeld; "drinken" gegeven', stayHere: false });
  return inc;
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ehbo-report-'));
  db = openEventDb(dir, 'test', { name: 'Testloop' });
  seedDemo(db);
  pushes = [];
  clock = new Date('2026-12-31T10:00:00Z');
  cookies.clear();
  app = buildApp({
    db,
    vapid: { ...generateVapidKeys(), subject: 'mailto:test@example.org' },
    build: { version: 'test', commit: 'x', builtAt: '' },
    calls: { notify: (_phones, payload) => pushes.push(payload), schedule: () => () => {}, now: () => clock },
  });
  await app.ready();
  await ok(DEMO.postLead, 'PUT', `/api/posts/${id('posts', 'Waterpost 3 · brug')}/open`, { open: true });
  await ok(DEMO.mobileEhbo, 'PUT', `/api/units/${id('ehbo_units', 'Team 2')}/availability`, { availability: 'vrij' });
});

afterEach(async () => {
  await app.close();
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('rapport: tijden per incident en totalen; alleen voor beheerders', async () => {
  assert.equal((await call(DEMO.coordinator, 'GET', '/api/admin/report')).statusCode, 403);
  await incident(40, 240);
  await incident(60, 360, 'ambulance');
  await ok(DEMO.postLead, 'POST', '/api/requests', { postId: id('posts', 'Waterpost 3 · brug'), kind: 'water', detail: null, clientId: 'water-1-abcdef' });

  const report = await ok<Report>(DEMO.admin, 'GET', '/api/admin/report');
  assert.equal(report.event.name, 'Silvesterloop 2026');
  assert.deepEqual(report.counts, { posts: 4, staff: 5, units: 2 });
  assert.equal(report.incidents.length, 2);
  const [first] = report.incidents;
  assert.deepEqual([first!.number, first!.postName, first!.unitName, first!.responseSeconds, first!.travelSeconds], [1, 'Waterpost 3 · brug', 'Team 2', 40, 240]);
  assert.equal(report.totals.incidents, 2);
  assert.equal(report.totals.avgResponseSeconds, 50);
  assert.equal(report.totals.maxResponseSeconds, 60);
  assert.equal(report.totals.avgTravelSeconds, 300);
  assert.deepEqual(report.totals.byOutcome, { geholpen: 1, ambulance: 1 });
  assert.deepEqual(report.totals.byPost, [{ postName: 'Waterpost 3 · brug', count: 2 }]);
  assert.deepEqual(report.totals.requestsByKind, { water: 1 });
});

test('CSV voor Excel: puntkomma, BOM, Nederlandse tijd, aanhalingstekens in notities', async () => {
  await incident(40, 240);
  const res = await call(DEMO.admin, 'GET', '/api/admin/report.csv');
  assert.equal(res.statusCode, 200);
  assert.match(String(res.headers['content-type']), /text\/csv/);
  assert.match(String(res.headers['content-disposition']), /rapport-2026-12-31\.csv/);
  const lines = res.body.split('\r\n');
  assert.ok(lines[0]!.startsWith('﻿Nr;Post;Km;Melding'));
  assert.match(lines[1]!, /^1;Waterpost 3 · brug;10,5;Onwel \/ flauw;1;nee;afgerond;2026-12-31 11:00:00;2026-12-31 11:00:40;/);
  assert.match(lines[1]!, /;0:40;4:00;Team 2;nee;Ter plaatse geholpen;"Gekoeld; ""drinken"" gegeven"$/);
});

test('testmodus: proefoproepen met "Test" in de melding, niet in het rapport, daarna te wissen', async () => {
  let state = await ok<AdminState>(DEMO.admin, 'PUT', '/api/admin/test-mode', { on: true });
  assert.equal(state.testMode, true);
  assert.equal((await ok(DEMO.postLead, 'GET', '/api/live/state')).testMode, true, 'iedereen ziet de testmodus');

  pushes.length = 0;
  const proef = await incident(30, 120);
  assert.ok(pushes.every((p) => p.title.startsWith('Test · ')), 'elke melding begint met Test');
  assert.equal((await ok(DEMO.coordinator, 'GET', '/api/live/state')).incidents.find((i) => i.id === proef.id)?.isTest, true);

  await ok(DEMO.admin, 'PUT', '/api/admin/test-mode', { on: false });
  await incident(45, 200);
  const report = await ok<Report>(DEMO.admin, 'GET', '/api/admin/report');
  assert.equal(report.incidents.length, 1, 'alleen de echte oproep');
  assert.equal(report.testItems, 1);

  state = await ok<AdminState>(DEMO.admin, 'DELETE', '/api/admin/test-data');
  assert.equal((await ok<Report>(DEMO.admin, 'GET', '/api/admin/report')).testItems, 0);
  assert.equal((await ok(DEMO.coordinator, 'GET', '/api/live/state')).incidents.length, 1);
});

test('testgegevens wissen kan niet zolang er een proefoproep loopt', async () => {
  await ok(DEMO.admin, 'PUT', '/api/admin/test-mode', { on: true });
  await ok(DEMO.postLead, 'POST', '/api/incidents', {
    postId: id('posts', 'Waterpost 3 · brug'), clientId: 'open-proef-abcdef', what: null, persons: null, responsive: null, note: null,
  });
  const res = await call(DEMO.admin, 'DELETE', '/api/admin/test-data');
  assert.equal(res.statusCode, 409);
  assert.match(res.json().error, /proefoproepen/);
});
