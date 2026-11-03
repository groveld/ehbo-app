// Import and export via a spreadsheet (#43): a round trip changes nothing, problems by row, all or nothing, and our own .xlsx and zip.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AdminState, ImportPreview } from '@ehbo/shared';
import { buildApp } from '../src/app.ts';
import { DEMO, seedDemo } from '../src/demo.ts';
import { openEventDb, type EventDb } from '../src/event-db.ts';
import { parseCsv } from '../src/spreadsheet.ts';
import { generateVapidKeys } from '../src/webpush.ts';
import { readXlsx, writeXlsx } from '../src/xlsx.ts';
import { readZip, writeZip } from '../src/zip.ts';

let app: ReturnType<typeof buildApp>;
let db: EventDb;
let dir: string;
let cookie: string;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ehbo-sheet-'));
  db = openEventDb(dir, 'test', { name: 'Test' });
  seedDemo(db);
  app = buildApp({ db, vapid: { ...generateVapidKeys(), subject: 'mailto:test@example.org' }, build: { version: 'test', commit: 'x', builtAt: '' } });
  await app.ready();
  const res = await app.inject({ url: '/api/session', method: 'POST', payload: { phone: DEMO.admin } });
  cookie = `ehbo_sessie=${res.cookies.find((c) => c.name === 'ehbo_sessie')!.value}`;
});

