// Import and export via a spreadsheet (#43): one .xlsx that is both the export and the template, or one CSV per sheet.
// Importing first checks everything and shows what would change; only then it saves, in one transaction: all or nothing.
// Things are matched on name. What isn't in the file stays, unless "remove what's missing" is ticked.
import {
  POST_CONTACT_ROLE_LABEL,
  TIME_PATTERN,
  formatPhone,
  isManned,
  normalizeEmergencyNumber,
  normalizePhone,
  type AdminState,
  type ContactData,
  type CoreTeamEntry,
  type EmergencyNumber,
  type ImportPreview,
  type ImportProblem,
  type ImportSheetSummary,
  type PostContactRole,
  type PostData,
  type UnitData,
  type UnitMobility,
} from '@ehbo/shared';
import type { AdminDb } from './admin-db.ts';
import { readXlsx, writeXlsx, type SheetColumn, type SheetSpec } from './xlsx.ts';

export const SHEET_KEYS = ['locaties', 'contactpersonen', 'eenheden', 'leden', 'kernteam', 'noodnummers'] as const;
export type SheetKey = (typeof SHEET_KEYS)[number];

const FUNCTIONS = 4;
const ROLES: PostContactRole[] = ['verantwoordelijke', 'lid', 'reserve'];
const MOBILITY: Record<string, UnitMobility> = { 'te voet': 'te_voet', fiets: 'fiets', auto: 'auto', anders: 'anders' };
const MOBILITY_TEXT = Object.fromEntries(Object.entries(MOBILITY).map(([text, value]) => [value, text])) as Record<UnitMobility, string>;
const YES_NO = ['ja', 'nee'];

interface Column extends SheetColumn { key: string; required?: boolean }
interface Sheet { key: SheetKey; name: string; note: string; columns: Column[] }

/** The sheets, in the order of the file. The lists for dropdowns depend on the event. */
function sheets(state: AdminState): Sheet[] {
  const functions = state.postTypes.map((t) => t.name);
  const posts = state.posts.map((p) => p.name);
  const runs = state.runs.map((r) => r.name);
  const units = state.units.map((u) => u.name);
  return [
    {
      key: 'locaties', name: 'Locaties',
      note: 'Eén regel per locatie. Functie 1 is verplicht; kies er meer als er meer op die plek is. De km-punten volgen vanzelf uit de GPX.',
      columns: [
        { key: 'name', header: 'Naam', width: 28, required: true },
        ...Array.from({ length: FUNCTIONS }, (_, i): Column => ({ key: `function${i + 1}`, header: `Functie ${i + 1}`, width: 20, list: functions, required: i === 0 })),
        { key: 'lat', header: 'Breedtegraad', width: 13 },
        { key: 'lng', header: 'Lengtegraad', width: 13 },
        { key: 'address', header: 'Herkenbare plek of adres', width: 28 },
        { key: 'accessRoute', header: 'Aanrijroute', width: 32 },
        { key: 'timeFrom', header: 'Bemand vanaf', width: 13, text: true },
        { key: 'timeTo', header: 'Tot', width: 9, text: true },
        { key: 'run', header: 'Keerpunt van (loop)', width: 18, list: runs },
      ],
    },
    {
      key: 'contactpersonen', name: 'Contactpersonen',
      note: 'Wie op welke locatie staat. Per locatie hooguit één verantwoordelijke. Een locatie die hier staat, krijgt precies deze mensen.',
      columns: [
        { key: 'post', header: 'Locatie', width: 28, list: posts, required: true },
        { key: 'name', header: 'Naam', width: 24 },
        { key: 'phone', header: 'Telefoon', width: 16, text: true, required: true },
        { key: 'role', header: 'Rol', width: 18, list: ROLES },
        { key: 'timeFrom', header: 'Vanaf', width: 9, text: true },
        { key: 'timeTo', header: 'Tot', width: 9, text: true },
      ],
    },
    {
      key: 'eenheden', name: 'EHBO-eenheden',
      note: 'Vast: de EHBO-post waar de eenheid staat. Mobiel: het vervoer, en eventueel een standplaats.',
      columns: [
        { key: 'name', header: 'Naam', width: 20, required: true },
        { key: 'kind', header: 'Soort', width: 10, list: ['vast', 'mobiel'], required: true },
        { key: 'mobility', header: 'Vervoer', width: 12, list: Object.keys(MOBILITY) },
        { key: 'post', header: 'Locatie of standplaats', width: 28, list: posts },
        { key: 'aed', header: 'AED', width: 7, list: YES_NO },
        { key: 'timeFrom', header: 'Dienst vanaf', width: 13, text: true },
        { key: 'timeTo', header: 'Tot', width: 9, text: true },
      ],
    },
    {
      key: 'leden', name: 'EHBO-leden',
      note: 'Wie in welke eenheid zit. Een eenheid die hier staat, krijgt precies deze mensen.',
      columns: [
        { key: 'unit', header: 'Eenheid', width: 20, list: units, required: true },
        { key: 'name', header: 'Naam', width: 24 },
        { key: 'phone', header: 'Telefoon', width: 16, text: true, required: true },
      ],
    },
    {
      key: 'kernteam', name: 'Kernteam',
      note: 'Functies zonder vaste locatie. Hooguit één evenementcoördinator.',
      columns: [
        { key: 'function', header: 'Functie', width: 30, required: true },
        { key: 'name', header: 'Naam', width: 24 },
        { key: 'phone', header: 'Telefoon', width: 16, text: true },
        { key: 'coordinator', header: 'Evenementcoördinator', width: 20, list: YES_NO },
      ],
    },
    {
      key: 'noodnummers', name: 'Noodnummers',
      note: '112 staat er altijd; zet hier de andere nummers, zoals de huisartsenpost.',
      columns: [
        { key: 'label', header: 'Omschrijving', width: 28, required: true },
        { key: 'number', header: 'Nummer', width: 16, text: true, required: true },
      ],
    },
  ];
}

