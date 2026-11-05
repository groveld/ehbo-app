// EHBO-oproepen: wie krijgt de oproep, escalatie na de ingestelde tijd, accepteren, ter plaatse, afronden.
// Functioneel ontwerp, "Hulpoproep en escalatie". De stand staat in de database; alleen timers en GPS-posities staan in het geheugen.
import {
  ACTION_MAX_AGE_MS,
  CLOSE_WARNING_MIN,
  INCIDENT_WHAT,
  KEEP_OPEN_MIN,
  POSITION_MAX_AGE_MS,
  awayLocationIds,
  incidentsOf,
  distanceKm,
  formatKm,
  placeOf,
  plannedClose,
  AFTER_CALL,
  type CloseIncident,
  type ControlResult,
  type Dispatch,
  type FirstAidStatus,
  type DispatchReason,
  type IncidentDetails,
  type IncidentEvent,
  type IncidentEventType,
  type IncidentPersons,
  type LiveIncident,
  type LiveRequest,
  type LiveState,
  type LiveTeam,
  type LastSeen,
  type Me,
  type NewIncident,
  type NewSelfIncident,
  type PushPayload,
  type TeamAvailability,
} from '@ehbo/shared';
import type { EventDb } from './event-db.ts';

/** Na de eerste escalatie blijft het alarm zo vaak herhalen (elke escalatietijd), tot iemand accepteert. */
export const MAX_REPEATS = 10;

export type Schedule = (fn: () => void, ms: number) => () => void;

const defaultSchedule: Schedule = (fn, ms) => {
  const timer = setTimeout(fn, ms);
  return () => clearTimeout(timer);
};

export interface CallsOptions {
  /** Pushmelding naar alle toestellen van deze personen. */
  notify: (phones: Iterable<string>, payload: PushPayload) => void;
  schedule?: Schedule;
  now?: () => Date;
  /** Aanvragen (water, verkeer, vrijwilliger) die mee in de live stand gaan. */
  requests?: () => LiveRequest[];
}

const httpError = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });

const PERSONS_TEXT: Record<IncidentPersons, string> = { '1': '1 persoon', '2': '2 personen', '3+': '3 of meer personen' };

type Row = Record<string, string | number | null>;

interface Team {
  id: number;
  name: string;
  kind: 'fixed' | 'mobile';
  locationId: number | null;
  hasAed: boolean;
  availability: TeamAvailability;
  /** Picked during a call, carried out once it's over. */
  nextAvailability: Exclude<TeamAvailability, 'available'> | null;
  stayLocationId: number | null;
  timeTo: string | null;
  keepUntil: string | null;
  closesAt: string | null;
  members: string[];
}

interface Location {
  id: number;
  typeId: number;
  name: string;
  km: number | null;
  lat: number | null;
  lng: number | null;
  isOpen: boolean;
  isEhbo: boolean;
  /** EHBO is all that's there: the location and its fixed team open and close together. */
  onlyEhbo: boolean;
  /** People are there (#69); an AED, toilets or a turnaround never open. */
  staffed: boolean;
  timeTo: string | null;
  keepUntil: string | null;
  closesAt: string | null;
  autoClosedAt: string | null;
}

export type Calls = ReturnType<typeof createCalls>;