afterEach(async () => {
  await app.close();
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const get = (url: string) => app.inject({ url, headers: { cookie } });
const send = (url: string, files: { name: string; data: Buffer | string }[], removeMissing = false) => app.inject({
  method: 'POST', url, headers: { cookie },
  payload: { files: files.map((f) => ({ name: f.name, data: Buffer.from(f.data).toString('base64') })), removeMissing },
});
const check = async (files: { name: string; data: Buffer | string }[], removeMissing = false) => (await send('/api/admin/import/check', files, removeMissing)).json() as ImportPreview;
const state = async () => (await get('/api/admin')).json() as AdminState;
const version = () => (db.raw.prepare('SELECT version FROM event').get() as { version: number }).version;
const exported = async () => (await get('/api/admin/export.xlsx')).rawPayload;

/** The export, with rows added to or changed on a sheet: as someone would do in Excel. */
function edited(file: Buffer, changes: Record<string, (rows: string[][]) => void>) {
  const sheets = readXlsx(file);
  return writeXlsx([...sheets].filter(([name]) => name !== 'Lijsten').map(([name, rows]) => {
    changes[name]?.(rows);
    return { name, note: rows[0]?.[0] ?? '', columns: (rows[1] ?? []).map((header) => ({ header })), rows: rows.slice(2) };
  }));
}

test('zip and xlsx: what is written reads back, also shared strings and a time as Excel writes them', () => {
  const zip = writeZip([{ name: 'a.txt', data: Buffer.from('hallo') }, { name: 'map/b.txt', data: Buffer.alloc(10_000, 'x') }]);
  assert.deepEqual([...readZip(zip)].map(([n, d]) => [n, d.length]), [['a.txt', 5], ['map/b.txt', 10_000]]);
  assert.throws(() => readZip(Buffer.from('geen zip')), /geen Excel-bestand/);

  // Excel keeps text in sharedStrings.xml and refers to it by number; a time is a fraction of a day.
  const sheet = '<worksheet><sheetData><row r="2"><c r="A2" t="s"><v>0</v></c><c r="C2"><v>0.4583333333</v></c><c r="D2" t="b"><v>1</v></c></row></sheetData></worksheet>';
  const file = writeZip([
    { name: 'xl/workbook.xml', data: Buffer.from('<workbook><sheets><sheet name="Locaties" sheetId="1" r:id="rId1"/></sheets></workbook>') },
    { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>') },
    { name: 'xl/sharedStrings.xml', data: Buffer.from('<sst><si><r><t>Water</t></r><r><t xml:space="preserve">post &amp; brug</t></r></si></sst>') },
    { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(sheet) },
  ]);
  assert.deepEqual(readXlsx(file).get('Locaties')?.[1], ['Waterpost & brug', '', '0.4583333333', 'ja']);
  assert.deepEqual(parseCsv('﻿Naam;Nummer\r\n"Huisartsenpost; nacht";0900 1234\r\n'), [['Naam', 'Nummer'], ['Huisartsenpost; nacht', '0900 1234']]);
});

test('export and import again changes nothing, and checking does not touch the event', async () => {
  const before = version();
  const preview = await check([{ name: 'evenement.xlsx', data: await exported() }]);
  assert.deepEqual(preview.problems, []);
  assert.deepEqual(preview.sheets.map((s) => s.sheet), ['Locaties', 'Contactpersonen', 'EHBO-eenheden', 'EHBO-leden', 'Kernteam', 'Noodnummers']);
  for (const s of preview.sheets) assert.deepEqual([s.sheet, s.added, s.changed, s.removed], [s.sheet, 0, 0, 0]);
  assert.equal(version(), before, 'checking changes nothing');
});

test('a new location with people, and a changed one, saved in one go', async () => {
  const file = edited(await exported(), {
    Locaties: (rows) => {
      rows.push(['Waterpost 7 · molen', 'Waterpost', 'Toiletten', '', '', '53.155', '5.84', 'Bij de molen', '', '0.4375', '13:00', '']);
      rows.find((r) => r[0] === 'Kruising 4')![8] = 'Fietspad achter de boerderij';
    },
    Contactpersonen: (rows) => { rows.push(['Waterpost 7 · molen', 'Mia Molen', '612345678', 'verantwoordelijke', '', '']); },
  });
  const preview = await check([{ name: 'evenement.xlsx', data: file }]);
  assert.deepEqual(preview.problems, []);
  const locations = preview.sheets.find((s) => s.sheet === 'Locaties')!;
  assert.deepEqual([locations.added, locations.changed], [1, 1]);

  const res = await send('/api/admin/import', [{ name: 'evenement.xlsx', data: file }]);
  assert.equal(res.statusCode, 200, res.body);
  const after = (await state()).posts;
  const mill = after.find((p) => p.name === 'Waterpost 7 · molen')!;
  assert.deepEqual([mill.timeFrom, mill.timeTo, mill.functionIds.length], ['10:30', '13:00', 2], 'a time as Excel writes it');
  assert.deepEqual(mill.contacts.map((c) => [c.name, c.phone, c.role]), [['Mia Molen', '+31612345678', 'verantwoordelijke']], 'the 0 Excel dropped comes back');
  assert.equal(after.find((p) => p.name === 'Kruising 4')!.accessRoute, 'Fietspad achter de boerderij');
});

test('problems by row, and then nothing is saved at all', async () => {
  const file = edited(await exported(), {
    Locaties: (rows) => { rows.push(['Nieuwe post', 'Zwembad', '', '', '', '53', '', '', '', '25:00', '', '']); },
    Contactpersonen: (rows) => {
      rows.push(['Waterpost 3 · brug', 'Tweede Baas', '0612345679', 'verantwoordelijke', '', '']);
      rows.push(['Bestaat niet', 'Iemand', '0612345670', 'lid', '', '']);
      rows.push(['Kruising 4', 'Fout Nummer', '12345', 'lid', '', '']);
    },
  });
  const preview = await check([{ name: 'evenement.xlsx', data: file }]);
  const messages = preview.problems.map((p) => `${p.sheet} ${p.row}: ${p.message}`);
  for (const expected of [/Locaties \d+: Onbekende functie: Zwembad/, /Locaties \d+: Vul een geldige breedte/, /Locaties \d+: Tijden als uu:mm/,
    /Contactpersonen \d+: Waterpost 3 · brug: kies één locatieverantwoordelijke/, /Contactpersonen \d+: Locatie Bestaat niet bestaat niet/, /Contactpersonen \d+: Ongeldig telefoonnummer bij Fout Nummer/]) {
    assert.ok(messages.some((m) => expected.test(m)), `${expected} in ${messages.join(' | ')}`);
  }
  const before = await state();
  const res = await send('/api/admin/import', [{ name: 'evenement.xlsx', data: file }]);
  assert.equal(res.statusCode, 400);
  assert.deepEqual((await state()).posts, before.posts, 'all or nothing');
});

test('one CSV changes only its own sheet; removing what is missing is a choice', async () => {
  const csv = (await get('/api/admin/export/noodnummers.csv')).body;
  assert.match(csv, /^﻿Omschrijving;Nummer/);
  const preview = await check([{ name: 'noodnummers.csv', data: 'Omschrijving;Nummer\r\nHuisartsenpost;0900 1234567\r\n' }]);
  assert.deepEqual(preview.problems, []);
  assert.deepEqual(preview.sheets.map((s) => s.sheet), ['Noodnummers']);
  assert.equal((await send('/api/admin/import', [{ name: 'noodnummers.csv', data: 'Omschrijving;Nummer\r\nHuisartsenpost;0900 1234567\r\n' }])).statusCode, 200);
  assert.ok((await state()).emergencyNumbers.some((n) => n.label === 'Huisartsenpost'));
  assert.equal((await state()).posts.length, 4, 'the locations stay');

  // Only the water post in the file, and remove the rest: the others go, but not one with history.
  const locations = 'Naam;Functie 1\r\nWaterpost 3 · brug;Waterpost\r\n';
  const removing = await check([{ name: 'locaties.csv', data: locations }], true);
  assert.equal(removing.sheets[0]!.removed, 3);
  db.raw.prepare("INSERT INTO requests (client_id, post_id, kind, status, reported_by, created_at) VALUES ('h', (SELECT id FROM posts WHERE name = 'Kruising 4'), 'water', 'afgehandeld', ?, '2026-12-31T10:00:00Z')").run(DEMO.postLead);
  const blocked = await check([{ name: 'locaties.csv', data: locations }], true);
  assert.ok(blocked.problems.some((p) => /Kruising 4 heeft oproepen of aanvragen/.test(p.message)));
});