// ---- Export ----

const phoneText = (phone: string | null) => (phone ? formatPhone(phone) : null);

function exportRows(state: AdminState): Record<SheetKey, (string | number | null)[][]> {
  const typeName = (id: number) => state.postTypes.find((t) => t.id === id)?.name ?? null;
  const postName = (id: number | null) => (id === null ? null : state.posts.find((p) => p.id === id)?.name ?? null);
  return {
    locaties: state.posts.map((p) => [p.name, ...Array.from({ length: FUNCTIONS }, (_, i) => (p.functionIds[i] !== undefined ? typeName(p.functionIds[i]!) : null)),
      p.lat, p.lng, p.address, p.accessRoute, p.timeFrom, p.timeTo, p.runId === null ? null : state.runs.find((r) => r.id === p.runId)?.name ?? null]),
    contactpersonen: state.posts.flatMap((p) => p.contacts.map((c) => [p.name, c.name, phoneText(c.phone), c.role, c.timeFrom, c.timeTo])),
    eenheden: state.units.map((u) => [u.name, u.kind, u.mobility ? MOBILITY_TEXT[u.mobility] : null, postName(u.postId), u.hasAed ? 'ja' : 'nee', u.timeFrom, u.timeTo]),
    leden: state.units.flatMap((u) => u.members.map((m) => [u.name, m.name, phoneText(m.phone)])),
    kernteam: state.coreTeam.map((c) => [c.function, c.name, phoneText(c.phone), c.isCoordinator ? 'ja' : 'nee']),
    noodnummers: state.emergencyNumbers.map((n) => [n.label, n.number]),
  };
}

export function exportXlsx(state: AdminState): Buffer {
  const rows = exportRows(state);
  return writeXlsx(sheets(state).map((s): SheetSpec => ({ name: s.name, note: s.note, columns: s.columns, rows: rows[s.key] })));
}

