// Beheer › Mensen (#70): every number with its name and everything it's listed at, and what's still missing. Only to look at;
// changes stay on the page of the post, team or core team. The name is the exception: it lives in people and is shared everywhere.
import { POST_CONTACT_ROLE_LABEL, formatPhone, type PeopleOverview, type PersonLink, type PersonOverview, type PostContactRole } from '@ehbo/shared';
import type { EventDb } from './event-db.ts';

type Row = Record<string, string | number | null>;

/** A time slot, when both ends are known; overlapping slots on two places can't both be staffed by one person. */
interface Slot { label: string; from: string; to: string }

export function peopleOverview(db: EventDb): PeopleOverview {
  const all = (sql: string) => db.raw.prepare(sql).all() as Row[];
  const loggedIn = db.loggedIn();
  const withPush = new Set(all('SELECT DISTINCT phone FROM subscriptions WHERE phone IS NOT NULL').map((r) => r.phone as string));
  const people = new Map<string, PersonOverview & { slots: Slot[] }>();
  const person = (phone: string, name: string) => {
    let entry = people.get(phone);
    if (!entry) {
      entry = { phone, name, links: [], loggedIn: loggedIn.has(phone), push: withPush.has(phone), problems: [], slots: [] };
      people.set(phone, entry);
    }
    return entry;
  };

  for (const p of all('SELECT phone, name FROM people')) person(p.phone as string, p.name as string);

  for (const c of all(`SELECT c.phone, c.role, COALESCE(c.time_from, p.time_from) AS time_from, COALESCE(c.time_to, p.time_to) AS time_to, p.id, p.name
                       FROM post_contacts c JOIN posts p ON p.id = c.post_id ORDER BY p.sort, p.id, c.id`)) {
    const entry = person(c.phone as string, '');
    const label = `${c.name as string} · ${POST_CONTACT_ROLE_LABEL[c.role as PostContactRole].toLowerCase()}`;
    entry.links.push({ kind: 'post', id: c.id as number, label });
    if (c.time_from && c.time_to) entry.slots.push({ label: c.name as string, from: c.time_from as string, to: c.time_to as string });
  }
  for (const m of all(`SELECT m.phone, u.id, u.name, u.time_from, u.time_to FROM ehbo_unit_members m JOIN ehbo_units u ON u.id = m.unit_id ORDER BY u.sort, u.id`)) {
    const entry = person(m.phone as string, '');
    entry.links.push({ kind: 'unit', id: m.id as number, label: `${m.name as string} (EHBO)` });
    if (m.time_from && m.time_to) entry.slots.push({ label: m.name as string, from: m.time_from as string, to: m.time_to as string });
  }
  for (const c of all('SELECT phone, function FROM core_team WHERE phone IS NOT NULL ORDER BY sort, id')) {
    person(c.phone as string, '').links.push({ kind: 'core', id: null, label: `Kernteam · ${c.function as string}` });
  }
  for (const a of all('SELECT phone FROM admins')) person(a.phone as string, '').links.push({ kind: 'admin', id: null, label: 'Beheerder' });

  const list = [...people.values()].map(({ slots, ...entry }): PersonOverview => {
    const problems: string[] = [];
    if (!entry.name.trim()) problems.push('Geen naam');
    if (!entry.links.length) problems.push('Staat nergens meer');
    const overlaps = slots.flatMap((a, i) => slots.slice(i + 1).filter((b) => b.label !== a.label && a.from < b.to && b.from < a.to).map((b) => `${a.label} en ${b.label}`));
    if (overlaps.length) problems.push(`Overlappende tijden: ${overlaps.join('; ')}`);
    return { ...entry, problems };
  });
  // By name; who has no name yet goes last, by number.
  list.sort((a, b) => (!a.name !== !b.name ? (a.name ? -1 : 1) : (a.name || a.phone).localeCompare(b.name || b.phone, 'nl')));

  const gaps: PeopleOverview['gaps'] = [
    // An EHBO post with a fixed team is run by that team, so it needs no lead.
    ...all(`SELECT id, name FROM posts p WHERE NOT EXISTS (SELECT 1 FROM post_contacts c WHERE c.post_id = p.id AND c.role = 'verantwoordelijke')
              AND NOT EXISTS (SELECT 1 FROM ehbo_units u WHERE u.post_id = p.id AND u.kind = 'vast') ORDER BY sort, id`)
      .map((p): PersonLink => ({ kind: 'post', id: p.id as number, label: `${p.name as string}: nog geen locatieverantwoordelijke` })),
    ...all('SELECT id, name FROM ehbo_units u WHERE NOT EXISTS (SELECT 1 FROM ehbo_unit_members m WHERE m.unit_id = u.id) ORDER BY sort, id')
      .map((u): PersonLink => ({ kind: 'unit', id: u.id as number, label: `${u.name as string}: nog geen leden` })),
    ...all('SELECT function FROM core_team WHERE phone IS NULL ORDER BY sort, id')
      .map((c): PersonLink => ({ kind: 'core', id: null, label: `Kernteam · ${c.function as string}: nog geen nummer` })),
  ];
  return { people: list, gaps };
}

/** The same list for a spreadsheet: one row per person. */
export function peopleCsv(overview: PeopleOverview) {
  const cell = (value: string) => (/[;"\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value);
  const rows = [
    ['Naam', 'Telefoon', 'Waar', 'Aangemeld', 'Meldingen', 'Let op'],
    ...overview.people.map((p) => [p.name, formatPhone(p.phone), p.links.map((l) => l.label).join(', '), p.loggedIn ? 'ja' : 'nee', p.push ? 'ja' : 'nee', p.problems.join(', ')]),
    [],
    ['Nog in te vullen'],
    ...overview.gaps.map((g) => [g.label]),
  ];
  // A BOM, so Excel reads the accents right; semicolons, as Dutch Excel expects.
  return `﻿${rows.map((r) => r.map(cell).join(';')).join('\r\n')}\r\n`;
}
