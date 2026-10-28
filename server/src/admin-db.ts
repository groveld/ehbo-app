// Beheer: lezen en opslaan van evenement, lopen, posten, EHBO-eenheden, kernteam, noodnummers en beheerders.
// Telefoonnummers komen hier al genormaliseerd (E.164) binnen; de routes controleren de invoer.
import type {
  AdminPerson,
  AdminPost,
  AdminRun,
  AdminState,
  AdminUnit,
  CoreTeamEntry,
  EmergencyNumber,
  EventSettings,
  PostData,
  PostTypeInfo,
  RunData,
  UnitData,
} from '@ehbo/shared';
import { getBrand, getStyle, saveStyle } from './brand.ts';
import type { EventDb } from './event-db.ts';
import type { Track } from './gpx.ts';

type Row = Record<string, string | number | null>;

export type AdminDb = ReturnType<typeof adminDb>;

export function adminDb(events: EventDb) {
  const db = events.raw;
  const all = (sql: string, ...params: (string | number | null)[]) => db.prepare(sql).all(...params) as Row[];
  const run = (sql: string, ...params: (string | number | null)[]) => db.prepare(sql).run(...params);
  const exists = (table: string, id: number) => db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(id) !== undefined;

  /** Naam van een persoon bijwerken; een leeg veld wist een bekende naam niet. */
  const upsertPerson = (phone: string, name: string) => run(
    `INSERT INTO people (phone, name) VALUES (?, ?)
     ON CONFLICT(phone) DO UPDATE SET name = CASE WHEN excluded.name <> '' THEN excluded.name ELSE people.name END`,
    phone, name.trim(),
  );

  function getState(): AdminState {
    const e = db.prepare('SELECT name, start_location, start_date, end_date, escalation_seconds FROM event WHERE id = 1').get() as Row;
    const event: EventSettings = {
      name: e.name as string,
      startLocation: e.start_location as string | null,
      startDate: e.start_date as string | null,
      endDate: e.end_date as string | null,
      escalationSeconds: e.escalation_seconds as number,
      style: getStyle(events),
    };

    const runs: AdminRun[] = all('SELECT * FROM runs ORDER BY sort, id').map((r) => ({
      id: r.id as number,
      name: r.name as string,
      distanceKm: r.distance_km as number | null,
      discipline: r.discipline as string | null,
      date: r.date as string | null,
      startTime: r.start_time as string | null,
      gpx: r.track_json ? { filename: (r.gpx_filename as string) ?? 'parcours.gpx', points: r.track_points as number, km: r.track_km as number } : null,
    }));

    const postTypes: PostTypeInfo[] = all('SELECT id, key, name, letter, color FROM post_types ORDER BY sort, id').map((t) => ({
      id: t.id as number, key: t.key as string | null, name: t.name as string, letter: t.letter as string, color: t.color as string,
    }));

    const contactsByPost = new Map<number, PostData['contacts']>();
    for (const c of all(`SELECT c.post_id, c.phone, c.role, c.time_from, c.time_to, p.name
                         FROM post_contacts c JOIN people p ON p.phone = c.phone ORDER BY c.id`)) {
      const list = contactsByPost.get(c.post_id as number) ?? [];
      list.push({ name: c.name as string, phone: c.phone as string, role: c.role as PostData['contacts'][number]['role'], timeFrom: c.time_from as string | null, timeTo: c.time_to as string | null });
      contactsByPost.set(c.post_id as number, list);
    }
    const posts: AdminPost[] = all('SELECT * FROM posts ORDER BY km IS NULL, km, sort, id').map((p) => ({
      id: p.id as number,
      typeId: p.type_id as number,
      name: p.name as string,
      km: p.km as number | null,
      lat: p.lat as number | null,
      lng: p.lng as number | null,
      accuracyM: p.accuracy_m as number | null,
      address: p.address as string | null,
      accessRoute: p.access_route as string | null,
      timeFrom: p.time_from as string | null,
      timeTo: p.time_to as string | null,
      isOpen: p.is_open === 1,
      contacts: contactsByPost.get(p.id as number) ?? [],
    }));

    const membersByUnit = new Map<number, UnitData['members']>();
    for (const m of all('SELECT m.unit_id, m.phone, p.name FROM ehbo_unit_members m JOIN people p ON p.phone = m.phone ORDER BY m.rowid')) {
      const list = membersByUnit.get(m.unit_id as number) ?? [];
      list.push({ name: m.name as string, phone: m.phone as string });
      membersByUnit.set(m.unit_id as number, list);
    }
    const units: AdminUnit[] = all('SELECT * FROM ehbo_units ORDER BY sort, id').map((u) => ({
      id: u.id as number,
      name: u.name as string,
      kind: u.kind as AdminUnit['kind'],
      mobility: u.mobility as AdminUnit['mobility'],
      postId: u.post_id as number | null,
      hasAed: u.has_aed === 1,
      availability: u.availability as AdminUnit['availability'],
      members: membersByUnit.get(u.id as number) ?? [],
    }));

    const coreTeam: CoreTeamEntry[] = all(`SELECT c.function, c.phone, c.is_coordinator, COALESCE(p.name, '') AS name
                                           FROM core_team c LEFT JOIN people p ON p.phone = c.phone ORDER BY c.sort, c.id`).map((c) => ({
      function: c.function as string, name: c.name as string, phone: c.phone as string | null, isCoordinator: c.is_coordinator === 1,
    }));

    const emergencyNumbers: EmergencyNumber[] = all('SELECT label, number FROM emergency_numbers ORDER BY sort, id')
      .map((n) => ({ label: n.label as string, number: n.number as string }));

    const admins: AdminPerson[] = all('SELECT a.phone, p.name FROM admins a JOIN people p ON p.phone = a.phone ORDER BY p.name, a.phone')
      .map((a) => ({ phone: a.phone as string, name: a.name as string }));

    return { event, runs, postTypes, posts, units, coreTeam, emergencyNumbers, admins, brand: getBrand(events), testMode: events.testMode() };
  }

  function saveEvent(e: EventSettings) {
    events.transaction(() => {
      run('UPDATE event SET name = ?, start_location = ?, start_date = ?, end_date = ?, escalation_seconds = ? WHERE id = 1',
        e.name.trim(), e.startLocation?.trim() || null, e.startDate, e.endDate, e.escalationSeconds);
      saveStyle(events, e.style);
    });
  }

  function saveRun(id: number | null, r: RunData): number | null {
    const values = [r.name.trim(), r.distanceKm, r.discipline?.trim() || null, r.date, r.startTime] as const;
    if (id === null) {
      const sort = (db.prepare('SELECT COALESCE(MAX(sort), -1) + 1 AS n FROM runs').get() as { n: number }).n;
      return Number(run('INSERT INTO runs (name, distance_km, discipline, date, start_time, sort) VALUES (?, ?, ?, ?, ?, ?)', ...values, sort).lastInsertRowid);
    }
    return run('UPDATE runs SET name = ?, distance_km = ?, discipline = ?, date = ?, start_time = ? WHERE id = ?', ...values, id).changes ? id : null;
  }

  function setRunGpx(id: number, filename: string, gpx: string, track: Track) {
    return run('UPDATE runs SET gpx = ?, gpx_filename = ?, track_json = ?, track_points = ?, track_km = ? WHERE id = ?',
      gpx, filename, JSON.stringify(track.line), track.points, track.km, id).changes > 0;
  }

  function savePost(id: number | null, p: PostData): number | null {
    if (id !== null && !exists('posts', id)) return null;
    return events.transaction(() => {
      const values = [p.typeId, p.name.trim(), p.km, p.lat, p.lng, p.accuracyM, p.address?.trim() || null, p.accessRoute?.trim() || null, p.timeFrom, p.timeTo] as const;
      let postId = id;
      if (postId === null) {
        postId = Number(run(`INSERT INTO posts (type_id, name, km, lat, lng, accuracy_m, address, access_route, time_from, time_to)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, ...values).lastInsertRowid);
      } else {
        run(`UPDATE posts SET type_id = ?, name = ?, km = ?, lat = ?, lng = ?, accuracy_m = ?, address = ?, access_route = ?, time_from = ?, time_to = ?
             WHERE id = ?`, ...values, postId);
        run('DELETE FROM post_contacts WHERE post_id = ?', postId);
      }
      for (const c of p.contacts) {
        upsertPerson(c.phone, c.name);
        run('INSERT INTO post_contacts (post_id, phone, role, time_from, time_to) VALUES (?, ?, ?, ?, ?)', postId, c.phone, c.role, c.timeFrom, c.timeTo);
      }
      return postId;
    });
  }

  function saveUnit(id: number | null, u: UnitData): number | null {
    if (id !== null && !exists('ehbo_units', id)) return null;
    return events.transaction(() => {
      const values = [u.name.trim(), u.kind, u.kind === 'mobiel' ? (u.mobility ?? 'anders') : null, u.postId, u.hasAed ? 1 : 0] as const;
      let unitId = id;
      if (unitId === null) {
        const sort = (db.prepare('SELECT COALESCE(MAX(sort), -1) + 1 AS n FROM ehbo_units').get() as { n: number }).n;
        unitId = Number(run('INSERT INTO ehbo_units (name, kind, mobility, post_id, has_aed, sort) VALUES (?, ?, ?, ?, ?, ?)', ...values, sort).lastInsertRowid);
      } else {
        run('UPDATE ehbo_units SET name = ?, kind = ?, mobility = ?, post_id = ?, has_aed = ? WHERE id = ?', ...values, unitId);
        run('DELETE FROM ehbo_unit_members WHERE unit_id = ?', unitId);
      }
      for (const m of u.members) {
        upsertPerson(m.phone, m.name);
        run('INSERT INTO ehbo_unit_members (unit_id, phone) VALUES (?, ?) ON CONFLICT DO NOTHING', unitId, m.phone);
      }
      return unitId;
    });
  }

  function saveCoreTeam(entries: CoreTeamEntry[]) {
    events.transaction(() => {
      run('DELETE FROM core_team');
      entries.forEach((c, i) => {
        if (c.phone) upsertPerson(c.phone, c.name);
        run('INSERT INTO core_team (function, phone, is_coordinator, sort) VALUES (?, ?, ?, ?)', c.function.trim(), c.phone, c.isCoordinator ? 1 : 0, i);
      });
    });
  }

  function saveEmergencyNumbers(numbers: EmergencyNumber[]) {
    events.transaction(() => {
      run('DELETE FROM emergency_numbers');
      numbers.forEach((n, i) => run('INSERT INTO emergency_numbers (label, number, sort) VALUES (?, ?, ?)', n.label.trim(), n.number.trim(), i));
    });
  }

  function addAdmin(phone: string, name: string) {
    events.transaction(() => {
      upsertPerson(phone, name);
      run('INSERT INTO admins (phone) VALUES (?) ON CONFLICT DO NOTHING', phone);
    });
  }

  return {
    getState,
    saveEvent,
    saveRun,
    setRunGpx,
    deleteRun: (id: number) => run('DELETE FROM runs WHERE id = ?', id).changes > 0,
    savePost,
    deletePost: (id: number) => run('DELETE FROM posts WHERE id = ?', id).changes > 0,
    postTypeExists: (id: number) => exists('post_types', id),
    postExists: (id: number) => exists('posts', id),
    saveUnit,
    deleteUnit: (id: number) => run('DELETE FROM ehbo_units WHERE id = ?', id).changes > 0,
    saveCoreTeam,
    saveEmergencyNumbers,
    addAdmin,
    removeAdmin: (phone: string) => run('DELETE FROM admins WHERE phone = ?', phone).changes > 0,
  };
}
