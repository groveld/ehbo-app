import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import type { EventPackage, MapStatus } from '@ehbo/shared';
import { buildApp } from '../src/app.ts';
import { DEMO, seedDemo } from '../src/demo.ts';
import { openEventDb, type EventDb } from '../src/event-db.ts';
import { areaBbox, assetPaths, MAX_ZOOM, tilesForBbox, type MapSource } from '../src/map.ts';
import { generateVapidKeys } from '../src/webpush.ts';

let app: ReturnType<typeof buildApp>;
let db: EventDb;
let dir: string;
let adminCookie: string;
let staffCookie: string;
const requested: string[] = [];

// Nep-kaart: elke tegel bevat zijn eigen coördinaten; tegels met x deelbaar door 7 zijn "water" (ontbreken).
const fakeSource: MapSource = {
  build: '20261028',
  getTile: async (z, x, y) => (x % 7 === 0 && z > 3 ? undefined : new TextEncoder().encode(`tile ${z}/${x}/${y}`)),
  getAsset: async (p) => {
    requested.push(p);
    return new TextEncoder().encode(`asset ${p}`);
  },
};

async function login(phone: string) {
  const res = await app.inject({ url: '/api/session', method: 'POST', payload: { phone } });
  return `ehbo_sessie=${res.cookies.find((c) => c.name === 'ehbo_sessie')!.value}`;
}

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ehbo-map-'));
  db = openEventDb(dir, 'test', { name: 'Testloop' });
  seedDemo(db);
  app = buildApp({ db, vapid: { ...generateVapidKeys(), subject: 'mailto:test@example.org' }, build: { version: 'test', commit: 'x', builtAt: '' }, mapSource: async () => fakeSource });
  await app.ready();
  adminCookie = await login(DEMO.admin);
  staffCookie = await login(DEMO.postMember);
});

