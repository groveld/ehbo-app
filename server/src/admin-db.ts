// Beheer: lezen en opslaan van evenement, lopen, posten, EHBO-eenheden, kernteam, noodnummers en beheerders.
// Telefoonnummers komen hier al genormaliseerd (E.164) binnen; de routes controleren de invoer.
import type {
  AdminPerson,
  AdminLocation,
  AdminRun,
  AdminState,
  AdminTeam,
  CoreTeamEntry,
  EmergencyNumber,
  EventSettings,
  InfoSection,
  InfoSettings,
  LocationData,
  LocationPassages,
  FunctionTypeInfo,
  RunData,
  TeamData,
} from '@ehbo/shared';
import { isStaffed, mainFunction } from '@ehbo/shared';
import { getBrand, getStyle, saveStyle } from './brand.ts';
import type { EventDb } from './event-db.ts';
import { recomputePassages, type Track } from './gpx.ts';

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
    const e = db.prepare('SELECT name, start_location, start_date, end_date, escalation_seconds, at_location_m FROM event WHERE id = 1').get() as Row;
    const event: EventSettings = {
      name: e.name as string,
      startLocation: e.start_location as string | null,
      startDate: e.start_date as string | null,
      endDate: e.end_date as string | null,
      escalationSeconds: e.escalation_seconds as number,
      atLocationM: e.at_location_m as number,
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

    const functionTypes: FunctionTypeInfo[] = all('SELECT id, key, name, letter, color, staffed FROM function_types ORDER BY sort, id').map((t) => ({
      id: t.id as number, key: t.key as string | null, name: t.name as string, letter: t.letter as string, color: t.color as string, staffed: t.staffed === 1,
    }));

    const contactsByLocation = new Map<number, LocationData['contacts']>();
    for (const c of all(`SELECT c.location_id, c.phone, c.role, c.time_from, c.time_to, p.name
                         FROM location_contacts c JOIN people p ON p.phone = c.phone ORDER BY c.id`)) {
      const list = contactsByLocation.get(c.location_id as number) ?? [];
      list.push({ name: c.name as string, phone: c.phone as string, role: c.role as LocationData['contacts'][number]['role'], timeFrom: c.time_from as string | null, timeTo: c.time_to as string | null });
      contactsByLocation.set(c.location_id as number, list);
    }
    const passagesByLocation = new Map<number, LocationPassages[]>();
    for (const r of all(`SELECT pp.location_id, pp.run_id, pp.km FROM km_points pp JOIN runs r ON r.id = pp.run_id
                         ORDER BY r.track_km DESC, r.id, pp.seq`)) {
      const list = passagesByLocation.get(r.location_id as number) ?? [];
      const entry = list.find((e) => e.runId === r.run_id);
      if (entry) entry.km.push(r.km as number);
      else list.push({ runId: r.run_id as number, km: [r.km as number] });
      passagesByLocation.set(r.location_id as number, list);
    }
    const functionsByLocation = new Map<number, number[]>();
    for (const f of all('SELECT location_id, type_id FROM location_functions ORDER BY sort, rowid')) {
      functionsByLocation.set(f.location_id as number, [...(functionsByLocation.get(f.location_id as number) ?? []), f.type_id as number]);
    }
    const locations: AdminLocation[] = all('SELECT * FROM locations ORDER BY km IS NULL, km, sort, id').map((p) => ({
      id: p.id as number,
      typeId: p.type_id as number,
      functionIds: functionsByLocation.get(p.id as number) ?? [p.type_id as number],
      runId: p.run_id as number | null,
      name: p.name as string,
      km: p.km as number | null,
      passages: passagesByLocation.get(p.id as number) ?? [],
      lat: p.lat as number | null,
      lng: p.lng as number | null,
      accuracyM: p.accuracy_m as number | null,
      address: p.address as string | null,
      accessRoute: p.access_route as string | null,
      timeFrom: p.time_from as string | null,
      timeTo: p.time_to as string | null,
      isOpen: p.is_open === 1,
      contacts: contactsByLocation.get(p.id as number) ?? [],
    }));

    const membersByTeam = new Map<number, TeamData['members']>();
    for (const m of all('SELECT m.team_id, m.phone, p.name FROM team_members m JOIN people p ON p.phone = m.phone ORDER BY m.rowid')) {
      const list = membersByTeam.get(m.team_id as number) ?? [];
      list.push({ name: m.name as string, phone: m.phone as string });
      membersByTeam.set(m.team_id as number, list);
    }
    const teams: AdminTeam[] = all('SELECT * FROM teams ORDER BY sort, id').map((u) => ({
      id: u.id as number,
      name: u.name as string,
      kind: u.kind as AdminTeam['kind'],
      mobility: u.mobility as AdminTeam['mobility'],
      locationId: u.location_id as number | null,
      hasAed: u.has_aed === 1,
      timeFrom: u.time_from as string | null,
      timeTo: u.time_to as string | null,
      availability: u.availability as AdminTeam['availability'],
      members: membersByTeam.get(u.id as number) ?? [],
    }));

    const coreTeam: CoreTeamEntry[] = all(`SELECT c.function, c.phone, c.is_coordinator, COALESCE(p.name, '') AS name
                                           FROM core_team c LEFT JOIN people p ON p.phone = c.phone ORDER BY c.sort, c.id`).map((c) => ({
      function: c.function as string, name: c.name as string, phone: c.phone as string | null, isCoordinator: c.is_coordinator === 1,
    }));

    const emergencyNumbers: EmergencyNumber[] = all('SELECT label, number FROM emergency_numbers ORDER BY sort, id')
      .map((n) => ({ label: n.label as string, number: n.number as string }));

    const admins: AdminPerson[] = all('SELECT a.phone, p.name FROM admins a JOIN people p ON p.phone = a.phone ORDER BY p.name, a.phone')
      .map((a) => ({ phone: a.phone as string, name: a.name as string }));

    return { event, runs, functionTypes, locations, teams, coreTeam, emergencyNumbers, admins, brand: getBrand(events), testMode: events.testMode(), sessions: events.countSessions(), info: getInfo() };
  }

  function getInfo(): InfoSettings {
    const e = events.getEvent();
    return { sections: e.info_json ? JSON.parse(e.info_json) as InfoSection[] : null, policy: e.info_policy, contact: e.info_contact };
  }

  function saveInfo(info: InfoSettings) {
    const sections = info.sections?.map((s) => ({ title: s.title.trim(), body: s.body.trim() })).filter((s) => s.title || s.body);
    run('UPDATE event SET info_json = ?, info_policy = ?, info_contact = ? WHERE id = 1',
      sections?.length ? JSON.stringify(sections) : null, info.policy?.trim() || null, info.contact?.trim() || null);
  }

  function saveEvent(e: EventSettings) {
    events.transaction(() => {
      run('UPDATE event SET name = ?, start_location = ?, start_date = ?, end_date = ?, escalation_seconds = ?, at_location_m = ? WHERE id = 1',
        e.name.trim(), e.startLocation?.trim() || null, e.startDate, e.endDate, e.escalationSeconds, e.atLocationM);
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
    const saved = run('UPDATE runs SET gpx = ?, gpx_filename = ?, track_json = ?, track_points = ?, track_km = ? WHERE id = ?',
      gpx, filename, JSON.stringify(track.line), track.points, track.km, id).changes > 0;
    recomputePassages(db);
    return saved;
  }

  function saveLocation(id: number | null, p: LocationData): number | null {
    if (id !== null && !exists('locations', id)) return null;
    return events.transaction(() => {
      // The main function goes first, so lists and the package can take the first one.
      const types = all('SELECT id, key, staffed FROM function_types').map((t) => ({ id: t.id as number, key: t.key as string | null, staffed: t.staffed === 1 }));
      const main = mainFunction(p.functionIds, types);
      const functionIds = [main, ...p.functionIds.filter((id) => id !== main)];
      // Nobody at an AED or a turnaround (#69): no people and no times. Only a turnaround has a run.
      const staffed = isStaffed(p, types);
      const turnaround = p.functionIds.some((id) => types.find((t) => t.id === id)?.key === 'turnaround');
      const values = [main, p.name.trim(), p.lat, p.lng, p.accuracyM, p.address?.trim() || null, p.accessRoute?.trim() || null,
        staffed ? p.timeFrom : null, staffed ? p.timeTo : null, turnaround ? p.runId : null] as const;
      let locationId = id;
      if (locationId === null) {
        locationId = Number(run(`INSERT INTO locations (type_id, name, lat, lng, accuracy_m, address, access_route, time_from, time_to, run_id)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, ...values).lastInsertRowid);
      } else {
        run(`UPDATE locations SET type_id = ?, name = ?, lat = ?, lng = ?, accuracy_m = ?, address = ?, access_route = ?, time_from = ?, time_to = ?, run_id = ?
             WHERE id = ?`, ...values, locationId);
        run('DELETE FROM location_contacts WHERE location_id = ?', locationId);
        run('DELETE FROM location_functions WHERE location_id = ?', locationId);
      }
      functionIds.forEach((typeId, i) => run('INSERT INTO location_functions (location_id, type_id, sort) VALUES (?, ?, ?)', locationId, typeId, i));
      for (const c of staffed ? p.contacts : []) {
        upsertPerson(c.phone, c.name);
        run('INSERT INTO location_contacts (location_id, phone, role, time_from, time_to) VALUES (?, ?, ?, ?, ?)', locationId, c.phone, c.role, c.timeFrom, c.timeTo);
      }
      recomputePassages(db);
      return locationId;
    });
  }

  function saveTeam(id: number | null, u: TeamData): number | null {
    if (id !== null && !exists('teams', id)) return null;
    return events.transaction(() => {
      const values = [u.name.trim(), u.kind, u.kind === 'mobile' ? (u.mobility ?? 'other') : null, u.locationId, u.hasAed ? 1 : 0, u.timeFrom ?? null, u.timeTo ?? null] as const;
      let teamId = id;
      if (teamId === null) {
        const sort = (db.prepare('SELECT COALESCE(MAX(sort), -1) + 1 AS n FROM teams').get() as { n: number }).n;
        teamId = Number(run('INSERT INTO teams (name, kind, mobility, location_id, has_aed, time_from, time_to, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', ...values, sort).lastInsertRowid);
      } else {
        run('UPDATE teams SET name = ?, kind = ?, mobility = ?, location_id = ?, has_aed = ?, time_from = ?, time_to = ? WHERE id = ?', ...values, teamId);
        run('DELETE FROM team_members WHERE team_id = ?', teamId);
      }
      for (const m of u.members) {
        upsertPerson(m.phone, m.name);
        run('INSERT INTO team_members (team_id, phone) VALUES (?, ?) ON CONFLICT DO NOTHING', teamId, m.phone);
      }
      return teamId;
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
    saveInfo,
    saveRun,
    setRunGpx,
    deleteRun: (id: number) => {
      const deleted = run('DELETE FROM runs WHERE id = ?', id).changes > 0;
      recomputePassages(db);
      return deleted;
    },
    saveLocation,
    deleteLocation: (id: number) => run('DELETE FROM locations WHERE id = ?', id).changes > 0,
    functionTypeExists: (id: number) => exists('function_types', id),
    runExists: (id: number) => exists('runs', id),
    locationExists: (id: number) => exists('locations', id),
    /** The report needs them: a post with incidents or requests can't be deleted. */
    locationHasHistory: (id: number) => db.prepare('SELECT 1 FROM help_requests WHERE location_id = ?').get(id) !== undefined,
    saveTeam,
    deleteTeam: (id: number) => run('DELETE FROM teams WHERE id = ?', id).changes > 0,
    saveCoreTeam,
    saveEmergencyNumbers,
    addAdmin,
    removeAdmin: (phone: string) => run('DELETE FROM admins WHERE phone = ?', phone).changes > 0,
  };
}
