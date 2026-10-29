import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_STYLE, type AdminState, type PostData, type UnitData } from '@ehbo/shared';
import { buildApp } from '../src/app.ts';
import { DEMO, seedDemo } from '../src/demo.ts';
import { openEventDb, type EventDb } from '../src/event-db.ts';
import { generateVapidKeys } from '../src/webpush.ts';

let app: ReturnType<typeof buildApp>;
let db: EventDb;
let dir: string;
let adminCookie: string;
let staffCookie: string;

async function login(phone: string) {
  const res = await app.inject({ url: '/api/session', method: 'POST', payload: { phone } });
  assert.equal(res.statusCode, 200, res.body);
  return `ehbo_sessie=${res.cookies.find((c) => c.name === 'ehbo_sessie')!.value}`;
}

const call = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: object | string, cookie = adminCookie, headers: Record<string, string> = {}) =>
  app.inject({ method, url, payload, headers: { cookie, ...headers } });

const version = () => (db.raw.prepare('SELECT version FROM event').get() as { version: number }).version;

const EVENT = {
  name: 'Silvesterloop 2026', startLocation: 'De Trilker', startDate: '2026-12-31', endDate: '2026-12-31', escalationSeconds: 30, style: DEFAULT_STYLE,
};

/** Begin van een PNG met de gevraagde maat, als base64; meer leest de server niet. */
function png(width: number, height = width) {
  const data = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(data);
  data.writeUInt32BE(13, 8);
  data.write('IHDR', 12, 'latin1');
  data.writeUInt32BE(width, 16);
  data.writeUInt32BE(height, 20);
  return data.toString('base64');
}

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ehbo-admin-'));
  db = openEventDb(dir, 'test', { name: 'Testloop' });
  seedDemo(db);
  app = buildApp({ db, vapid: { ...generateVapidKeys(), subject: 'mailto:test@example.org' }, build: { version: 'test', commit: 'x', builtAt: '' } });
  await app.ready();
  adminCookie = await login(DEMO.admin);
  staffCookie = await login(DEMO.postMember);
});