/** One sheet as CSV, the way Dutch Excel reads it: semicolons and a BOM. Only the header, no note. */
export function exportCsv(state: AdminState, key: SheetKey): string {
  const sheet = sheets(state).find((s) => s.key === key)!;
  const cell = (value: string | number | null) => {
    const text = value === null ? '' : String(value);
    return /[;"\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  const lines = [sheet.columns.map((c) => c.header), ...exportRows(state)[key]];
  return `﻿${lines.map((line) => line.map(cell).join(';')).join('\r\n')}\r\n`;
}

export const sheetFileName = (state: AdminState, key: SheetKey) => sheets(state).find((s) => s.key === key)!.name.toLowerCase();

// ---- Reading a file ----

export interface ImportFile { name: string; data: Buffer }

/** Rows of one sheet, by column key, with the row number in the file for error messages. */
type Rows = { row: number; values: Record<string, string> }[];

export function parseCsv(text: string): string[][] {
  const body = text.replace(/^﻿/, '');
  const first = body.split(/\r?\n/, 1)[0] ?? '';
  // Dutch Excel writes semicolons, others commas or tabs: the one that occurs most in the header.
  const delimiter = [';', ',', '\t'].reduce((best, d) => (first.split(d).length > first.split(best).length ? d : best), ';');
  const rows: string[][] = [];
  let row: string[] = [];
  let value = '';
  let quoted = false;
  for (let i = 0; i < body.length; i++) {
    const c = body[i]!;
    if (quoted) {
      if (c === '"' && body[i + 1] === '"') { value += '"'; i++; }
      else if (c === '"') quoted = false;
      else value += c;
    } else if (c === '"' && value === '') quoted = true;
    else if (c === delimiter) { row.push(value); value = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && body[i + 1] === '\n') i++;
      row.push(value);
      rows.push(row);
      row = [];
      value = '';
    } else value += c;
  }
  if (value !== '' || row.length) rows.push([...row, value]);
  return rows;
}

const norm = (text: string) => text.trim().toLowerCase().replace(/\s+/g, ' ');

/** A sheet is recognised by its header row, wherever it is in the first rows: an .xlsx has a note above it, a CSV doesn't. */
function toRows(sheet: Sheet, cells: string[][]): Rows | null {
  const headerAt = cells.slice(0, 5).findIndex((row) => norm(row?.[0] ?? '') === norm(sheet.columns[0]!.header) && (row ?? []).filter(Boolean).length >= Math.min(2, sheet.columns.length));
  if (headerAt < 0) return null;
  const header = (cells[headerAt] ?? []).map(norm);
  const index = new Map(sheet.columns.map((c) => [c.key, header.indexOf(norm(c.header))]));
  return cells.slice(headerAt + 1).flatMap((row, i) => {
    const values = Object.fromEntries(sheet.columns.map((c) => [c.key, (index.get(c.key)! >= 0 ? row?.[index.get(c.key)!] ?? '' : '').trim()]));
    return Object.values(values).some(Boolean) ? [{ row: headerAt + i + 2, values }] : [];
  });
}

function readFiles(state: AdminState, files: ImportFile[], problems: ImportProblem[]) {
  const found = new Map<SheetKey, Rows>();
  const all = sheets(state);
  for (const file of files) {
    let tables: [string, string[][]][];
    try {
      tables = /\.csv$/i.test(file.name) ? [[file.name, parseCsv(file.data.toString('utf8'))]] : [...readXlsx(file.data)];
    } catch (err) {
      problems.push({ sheet: file.name, row: null, message: (err as Error).message });
      continue;
    }
    let any = false;
    for (const [tableName, cells] of tables) {
      // A tab by its name, otherwise (a CSV) by its header.
      const byName = all.find((s) => norm(s.name) === norm(tableName));
      for (const sheet of byName ? [byName] : all) {
        const rows = toRows(sheet, cells);
        if (!rows) continue;
        found.set(sheet.key, rows);
        any = true;
        break;
      }
    }
    if (!any) problems.push({ sheet: file.name, row: null, message: 'Geen bekend tabblad gevonden. Begin met de export, dan kloppen de kolommen.' });
  }
  return found;
}

// ---- Checking and planning ----

/** "9:00", "09:00", "11:00:00" or Excel's fraction of a day, as "09:00". */
function timeOf(value: string): string | null | undefined {
  if (!value) return null;
  const fraction = /^0?\.\d+$|^0$/.test(value) ? Number(value) : NaN;
  if (!Number.isNaN(fraction)) {
    const minutes = Math.round(fraction * 24 * 60);
    return `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  }
  const m = /^(\d{1,2})[:.](\d{2})(?::\d{2})?$/.exec(value);
  const time = m ? `${m[1]!.padStart(2, '0')}:${m[2]}` : '';
  return new RegExp(TIME_PATTERN).test(time) ? time : undefined;
}

/** Excel drops the 0 of 0612345678 when a number was typed in a cell that wasn't text. */
const phoneOf = (value: string) => normalizePhone(/^6\d{8}$/.test(value) ? `0${value}` : value);
const numberOf = (value: string) => (value ? Number(value.replace(',', '.')) : null);
const yes = (value: string) => ['ja', 'j', 'yes', 'y', '1', 'true', 'waar', 'x'].includes(norm(value));
const sameKey = (a: string, b: string) => norm(a) === norm(b);

export interface ImportPlan {
  preview: ImportPreview;
  /** Saves it all in one transaction; only when there are no problems. */
  apply: () => void;
}

export function planImport(admin: AdminDb, files: ImportFile[], removeMissing: boolean): ImportPlan {
  const state = admin.getState();
  const problems: ImportProblem[] = [];
  const found = readFiles(state, files, problems);
  const sheetName = (key: SheetKey) => sheets(state).find((s) => s.key === key)!.name;
  const problem = (key: SheetKey, row: number | null, message: string) => problems.push({ sheet: sheetName(key), row, message });
  const summaries: ImportSheetSummary[] = [];
  const summary = (key: SheetKey) => {
    const s = { sheet: sheetName(key), added: 0, changed: 0, unchanged: 0, removed: 0 };
    summaries.push(s);
    return s;
  };
  const required = (key: SheetKey, rows: Rows) => {
    const columns = sheets(state).find((s) => s.key === key)!.columns.filter((c) => c.required);
    return rows.filter(({ row, values }) => {
      const missing = columns.filter((c) => !values[c.key]);
      for (const c of missing) problem(key, row, `${c.header} ontbreekt`);
      return missing.length === 0;
    });
  };

  // Locations: from the file, keyed by name, with the existing one when there is one.
  type PostPlan = { name: string; existing: AdminState['posts'][number] | undefined; data: Omit<PostData, 'contacts'> | null; contacts: ContactData[] | null };
  const postPlans = new Map<string, PostPlan>();
  const postKey = (name: string) => norm(name);
  for (const p of state.posts) postPlans.set(postKey(p.name), { name: p.name, existing: p, data: null, contacts: null });

  const locations = found.get('locaties');
  if (locations) {
    for (const { row, values } of required('locaties', locations)) {
      const key = postKey(values.name!);
      const plan = postPlans.get(key) ?? { name: values.name!, existing: undefined, data: null, contacts: null };
      if (plan.data) {
        problem('locaties', row, `${values.name} staat er twee keer in`);
        continue;
      }
      const functionIds: number[] = [];
      for (let i = 1; i <= FUNCTIONS; i++) {
        const name = values[`function${i}`];
        if (!name) continue;
        const type = state.postTypes.find((t) => sameKey(t.name, name));
        if (!type) problem('locaties', row, `Onbekende functie: ${name}`);
        else if (!functionIds.includes(type.id)) functionIds.push(type.id);
      }
      const [lat, lng] = [numberOf(values.lat!), numberOf(values.lng!)];
      if ((lat === null) !== (lng === null) || (lat !== null && !(Math.abs(lat) <= 90 && Math.abs(lng!) <= 180))) problem('locaties', row, 'Vul een geldige breedte- én lengtegraad in, of geen van beide');
      const [timeFrom, timeTo] = [timeOf(values.timeFrom!), timeOf(values.timeTo!)];
      if (timeFrom === undefined || timeTo === undefined) problem('locaties', row, 'Tijden als uu:mm, bijvoorbeeld 09:30');
      const run = values.run ? state.runs.find((r) => sameKey(r.name, values.run!)) : undefined;
      if (values.run && !run) problem('locaties', row, `Onbekende loop: ${values.run}`);
      plan.data = {
        functionIds, runId: run?.id ?? null, name: values.name!.trim(), lat, lng, accuracyM: plan.existing && plan.existing.lat === lat && plan.existing.lng === lng ? plan.existing.accuracyM : null,
        address: values.address || null, accessRoute: values.accessRoute || null, timeFrom: timeFrom ?? null, timeTo: timeTo ?? null,
      };
      postPlans.set(key, plan);
    }
  }

  const contacts = found.get('contactpersonen');
  const contactSummary = contacts ? summary('contactpersonen') : null;
  if (contacts) {
    const byPost = new Map<string, ContactData[]>();
    for (const { row, values } of required('contactpersonen', contacts)) {
      const plan = postPlans.get(postKey(values.post!));
      if (!plan || (!plan.existing && !plan.data)) {
        problem('contactpersonen', row, `Locatie ${values.post} bestaat niet`);
        continue;
      }
      const phone = phoneOf(values.phone!);
      if (!phone) problem('contactpersonen', row, `Ongeldig telefoonnummer bij ${values.name || 'deze persoon'}: ${values.phone}`);
      const roleText = norm(values.role || 'lid');
      const role = ROLES.find((r) => r === roleText || norm(POST_CONTACT_ROLE_LABEL[r]) === roleText);
      if (!role) problem('contactpersonen', row, `Onbekende rol: ${values.role}. Kies verantwoordelijke, lid of reserve`);
      const [timeFrom, timeTo] = [timeOf(values.timeFrom!), timeOf(values.timeTo!)];
      if (timeFrom === undefined || timeTo === undefined) problem('contactpersonen', row, 'Tijden als uu:mm, bijvoorbeeld 09:30');
      if (!phone || !role) continue;
      const list = byPost.get(postKey(values.post!)) ?? [];
      if (role === 'verantwoordelijke' && list.some((c) => c.role === 'verantwoordelijke')) problem('contactpersonen', row, `${plan.name}: kies één locatieverantwoordelijke`);
      list.push({ name: values.name ?? '', phone, role, timeFrom: timeFrom ?? null, timeTo: timeTo ?? null });
      byPost.set(postKey(values.post!), list);
    }
    // Every location in the file gets exactly the people in this sheet; the others keep theirs.
    for (const [key, plan] of postPlans) {
      if (byPost.has(key) || plan.data) {
        plan.contacts = byPost.get(key) ?? [];
        const before = new Map((plan.existing?.contacts ?? []).map((c) => [c.phone, c]));
        for (const c of plan.contacts) {
          const old = before.get(c.phone);
          if (!old) contactSummary!.added++;
          else if (old.role !== c.role || old.timeFrom !== c.timeFrom || old.timeTo !== c.timeTo || (c.name && old.name !== c.name)) contactSummary!.changed++;
          else contactSummary!.unchanged++;
          before.delete(c.phone);
        }
        contactSummary!.removed += before.size;
      }
    }
  }

  const postSummary = locations ? summary('locaties') : null;
  const toRemove = { posts: [] as number[], units: [] as number[] };
  if (locations) {
    for (const plan of postPlans.values()) {
      if (plan.data) {
        if (!plan.existing) postSummary!.added++;
        else {
          const e = plan.existing;
          const same = [...e.functionIds].sort().join() === [...plan.data.functionIds].sort().join() && e.runId === plan.data.runId && e.lat === plan.data.lat && e.lng === plan.data.lng
            && e.address === plan.data.address && e.accessRoute === plan.data.accessRoute && e.timeFrom === plan.data.timeFrom && e.timeTo === plan.data.timeTo;
          if (same) postSummary!.unchanged++;
          else postSummary!.changed++;
        }
      } else if (removeMissing && plan.existing) {
        if (admin.postHasHistory(plan.existing.id)) problem('locaties', null, `${plan.existing.name} heeft oproepen of aanvragen en kan niet weg`);
        toRemove.posts.push(plan.existing.id);
        postSummary!.removed++;
      }
    }
  }
  /** Is there (still) a location by this name, and does it have an EHBO function? */
  const postAfter = (name: string) => {
    const plan = postPlans.get(postKey(name));
    if (!plan || (plan.existing && toRemove.posts.includes(plan.existing.id) && !plan.data)) return null;
    const functionIds = plan.data?.functionIds ?? plan.existing?.functionIds ?? [];
    return { ehbo: functionIds.some((id) => state.postTypes.find((t) => t.id === id)?.key === 'ehbo') };
  };

  // Teams, the same way.
  type UnitPlan = { name: string; existing: AdminState['units'][number] | undefined; data: Omit<UnitData, 'members' | 'postId'> & { post: string | null } | null; members: UnitData['members'] | null };
  const unitPlans = new Map<string, UnitPlan>();
  for (const u of state.units) unitPlans.set(norm(u.name), { name: u.name, existing: u, data: null, members: null });
  const teams = found.get('eenheden');
  if (teams) {
    for (const { row, values } of required('eenheden', teams)) {
      const key = norm(values.name!);
      const plan = unitPlans.get(key) ?? { name: values.name!, existing: undefined, data: null, members: null };
      if (plan.data) {
        problem('eenheden', row, `${values.name} staat er twee keer in`);
        continue;
      }
      const kind = norm(values.kind!) === 'vast' ? 'vast' : norm(values.kind!) === 'mobiel' ? 'mobiel' : null;
      if (!kind) problem('eenheden', row, `Soort is vast of mobiel, niet ${values.kind}`);
      const mobility = values.mobility ? MOBILITY[norm(values.mobility)] : undefined;
      if (values.mobility && !mobility) problem('eenheden', row, `Onbekend vervoer: ${values.mobility}`);
      const post = values.post ? postAfter(values.post) : null;
      if (values.post && !post) problem('eenheden', row, `Locatie ${values.post} bestaat niet`);
      if (kind === 'vast' && !values.post) problem('eenheden', row, 'Kies de EHBO-post van deze vaste eenheid');
      if (kind === 'vast' && post && !post.ehbo) problem('eenheden', row, `${values.post} heeft geen EHBO-functie`);
      const [timeFrom, timeTo] = [timeOf(values.timeFrom!), timeOf(values.timeTo!)];
      if (timeFrom === undefined || timeTo === undefined) problem('eenheden', row, 'Tijden als uu:mm, bijvoorbeeld 09:30');
      plan.data = {
        name: values.name!.trim(), kind: kind ?? 'mobiel', mobility: kind === 'mobiel' ? mobility ?? 'anders' : null, post: values.post || null,
        hasAed: yes(values.aed ?? ''), timeFrom: timeFrom ?? null, timeTo: timeTo ?? null,
      };
      unitPlans.set(key, plan);
    }
  }
  const members = found.get('leden');
  const memberSummary = members ? summary('leden') : null;
  if (members) {
    const byUnit = new Map<string, UnitData['members']>();
    for (const { row, values } of required('leden', members)) {
      const plan = unitPlans.get(norm(values.unit!));
      if (!plan || (!plan.existing && !plan.data)) {
        problem('leden', row, `Eenheid ${values.unit} bestaat niet`);
        continue;
      }
      const phone = phoneOf(values.phone!);
      if (!phone) {
        problem('leden', row, `Ongeldig telefoonnummer bij ${values.name || 'deze persoon'}: ${values.phone}`);
        continue;
      }
      byUnit.set(norm(values.unit!), [...(byUnit.get(norm(values.unit!)) ?? []), { name: values.name ?? '', phone }]);
    }
    for (const [key, plan] of unitPlans) {
      if (byUnit.has(key) || plan.data) {
        plan.members = byUnit.get(key) ?? [];
        const before = new Map((plan.existing?.members ?? []).map((m) => [m.phone, m]));
        for (const m of plan.members) {
          const old = before.get(m.phone);
          if (!old) memberSummary!.added++;
          else if (m.name && old.name !== m.name) memberSummary!.changed++;
          else memberSummary!.unchanged++;
          before.delete(m.phone);
        }
        memberSummary!.removed += before.size;
      }
    }
  }
  const unitSummary = teams ? summary('eenheden') : null;
  if (teams) {
    for (const plan of unitPlans.values()) {
      if (plan.data) {
        const e = plan.existing;
        const postName = e?.postId != null ? state.posts.find((p) => p.id === e.postId)?.name ?? null : null;
        if (!e) unitSummary!.added++;
        else if (e.kind === plan.data.kind && e.mobility === plan.data.mobility && e.hasAed === plan.data.hasAed && e.timeFrom === plan.data.timeFrom && e.timeTo === plan.data.timeTo
          && norm(postName ?? '') === norm(plan.data.post ?? '')) unitSummary!.unchanged++;
        else unitSummary!.changed++;
      } else if (removeMissing && plan.existing) {
        toRemove.units.push(plan.existing.id);
        unitSummary!.removed++;
      }
    }
  }

  // Core team and emergency numbers: one list each, matched on the function and the description.
  let coreTeam: CoreTeamEntry[] | null = null;
  const team = found.get('kernteam');
  if (team) {
    const s = summary('kernteam');
    const fromFile: CoreTeamEntry[] = [];
    for (const { row, values } of required('kernteam', team)) {
      const phone = values.phone ? phoneOf(values.phone) : null;
      if (values.phone && !phone) problem('kernteam', row, `Ongeldig telefoonnummer bij ${values.name || values.function}: ${values.phone}`);
      fromFile.push({ function: values.function!.trim(), name: values.name ?? '', phone, isCoordinator: yes(values.coordinator ?? '') });
    }
    if (fromFile.filter((c) => c.isCoordinator).length > 1) problem('kernteam', null, 'Er is maar één evenementcoördinator');
    const kept = removeMissing ? [] : state.coreTeam.filter((c) => !fromFile.some((f) => sameKey(f.function, c.function)));
    coreTeam = [...state.coreTeam.filter((c) => fromFile.some((f) => sameKey(f.function, c.function))).map((c) => fromFile.find((f) => sameKey(f.function, c.function))!),
      ...fromFile.filter((f) => !state.coreTeam.some((c) => sameKey(f.function, c.function))), ...kept];
    // The coordinator in the file replaces one that stays from before.
    if (fromFile.some((c) => c.isCoordinator)) coreTeam = coreTeam.map((c) => (kept.includes(c) ? { ...c, isCoordinator: false } : c));
    for (const f of fromFile) {
      const old = state.coreTeam.find((c) => sameKey(c.function, f.function));
      if (!old) s.added++;
      else if (old.phone !== f.phone || old.isCoordinator !== f.isCoordinator || (f.name && old.name !== f.name)) s.changed++;
      else s.unchanged++;
    }
    if (removeMissing) s.removed = state.coreTeam.filter((c) => !fromFile.some((f) => sameKey(f.function, c.function))).length;
  }
  let numbers: EmergencyNumber[] | null = null;
  const emergency = found.get('noodnummers');
  if (emergency) {
    const s = summary('noodnummers');
    const fromFile: EmergencyNumber[] = [];
    for (const { row, values } of required('noodnummers', emergency)) {
      const number = normalizeEmergencyNumber(values.number!);
      if (!number) problem('noodnummers', row, `Ongeldig noodnummer bij ${values.label}: ${values.number}`);
      else fromFile.push({ label: values.label!.trim(), number });
    }
    const kept = removeMissing ? [] : state.emergencyNumbers.filter((n) => !fromFile.some((f) => sameKey(f.label, n.label)));
    numbers = [...fromFile, ...kept];
    for (const f of fromFile) {
      const old = state.emergencyNumbers.find((n) => sameKey(n.label, f.label));
      if (!old) s.added++;
      else if (old.number !== f.number) s.changed++;
      else s.unchanged++;
    }
    if (removeMissing) s.removed = state.emergencyNumbers.filter((n) => !fromFile.some((f) => sameKey(f.label, n.label))).length;
  }

  // In the order of the file.
  const order = SHEET_KEYS.map(sheetName);
  summaries.sort((a, b) => order.indexOf(a.sheet) - order.indexOf(b.sheet));
  const preview: ImportPreview = { sheets: summaries, problems, removeMissing };

  function apply() {
    if (problems.length) throw Object.assign(new Error('Het bestand heeft nog fouten; er is niets opgeslagen'), { statusCode: 400 });
    const types = state.postTypes;
    for (const id of toRemove.units) admin.deleteUnit(id);
    for (const id of toRemove.posts) admin.deletePost(id);
    for (const plan of postPlans.values()) {
      if (!plan.data && !plan.contacts) continue;
      const base = plan.data ?? { ...plan.existing!, contacts: undefined };
      const data: PostData = { ...base, contacts: plan.contacts ?? plan.existing?.contacts ?? [] };
      if (!isManned(data, types)) data.contacts = [];
      admin.savePost(plan.existing?.id ?? null, data);
    }
    // New locations have an id now.
    const posts = admin.getState().posts;
    for (const plan of unitPlans.values()) {
      if (!plan.data && !plan.members) continue;
      const e = plan.existing;
      const postName = plan.data ? plan.data.post : null;
      const postId = plan.data ? (postName ? posts.find((p) => sameKey(p.name, postName))?.id ?? null : null) : e!.postId;
      const data: UnitData = plan.data
        ? { name: plan.data.name, kind: plan.data.kind, mobility: plan.data.mobility, postId, hasAed: plan.data.hasAed, timeFrom: plan.data.timeFrom, timeTo: plan.data.timeTo, members: plan.members ?? e?.members ?? [] }
        : { ...e!, members: plan.members ?? e!.members };
      admin.saveUnit(e?.id ?? null, data);
    }
    if (coreTeam) admin.saveCoreTeam(coreTeam);
    if (numbers) admin.saveEmergencyNumbers(numbers);
  }

  return { preview, apply };
}