after(async () => {
  await app.close();
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('kaartgebied: alle punten met 2 km marge', () => {
  const [west, south, east, north] = areaBbox([[5.80, 53.14], [5.84, 53.16]]);
  assert.ok(Math.abs((53.14 - south) * 111.32 - 2) < 0.01, 'zuid 2 km');
  assert.ok(Math.abs((north - 53.16) * 111.32 - 2) < 0.01, 'noord 2 km');
  assert.ok(west < 5.80 - 0.029 && east > 5.84 + 0.029, 'oost en west ± 2 km (breder op deze breedte)');
  assert.throws(() => areaBbox([]), /Geen parcours of posten/);
});

test('tegels per zoom: één wereldtegel op zoom 0, het gebied op zoom 15', () => {
  const tiles = tilesForBbox([5.77, 53.12, 5.87, 53.18]);
  assert.deepEqual(tiles[0], [0, 0, 0]);
  const z15 = tiles.filter(([z]) => z === MAX_ZOOM);
  // ± 6,7 × 6,7 km: 10 × 13 tegels op zoom 15.
  assert.ok(z15.length > 80 && z15.length < 200, `zoom 15: ${z15.length}`);
  assert.ok(tiles.length < 400, `totaal ${tiles.length}`);
});

test('zonder kaart: pakket zonder kaart, tegels geven 404', async () => {
  const pkg = (await app.inject({ url: '/api/package' })).json() as EventPackage;
  assert.equal(pkg.map, null);
  assert.equal((await app.inject({ url: '/map/0/tiles/0/0/0.mvt' })).statusCode, 404);
});

test('kaart ophalen: alleen beheerders, op de achtergrond, met voortgang', async () => {
  assert.equal((await app.inject({ url: '/api/admin/map', method: 'POST', headers: { cookie: staffCookie } })).statusCode, 403);
  const start = await app.inject({ url: '/api/admin/map', method: 'POST', headers: { cookie: adminCookie } });
  assert.equal(start.statusCode, 202);
  let status = start.json() as MapStatus;
  for (let i = 0; i < 100 && status.state === 'running'; i++) {
    await new Promise((r) => setTimeout(r, 20));
    status = (await app.inject({ url: '/api/admin/map', headers: { cookie: adminCookie } })).json();
  }
  assert.equal(status.state, 'done', status.message);
  assert.equal(status.done, status.total);
  assert.equal(status.current?.build, '20261028');
  assert.deepEqual(requested.sort(), assetPaths().sort(), 'lettertypen en iconen opgehaald');
});

test('tegels: gzip, lang te bewaren, alleen voor de huidige kaartversie', async () => {
  const pkg = (await app.inject({ url: '/api/package' })).json() as EventPackage;
  assert.ok(pkg.map, 'kaart in het pakket');
  const [z, x, y] = pkg.map.tiles.at(-1)!;
  const res = await app.inject({ url: `/map/${pkg.map.version}/tiles/${z}/${x}/${y}.mvt` });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['content-encoding'], 'gzip');
  assert.match(String(res.headers['cache-control']), /immutable/);
  assert.equal(zlib.gunzipSync(res.rawPayload).toString(), `tile ${z}/${x}/${y}`);

  assert.equal((await app.inject({ url: `/map/${pkg.map.version}/tiles/15/7/1.mvt` })).statusCode, 204, 'lege tegel (water)');
  assert.equal((await app.inject({ url: `/map/${pkg.map.version + 1}/tiles/${z}/${x}/${y}.mvt` })).statusCode, 404, 'andere versie');
  assert.ok(pkg.map.tiles.every(([, tx, , ]) => tx % 7 !== 0 || pkg.map!.tiles.some(([tz]) => tz <= 3)), 'lege tegels niet in de lijst');

  const font = await app.inject({ url: `/map/${pkg.map.version}/fonts/Noto%20Sans%20Regular/0-255.pbf` });
  assert.equal(font.statusCode, 200);
  assert.equal(font.headers['content-type'], 'application/x-protobuf');
  assert.equal((await app.inject({ url: `/map/${pkg.map.version}/sprites/v4/light.json` })).headers['content-type'], 'application/json');
});

test('evenementpakket: deelnemers zonder namen en nummers, medewerkers met', async () => {
  const pub = (await app.inject({ url: '/api/package' })).json() as EventPackage;
  assert.equal(pub.staff, false);
  assert.ok(pub.posts.length > 0);
  assert.doesNotMatch(JSON.stringify(pub), /\+316|Wim Water|accessRoute/, 'geen persoonsgegevens');
  assert.deepEqual([pub.units, pub.coreTeam, pub.emergencyNumbers], [[], [], []]);

  const staff = (await app.inject({ url: '/api/package', headers: { cookie: staffCookie } })).json() as EventPackage;
  assert.equal(staff.staff, true);
  assert.ok(staff.posts.some((p) => p.contacts?.some((c) => c.name === 'Wim Water')));
  assert.equal(staff.coreTeam[0]?.phone, DEMO.coordinator);
  assert.equal(staff.units[0]?.members[0]?.name, 'Eva EHBO');
  assert.notEqual(staff.version, pub.version);
});

test('evenementpakket: 304 als de telefoon deze versie al heeft, nieuwe versie na een wijziging', async () => {
  const first = await app.inject({ url: '/api/package', headers: { cookie: staffCookie } });
  const etag = String(first.headers.etag);
  const same = await app.inject({ url: '/api/package', headers: { cookie: staffCookie, 'if-none-match': etag } });
  assert.equal(same.statusCode, 304);
  assert.equal(same.body, '');

  await app.inject({ url: '/api/admin/emergency-numbers', method: 'PUT', headers: { cookie: adminCookie }, payload: [{ label: 'SEH', number: '0513 685 685' }] });
  const changed = await app.inject({ url: '/api/package', headers: { cookie: staffCookie, 'if-none-match': etag } });
  assert.equal(changed.statusCode, 200);
  assert.deepEqual((changed.json() as EventPackage).emergencyNumbers, [{ label: 'SEH', number: '0513 685 685' }]);
});

test('standaardletters uit het schermontwerp', () => {
  const letters = db.raw.prepare("SELECT key, letter FROM post_types WHERE key IN ('start_finish', 'stempel') ORDER BY key").all();
  assert.deepEqual(letters.map((r) => r.letter), ['S/F', 'St']);
});