export function createCalls(db: EventDb, { notify: send, schedule = defaultSchedule, now = () => new Date(), requests = () => [] }: CallsOptions) {
  // In de testmodus begint elke melding met "Test", zodat niemand een proefoproep voor echt aanziet.
  const notify: CallsOptions['notify'] = (phones, payload) => send(phones, db.testMode() ? { ...payload, title: `Test · ${payload.title}` } : payload);
  const sql = db.raw;
  const all = (query: string, ...params: (string | number | null)[]) => sql.prepare(query).all(...params) as Row[];
  const get = (query: string, ...params: (string | number | null)[]) => sql.prepare(query).get(...params) as Row | undefined;
  const run = (query: string, ...params: (string | number | null)[]) => sql.prepare(query).run(...params);
  const iso = () => now().toISOString();

  /** While a change from a phone's queue is carried out: when it really happened. */
  let happenedAt: Date | null = null;
  const moment = () => happenedAt ?? now();
  const stamp = () => moment().toISOString();

  /** Last GPS position per person; on purpose not in the database. Only members of a mobile team on duty share one (#101). */
  const positions = new Map<string, { lng: number; lat: number; at: number }>();
  /** Teams whose last member logged out during a call: they go off duty once the call is over. */
  const leftDuringCall = new Set<number>();
  const timers = new Map<number, () => void>();
  const listeners = new Set<(state: LiveState) => void>();
  let version = 0;

  // ---- Gegevens ----

  const escalationMs = () => (get('SELECT escalation_seconds FROM event WHERE id = 1')!.escalation_seconds as number) * 1000;
  /** Within this many metres of a post a position counts as that post (#63). */
  const atLocationM = () => get('SELECT at_location_m FROM event WHERE id = 1')!.at_location_m as number;
  const coordinator = () => db.coordinatorPhone();
  /** A waiting call goes to a team other than its own only after this long (Delen na). */
  const shareAfterMs = () => (get('SELECT share_after_min FROM event WHERE id = 1')!.share_after_min as number) * 60_000;

  function teams(): Team[] {
    const members = new Map<number, string[]>();
    for (const m of all('SELECT team_id, phone FROM team_members ORDER BY rowid')) {
      members.set(m.team_id as number, [...(members.get(m.team_id as number) ?? []), m.phone as string]);
    }
    return all('SELECT id, name, kind, location_id, has_aed, availability, next_availability, stay_location_id, time_to, keep_until, closes_at FROM teams ORDER BY sort, id').map((u) => ({
      id: u.id as number,
      name: u.name as string,
      kind: u.kind as Team['kind'],
      locationId: u.location_id as number | null,
      hasAed: u.has_aed === 1,
      availability: u.availability as TeamAvailability,
      nextAvailability: u.next_availability as Team['nextAvailability'],
      stayLocationId: u.stay_location_id as number | null,
      timeTo: u.time_to as string | null,
      keepUntil: u.keep_until as string | null,
      closesAt: u.closes_at as string | null,
      members: members.get(u.id as number) ?? [],
    }));
  }

  function locations(): Map<number, Location> {
    // An EHBO post is a location with an EHBO function, also when that isn't its main function (#83).
    return new Map(all(`SELECT p.id, p.type_id, p.name, p.km, p.lat, p.lng, p.is_open, p.time_to, p.keep_until, p.closes_at, p.auto_closed_at,
                               EXISTS (SELECT 1 FROM location_functions f JOIN function_types t ON t.id = f.type_id WHERE f.location_id = p.id AND t.key = 'first_aid') AS ehbo,
                               (SELECT COUNT(*) FROM location_functions f WHERE f.location_id = p.id) AS functions,
                               EXISTS (SELECT 1 FROM location_functions f JOIN function_types t ON t.id = f.type_id WHERE f.location_id = p.id AND t.staffed = 1) AS staffed
                        FROM locations p`).map((p) => [p.id as number, {
      id: p.id as number,
      typeId: p.type_id as number,
      name: p.name as string,
      km: p.km as number | null,
      lat: p.lat as number | null,
      lng: p.lng as number | null,
      isOpen: p.is_open === 1,
      isEhbo: p.ehbo === 1,
      onlyEhbo: p.ehbo === 1 && p.functions === 1,
      staffed: p.staffed === 1,
      timeTo: p.time_to as string | null,
      keepUntil: p.keep_until as string | null,
      closesAt: p.closes_at as string | null,
      autoClosedAt: p.auto_closed_at as string | null,
    }]));
  }

  const teamById = (id: number) => teams().find((u) => u.id === id);
  const locationPhones = (locationId: number) => all('SELECT phone FROM location_contacts WHERE location_id = ?', locationId).map((r) => r.phone as string);
  const personName = (phone: string) => (get('SELECT name FROM people WHERE phone = ?', phone)?.name as string | undefined) || phone;

  /** Eenheden die nu met een oproep bezig zijn: team id → incident id. */
  function busyTeams() {
    return new Map(all(`SELECT d.team_id, d.help_request_id AS incident_id FROM dispatches d JOIN incidents i ON i.id = d.help_request_id
                        WHERE d.accepted_at IS NOT NULL AND i.status IN ('accepted', 'on_site')`)
      .map((r) => [r.team_id as number, r.incident_id as number]));
  }

  /** A mobile team's position: the freshest of its members. */
  function teamFix(team: Team) {
    if (team.kind !== 'mobile') return undefined;
    return team.members.map((m) => positions.get(m)).filter((f) => f !== undefined).sort((a, b) => b.at - a.at)[0];
  }

  /** A team goes off duty: its members stop sharing, unless they're on another mobile team on duty. */
  function forgetPositions(team: Team) {
    const sharing = new Set(teams().filter((u) => u.id !== team.id && u.kind === 'mobile' && u.availability !== 'off_duty').flatMap((u) => u.members));
    for (const member of team.members) if (!sharing.has(member)) positions.delete(member);
  }

  /** Waar een eenheid nu is: vast = eigen post (of waar ze bleef), mobiel = recente GPS, anders de standplaats. */
  function teamPosition(team: Team, locationMap: Map<number, Location>): [number, number] | null {
    if (team.kind === 'mobile') {
      const fix = teamFix(team);
      if (fix && now().getTime() - fix.at <= POSITION_MAX_AGE_MS) return [fix.lng, fix.lat];
    }
    const location = locationMap.get((team.kind === 'fixed' ? team.stayLocationId : null) ?? team.locationId ?? -1);
    return location?.lat != null && location.lng != null ? [location.lng, location.lat] : null;
  }

  /** Beschikbare eenheden met hun afstand tot de plek van de hulpvraag (null als die onbekend is). */
  function freeTeams(location: { lat: number | null; lng: number | null }) {
    const busy = busyTeams();
    const locationMap = locations();
    return teams()
      .filter((u) => u.availability === 'available' && !busy.has(u.id))
      .map((team) => {
        const position = teamPosition(team, locationMap);
        const km = position && location.lat != null && location.lng != null ? Math.round(distanceKm(position, [location.lng, location.lat]) * 10) / 10 : null;
        return { team, km };
      });
  }

  const nearest = <T extends { km: number | null }>(list: T[]) =>
    list.filter((c) => c.km !== null).sort((a, b) => a.km! - b.km!)[0];

  function incidentRow(id: number) {
    const row = get('SELECT * FROM incidents WHERE id = ?', id);
    if (!row) throw httpError(404, 'Melding niet gevonden');
    return row;
  }

  /** Where help is needed: the place of the incident when that's away from its post, otherwise the post. */
  function targetOf(row: Row) {
    return row.place_lat != null && row.place_lng != null ? { lat: row.place_lat as number, lng: row.place_lng as number } : locations().get(row.location_id as number)!;
  }
  const placeName = (row: Row) => (row.place_name as string | null) ?? locations().get(row.location_id as number)!.name;
  /** Who follows the call: the post, and who asked for help, also from away from a post. */
  const followers = (row: Row) => new Set([...locationPhones(row.location_id as number), row.reported_by as string]);

  function dispatchesOf(id: number): Dispatch[] {
    return all('SELECT * FROM dispatches WHERE help_request_id = ? ORDER BY at, rowid', id).map((d) => ({
      teamId: d.team_id as number,
      at: d.at as string,
      reason: d.reason as DispatchReason,
      distanceKm: d.distance_km as number | null,
      declinedAt: d.declined_at as string | null,
      acceptedAt: d.accepted_at as string | null,
    }));
  }

  // ---- Live stand ----

  function toLive(row: Row, eventsById: Map<number, IncidentEvent[]>, locationMap: Map<number, Location>): LiveIncident {
    const acceptedBy = row.accepted_by as string | null;
    // An incident keeps its post: the database refuses to delete a post that has incidents.
    const { typeId, name, km, lat, lng } = locationMap.get(row.location_id as number)!;
    const place = row.place_name as string | null;
    return {
      id: row.id as number,
      type: row.type as string,
      handling: 'dispatch',
      locationId: row.location_id as number,
      location: { typeId, name: place ?? name, km, lat: (row.place_lat as number | null) ?? lat, lng: (row.place_lng as number | null) ?? lng },
      reportedBy: row.reported_by as string,
      selfStarted: row.self_started === 1,
      offLocation: place !== null,
      accuracyM: row.place_accuracy_m as number | null,
      status: row.status as LiveIncident['status'],
      stage: row.stage as LiveIncident['stage'],
      what: row.what as LiveIncident['what'],
      persons: row.persons as LiveIncident['persons'],
      responsive: row.responsive as LiveIncident['responsive'],
      note: row.note as string | null,
      aed: row.aed === 1,
      isTest: row.is_test === 1,
      reportedAt: row.reported_at as string,
      sentAt: row.sent_at as string,
      escalatesAt: row.escalates_at as string | null,
      teamId: row.team_id as number | null,
      acceptedBy: acceptedBy ? { name: personName(acceptedBy), phone: acceptedBy } : null,
      acceptedAt: row.accepted_at as string | null,
      onSiteAt: row.on_site_at as string | null,
      closedAt: row.closed_at as string | null,
      outcome: row.outcome as LiveIncident['outcome'],
      dispatches: dispatchesOf(row.id as number),
      events: eventsById.get(row.id as number) ?? [],
    };
  }

  function liveTeams(): LiveTeam[] {
    const busy = busyTeams();
    return teams().map((u) => {
      const fix = teamFix(u);
      return { id: u.id, availability: u.availability, incidentId: busy.get(u.id) ?? null, stayLocationId: u.stayLocationId, position: fix ? { lat: fix.lat, lng: fix.lng, at: new Date(fix.at).toISOString() } : null, closesAt: u.closesAt, nextAvailability: u.nextAvailability };
    });
  }

  /** Voor deelnemers: welke standplaatsen nu leeg zijn. Zonder de oproepen, dus licht genoeg om vaak op te vragen. */
  function ehboStatus(): Omit<FirstAidStatus, 'open'> {
    return { awayLocationIds: awayLocationIds(teams(), liveTeams(), [...locations().values()], now().getTime(), atLocationM()), dataVersion: db.dataVersion() };
  }

  function state(): LiveState {
    const eventsById = new Map<number, IncidentEvent[]>();
    for (const e of all('SELECT help_request_id AS incident_id, at, type, team_id, text FROM help_request_events ORDER BY id')) {
      const list = eventsById.get(e.incident_id as number) ?? [];
      list.push({ at: e.at as string, type: e.type as IncidentEventType, teamId: e.team_id as number | null, text: e.text as string });
      eventsById.set(e.incident_id as number, list);
    }
    const locationMap = locations();
    return {
      version,
      dataVersion: db.dataVersion(),
      serverTime: iso(),
      helpRequests: [...all('SELECT * FROM incidents').map((row) => toLive(row, eventsById, locationMap)), ...requests()].sort((a, b) => b.id - a.id),
      teams: liveTeams(),
      locations: [...locationMap.values()].map((p) => ({ id: p.id, isOpen: p.isOpen, closesAt: p.closesAt, autoClosedAt: p.autoClosedAt })),
      testMode: db.testMode(),
    };
  }

  function changed() {
    version++;
    if (listeners.size === 0) return;
    const snapshot = state();
    for (const listener of listeners) listener(snapshot);
  }

  // ---- Bouwstenen ----

  /** An incident is a help request of the first-aid type (#86); what only incidents have is in dispatch_details. */
  const SHARED = new Set(['client_id', 'location_id', 'reported_by', 'status', 'is_test', 'reported_at', 'accepted_by', 'accepted_at', 'closed_at',
    'place_name', 'place_lat', 'place_lng', 'place_accuracy_m']);
  const split = (values: Row): [string[], string[]] => {
    const keys = Object.keys(values);
    return [keys.filter((k) => SHARED.has(k)), keys.filter((k) => !SHARED.has(k))];
  };
  function insertIncident(typeKey: string, values: Row) {
    const [shared, details] = split(values);
    const type = get('SELECT id FROM help_request_types WHERE key = ?', typeKey)!.id as number;
    const id = Number(run(`INSERT INTO help_requests (type_id, ${shared.join(', ')}) VALUES (?, ${shared.map(() => '?').join(', ')})`, type, ...shared.map((k) => values[k]!)).lastInsertRowid);
    run(`INSERT INTO dispatch_details (help_request_id, ${details.join(', ')}) VALUES (?, ${details.map(() => '?').join(', ')})`, id, ...details.map((k) => values[k]!));
    return id;
  }
  function setIncident(id: number, values: Row) {
    const [shared, details] = split(values);
    if (shared.length) run(`UPDATE help_requests SET ${shared.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...shared.map((k) => values[k]!), id);
    if (details.length) run(`UPDATE dispatch_details SET ${details.map((k) => `${k} = ?`).join(', ')} WHERE help_request_id = ?`, ...details.map((k) => values[k]!), id);
  }

  const log = (incidentId: number, type: IncidentEventType, text: string, teamId: number | null = null) =>
    run('INSERT INTO help_request_events (help_request_id, at, type, team_id, text) VALUES (?, ?, ?, ?, ?)', incidentId, stamp(), type, teamId, text);

  function summary(row: Row) {
    const what = row.what ? INCIDENT_WHAT[row.what as keyof typeof INCIDENT_WHAT] : null;
    const persons = row.persons ? PERSONS_TEXT[row.persons as IncidentPersons] : null;
    return [what, persons].filter(Boolean).join(' · ') || 'EHBO nodig';
  }

  const tag = (id: number) => `oproep-${id}`;
  const teamUrl = (id: number) => `/dispatch/${id}`;

  function cancelTimer(id: number) {
    timers.get(id)?.();
    timers.delete(id);
  }

  function setTimer(id: number, ms: number, fn: () => void) {
    cancelTimer(id);
    timers.set(id, schedule(() => {
      timers.delete(id);
      fn();
    }, Math.max(0, ms)));
  }

  function addDispatch(incidentId: number, teamId: number, reason: DispatchReason, km: number | null) {
    run(`INSERT INTO dispatches (help_request_id, team_id, at, reason, distance_km) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(help_request_id, team_id) DO NOTHING`, incidentId, teamId, iso(), reason, km);
  }

  /** Alarm naar eenheden (alle leden), met de afstand per eenheid. */
  function alarmTeams(row: Row, teamIds: number[], intro: string) {
    const distances = new Map(dispatchesOf(row.id as number).map((d) => [d.teamId, d.distanceKm]));
    for (const team of teams().filter((u) => teamIds.includes(u.id))) {
      const km = distances.get(team.id);
      const parts = [row.aed === 1 && team.hasAed ? 'AED meenemen' : null, summary(row), km != null ? `${formatKm(km)} km` : null];
      notify(team.members, {
        title: `${intro} · ${placeName(row)}`,
        body: `${parts.filter(Boolean).join(' · ')}. Tik om te reageren.`,
        tag: tag(row.id as number),
        url: teamUrl(row.id as number),
        urgent: true,
      });
    }
  }

  function copyToCoordinator(row: Row, body: string, urgent = false) {
    const phone = coordinator();
    if (!phone) return;
    notify([phone], { title: `EHBO-oproep · ${placeName(row)}`, body, tag: `kopie-${row.id as number}`, url: `/incident/${row.id as number}`, urgent });
  }

  /** Teams called for this one that haven't answered: not declined, not accepted. */
  const pending = (id: number) => dispatchesOf(id).filter((d) => !d.declinedAt && !d.acceptedAt).map((d) => d.teamId);
  /** Of those, the ones that can still react: a team busy with another call isn't rung for this one. */
  function invited(id: number) {
    const busy = busyTeams();
    return pending(id).filter((teamId) => (busy.get(teamId) ?? id) === id);
  }

  // ---- Escalatie ----

  function escalate(id: number, reason: string) {
    const row = incidentRow(id);
    if (row.status !== 'sent') return;
    db.transaction(() => {
      setIncident(id, { stage: 'all', escalates_at: null });
      for (const { team, km } of freeTeams(targetOf(row))) addDispatch(id, team.id, 'all', km);
      log(id, 'escalated', `${reason} → naar alle beschikbare eenheden`);
    });
    const updated = incidentRow(id);
    const targets = invited(id);
    alarmTeams(updated, targets, 'EHBO-oproep · alle eenheden');
    copyToCoordinator(updated, targets.length
      ? `${reason}. Nu naar alle beschikbare eenheden (${targets.length}).`
      : busyTeams().size
        ? 'Alle EHBO-eenheden zijn bezig. De oproep wacht op de eerste die vrij is. Kan het niet wachten? Bel zelf een eenheid of 112.'
        : 'Geen beschikbare EHBO-eenheid. Bel zelf een eenheid of 112.', targets.length === 0);
    setTimer(id, escalationMs(), () => repeat(id, 1));
    changed();
  }

  /**
   * Nobody accepted yet: ring the teams that were called again. A team that became free since gets a waiting call from offerOpenCalls,
   * one at a time; with nobody to ring the call just waits for that.
   */
  function repeat(id: number, count: number) {
    const row = incidentRow(id);
    if (row.status !== 'sent') return;
    const targets = invited(id);
    if (!targets.length) return;
    log(id, 'repeated', `Nog niemand heeft aangenomen; alarm opnieuw (${count})`);
    alarmTeams(row, targets, 'EHBO-oproep · nog niemand');
    // Bij de eerste herhaling (dus na twee keer de escalatietijd) belt de coördinator zelf.
    if (count === 1) copyToCoordinator(row, 'Nog niemand heeft de oproep aangenomen. Bel de eenheden.', true);
    if (count < MAX_REPEATS) setTimer(id, escalationMs(), () => repeat(id, count + 1));
    changed();
  }

  /**
   * These teams just became available. A call that's waiting with nobody to react to it goes to them at once, not at the next round.
   * A call that another available team still has stays with that team, and goes to everyone with the escalation as usual.
   */
  /**
   * Calls waiting because no free team can react go to teams that are free, one call per team at a time.
   * The worst first (not responsive), then the nearest. A call belongs to the nearest team on duty, busy or not; another team takes it
   * only once it waited Delen na (share_after_min), so each team keeps working its own stretch of the route. Not responsive is never kept.
   * `again`: the team just became available, so it's asked again what it declined before. Gives whether anything was offered.
   */
  function offerOpenCalls(teamIds: number[], again = false) {
    const waiting = all("SELECT * FROM incidents WHERE status = 'sent' ORDER BY id");
    if (!waiting.length) return false;
    const busy = busyTeams();
    const locationMap = locations();
    const onDuty = teams().filter((u) => u.availability === 'available');
    const free = new Set(onDuty.filter((u) => !busy.has(u.id)).map((u) => u.id));
    const lngLat = (p: { lat: number | null; lng: number | null }): [number, number] | null => (p.lat != null && p.lng != null ? [p.lng, p.lat] : null);
    // A busy team is at its call, or on its way there.
    const where = new Map(onDuty.map((u) => [u.id, busy.has(u.id) ? lngLat(targetOf(incidentRow(busy.get(u.id)!))) : teamPosition(u, locationMap)]));
    const kmTo = (teamId: number, row: Row) => {
      const [from, to] = [where.get(teamId), lngLat(targetOf(row))];
      return from && to ? distanceKm(from, to) : null;
    };
    const ownTeam = (row: Row) => nearest(onDuty.map((u) => ({ team: u, km: kmTo(u.id, row) })))?.team ?? null;
    const at = now().getTime();
    const share = shareAfterMs();
    const open = waiting.filter((row) => !invited(row.id as number).some((t) => free.has(t)));
    const offered = new Set<number>();
    for (const team of onDuty.filter((u) => teamIds.includes(u.id) && free.has(u.id))) {
      // Asked while it was busy, so not rung: that one is still its own. Otherwise one call at a time.
      const mine = waiting.filter((row) => invited(row.id as number).includes(team.id));
      if (mine.length && !again) continue;
      const choices = (mine.length ? mine : open).flatMap((row) => {
        const id = row.id as number;
        if (offered.has(id)) return [];
        if (mine.length) return [{ row, km: kmTo(team.id, row), own: null }];
        if (!again && dispatchesOf(id).some((d) => d.teamId === team.id && d.declinedAt)) return [];
        const own = ownTeam(row);
        const shared = own !== null && own.id !== team.id;
        if (shared && row.aed !== 1 && at - new Date(row.reported_at as string).getTime() < share) return [];
        return [{ row, km: kmTo(team.id, row), own: shared ? own : null }];
      }).sort((a, b) => (b.row.aed as number) - (a.row.aed as number) || (a.km ?? Infinity) - (b.km ?? Infinity) || (a.row.id as number) - (b.row.id as number));
      const pick = choices[0];
      if (!pick) continue;
      const id = pick.row.id as number;
      offered.add(id);
      if (!mine.length) db.transaction(() => {
        addDispatch(id, team.id, 'all', pick.km === null ? null : Math.round(pick.km * 10) / 10);
        // Who said "kan niet" and is available now, gets the question again.
        run('UPDATE dispatches SET declined_at = NULL WHERE help_request_id = ? AND team_id = ?', id, team.id);
        log(id, 'sent', `Naar ${team.name} gestuurd: ${pick.own ? `${pick.own.name} is nog bezig` : 'nu beschikbaar'}`, team.id);
      });
      alarmTeams(pick.row, [team.id], 'EHBO-oproep');
      if (!timers.has(id)) setTimer(id, escalationMs(), () => repeat(id, 2));
    }
    return offered.size > 0;
  }

  /** A team took a call: what it was asked as well and nobody else can answer now goes on at once, instead of after the escalation time. */
  function nowBusy(team: Team) {
    for (const r of all(`SELECT d.help_request_id AS id FROM dispatches d JOIN incidents i ON i.id = d.help_request_id
                         WHERE d.team_id = ? AND i.status = 'sent' AND i.stage = 'nearest' AND d.accepted_at IS NULL AND d.declined_at IS NULL`, team.id)) {
      if (invited(r.id as number).length) continue;
      cancelTimer(r.id as number);
      escalate(r.id as number, `${team.name} is bezig met een andere oproep`);
    }
  }

  // ---- Rechten ----

  const isCoordinator = (me: Me) => coordinator() === me.phone;
  const memberOf = (me: Me, teamId: number) => me.assignments.some((a) => a.kind === 'team' && a.teamId === teamId);
  const atLocation = (me: Me, locationId: number) => me.assignments.some((a) => a.kind === 'location' && a.locationId === locationId);

  /** The post, who asked for help, the coordinator or an admin. */
  const canFollow = (me: Me, row: Row) => atLocation(me, row.location_id as number) || row.reported_by === me.phone || me.isAdmin || isCoordinator(me);

  function requireTeamMember(me: Me, teamId: number) {
    if (!memberOf(me, teamId) && !me.isAdmin) throw httpError(403, 'Je hoort niet bij deze EHBO-eenheid');
    const team = teamById(teamId);
    if (!team) throw httpError(404, 'EHBO-eenheid niet gevonden');
    return team;
  }

  /** De eenheid van deze medewerker die de oproep heeft aangenomen. */
  function acceptedTeamOf(me: Me, id: number) {
    const accepted = dispatchesOf(id).filter((d) => d.acceptedAt);
    const teamId = accepted.find((d) => memberOf(me, d.teamId))?.teamId ?? (me.isAdmin ? accepted[0]?.teamId : undefined);
    if (teamId === undefined) throw httpError(403, 'Alleen de eenheid die de oproep heeft aangenomen');
    return teamId;
  }

  // ---- Acties ----

  function report(me: Me, body: NewIncident): LiveIncident {
    const existing = get('SELECT id FROM incidents WHERE client_id = ?', body.clientId);
    if (existing) return incidentsOf(state()).find((i) => i.id === existing.id)!;

    // From a post, or from where you are (#102): anyone on staff, with a GPS position. That place is kept for the report;
    // within the radius of a post it counts as that post.
    const position: [number, number] | null = body.lat != null && body.lng != null ? [body.lng, body.lat] : null;
    if (body.locationId === null && !position) throw httpError(400, 'Zonder locatie is je positie nodig');
    const place = body.locationId === null && position ? placeOf([...locations().values()], position, atLocationM()) : null;
    const location = locations().get(body.locationId ?? place?.locationId ?? -1);
    if (!location) throw body.locationId === null ? httpError(409, 'Er zijn nog geen locaties met een positie') : httpError(404, 'Locatie niet gevonden');
    if (body.locationId !== null) {
      if (!atLocation(me, location.id) && !me.isAdmin && !isCoordinator(me)) throw httpError(403, 'Je kunt alleen een verzoek doen vanaf je eigen locatie');
      if (!location.isOpen && !reopenAutoClosed(location.id)) throw httpError(409, 'Deze locatie is dicht. Zet de locatie eerst open.');
    }
    const offLocation = place !== null && !place.atLocation;

    const sentAt = iso();
    // Een melding die zonder bereik is bewaard, houdt het moment van versturen; nooit in de toekomst of meer dan een uur terug.
    const reported = body.reportedAt ? new Date(body.reportedAt) : null;
    const reportedAt = reported && reported <= now() && now().getTime() - reported.getTime() < 3600_000 ? reported.toISOString() : sentAt;
    const aed = body.responsive === 'no';

    const candidates = freeTeams(offLocation ? { lat: position![1], lng: position![0] } : location);
    const first = nearest(candidates);
    const aedTeam = aed ? nearest(candidates.filter((c) => c.team.hasAed)) : undefined;
    const escalatesAt = first ? new Date(now().getTime() + escalationMs()).toISOString() : null;

    const id = db.transaction(() => {
      const incidentId = insertIncident(body.type, {
        client_id: body.clientId, location_id: location.id, reported_by: me.phone, what: body.what, persons: body.persons, responsive: body.responsive,
        note: body.note?.trim() || null, aed: aed ? 1 : 0, status: 'sent', stage: 'nearest', reported_at: reportedAt, sent_at: sentAt, escalates_at: escalatesAt,
        is_test: db.testMode() ? 1 : 0, place_name: offLocation ? place.name : null, place_lat: offLocation ? position![1] : null, place_lng: offLocation ? position![0] : null,
        place_accuracy_m: place ? body.accuracyM ?? null : null,
      });
      log(incidentId, 'reported', body.locationId === null ? `Gemeld door ${personName(me.phone)} · ${offLocation ? place.name : location.name}` : `Gemeld door ${location.name}`);
      if (first) {
        addDispatch(incidentId, first.team.id, 'nearest', first.km);
        if (aedTeam && aedTeam.team.id !== first.team.id) addDispatch(incidentId, aedTeam.team.id, 'aed', aedTeam.km);
        const names = [`${first.team.name} (dichtstbij)`];
        if (aedTeam && aedTeam.team.id !== first.team.id) names.push(`${aedTeam.team.name} (AED)`);
        log(incidentId, 'sent', `Naar ${names.join(' en ')} gestuurd + evenementcoördinator`);
      }
      return incidentId;
    });

    if (first) {
      const row = incidentRow(id);
      alarmTeams(row, invited(id), 'EHBO-oproep');
      copyToCoordinator(row, `${summary(row)}. Naar ${teams().filter((u) => invited(id).includes(u.id)).map((u) => u.name).join(' en ')}.`);
      setTimer(id, escalationMs(), () => escalate(id, `Geen reactie binnen ${escalationMs() / 1000} s`));
      changed();
    } else {
      // Geen beschikbare eenheid met bekende positie: meteen naar iedereen die vrij is.
      escalate(id, 'Geen beschikbare eenheid in de buurt bekend');
    }
    return incidentsOf(state()).find((i) => i.id === id)!;
  }

  /**
   * Started by the team itself: no call. Someone came to it, so it's on site at once; or it heard of it and still has to go there (`enRoute`),
   * then it's accepted and the team taps on site when it arrives. Only a person who isn't responsive still brings an AED.
   */
  function selfStart(me: Me, body: NewSelfIncident): LiveIncident {
    const existing = get('SELECT id FROM incidents WHERE client_id = ?', body.clientId);
    if (existing) return incidentsOf(state()).find((i) => i.id === existing.id)!;
    const team = requireTeamMember(me, body.teamId);
    if (busyTeams().has(team.id)) throw httpError(409, `${team.name} is al bezig met een andere oproep`);

    const locationMap = locations();
    const position: [number, number] | null = body.lat !== null && body.lng !== null ? [body.lng, body.lat] : null;
    const place = position ? placeOf([...locationMap.values()], position, atLocationM()) : null;
    const location = locationMap.get(place?.locationId ?? body.locationId);
    if (!location) throw httpError(404, 'Locatie niet gevonden');
    const offLocation = place !== null && !place.atLocation;
    const at = stamp();
    const aed = body.responsive === 'no';
    const enRoute = body.enRoute && !position;

    const id = db.transaction(() => {
      const incidentId = insertIncident('first_aid', {
        client_id: body.clientId, location_id: location.id, reported_by: me.phone, what: body.what, persons: body.persons, responsive: body.responsive,
        note: body.note?.trim() || null, aed: aed ? 1 : 0, status: enRoute ? 'accepted' : 'on_site', stage: 'nearest', reported_at: at, sent_at: at,
        team_id: team.id, accepted_by: me.phone, accepted_at: at, on_site_at: enRoute ? null : at, is_test: db.testMode() ? 1 : 0, self_started: 1,
        place_name: offLocation ? place.name : null, place_lat: offLocation ? position![1] : null, place_lng: offLocation ? position![0] : null,
      });
      addDispatch(incidentId, team.id, 'manual', 0);
      run('UPDATE dispatches SET accepted_at = ? WHERE help_request_id = ? AND team_id = ?', at, incidentId, team.id);
      run("UPDATE teams SET availability = 'available', stay_location_id = NULL WHERE id = ?", team.id);
      log(incidentId, 'reported', `Zelf gestart door ${team.name} · ${offLocation ? place.name : location.name}${enRoute ? ' · onderweg' : ''}`, team.id);
      return incidentId;
    });

    const row = incidentRow(id);
    if (aed && !team.hasAed) {
      const aedTeam = nearest(freeTeams(targetOf(row)).filter((c) => c.team.hasAed && c.team.id !== team.id));
      if (aedTeam) {
        addDispatch(id, aedTeam.team.id, 'aed', aedTeam.km);
        log(id, 'sent', `Naar ${aedTeam.team.name} (AED) gestuurd`, aedTeam.team.id);
        alarmTeams(row, [aedTeam.team.id], 'EHBO-oproep · AED nodig');
      }
    }
    copyToCoordinator(row, `${team.name} is zelf een incident gestart: ${summary(row)}${offLocation ? `, ${place.name}` : ''}${enRoute ? `, onderweg naar ${location.name}` : ''}.`);
    nowBusy(team);
    changed();
    return incidentsOf(state()).find((i) => i.id === id)!;
  }

  /** What an addition changes, in words for a push. Never the note itself: that doesn't belong on a lock screen. */
  function changes(row: Row, details: IncidentDetails, note: string | null) {
    const list: string[] = [];
    if (details.what !== row.what) list.push(details.what ? INCIDENT_WHAT[details.what] : 'Wat er is: weggehaald');
    if (details.persons !== row.persons) list.push(details.persons ? PERSONS_TEXT[details.persons] : 'Aantal personen: weggehaald');
    if (details.responsive !== row.responsive) {
      list.push(details.responsive === 'no' ? 'Niet aanspreekbaar' : details.responsive === 'yes' ? 'Aanspreekbaar' : 'Aanspreekbaar: weet niet');
    }
    if (note !== row.note) list.push(!row.note ? 'Notitie toegevoegd' : note ? 'Notitie gewijzigd' : 'Notitie weggehaald');
    return list;
  }

  function update(me: Me, id: number, details: IncidentDetails) {
    const row = incidentRow(id);
    if (!canFollow(me, row)) throw httpError(403, 'Alleen de locatie of wie de melding deed, kan hem aanvullen');
    if (!['sent', 'accepted', 'on_site'].includes(row.status as string)) throw httpError(409, 'Deze melding is al afgesloten');
    const note = details.note?.trim() || null;
    const differences = changes(row, details, note);
    // Sent again without a change (say from the queue): nothing to log, and no alert.
    if (!differences.length) return state();
    const becameAed = row.aed !== 1 && details.responsive === 'no';
    db.transaction(() => {
      setIncident(id, { what: details.what, persons: details.persons, responsive: details.responsive, note, aed: row.aed === 1 || becameAed ? 1 : 0 });
      log(id, 'added', `Aangevuld: ${differences.join(', ').toLowerCase()}`);
    });
    const updated = incidentRow(id);
    // Niet aanspreekbaar geworden: de dichtstbijzijnde beschikbare AED-eenheid alsnog oproepen, als er nog geen AED komt.
    if (becameAed) {
      const comingWithAed = dispatchesOf(id).some((d) => !d.declinedAt && teamById(d.teamId)?.hasAed);
      const aedTeam = comingWithAed ? undefined : nearest(freeTeams(targetOf(updated)).filter((c) => c.team.hasAed));
      if (aedTeam) {
        addDispatch(id, aedTeam.team.id, 'aed', aedTeam.km);
        log(id, 'sent', `Naar ${aedTeam.team.name} (AED) gestuurd`, aedTeam.team.id);
        alarmTeams(updated, [aedTeam.team.id], 'EHBO-oproep · AED nodig');
      }
    }
    const accepted = dispatchesOf(id).filter((d) => d.acceptedAt).map((d) => d.teamId);
    // The app plays its own short sound when it's in view; the push then stays silent (quietInApp).
    for (const team of teams().filter((u) => accepted.includes(u.id))) {
      notify(team.members, { title: `Melding aangevuld · ${placeName(updated)}`, body: differences.join(' · '), tag: `aangevuld-${id}`, url: teamUrl(id), quietInApp: true });
    }
    changed();
    return state();
  }

  /** Accepteren door een eenheid, of toewijzen door de coördinator (by = null). */
  function take(id: number, team: Team, by: Me, manual: boolean) {
    const row = incidentRow(id);
    const open = ['sent', 'accepted', 'on_site'].includes(row.status as string);
    if (!open) throw httpError(409, row.status === 'withdrawn' ? 'De melding is ingetrokken' : 'Deze melding is al afgerond');
    const busy = busyTeams().get(team.id);
    if (busy !== undefined && busy !== id) throw httpError(409, `${team.name} is al bezig met een andere oproep`);
    const dispatches = dispatchesOf(id);
    if (dispatches.some((d) => d.teamId === team.id && d.acceptedAt)) return state();

    // Al aangenomen: alleen nog een eenheid met AED als die nodig is en nog niet komt, of een toewijzing door de coördinator.
    const acceptedTeams = dispatches.filter((d) => d.acceptedAt).map((d) => teamById(d.teamId));
    const aedStillNeeded = row.aed === 1 && team.hasAed && !acceptedTeams.some((u) => u?.hasAed);
    if (row.status !== 'sent' && !manual && !aedStillNeeded) {
      throw httpError(409, `Oproep is al aangenomen door ${acceptedTeams[0]?.name ?? 'een andere eenheid'}`);
    }

    const at = stamp();
    const location = locations().get(row.location_id as number)!;
    db.transaction(() => {
      const km = freeTeams(targetOf(row)).find((c) => c.team.id === team.id)?.km ?? null;
      addDispatch(id, team.id, manual ? 'manual' : 'all', km);
      run('UPDATE dispatches SET accepted_at = ?, declined_at = NULL WHERE help_request_id = ? AND team_id = ?', at, id, team.id);
      // Wie aanneemt, is in dienst; een vaste eenheid gaat na afloop terug naar haar eigen post.
      run("UPDATE teams SET availability = 'available', stay_location_id = NULL WHERE id = ?", team.id);
      if (row.status === 'sent') {
        setIncident(id, { status: 'accepted', team_id: team.id, accepted_by: manual ? null : by.phone, accepted_at: at, escalates_at: null });
      }
      log(id, manual ? 'assigned' : 'accepted',
        manual ? `Toegewezen aan ${team.name} door ${personName(by.phone)}` : `Geaccepteerd door ${team.name} (${personName(by.phone)})`, team.id);
    });
    cancelTimer(id);

    const updated = incidentRow(id);
    const helper = manual ? team.name : `${team.name} (${personName(by.phone)})`;
    if (manual) {
      notify(team.members, { title: `Ingezet · ${placeName(row)}`, body: `${summary(updated)}. De coördinator heeft jullie gestuurd.`, tag: tag(id), url: teamUrl(id), urgent: true });
    }
    // Anderen hoeven niet meer te komen, behalve een AED-eenheid zolang er nog geen AED onderweg is.
    const aedComing = row.aed !== 1 || dispatchesOf(id).some((d) => d.acceptedAt && teamById(d.teamId)?.hasAed);
    const released = pending(id).filter((teamId) => aedComing || !teamById(teamId)?.hasAed);
    for (const other of teams().filter((u) => released.includes(u.id))) {
      notify(other.members, { title: 'Oproep is al aangenomen', body: `${team.name} gaat naar ${placeName(row)}. Je hoeft niet te komen.`, tag: tag(id), url: teamUrl(id) });
    }
    notify(followers(row), { title: 'Hulp is onderweg', body: `${helper} komt eraan.`, tag: `melding-${id}`, url: `/incident/${id}` });
    copyToCoordinator(updated, `${manual ? 'Toegewezen aan' : 'Aangenomen door'} ${helper}.`);
    nowBusy(team);
    changed();
    return state();
  }

  function accept(me: Me, id: number, teamId: number) {
    return take(id, requireTeamMember(me, teamId), me, false);
  }

  function assign(me: Me, id: number, teamId: number) {
    if (!isCoordinator(me) && !me.isAdmin) throw httpError(403, 'Alleen de evenementcoördinator kan een oproep toewijzen');
    const team = teamById(teamId);
    if (!team) throw httpError(404, 'EHBO-eenheid niet gevonden');
    return take(id, team, me, true);
  }

  function decline(me: Me, id: number, teamId: number) {
    const team = requireTeamMember(me, teamId);
    const row = incidentRow(id);
    if (row.status !== 'sent') return state();
    db.transaction(() => {
      run(`INSERT INTO dispatches (help_request_id, team_id, at, reason, declined_at) VALUES (?, ?, ?, 'all', ?)
           ON CONFLICT(help_request_id, team_id) DO UPDATE SET declined_at = excluded.declined_at`, id, team.id, stamp(), stamp());
      log(id, 'declined', `${team.name}: kan niet`, team.id);
    });
    if (row.stage === 'nearest') {
      cancelTimer(id);
      escalate(id, `${team.name} kan niet`);
    }
    // Free to take another one that's waiting.
    offerOpenCalls([team.id]);
    changed();
    return state();
  }

  function onSite(me: Me, id: number) {
    const row = incidentRow(id);
    const teamId = acceptedTeamOf(me, id);
    if (row.status !== 'accepted' && row.status !== 'on_site') throw httpError(409, 'Deze melding is niet meer open');
    const team = teamById(teamId)!;
    db.transaction(() => {
      if (row.status === 'accepted') setIncident(id, { status: 'on_site', on_site_at: stamp() });
      log(id, 'on_site', `${team.name} is ter plaatse`, teamId);
    });
    copyToCoordinator(incidentRow(id), `${team.name} is ter plaatse.`);
    changed();
    return state();
  }

  function close(me: Me, id: number, body: CloseIncident) {
    const row = incidentRow(id);
    const teamId = acceptedTeamOf(me, id);
    if (row.status !== 'accepted' && row.status !== 'on_site') throw httpError(409, 'Deze melding is niet meer open');
    const team = teamById(teamId)!;
    db.transaction(() => {
      setIncident(id, { status: 'closed', closed_at: stamp(), outcome: body.outcome, outcome_persons: body.persons, outcome_note: body.note?.trim() || null, on_site_at: row.on_site_at ?? stamp() });
      // Alleen een vaste eenheid "blijft hier"; een mobiele eenheid geeft haar positie zelf door.
      const stay = body.stayHere && team.kind === 'fixed' && row.location_id !== team.locationId ? (row.location_id as number) : null;
      run('UPDATE teams SET stay_location_id = ? WHERE id = ?', stay, teamId);
      // The status afterwards in the same step, so no call comes in between.
      const then = body.then ?? team.nextAvailability ?? 'available';
      run('UPDATE teams SET next_availability = ? WHERE id = ?', then === 'available' ? null : then, teamId);
      afterCalls();
      log(id, 'closed', `Afgerond door ${team.name}${AFTER_CALL[then]}`, teamId);
    });
    copyToCoordinator(incidentRow(id), `Afgerond door ${team.name}.`);
    offerOpenCalls([teamId], true);
    changed();
    return state();
  }

  function withdraw(me: Me, id: number) {
    const row = incidentRow(id);
    if (!canFollow(me, row)) throw httpError(403, 'Alleen de locatie of wie de melding deed, kan hem intrekken');
    if (!['sent', 'accepted', 'on_site'].includes(row.status as string)) return state();
    const location = locations().get(row.location_id as number)!;
    db.transaction(() => {
      setIncident(id, { status: 'withdrawn', closed_at: stamp(), escalates_at: null });
      log(id, 'withdrawn', `Ingetrokken door ${personName(me.phone)}`);
      afterCalls();
    });
    cancelTimer(id);
    const reached = dispatchesOf(id).filter((d) => !d.declinedAt).map((d) => d.teamId);
    for (const team of teams().filter((u) => reached.includes(u.id))) {
      notify(team.members, { title: 'Melding ingetrokken', body: `${placeName(row)}: geen hulp meer nodig.`, tag: tag(id), url: teamUrl(id) });
    }
    copyToCoordinator(row, `Ingetrokken door ${row.place_name ? personName(me.phone) : location.name}.`);
    // The team that was on its way is free for what's waiting.
    offerOpenCalls(dispatchesOf(id).filter((d) => d.acceptedAt).map((d) => d.teamId), true);
    changed();
    return state();
  }

  /** Puts a team on this status, with what comes with it. Inside a transaction. */
  function putAvailability(team: Team, availability: TeamAvailability) {
    run('UPDATE teams SET availability = ?, next_availability = NULL WHERE id = ?', availability, team.id);
    // Fixed team: on duty and its own EHBO post open are the same (design doc, "Post open of dicht"), as long as no other shift is still there.
    // Not available is still on duty, so the post is open, only not free.
    if (team.kind === 'fixed' && team.locationId !== null && availability !== 'off_duty') setLocation(team.locationId, true);
    if (team.kind === 'fixed' && team.locationId !== null && availability === 'off_duty' && !otherShiftOnDuty(team)) setLocation(team.locationId, false);
    if (availability === 'off_duty') {
      run('UPDATE teams SET stay_location_id = NULL, keep_until = NULL, closes_at = NULL WHERE id = ?', team.id);
      forgetPositions(team);
    } else if (team.availability === 'off_duty') {
      run('UPDATE teams SET keep_until = ?, closes_at = NULL WHERE id = ?', keepAfterOpening(planOf(team)), team.id);
    }
  }

  /** Teams whose call is over carry out the status they picked during it. Inside a transaction. */
  function afterCalls() {
    const busy = busyTeams();
    for (const team of teams().filter((u) => u.nextAvailability && !busy.has(u.id))) putAvailability(team, team.nextAvailability!);
  }

  function setAvailability(me: Me, teamId: number, availability: TeamAvailability) {
    const team = requireTeamMember(me, teamId);
    // During a call the team is there but busy: the status it picks waits until the call is over.
    if (busyTeams().has(team.id)) {
      run('UPDATE teams SET next_availability = ? WHERE id = ?', availability === 'available' ? null : availability, team.id);
      changed();
      return state();
    }
    db.transaction(() => putAvailability(team, availability));
    if (availability === 'available') offerOpenCalls([team.id], true);
    changed();
    return state();
  }

  /** Sharing belongs to a person (#101), but only when there's a reason: being on a mobile team on duty. Nobody else is tracked. */
  function setPosition(me: Me, position: { lat: number; lng: number }) {
    if (!teams().some((u) => u.kind === 'mobile' && u.availability !== 'off_duty' && u.members.includes(me.phone))) {
      throw httpError(409, 'Alleen een mobiele EHBO-eenheid in dienst deelt haar positie');
    }
    positions.set(me.phone, { lat: position.lat, lng: position.lng, at: now().getTime() });
    // Iedereen ziet de mobiele eenheid op de kaart meebewegen.
    changed();
  }

  function setLocationOpen(me: Me, locationId: number, open: boolean) {
    const location = locations().get(locationId);
    if (!location) throw httpError(404, 'Locatie niet gevonden');
    if (!location.staffed) throw httpError(409, 'Op deze locatie staat niemand: hij gaat niet open of dicht');
    const lead = me.assignments.some((a) => a.kind === 'location' && a.locationId === locationId && a.role === 'lead');
    const ownEhboLocation = location.isEhbo && teams().some((u) => u.kind === 'fixed' && u.locationId === locationId && memberOf(me, u.id));
    if (!lead && !ownEhboLocation && !me.isAdmin) throw httpError(403, 'Alleen de locatieverantwoordelijke kan de locatie open of dicht zetten');
    const fixed = teams().filter((u) => u.kind === 'fixed' && u.locationId === locationId);
    // Openen: je eigen eenheid, als je daarbij hoort; een andere dienst op dezelfde post blijft zoals hij is.
    // On a location with more than EHBO (#83), someone else opening or closing it doesn't make the team available or take it off duty.
    const mine = fixed.filter((u) => memberOf(me, u.id));
    const affected = mine.length ? (open ? mine : fixed) : location.onlyEhbo ? fixed : [];
    db.transaction(() => {
      setLocation(locationId, open);
      // Een vaste eenheid op deze EHBO-post gaat mee in dienst of uit dienst.
      for (const team of affected) {
        if (team.availability !== 'unavailable') run('UPDATE teams SET availability = ? WHERE id = ?', open ? 'available' : 'off_duty', team.id);
      }
    });
    if (open) offerOpenCalls(affected.map((u) => u.id), true);
    changed();
    return state();
  }

  // ---- Sluiten op tijd (functioneel ontwerp, "Openen en sluiten") ----
  // Op de geplande tijd, nooit op "geen verbinding": een telefoon in je zak heeft die ook niet. Altijd eerst een waarschuwing,
  // en nooit tijdens een open melding of aanvraag.

  const eventDates = () => {
    const row = get('SELECT start_date, end_date FROM event WHERE id = 1')!;
    return { startDate: row.start_date as string | null, endDate: row.end_date as string | null };
  };
  const clockText = (at: number) => new Date(at).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Amsterdam' });
  const locationPlan = (locationId: number | null) => (locationId === null ? null : locations().get(locationId)?.timeTo ?? null);
  /** A fixed team without its own end time follows its post. */
  const planOf = (team: Team) => team.timeTo ?? (team.kind === 'fixed' ? locationPlan(team.locationId) : null);

  /** Opened again around or after the planned end: don't close it straight away. */
  function keepAfterOpening(timeTo: string | null) {
    const planned = plannedClose({ timeTo }, eventDates(), now().getTime());
    const late = planned !== null && now().getTime() >= planned - CLOSE_WARNING_MIN * 60_000;
    return late ? new Date(now().getTime() + KEEP_OPEN_MIN * 60_000).toISOString() : null;
  }

  function setLocation(locationId: number, open: boolean) {
    run('UPDATE locations SET is_open = ?, keep_until = ?, closes_at = NULL, auto_closed_at = NULL WHERE id = ?', open ? 1 : 0, open ? keepAfterOpening(locationPlan(locationId)) : null, locationId);
  }

  const otherShiftOnDuty = (team: Team) => teams().some((u) => u.id !== team.id && u.kind === 'fixed' && u.locationId === team.locationId && u.availability !== 'off_duty');

  /** A phone without signal didn't see its post close by time: what it asks for still counts, and the post is open again. */
  function reopenAutoClosed(locationId: number) {
    if (!locations().get(locationId)?.autoClosedAt) return false;
    setLocation(locationId, true);
    return true;
  }

  function closeTeamAuto(team: Team) {
    takeOffDuty(team);
    if (team.kind === 'fixed' && team.locationId !== null && !otherShiftOnDuty(team)) {
      run('UPDATE locations SET is_open = 0, keep_until = NULL, closes_at = NULL, auto_closed_at = ? WHERE id = ?', iso(), team.locationId);
    }
  }

  /** What to do with something open now. */
  function nextStep(item: { keepUntil: string | null; closesAt: string | null }, timeTo: string | null, inUse: boolean, at: number) {
    if (inUse) return item.closesAt ? 'clear' : null;
    if (item.closesAt) return at >= new Date(item.closesAt).getTime() ? 'close' : null;
    const deadline = Math.max(plannedClose({ timeTo }, eventDates(), at) ?? 0, item.keepUntil ? new Date(item.keepUntil).getTime() : 0);
    return deadline && at >= deadline - CLOSE_WARNING_MIN * 60_000 ? new Date(Math.max(deadline, at + CLOSE_WARNING_MIN * 60_000)) : null;
  }

  /** Every minute. */
  function sweep() {
    const at = now().getTime();
    const locationMap = locations();
    const allTeams = teams();
    const busy = busyTeams();
    const fixedLocations = new Set(allTeams.filter((u) => u.kind === 'fixed').map((u) => u.locationId));
    const inUseLocations = new Set(all(`SELECT location_id FROM incidents WHERE status IN ('sent', 'accepted', 'on_site')
                                    UNION SELECT location_id FROM queue_requests WHERE status IN ('sent', 'accepted')`).map((r) => r.location_id as number));
    const closed: string[] = [];
    let touched = sweepLeft();

    for (const team of allTeams.filter((u) => u.availability !== 'off_duty')) {
      const step = nextStep(team, planOf(team), busy.has(team.id), at);
      if (!step) continue;
      touched = true;
      if (step === 'clear') {
        run('UPDATE teams SET closes_at = NULL WHERE id = ?', team.id);
      } else if (step === 'close') {
        db.transaction(() => closeTeamAuto(team));
        closed.push(team.name);
        notify(team.members, { title: 'Je bent uit dienst gezet', body: 'Je dienst is voorbij. Nog bezig? Zet jezelf weer op Beschikbaar.', tag: `dienst-${team.id}`, url: '/first-aid' });
      } else {
        run('UPDATE teams SET closes_at = ? WHERE id = ?', step.toISOString(), team.id);
        notify(team.members, { title: `Je dienst stopt om ${clockText(step.getTime())}`, body: 'Nog nodig? Tik om in dienst te blijven.', tag: `dienst-${team.id}`, url: '/first-aid' });
      }
    }
    for (const location of [...locationMap.values()].filter((p) => p.isOpen && !fixedLocations.has(p.id))) {
      const step = nextStep(location, location.timeTo, inUseLocations.has(location.id), at);
      if (!step) continue;
      touched = true;
      if (step === 'clear') {
        run('UPDATE locations SET closes_at = NULL WHERE id = ?', location.id);
      } else if (step === 'close') {
        run('UPDATE locations SET is_open = 0, keep_until = NULL, closes_at = NULL, auto_closed_at = ? WHERE id = ?', iso(), location.id);
        closed.push(location.name);
        notify(locationPhones(location.id), { title: `${location.name} is gesloten`, body: 'De geplande tijd is voorbij. Nog bezig? Je kunt de locatie altijd weer openen.', tag: `post-${location.id}`, url: `/location/${location.id}/start` });
      } else {
        run('UPDATE locations SET closes_at = ? WHERE id = ?', step.toISOString(), location.id);
        notify(locationPhones(location.id), { title: `${location.name} sluit om ${clockText(step.getTime())}`, body: 'Nog nodig? Tik om de locatie open te houden.', tag: `post-${location.id}`, url: `/location/${location.id}/start` });
      }
    }
    const phone = coordinator();
    if (closed.length && phone) notify([phone], { title: 'Automatisch gesloten', body: closed.join(', '), tag: 'gesloten', url: '/control' });
    // A waiting call that has waited Delen na can go to a free team elsewhere now.
    if (offerOpenCalls(teams().map((u) => u.id))) touched = true;
    if (touched) changed();
  }

  function keepLocation(me: Me, locationId: number) {
    const location = locations().get(locationId);
    if (!location) throw httpError(404, 'Locatie niet gevonden');
    const lead = me.assignments.some((a) => a.kind === 'location' && a.locationId === locationId && a.role === 'lead');
    if (!lead && !isLead(me)) throw httpError(403, 'Alleen de locatieverantwoordelijke of de coördinator kan de locatie open houden');
    const until = new Date(now().getTime() + KEEP_OPEN_MIN * 60_000).toISOString();
    run('UPDATE locations SET is_open = 1, keep_until = ?, closes_at = NULL, auto_closed_at = NULL WHERE id = ?', until, locationId);
    changed();
    return state();
  }

  function keepTeam(me: Me, teamId: number) {
    const team = teamById(teamId);
    if (!team) throw httpError(404, 'EHBO-eenheid niet gevonden');
    if (!memberOf(me, teamId) && !isLead(me)) throw httpError(403, 'Je hoort niet bij deze EHBO-eenheid');
    run('UPDATE teams SET keep_until = ?, closes_at = NULL WHERE id = ?', new Date(now().getTime() + KEEP_OPEN_MIN * 60_000).toISOString(), teamId);
    changed();
    return state();
  }

  // ---- Voor de coördinator: alles tegelijk, en wie er nog contact heeft ----

  const isLead = (me: Me) => isCoordinator(me) || me.isAdmin;
  function requireLead(me: Me) {
    if (!isLead(me)) throw httpError(403, 'Alleen de evenementcoördinator of een beheerder');
  }

  /** Who hasn't been in touch: the last contact per open post and per team on duty. Only to look at; see QUIET_AFTER_MIN. */
  function lastSeen(me: Me): LastSeen {
    requireLead(me);
    const seen = new Map(all('SELECT phone, MAX(last_seen_at) AS at FROM sessions GROUP BY phone').map((r) => [r.phone as string, `${(r.at as string).replace(' ', 'T')}Z`]));
    const latest = (phones: string[]) => phones.map((p) => seen.get(p)).filter((t) => t !== undefined).sort().at(-1) ?? null;
    const result: LastSeen = { locations: {}, teams: {} };
    for (const location of locations().values()) if (location.isOpen) result.locations[location.id] = latest(locationPhones(location.id));
    for (const team of teams()) if (team.availability !== 'off_duty') result.teams[team.id] = latest(team.members);
    return result;
  }

  function openAll(me: Me): ControlResult {
    requireLead(me);
    // Nobody logged in can't receive a call or a question, so that stays closed and is named.
    const present = db.loggedIn();
    const allTeams = teams();
    const here = (people: string[]) => people.some((p) => present.has(p));
    const closedLocations = [...locations().values()].filter((p) => !p.isOpen && p.staffed);
    const off = allTeams.filter((u) => u.availability === 'off_duty');
    const openLocations = closedLocations.filter((p) => here(locationPeople(p.id, allTeams)));
    const onDuty = off.filter((u) => here(u.members));
    const skipped = [...closedLocations.filter((p) => !openLocations.includes(p)).map((p) => p.name), ...off.filter((u) => !onDuty.includes(u)).map((u) => u.name)];
    db.transaction(() => {
      for (const location of openLocations) setLocation(location.id, true);
      for (const team of onDuty) run("UPDATE teams SET availability = 'available', keep_until = ?, closes_at = NULL WHERE id = ?", keepAfterOpening(planOf(team)), team.id);
    });
    for (const location of openLocations) notify(locationPhones(location.id), { title: `${location.name} is geopend`, body: 'De coördinator heeft je locatie geopend.', tag: `post-${location.id}`, url: `/location/${location.id}/start` });
    offerOpenCalls(onDuty.map((u) => u.id), true);
    for (const team of onDuty) notify(team.members, { title: 'Je staat op Beschikbaar', body: 'De coördinator heeft je op Beschikbaar gezet.', tag: `dienst-${team.id}`, url: '/first-aid' });
    changed();
    return { state: state(), skipped };
  }

  /** Everything except what's in the middle of a call: that says so instead. */
  function closeEverything(): ControlResult {
    const busy = busyTeams();
    const openLocations = new Set(all("SELECT location_id FROM incidents WHERE status IN ('sent', 'accepted', 'on_site')").map((r) => r.location_id as number));
    const skipped = [...teams().filter((u) => busy.has(u.id)).map((u) => u.name), ...[...locations().values()].filter((p) => openLocations.has(p.id)).map((p) => p.name)];
    db.transaction(() => {
      for (const location of locations().values()) if (!openLocations.has(location.id)) setLocation(location.id, false);
      for (const team of teams()) {
        if (!busy.has(team.id)) takeOffDuty(team);
      }
    });
    return { state: state(), skipped };
  }

  function closeAll(me: Me) {
    requireLead(me);
    const result = closeEverything();
    changed();
    return result;
  }

  function closeDay(me: Me, finishRequests: () => void) {
    requireLead(me);
    const open = all("SELECT location_id, reported_at FROM incidents WHERE status IN ('sent', 'accepted', 'on_site') ORDER BY id");
    const locationMap = locations();
    if (open.length) {
      throw httpError(409, `Eerst afronden: ${open.map((i) => `${locationMap.get(i.location_id as number)?.name}, ${clockText(new Date(i.reported_at as string).getTime())}`).join('; ')}`);
    }
    finishRequests();
    const everyone = new Set(all('SELECT phone FROM location_contacts UNION SELECT phone FROM team_members').map((r) => r.phone as string));
    const result = closeEverything();
    notify(everyone, { title: 'Dag gesloten', body: 'Alle locaties zijn dicht. Tot morgen.', tag: 'dag-gesloten', url: '/' });
    changed();
    return result;
  }

  // ---- Logged in or not (functioneel ontwerp, "Openen en sluiten") ----
  // A post or team with nobody logged in is closed: when the last one logs out, and as the first one logs in.
  // Logging out is something a person does, so this is no "closing on lost connection".

  /** Everyone who counts as being at a post: its contacts, and at an EHBO post the members of its fixed teams. */
  function locationPeople(locationId: number, allTeams = teams()) {
    return [...locationPhones(locationId), ...allTeams.filter((u) => u.kind === 'fixed' && u.locationId === locationId).flatMap((u) => u.members)];
  }

  /** Locations and teams of these people that nobody is logged in for. */
  function unattended(phones: Iterable<string>) {
    const present = db.loggedIn();
    const concerned = new Set(phones);
    const allTeams = teams();
    const nobody = (people: string[]) => people.some((p) => concerned.has(p)) && !people.some((p) => present.has(p));
    return { locations: [...locations().values()].filter((p) => nobody(locationPeople(p.id, allTeams))), teams: allTeams.filter((u) => nobody(u.members)) };
  }

  function takeOffDuty(team: Team) {
    run("UPDATE teams SET availability = 'off_duty', stay_location_id = NULL, keep_until = NULL, closes_at = NULL WHERE id = ?", team.id);
    forgetPositions(team);
  }

  /** Closes what nobody is logged in for; a team in the middle of a call waits until it's over. Gives the names of what closed. */
  function closeUnattended(phones: Iterable<string>) {
    const { locations: empty, teams: idle } = unattended(phones);
    const busy = busyTeams();
    const closed: string[] = [];
    db.transaction(() => {
      for (const location of empty.filter((p) => p.isOpen)) {
        setLocation(location.id, false);
        closed.push(location.name);
      }
      for (const team of idle.filter((u) => u.availability !== 'off_duty')) {
        if (busy.has(team.id)) {
          leftDuringCall.add(team.id);
          continue;
        }
        takeOffDuty(team);
        closed.push(team.name);
      }
    });
    return closed;
  }

  /** These people logged out, or their sessions ended. */
  function leave(phones: Iterable<string>) {
    const closed = closeUnattended(phones);
    if (!closed.length) return;
    const phone = coordinator();
    if (phone) notify([phone], { title: 'Gesloten: niemand meer aangemeld', body: closed.join(', '), tag: 'afgemeld', url: '/control' });
    changed();
  }

  /** Just before this person logs in: who is first at a post or team finds it closed, whatever it said, so the start is always the same. */
  function arrive(phone: string) {
    if (closeUnattended([phone]).length) changed();
  }

  /** In the sweep: a team whose last member left during a call, now that the call is over. */
  function sweepLeft() {
    const busy = busyTeams();
    const present = db.loggedIn();
    let touched = false;
    for (const id of leftDuringCall) {
      if (busy.has(id)) continue;
      leftDuringCall.delete(id);
      const team = teamById(id);
      if (!team || team.availability === 'off_duty' || team.members.some((p) => present.has(p))) continue;
      takeOffDuty(team);
      touched = true;
    }
    return touched;
  }

  /** Carries out a change with the time it happened on the phone, when that time can be believed. */
  function at<T>(time: string | undefined, change: () => T): T {
    const date = time ? new Date(time) : null;
    const age = date ? now().getTime() - date.getTime() : NaN;
    happenedAt = age >= 0 && age <= ACTION_MAX_AGE_MS ? date : null;
    try {
      return change();
    } finally {
      happenedAt = null;
    }
  }

  /** A change from a phone's queue: only the first time this id arrives. The phone may send it again when the answer got lost. */
  function once(id: string | undefined, time: string | undefined, change: () => LiveState): LiveState {
    if (!id) return at(time, change);
    if (get('SELECT id FROM client_actions WHERE id = ?', id)) return state();
    const result = at(time, change);
    run('INSERT INTO client_actions (id, at) VALUES (?, ?)', id, iso());
    return result;
  }

  /** Na een herstart: lopende escalaties en herhalingen opnieuw inplannen. */
  function resume() {
    for (const row of all("SELECT id, stage, escalates_at FROM incidents WHERE status = 'sent'")) {
      const id = row.id as number;
      if (row.stage === 'nearest' && row.escalates_at) {
        setTimer(id, new Date(row.escalates_at as string).getTime() - now().getTime(), () => escalate(id, 'Geen reactie op tijd'));
      } else {
        setTimer(id, escalationMs(), () => repeat(id, 1));
      }
    }
  }

  function stop() {
    for (const cancel of timers.values()) cancel();
    timers.clear();
    listeners.clear();
  }

  /** How a help request is handled, or null when there's none with this id. */
  const handlingOf = (id: number) => (get('SELECT t.handling FROM help_requests h JOIN help_request_types t ON t.id = h.type_id WHERE h.id = ?', id)?.handling as 'dispatch' | 'queue' | undefined) ?? null;

  return {
    state,
    handlingOf,
    ehboStatus,
    subscribe(listener: (state: LiveState) => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    report, selfStart, update, accept, assign, decline, onSite, close, withdraw, setAvailability, setPosition, setLocationOpen, resume, stop, at, once, moment,
    sweep, keepLocation, keepTeam, reopenAutoClosed, lastSeen, openAll, closeAll, closeDay, leave, arrive,
    /** The live connection is a contact with the phone too. */
    seen: (sessionHash: string) => db.touchSession(sessionHash),
    /** Wijziging van buitenaf (bijv. beheer): iedereen de nieuwe stand sturen. */
    changed,
  };
}
