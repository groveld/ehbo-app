import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_STYLE, type AdminState, type EventPackage, type PeopleOverview, type PostData, type TeamData } from '@ehbo/shared';
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
  return `session=${res.cookies.find((c) => c.name === 'session')!.value}`;
}

const call = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: object | string, cookie = adminCookie, headers: Record<string, string> = {}) =>
  app.inject({ method, url, payload, headers: { cookie, ...headers } });

const version = () => (db.raw.prepare('SELECT version FROM event').get() as { version: number }).version;

const EVENT = {
  name: 'Silvesterloop 2026', startLocation: 'De Trilker', startDate: '2026-12-31', endDate: '2026-12-31', escalationSeconds: 30, atPostM: 30, style: DEFAULT_STYLE,
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
  assert.deepEqual(state.posts.map((p) => Math.round(p.km! * 10) / 10), [0, 0, 1.5, 2], 'gesorteerd op km-punt');
  assert.equal(state.teams[0]?.members[0]?.name, 'Eva EHBO');
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

test('how close counts as at a post: set by the admin, in the package, and used for a place', async () => {
  const res = await call('PUT', '/api/admin/event', { ...EVENT, atPostM: 120 });
  assert.equal((res.json() as AdminState).event.atPostM, 120);
  assert.equal((await call('PUT', '/api/admin/event', { ...EVENT, atPostM: 10 })).statusCode, 400, 'below the minimum');
  assert.equal((await call('PUT', '/api/admin/event', { ...EVENT, atPostM: 600 })).statusCode, 400, 'above the maximum');
  const pkg = (await app.inject({ url: '/api/package' })).json() as EventPackage;
  assert.equal(pkg.event.atPostM, 120, 'participants get it too, for the grey cross');
  await call('PUT', '/api/admin/event', EVENT);
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

test('a location with several functions: the main one from the marker order, and one lead', async () => {
  const state = (await call('GET', '/api/admin')).json() as AdminState;
  const type = (key: string) => state.postTypes.find((t) => t.key === key)!.id;
  const post: PostData = {
    functionIds: [type('water'), type('ehbo'), type('stempel')], runId: null, name: 'Brug', lat: 53.17, lng: 5.86, accuracyM: null, address: null,
    accessRoute: null, timeFrom: null, timeTo: null, contacts: [],
  };
  const saved = ((await call('POST', '/api/admin/posts', post)).json() as AdminState).posts.find((p) => p.name === 'Brug')!;
  assert.equal(saved.typeId, type('ehbo'), 'EHBO is above water and stamp');
  assert.deepEqual(saved.functionIds, [type('ehbo'), type('water'), type('stempel')], 'main function first');
  const pkg = (await app.inject({ url: '/api/package' })).json() as EventPackage;
  assert.deepEqual(pkg.posts.find((p) => p.id === saved.id)!.functionIds, saved.functionIds);

  assert.equal((await call('PUT', `/api/admin/posts/${saved.id}`, { ...post, functionIds: [] })).statusCode, 400, 'at least one function');
  const two = { ...post, contacts: [
    { name: 'Een', phone: '0611111101', role: 'lead', timeFrom: null, timeTo: null },
    { name: 'Twee', phone: '0611111102', role: 'lead', timeFrom: null, timeTo: null },
  ] };
  const refused = await call('PUT', `/api/admin/posts/${saved.id}`, two);
  assert.equal(refused.statusCode, 400);
  assert.match(refused.json().error, /Brug: kies één locatieverantwoordelijke/);
  assert.equal((await call('DELETE', `/api/admin/posts/${saved.id}`)).statusCode, 200);
});

test('post met contactpersonen; nieuw nummer kan daarna aanmelden', async () => {
  const state = (await call('GET', '/api/admin')).json() as AdminState;
  const water = state.postTypes.find((t) => t.key === 'water')!;
  const post: PostData = {
    functionIds: [water.id], runId: null, name: 'Waterpost 5', lat: 53.16, lng: 5.85, accuracyM: 4, address: null,
    accessRoute: 'Via de dijk', timeFrom: '11:00', timeTo: '14:00',
    contacts: [{ name: 'Nieuwe Vrijwilliger', phone: '06-1234 5678', role: 'lead', timeFrom: null, timeTo: null }],
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
  assert.equal((await call('POST', '/api/admin/posts', { ...post, functionIds: [999] })).statusCode, 400);
  assert.equal((await call('POST', '/api/admin/posts', { ...post, lng: null })).statusCode, 400);

  assert.equal((await call('DELETE', `/api/admin/posts/${saved.id}`)).statusCode, 200);
});

test('a post with incidents or requests stays: deleting it gives a clear error', async () => {
  const state = (await call('GET', '/api/admin')).json() as AdminState;
  const post = state.posts.find((p) => p.name === 'Kruising 4')!;
  db.raw.prepare(`INSERT INTO help_requests (client_id, type_id, post_id, status, reported_by, reported_at)
    VALUES ('history', (SELECT id FROM help_request_types WHERE key = 'water'), ?, 'closed', ?, '2026-12-31T10:00:00Z')`).run(post.id, DEMO.postLead);
  const res = await call('DELETE', `/api/admin/posts/${post.id}`);
  assert.equal(res.statusCode, 409, res.body);
  assert.match(res.json().error, /oproepen of aanvragen/);
  db.raw.prepare("DELETE FROM help_requests WHERE client_id = 'history'").run();
});

test('EHBO-eenheid: vast vraagt een post, mobiel niet', async () => {
  const state = (await call('GET', '/api/admin')).json() as AdminState;
  const stamp = state.posts.find((p) => p.name === 'Kruising 4')!;
  const team: TeamData = { name: 'Team 3', kind: 'mobile', mobility: 'bike', postId: stamp.id, hasAed: true, timeFrom: null, timeTo: null, members: [{ name: 'Fiets Fred', phone: '0687654321' }] };
  const res = await call('POST', '/api/admin/teams', team);
  assert.equal(res.statusCode, 200, res.body);
  const saved = (res.json() as AdminState).teams.find((u) => u.name === 'Team 3')!;
  assert.equal(saved.mobility, 'bike');
  assert.equal(saved.members[0]?.phone, '+31687654321');

  const me = (await app.inject({ url: '/api/session', method: 'POST', payload: { phone: '0687654321' } })).json();
  assert.equal(me.home, 'first_aid');
  assert.match(me.assignments[0].detail, /Mobiel \(fiets\) · Standplaats Kruising 4/);

  assert.equal((await call('POST', '/api/admin/teams', { ...team, kind: 'fixed', postId: null })).statusCode, 400);
  const fixed = await call('PUT', `/api/admin/teams/${saved.id}`, { ...team, kind: 'fixed', mobility: 'bike' });
  assert.equal((fixed.json() as AdminState).teams.find((u) => u.id === saved.id)?.mobility, null, 'vast heeft geen vervoer');
  assert.equal((await call('DELETE', `/api/admin/teams/${saved.id}`)).statusCode, 200);
});

test('kernteam en noodnummers', async () => {
  const entries = [
    { function: 'Evenementcoördinator', name: 'Cor Coördinator', phone: '0600000002', isCoordinator: true },
    { function: 'Wedstrijdleiding', name: 'Wil Wedstrijd', phone: '0611112222', isCoordinator: false },
    { function: 'EHBO-coördinator', name: '', phone: null, isCoordinator: false },
  ];
  const res = await call('PUT', '/api/admin/core-team', entries);
  assert.equal(res.statusCode, 200, res.body);
  assert.equal((res.json() as AdminState).coreTeam[1]?.phone, '+31611112222');
  assert.equal(db.coordinatorPhone(), DEMO.coordinator);
  assert.equal((await call('PUT', '/api/admin/core-team', entries.map((t) => ({ ...t, isCoordinator: true })))).statusCode, 400);

  const numbers = [{ label: 'SEH Heerenveen', number: '0513-685 685' }, { label: 'Huisartsenpost', number: '0900 1122' }];
  assert.deepEqual((await call('PUT', '/api/admin/emergency-numbers', numbers)).json().emergencyNumbers, [{ label: 'SEH Heerenveen', number: '+31513685685' }, { label: 'Huisartsenpost', number: '09001122' }]);
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

test('km points follow from the GPX and the position, and stay up to date', async () => {
  const state = (await call('GET', '/api/admin')).json() as AdminState;
  const water = state.posts.find((p) => p.name === 'Waterpost 3 · brug')!;
  const tenKm = state.runs.find((r) => r.name === '10 km')!;
  assert.equal(water.passages.length, 1);
  assert.equal(water.passages[0]!.runId, tenKm.id);
  assert.equal(water.km, water.passages[0]!.km[0]);
  const crossing = state.posts.find((p) => p.name === 'Kruising 4')!;
  assert.equal(crossing.passages[0]!.km.length, 2, 'out and back passes it twice');

  // Moved away from every route: no km points any more.
  const { id, ...data } = water;
  let res = await call('PUT', `/api/admin/posts/${id}`, { ...data, lat: 53.3, lng: 5.9 });
  assert.equal(res.statusCode, 200, res.body);
  let moved = (res.json() as AdminState).posts.find((p) => p.id === id)!;
  assert.deepEqual([moved.km, moved.passages], [null, []]);

  // And back: they return.
  res = await call('PUT', `/api/admin/posts/${id}`, data);
  moved = (res.json() as AdminState).posts.find((p) => p.id === id)!;
  assert.deepEqual(moved.passages, water.passages);
});

test('GPX for download: public, and only the route', async () => {
  const state = (await call('POST', '/api/admin/runs', { name: 'Tocht & Trail', distanceKm: 1, discipline: 'hardlopen', date: '2026-12-31', startTime: '10:00' })).json() as AdminState;
  const run = state.runs.at(-1)!;
  assert.equal((await app.inject({ url: `/gpx/${run.id}.gpx` })).statusCode, 404, 'no route yet');

  const gpx = '<gpx><metadata><author>Geheime Naam</author></metadata><trk><trkseg><trkpt lat="53.0" lon="5.8"><time>2026-01-01T10:00:00Z</time></trkpt><trkpt lat="53.009" lon="5.8"/></trkseg></trk></gpx>';
  await call('PUT', `/api/admin/runs/${run.id}/gpx?filename=a.gpx`, gpx, adminCookie, { 'content-type': 'application/gpx+xml' });

  const res = await app.inject({ url: `/gpx/${run.id}.gpx` });
  assert.equal(res.statusCode, 200, 'without logging in');
  assert.match(res.headers['content-disposition'] as string, /filename="tocht-trail\.gpx"/);
  assert.match(res.body, /<name>Tocht &#38; Trail<\/name>/);
  assert.match(res.body, /<trkpt lat="53.009" lon="5.8"\/>/);
  assert.doesNotMatch(res.body, /Geheime Naam|<time>/);
  assert.equal((await app.inject({ url: '/gpx/abc.gpx' })).statusCode, 404);
});

test('GPX for download: every post on the route as a waypoint, before the track, and nothing for staff only', async () => {
  const run = db.raw.prepare("SELECT id FROM runs WHERE name = '10 km'").get() as { id: number };
  db.raw.prepare("UPDATE posts SET access_route = 'Via het fietspad achter de boerderij' WHERE name = 'Kruising 4'").run();
  const body = (await app.inject({ url: `/gpx/${run.id}.gpx` })).body;
  const names = [...body.matchAll(/<wpt [^>]*><name>([^<]*)<\/name>/g)].map((m) => m[1]);
  assert.deepEqual(names, ['Start/finish De Trilker', 'EHBO-post 1 · start', 'Kruising 4', 'Waterpost 3 · brug'], 'in the order you meet them');
  assert.ok(body.indexOf('<wpt') < body.indexOf('<trk>'), 'waypoints first');
  assert.match(body, /<name>Waterpost 3 · brug<\/name><desc>Waterpost · km [\d,]+<\/desc><sym>Drinking Water<\/sym>/);
  assert.match(body, /<name>Kruising 4<\/name><desc>Verkeer · km [\d,]+ en [\d,]+<\/desc>/, 'passed twice');
  assert.match(body, /<sym>First Aid<\/sym>/);
  assert.doesNotMatch(body, /fietspad|\+316|Wim|Vera/);
});

test('Beheer › Mensen: everyone with where they are, what is missing, and the name to change', async () => {
  const res = await call('GET', '/api/admin/people');
  assert.equal(res.statusCode, 200);
  const overview = res.json() as PeopleOverview;
  const wim = overview.people.find((p) => p.phone === DEMO.postLead)!;
  assert.deepEqual(wim.links.map((l) => l.label), ['Waterpost 3 · brug · locatieverantwoordelijke', 'Kruising 4 · lid']);
  assert.ok(overview.people.find((p) => p.phone === DEMO.admin)!.links.some((l) => l.kind === 'admin'));
  assert.ok(overview.gaps.some((g) => g.label === 'Kruising 4: nog geen locatieverantwoordelijke'));
  assert.ok(!overview.gaps.some((g) => g.label.startsWith('EHBO-post 1')), 'run by its fixed team');
  const names = overview.people.map((p) => p.name).filter(Boolean);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, 'nl')), 'by name');

  // Two places at the same time.
  db.raw.prepare("UPDATE post_contacts SET time_from = '11:00', time_to = '12:00' WHERE phone = ?").run(DEMO.postLead);
  const twice = (await call('GET', '/api/admin/people')).json() as PeopleOverview;
  assert.match(twice.people.find((p) => p.phone === DEMO.postLead)!.problems.join(), /Overlappende tijden: Waterpost 3 · brug en Kruising 4/);
  db.raw.prepare('UPDATE post_contacts SET time_from = NULL, time_to = NULL WHERE phone = ?').run(DEMO.postLead);

  const renamed = (await call('PUT', `/api/admin/people/${encodeURIComponent(DEMO.postLead)}`, { name: 'Wim Waterman' })).json() as PeopleOverview;
  assert.equal(renamed.people.find((p) => p.phone === DEMO.postLead)!.name, 'Wim Waterman');
  assert.equal((await call('PUT', '/api/admin/people/0699999998', { name: 'X' })).statusCode, 404);
  await call('PUT', `/api/admin/people/${encodeURIComponent(DEMO.postLead)}`, { name: 'Wim Water' });

  const csv = await call('GET', '/api/admin/people.csv');
  assert.match(csv.headers['content-type'] as string, /text\/csv/);
  assert.match(csv.body, /Wim Water;\+31 6/);
});

test('unmanned functions: an AED has no people, never opens, and a turnaround belongs to one run', async () => {
  const state = (await call('GET', '/api/admin')).json() as AdminState;
  const type = (key: string) => state.postTypes.find((t) => t.key === key)!;
  assert.deepEqual(['aed', 'toilet', 'keerpunt'].map((k) => type(k).manned), [false, false, false]);
  assert.equal(type('stempel').name, 'Stempel-/controlepost', 'the checkpoint is the stamp post');

  const run = state.runs.find((r) => r.name === '10 km')!;
  const aed: PostData = {
    functionIds: [type('aed').id], runId: run.id, name: 'AED dorpshuis', lat: 53.145, lng: 5.82, accuracyM: null, address: null, accessRoute: null,
    timeFrom: '10:00', timeTo: '12:00', contacts: [{ name: 'Niemand', phone: '0611111199', role: 'lead', timeFrom: null, timeTo: null }],
  };
  const saved = ((await call('POST', '/api/admin/posts', aed)).json() as AdminState).posts.find((p) => p.name === 'AED dorpshuis')!;
  assert.deepEqual([saved.contacts.length, saved.timeFrom, saved.runId], [0, null, null], 'no people, no times, and only a turnaround has a run');

  const turn = ((await call('POST', '/api/admin/posts', { ...aed, functionIds: [type('keerpunt').id], name: 'Keerpunt 10 km' })).json() as AdminState)
    .posts.find((p) => p.name === 'Keerpunt 10 km')!;
  assert.equal(turn.runId, run.id);
  assert.equal((await call('POST', '/api/admin/posts', { ...aed, runId: 9999 })).statusCode, 400);

  const opened = await app.inject({ method: 'PUT', url: `/api/posts/${saved.id}/open`, payload: { open: true }, headers: { cookie: adminCookie } });
  assert.equal(opened.statusCode, 409, 'nobody there, so it never opens');
  for (const id of [saved.id, turn.id]) await call('DELETE', `/api/admin/posts/${id}`);
});