after(async () => {
  await app.close();
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('alleen beheerders', async () => {
  assert.equal((await call('GET', '/api/admin', undefined, '')).statusCode, 401);
  assert.equal((await call('GET', '/api/admin', undefined, staffCookie)).statusCode, 403);
  const state = (await call('GET', '/api/admin')).json() as AdminState;
  assert.equal(state.event.name, 'Silvesterloop 2026');
  assert.equal(state.posts.length, 4);
  assert.deepEqual(state.posts.map((p) => p.km), [0, 0, 9.7, 10.5], 'gesorteerd op km-punt');
  assert.equal(state.units[0]?.members[0]?.name, 'Eva EHBO');
  assert.equal(state.coreTeam[0]?.isCoordinator, true);
});

test('evenement opslaan; einddatum niet voor begindatum', async () => {
  const before = version();
  const event = { ...EVENT, escalationSeconds: 45 };
  const res = await call('PUT', '/api/admin/event', event);
  assert.equal(res.statusCode, 200, res.body);
  assert.equal((res.json() as AdminState).event.escalationSeconds, 45);
  assert.equal(version(), before + 1, 'nieuwe versie van het evenementpakket');
  assert.equal((await call('PUT', '/api/admin/event', { ...event, endDate: '2026-12-30' })).statusCode, 400);
  assert.equal((await call('PUT', '/api/admin/event', { ...event, escalationSeconds: 5 })).statusCode, 400);
  assert.equal((await call('PUT', '/api/admin/event', { ...event, startDate: '31-12-2026' })).statusCode, 400);
});

test('stijl: korte naam en kleuren, alleen leesbare kleuren', async () => {
  const style = { shortName: ' Silvester ', primaryColor: '#1d3557', accentColor: '#F2C230' };
  const state = (await call('PUT', '/api/admin/event', { ...EVENT, style })).json() as AdminState;
  assert.deepEqual(state.event.style, { shortName: 'Silvester', primaryColor: '#1D3557', accentColor: '#F2C230' });
  assert.equal((await app.inject({ url: '/manifest.webmanifest' })).json().short_name, 'Silvester');
  assert.equal((await app.inject({ url: '/api/event' })).json().style.primaryColor, '#1D3557', 'iedereen krijgt de kleuren');

  const light = await call('PUT', '/api/admin/event', { ...EVENT, style: { ...style, primaryColor: '#F2C230' } });
  assert.equal(light.statusCode, 400);
  assert.match(light.json().error, /hoofdkleur is te licht/);
  assert.equal((await call('PUT', '/api/admin/event', { ...EVENT, style: { ...style, accentColor: '#333333' } })).statusCode, 400);
  assert.equal((await call('PUT', '/api/admin/event', { ...EVENT, style: { ...style, shortName: 'Veel te lange naam' } })).statusCode, 400);
  assert.equal((await call('PUT', '/api/admin/event', { ...EVENT, style: { ...style, primaryColor: 'red' } })).statusCode, 400);
  await call('PUT', '/api/admin/event', EVENT);
});

test('logo en app-icoon uploaden, tonen en verwijderen', async () => {
  const icon = { icon512: png(512), icon192: png(192), maskable512: png(512), appleTouch: png(180) };
  assert.equal((await call('PUT', '/api/admin/brand/icon', icon, staffCookie)).statusCode, 403);
  assert.equal((await call('PUT', '/api/admin/brand/icon', { ...icon, icon192: png(200) })).statusCode, 400, 'verkeerde maat');
  assert.equal((await call('PUT', '/api/admin/brand/icon', { ...icon, icon192: Buffer.from('<svg/>').toString('base64') })).statusCode, 400, 'geen PNG');

  let state = (await call('PUT', '/api/admin/brand/icon', icon)).json() as AdminState;
  assert.match(state.brand.icon!, /^\/brand\/icon-192\.png\?v=\d+$/);
  const served = await app.inject({ url: '/brand/icon-192.png' });
  assert.equal(served.statusCode, 200);
  assert.equal(served.headers['content-type'], 'image/png');
  assert.equal(served.rawPayload.readUInt32BE(16), 192);
  assert.equal((await app.inject({ url: '/manifest.webmanifest' })).json().icons[0].src, state.brand.icon, 'manifest wijst naar de nieuwe versie');

  assert.equal((await call('PUT', '/api/admin/brand/logo', { png: png(3000, 600) })).statusCode, 400, 'te groot');
  state = (await call('PUT', '/api/admin/brand/logo', { png: png(1200, 400) })).json() as AdminState;
  assert.ok(state.brand.logo);
  assert.equal((await app.inject({ url: '/api/event' })).json().brand.logo, state.brand.logo);

  state = (await call('DELETE', '/api/admin/brand/icon')).json() as AdminState;
  assert.equal(state.brand.icon, null);
  assert.equal((await app.inject({ url: '/brand/apple-touch-icon.png' })).headers.location, '/icons/apple-touch-icon.png');
  state = (await call('DELETE', '/api/admin/brand/logo')).json() as AdminState;
  assert.equal(state.brand.logo, null);
});

test('loop toevoegen, GPX uploaden en verwijderen', async () => {
  let state = (await call('POST', '/api/admin/runs', { name: 'Marathon', distanceKm: 42.2, discipline: 'hardlopen', date: '2026-12-31', startTime: '10:00' })).json() as AdminState;
  const run = state.runs.at(-1)!;
  assert.equal(run.name, 'Marathon');
  assert.equal(run.gpx, null);

  const gpx = '<gpx><trk><trkseg><trkpt lat="53.0" lon="5.8"/><trkpt lat="53.009" lon="5.8"/></trkseg></trk></gpx>';
  const upload = await call('PUT', `/api/admin/runs/${run.id}/gpx?filename=marathon.gpx`, gpx, adminCookie, { 'content-type': 'application/gpx+xml' });
  assert.equal(upload.statusCode, 200, upload.body);
  state = upload.json();
  assert.deepEqual(state.runs.find((r) => r.id === run.id)?.gpx, { filename: 'marathon.gpx', points: 2, km: 1 });

  const bad = await call('PUT', `/api/admin/runs/${run.id}/gpx`, '<gpx/>', adminCookie, { 'content-type': 'application/gpx+xml' });
  assert.equal(bad.statusCode, 400);
  assert.match(bad.json().error, /Geen route/);

  assert.equal((await call('DELETE', `/api/admin/runs/${run.id}`)).statusCode, 200);
  assert.equal((await call('DELETE', `/api/admin/runs/${run.id}`)).statusCode, 404);
});

test('post met contactpersonen; nieuw nummer kan daarna aanmelden', async () => {
  const state = (await call('GET', '/api/admin')).json() as AdminState;
  const water = state.postTypes.find((t) => t.key === 'water')!;
  const post: PostData = {
    typeId: water.id, name: 'Waterpost 5', km: 30.5, lat: 53.16, lng: 5.85, accuracyM: 4, address: null,
    accessRoute: 'Via de dijk', timeFrom: '11:00', timeTo: '14:00',
    contacts: [{ name: 'Nieuwe Vrijwilliger', phone: '06-1234 5678', role: 'verantwoordelijke', timeFrom: null, timeTo: null }],
  };
  const res = await call('POST', '/api/admin/posts', post);
  assert.equal(res.statusCode, 200, res.body);
  const saved = (res.json() as AdminState).posts.find((p) => p.name === 'Waterpost 5')!;
  assert.equal(saved.contacts[0]?.phone, '+31612345678', 'nummer genormaliseerd');

  const me = (await app.inject({ url: '/api/session', method: 'POST', payload: { phone: '0612345678' } })).json();
  assert.equal(me.name, 'Nieuwe Vrijwilliger');
  assert.equal(me.home, 'post');

  // Wijzigen vervangt de contactpersonen; wie eraf gaat, verliest zijn rol.
  const edited = await call('PUT', `/api/admin/posts/${saved.id}`, { ...post, contacts: [] });
  assert.equal(edited.statusCode, 200);
  assert.equal((await app.inject({ url: '/api/session', method: 'POST', payload: { phone: '0612345678' } })).statusCode, 404);

  const invalid = await call('POST', '/api/admin/posts', { ...post, contacts: [{ ...post.contacts[0], name: 'Piet', phone: '123' }] });
  assert.equal(invalid.statusCode, 400);
  assert.match(invalid.json().error, /Piet/);
  assert.equal((await call('POST', '/api/admin/posts', { ...post, typeId: 999 })).statusCode, 400);
  assert.equal((await call('POST', '/api/admin/posts', { ...post, lng: null })).statusCode, 400);

  assert.equal((await call('DELETE', `/api/admin/posts/${saved.id}`)).statusCode, 200);
});

test('EHBO-eenheid: vast vraagt een post, mobiel niet', async () => {
  const state = (await call('GET', '/api/admin')).json() as AdminState;
  const stamp = state.posts.find((p) => p.name === 'Kruising 4')!;
  const unit: UnitData = { name: 'Team 3', kind: 'mobiel', mobility: 'fiets', postId: stamp.id, hasAed: true, members: [{ name: 'Fiets Fred', phone: '0687654321' }] };
  const res = await call('POST', '/api/admin/units', unit);
  assert.equal(res.statusCode, 200, res.body);
  const saved = (res.json() as AdminState).units.find((u) => u.name === 'Team 3')!;
  assert.equal(saved.mobility, 'fiets');
  assert.equal(saved.members[0]?.phone, '+31687654321');

  const me = (await app.inject({ url: '/api/session', method: 'POST', payload: { phone: '0687654321' } })).json();
  assert.equal(me.home, 'ehbo');
  assert.match(me.assignments[0].detail, /Mobiel, fiets · standplaats Kruising 4/);

  assert.equal((await call('POST', '/api/admin/units', { ...unit, kind: 'vast', postId: null })).statusCode, 400);
  const fixed = await call('PUT', `/api/admin/units/${saved.id}`, { ...unit, kind: 'vast', mobility: 'fiets' });
  assert.equal((fixed.json() as AdminState).units.find((u) => u.id === saved.id)?.mobility, null, 'vast heeft geen vervoer');
  assert.equal((await call('DELETE', `/api/admin/units/${saved.id}`)).statusCode, 200);
});

test('kernteam en noodnummers', async () => {
  const team = [
    { function: 'Evenementcoördinator', name: 'Cor Coördinator', phone: '0600000002', isCoordinator: true },
    { function: 'Wedstrijdleiding', name: 'Wil Wedstrijd', phone: '0611112222', isCoordinator: false },
    { function: 'EHBO-coördinator', name: '', phone: null, isCoordinator: false },
  ];
  const res = await call('PUT', '/api/admin/core-team', team);
  assert.equal(res.statusCode, 200, res.body);
  assert.equal((res.json() as AdminState).coreTeam[1]?.phone, '+31611112222');
  assert.equal(db.coordinatorPhone(), DEMO.coordinator);
  assert.equal((await call('PUT', '/api/admin/core-team', team.map((t) => ({ ...t, isCoordinator: true })))).statusCode, 400);

  const numbers = [{ label: 'SEH Heerenveen', number: '0513-685 685' }, { label: 'Huisartsenpost', number: '0900 1122' }];
  assert.deepEqual((await call('PUT', '/api/admin/emergency-numbers', numbers)).json().emergencyNumbers, numbers);
  assert.equal((await call('PUT', '/api/admin/emergency-numbers', [{ label: 'X', number: 'bel mij' }])).statusCode, 400);
});

test('beheerders: toevoegen, eigen nummer niet verwijderen', async () => {
  const added = await call('POST', '/api/admin/admins', { phone: '06 99 88 77 66', name: 'Tweede Beheerder' });
  assert.equal(added.statusCode, 200, added.body);
  assert.ok((added.json() as AdminState).admins.some((a) => a.phone === '+31699887766' && a.name === 'Tweede Beheerder'));
  assert.equal((await call('DELETE', `/api/admin/admins/${encodeURIComponent(DEMO.admin)}`)).statusCode, 400);
  assert.equal((await call('DELETE', `/api/admin/admins/${encodeURIComponent('+31699887766')}`)).statusCode, 200);
  assert.equal((await call('DELETE', `/api/admin/admins/${encodeURIComponent('+31699887766')}`)).statusCode, 404);
});

test('info & voorwaarden: eigen tekst met plaatshouders, terug naar de standaard', async () => {
  const info = {
    sections: [{ title: 'Over {evenement}', body: 'Vragen? {contact}. Bewaren volgens {beleid}.' }, { title: ' ', body: '' }],
    policy: 'het verwijderplan van Stichting Silvesterloop',
    contact: 'Bea, beheer@example.org',
  };
  const state = (await call('PUT', '/api/admin/info', info)).json() as AdminState;
  assert.equal(state.info.sections?.length, 1, 'lege onderdelen vallen weg');
  const event = (await app.inject({ url: '/api/event' })).json();
  assert.deepEqual(event.info, [{
    title: 'Over Silvesterloop 2026',
    body: 'Vragen? Bea, beheer@example.org. Bewaren volgens het verwijderplan van Stichting Silvesterloop.',
  }]);
  assert.equal((await call('PUT', '/api/admin/info', info, staffCookie)).statusCode, 403);

  const reset = (await call('PUT', '/api/admin/info', { sections: null, policy: null, contact: null })).json() as AdminState;
  assert.equal(reset.info.sections, null);
  assert.match((await app.inject({ url: '/api/event' })).json().info[0].title, /Waarvoor is deze app/);
});
