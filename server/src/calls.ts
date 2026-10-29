// EHBO-oproepen: wie krijgt de oproep, escalatie na de ingestelde tijd, accepteren, ter plaatse, afronden.
// Functioneel ontwerp, "Hulpoproep en escalatie". De stand staat in de database; alleen timers en GPS-posities staan in het geheugen.
import {
  INCIDENT_WHAT,
  POSITION_MAX_AGE_MS,
  distanceKm,
  formatKm,
  type CloseIncident,
  type Dispatch,
  type DispatchReason,
  type IncidentDetails,
  type IncidentEvent,
  type IncidentEventType,
  type IncidentPersons,
  type LiveIncident,
  type LiveRequest,
  type LiveState,
  type LiveUnit,
  type Me,
  type NewIncident,
  type PushPayload,
  type UnitAvailability,
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

interface Unit {
  id: number;
  name: string;
  kind: 'vast' | 'mobiel';
  postId: number | null;
  hasAed: boolean;
  availability: UnitAvailability;
  stayPostId: number | null;
  members: string[];
}

interface Post {
  id: number;
  name: string;
  lat: number | null;
  lng: number | null;
  isOpen: boolean;
  isEhbo: boolean;
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

  /** Laatste GPS-positie per mobiele eenheid; bewust niet in de database. */
  const positions = new Map<number, { lng: number; lat: number; at: number }>();
  const timers = new Map<number, () => void>();
  const listeners = new Set<(state: LiveState) => void>();
  let version = 0;

  // ---- Gegevens ----

  const escalationMs = () => (get('SELECT escalation_seconds FROM event WHERE id = 1')!.escalation_seconds as number) * 1000;
  const coordinator = () => db.coordinatorPhone();

  function units(): Unit[] {
    const members = new Map<number, string[]>();
    for (const m of all('SELECT unit_id, phone FROM ehbo_unit_members ORDER BY rowid')) {
      members.set(m.unit_id as number, [...(members.get(m.unit_id as number) ?? []), m.phone as string]);
    }
    return all('SELECT id, name, kind, post_id, has_aed, availability, stay_post_id FROM ehbo_units ORDER BY sort, id').map((u) => ({
      id: u.id as number,
      name: u.name as string,
      kind: u.kind as Unit['kind'],
      postId: u.post_id as number | null,
      hasAed: u.has_aed === 1,
      availability: u.availability as UnitAvailability,
      stayPostId: u.stay_post_id as number | null,
      members: members.get(u.id as number) ?? [],
    }));
  }

  function posts(): Map<number, Post> {
    return new Map(all(`SELECT p.id, p.name, p.lat, p.lng, p.is_open, t.key FROM posts p JOIN post_types t ON t.id = p.type_id`).map((p) => [p.id as number, {
      id: p.id as number,
      name: p.name as string,
      lat: p.lat as number | null,
      lng: p.lng as number | null,
      isOpen: p.is_open === 1,
      isEhbo: p.key === 'ehbo',
    }]));
  }

  const unitById = (id: number) => units().find((u) => u.id === id);
  const postPhones = (postId: number) => all('SELECT phone FROM post_contacts WHERE post_id = ?', postId).map((r) => r.phone as string);
  const personName = (phone: string) => (get('SELECT name FROM people WHERE phone = ?', phone)?.name as string | undefined) || phone;

  /** Eenheden die nu met een oproep bezig zijn: unit id → incident id. */
  function busyUnits() {
    return new Map(all(`SELECT d.unit_id, d.incident_id FROM incident_dispatches d JOIN incidents i ON i.id = d.incident_id
                        WHERE d.accepted_at IS NOT NULL AND i.status IN ('geaccepteerd', 'ter_plaatse')`)
      .map((r) => [r.unit_id as number, r.incident_id as number]));
  }

  /** Waar een eenheid nu is: vast = eigen post (of waar ze bleef), mobiel = recente GPS, anders de standplaats. */
  function unitPosition(unit: Unit, postMap: Map<number, Post>): [number, number] | null {
    if (unit.kind === 'mobiel') {
      const fix = positions.get(unit.id);
      if (fix && now().getTime() - fix.at <= POSITION_MAX_AGE_MS) return [fix.lng, fix.lat];
    }
    const post = postMap.get((unit.kind === 'vast' ? unit.stayPostId : null) ?? unit.postId ?? -1);
    return post?.lat != null && post.lng != null ? [post.lng, post.lat] : null;
  }

  /** Beschikbare eenheden met hun afstand tot de post (null als die onbekend is). */
  function freeUnits(post: Post) {
    const busy = busyUnits();
    const postMap = posts();
    return units()
      .filter((u) => u.availability === 'vrij' && !busy.has(u.id))
      .map((unit) => {
        const position = unitPosition(unit, postMap);
        const km = position && post.lat != null && post.lng != null ? Math.round(distanceKm(position, [post.lng, post.lat]) * 10) / 10 : null;
        return { unit, km };
      });
  }

  const nearest = <T extends { km: number | null }>(list: T[]) =>
    list.filter((c) => c.km !== null).sort((a, b) => a.km! - b.km!)[0];

  function incidentRow(id: number) {
    const row = get('SELECT * FROM incidents WHERE id = ?', id);
    if (!row) throw httpError(404, 'Melding niet gevonden');
    return row;
  }

  function dispatchesOf(id: number): Dispatch[] {
    return all('SELECT * FROM incident_dispatches WHERE incident_id = ? ORDER BY at, rowid', id).map((d) => ({
      unitId: d.unit_id as number,
      at: d.at as string,
      reason: d.reason as DispatchReason,
      distanceKm: d.distance_km as number | null,
      declinedAt: d.declined_at as string | null,
      acceptedAt: d.accepted_at as string | null,
    }));
  }

  // ---- Live stand ----

  function toLive(row: Row, eventsById: Map<number, IncidentEvent[]>): LiveIncident {
    const acceptedBy = row.accepted_by as string | null;
    return {
      id: row.id as number,
      postId: row.post_id as number,
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
      unitId: row.unit_id as number | null,
      acceptedBy: acceptedBy ? { name: personName(acceptedBy), phone: acceptedBy } : null,
      acceptedAt: row.accepted_at as string | null,
      onSiteAt: row.on_site_at as string | null,
      closedAt: row.closed_at as string | null,
      outcome: row.outcome as LiveIncident['outcome'],
      dispatches: dispatchesOf(row.id as number),
      events: eventsById.get(row.id as number) ?? [],
    };
  }

  function state(): LiveState {
    const eventsById = new Map<number, IncidentEvent[]>();
    for (const e of all('SELECT incident_id, at, type, unit_id, text FROM incident_events ORDER BY id')) {
      const list = eventsById.get(e.incident_id as number) ?? [];
      list.push({ at: e.at as string, type: e.type as IncidentEventType, unitId: e.unit_id as number | null, text: e.text as string });
      eventsById.set(e.incident_id as number, list);
    }
    const busy = busyUnits();
    return {
      version,
      serverTime: iso(),
      incidents: all('SELECT * FROM incidents ORDER BY id DESC').map((row) => toLive(row, eventsById)),
      units: units().map((u): LiveUnit => {
        const fix = u.kind === 'mobiel' ? positions.get(u.id) : undefined;
        return { id: u.id, availability: u.availability, incidentId: busy.get(u.id) ?? null, stayPostId: u.stayPostId, position: fix ? { lat: fix.lat, lng: fix.lng, at: new Date(fix.at).toISOString() } : null };
      }),
      posts: [...posts().values()].map((p) => ({ id: p.id, isOpen: p.isOpen })),
      requests: requests(),
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

  const log = (incidentId: number, type: IncidentEventType, text: string, unitId: number | null = null) =>
    run('INSERT INTO incident_events (incident_id, at, type, unit_id, text) VALUES (?, ?, ?, ?, ?)', incidentId, iso(), type, unitId, text);

  function summary(row: Row) {
    const what = row.what ? INCIDENT_WHAT[row.what as keyof typeof INCIDENT_WHAT] : null;
    const persons = row.persons ? PERSONS_TEXT[row.persons as IncidentPersons] : null;
    return [what, persons].filter(Boolean).join(' · ') || 'EHBO nodig';
  }

  const tag = (id: number) => `oproep-${id}`;
  const unitUrl = (id: number) => `/oproep/${id}`;

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

  function addDispatch(incidentId: number, unitId: number, reason: DispatchReason, km: number | null) {
    run(`INSERT INTO incident_dispatches (incident_id, unit_id, at, reason, distance_km) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(incident_id, unit_id) DO NOTHING`, incidentId, unitId, iso(), reason, km);
  }

  /** Alarm naar eenheden (alle leden), met de afstand per eenheid. */
  function alarmUnits(row: Row, unitIds: number[], intro: string) {
    const post = posts().get(row.post_id as number)!;
    const distances = new Map(dispatchesOf(row.id as number).map((d) => [d.unitId, d.distanceKm]));
    for (const unit of units().filter((u) => unitIds.includes(u.id))) {
      const km = distances.get(unit.id);
      const parts = [row.aed === 1 && unit.hasAed ? 'AED meenemen' : null, summary(row), km != null ? `${formatKm(km)} km` : null];
      notify(unit.members, {
        title: `${intro} · ${post.name}`,
        body: `${parts.filter(Boolean).join(' · ')}. Tik om te reageren.`,
        tag: tag(row.id as number),
        url: unitUrl(row.id as number),
        urgent: true,
      });
    }
  }

  function copyToCoordinator(row: Row, body: string, urgent = false) {
    const phone = coordinator();
    if (!phone) return;
    const post = posts().get(row.post_id as number)!;
    notify([phone], { title: `EHBO-oproep · ${post.name}`, body, tag: `kopie-${row.id as number}`, url: `/melding/${row.id as number}`, urgent });
  }

  /** Eenheden die nog op deze oproep kunnen reageren: opgeroepen, niet geweigerd, niet aangenomen. */
  const invited = (id: number) => dispatchesOf(id).filter((d) => !d.declinedAt && !d.acceptedAt).map((d) => d.unitId);

  // ---- Escalatie ----

  function escalate(id: number, reason: string) {
    const row = incidentRow(id);
    if (row.status !== 'verstuurd') return;
    const post = posts().get(row.post_id as number)!;
    db.transaction(() => {
      run("UPDATE incidents SET stage = 'alle', escalates_at = NULL WHERE id = ?", id);
      for (const { unit, km } of freeUnits(post)) addDispatch(id, unit.id, 'alle', km);
      log(id, 'geescaleerd', `${reason} → naar alle beschikbare eenheden`);
    });
    const updated = incidentRow(id);
    const targets = invited(id);
    alarmUnits(updated, targets, 'EHBO-oproep · alle eenheden');
    copyToCoordinator(updated, targets.length
      ? `${reason}. Nu naar alle beschikbare eenheden (${targets.length}).`
      : 'Geen beschikbare EHBO-eenheid. Bel zelf een eenheid of 112.', targets.length === 0);
    setTimer(id, escalationMs(), () => repeat(id, 1));
    changed();
  }

  /** Nog niemand aangenomen: alarm herhalen bij alle eenheden (ook wie inmiddels vrij is gekomen). */
  function repeat(id: number, count: number) {
    const row = incidentRow(id);
    if (row.status !== 'verstuurd') return;
    const post = posts().get(row.post_id as number)!;
    db.transaction(() => {
      for (const { unit, km } of freeUnits(post)) addDispatch(id, unit.id, 'alle', km);
      log(id, 'herhaald', `Nog niemand heeft aangenomen; alarm opnieuw (${count})`);
    });
    alarmUnits(row, invited(id), 'EHBO-oproep · nog niemand');
    // Bij de eerste herhaling (dus na twee keer de escalatietijd) belt de coördinator zelf.
    if (count === 1) copyToCoordinator(row, 'Nog niemand heeft de oproep aangenomen. Bel de eenheden.', true);
    if (count < MAX_REPEATS) setTimer(id, escalationMs(), () => repeat(id, count + 1));
    changed();
  }

  // ---- Rechten ----

  const isCoordinator = (me: Me) => coordinator() === me.phone;
  const memberOf = (me: Me, unitId: number) => me.assignments.some((a) => a.kind === 'ehbo' && a.unitId === unitId);
  const atPost = (me: Me, postId: number) => me.assignments.some((a) => a.kind === 'post' && a.postId === postId);

  function requireUnitMember(me: Me, unitId: number) {
    if (!memberOf(me, unitId) && !me.isAdmin) throw httpError(403, 'Je hoort niet bij deze EHBO-eenheid');
    const unit = unitById(unitId);
    if (!unit) throw httpError(404, 'EHBO-eenheid niet gevonden');
    return unit;
  }

  /** De eenheid van deze medewerker die de oproep heeft aangenomen. */
  function acceptedUnitOf(me: Me, id: number) {
    const accepted = dispatchesOf(id).filter((d) => d.acceptedAt);
    const unitId = accepted.find((d) => memberOf(me, d.unitId))?.unitId ?? (me.isAdmin ? accepted[0]?.unitId : undefined);
    if (unitId === undefined) throw httpError(403, 'Alleen de eenheid die de oproep heeft aangenomen');
    return unitId;
  }

  // ---- Acties ----

  function report(me: Me, body: NewIncident): LiveIncident {
    const existing = get('SELECT id FROM incidents WHERE client_id = ?', body.clientId);
    if (existing) return state().incidents.find((i) => i.id === existing.id)!;

    const post = posts().get(body.postId);
    if (!post) throw httpError(404, 'Post niet gevonden');
    if (!atPost(me, post.id) && !me.isAdmin && !isCoordinator(me)) throw httpError(403, 'Je kunt alleen een verzoek doen vanaf je eigen post');
    if (!post.isOpen) throw httpError(409, 'Deze post is dicht. Zet de post eerst open.');

    const sentAt = iso();
    // Een melding die zonder bereik is bewaard, houdt het moment van versturen; nooit in de toekomst of meer dan een uur terug.
    const reported = body.reportedAt ? new Date(body.reportedAt) : null;
    const reportedAt = reported && reported <= now() && now().getTime() - reported.getTime() < 3600_000 ? reported.toISOString() : sentAt;
    const aed = body.responsive === 'nee';

    const candidates = freeUnits(post);
    const first = nearest(candidates);
    const aedUnit = aed ? nearest(candidates.filter((c) => c.unit.hasAed)) : undefined;
    const escalatesAt = first ? new Date(now().getTime() + escalationMs()).toISOString() : null;

    const id = db.transaction(() => {
      const incidentId = Number(run(`
        INSERT INTO incidents (client_id, post_id, reported_by, what, persons, responsive, note, aed, status, stage, reported_at, sent_at, escalates_at, is_test)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'verstuurd', 'dichtstbij', ?, ?, ?, ?)`,
      body.clientId, post.id, me.phone, body.what, body.persons, body.responsive, body.note?.trim() || null, aed ? 1 : 0, reportedAt, sentAt, escalatesAt,
      db.testMode() ? 1 : 0).lastInsertRowid);
      log(incidentId, 'gemeld', `Gemeld door ${post.name}`);
      if (first) {
        addDispatch(incidentId, first.unit.id, 'dichtstbij', first.km);
        if (aedUnit && aedUnit.unit.id !== first.unit.id) addDispatch(incidentId, aedUnit.unit.id, 'aed', aedUnit.km);
        const names = [`${first.unit.name} (dichtstbij)`];
        if (aedUnit && aedUnit.unit.id !== first.unit.id) names.push(`${aedUnit.unit.name} (AED)`);
        log(incidentId, 'verstuurd', `Naar ${names.join(' en ')} gestuurd + evenementcoördinator`);
      }
      return incidentId;
    });

    if (first) {
      const row = incidentRow(id);
      alarmUnits(row, invited(id), 'EHBO-oproep');
      copyToCoordinator(row, `${summary(row)}. Naar ${units().filter((u) => invited(id).includes(u.id)).map((u) => u.name).join(' en ')}.`);
      setTimer(id, escalationMs(), () => escalate(id, `Geen reactie binnen ${escalationMs() / 1000} s`));
      changed();
    } else {
      // Geen beschikbare eenheid met bekende positie: meteen naar iedereen die vrij is.
      escalate(id, 'Geen beschikbare eenheid in de buurt bekend');
    }
    return state().incidents.find((i) => i.id === id)!;
  }

  function update(me: Me, id: number, details: IncidentDetails) {
    const row = incidentRow(id);
    if (!atPost(me, row.post_id as number) && !me.isAdmin && !isCoordinator(me)) throw httpError(403, 'Alleen de post kan de melding aanvullen');
    if (!['verstuurd', 'geaccepteerd', 'ter_plaatse'].includes(row.status as string)) throw httpError(409, 'Deze melding is al afgesloten');
    const becameAed = row.aed !== 1 && details.responsive === 'nee';
    db.transaction(() => {
      run('UPDATE incidents SET what = ?, persons = ?, responsive = ?, note = ?, aed = ? WHERE id = ?',
        details.what, details.persons, details.responsive, details.note?.trim() || null, row.aed === 1 || becameAed ? 1 : 0, id);
      log(id, 'aangevuld', `Aangevuld: ${summary(incidentRow(id))}${becameAed ? ', niet aanspreekbaar' : ''}`);
    });
    const updated = incidentRow(id);
    // Niet aanspreekbaar geworden: de dichtstbijzijnde beschikbare AED-eenheid alsnog oproepen, als er nog geen AED komt.
    if (becameAed) {
      const comingWithAed = dispatchesOf(id).some((d) => !d.declinedAt && unitById(d.unitId)?.hasAed);
      const aedUnit = comingWithAed ? undefined : nearest(freeUnits(posts().get(updated.post_id as number)!).filter((c) => c.unit.hasAed));
      if (aedUnit) {
        addDispatch(id, aedUnit.unit.id, 'aed', aedUnit.km);
        log(id, 'verstuurd', `Naar ${aedUnit.unit.name} (AED) gestuurd`, aedUnit.unit.id);
        alarmUnits(updated, [aedUnit.unit.id], 'EHBO-oproep · AED nodig');
      }
    }
    const accepted = dispatchesOf(id).filter((d) => d.acceptedAt).map((d) => d.unitId);
    for (const unit of units().filter((u) => accepted.includes(u.id))) {
      notify(unit.members, { title: 'Melding aangevuld', body: `${summary(updated)}${becameAed ? ' · niet aanspreekbaar' : ''}`, tag: `aangevuld-${id}`, url: unitUrl(id) });
    }
    changed();
    return state();
  }

  /** Accepteren door een eenheid, of toewijzen door de coördinator (by = null). */
  function take(id: number, unit: Unit, by: Me, manual: boolean) {
    const row = incidentRow(id);
    const open = ['verstuurd', 'geaccepteerd', 'ter_plaatse'].includes(row.status as string);
    if (!open) throw httpError(409, row.status === 'ingetrokken' ? 'De post heeft de melding ingetrokken' : 'Deze melding is al afgerond');
    const busy = busyUnits().get(unit.id);
    if (busy !== undefined && busy !== id) throw httpError(409, `${unit.name} is al bezig met een andere oproep`);
    const dispatches = dispatchesOf(id);
    if (dispatches.some((d) => d.unitId === unit.id && d.acceptedAt)) return state();

    // Al aangenomen: alleen nog een eenheid met AED als die nodig is en nog niet komt, of een toewijzing door de coördinator.
    const acceptedUnits = dispatches.filter((d) => d.acceptedAt).map((d) => unitById(d.unitId));
    const aedStillNeeded = row.aed === 1 && unit.hasAed && !acceptedUnits.some((u) => u?.hasAed);
    if (row.status !== 'verstuurd' && !manual && !aedStillNeeded) {
      throw httpError(409, `Oproep is al aangenomen door ${acceptedUnits[0]?.name ?? 'een andere eenheid'}`);
    }

    const at = iso();
    const post = posts().get(row.post_id as number)!;
    db.transaction(() => {
      const km = freeUnits(post).find((c) => c.unit.id === unit.id)?.km ?? null;
      addDispatch(id, unit.id, manual ? 'handmatig' : 'alle', km);
      run('UPDATE incident_dispatches SET accepted_at = ?, declined_at = NULL WHERE incident_id = ? AND unit_id = ?', at, id, unit.id);
      // Wie aanneemt, is in dienst; een vaste eenheid gaat na afloop terug naar haar eigen post.
      run("UPDATE ehbo_units SET availability = 'vrij', stay_post_id = NULL WHERE id = ?", unit.id);
      if (row.status === 'verstuurd') {
        run("UPDATE incidents SET status = 'geaccepteerd', unit_id = ?, accepted_by = ?, accepted_at = ?, escalates_at = NULL WHERE id = ?",
          unit.id, manual ? null : by.phone, at, id);
      }
      log(id, manual ? 'toegewezen' : 'geaccepteerd',
        manual ? `Toegewezen aan ${unit.name} door ${personName(by.phone)}` : `Geaccepteerd door ${unit.name} (${personName(by.phone)})`, unit.id);
    });
    cancelTimer(id);

    const updated = incidentRow(id);
    const helper = manual ? unit.name : `${unit.name} (${personName(by.phone)})`;
    if (manual) {
      notify(unit.members, { title: `Ingezet · ${post.name}`, body: `${summary(updated)}. De coördinator heeft jullie gestuurd.`, tag: tag(id), url: unitUrl(id), urgent: true });
    }
    // Anderen hoeven niet meer te komen, behalve een AED-eenheid zolang er nog geen AED onderweg is.
    const aedComing = row.aed !== 1 || dispatchesOf(id).some((d) => d.acceptedAt && unitById(d.unitId)?.hasAed);
    const released = invited(id).filter((unitId) => aedComing || !unitById(unitId)?.hasAed);
    for (const other of units().filter((u) => released.includes(u.id))) {
      notify(other.members, { title: 'Oproep is al aangenomen', body: `${unit.name} gaat naar ${post.name}. Je hoeft niet te komen.`, tag: tag(id), url: unitUrl(id) });
    }
    notify(postPhones(post.id), { title: 'Hulp is onderweg', body: `${helper} komt eraan.`, tag: `melding-${id}`, url: `/melding/${id}` });
    copyToCoordinator(updated, `${manual ? 'Toegewezen aan' : 'Aangenomen door'} ${helper}.`);
    changed();
    return state();
  }

  function accept(me: Me, id: number, unitId: number) {
    return take(id, requireUnitMember(me, unitId), me, false);
  }

  function assign(me: Me, id: number, unitId: number) {
    if (!isCoordinator(me) && !me.isAdmin) throw httpError(403, 'Alleen de evenementcoördinator kan een oproep toewijzen');
    const unit = unitById(unitId);
    if (!unit) throw httpError(404, 'EHBO-eenheid niet gevonden');
    return take(id, unit, me, true);
  }

  function decline(me: Me, id: number, unitId: number) {
    const unit = requireUnitMember(me, unitId);
    const row = incidentRow(id);
    if (row.status !== 'verstuurd') return state();
    db.transaction(() => {
      run(`INSERT INTO incident_dispatches (incident_id, unit_id, at, reason, declined_at) VALUES (?, ?, ?, 'alle', ?)
           ON CONFLICT(incident_id, unit_id) DO UPDATE SET declined_at = excluded.declined_at`, id, unit.id, iso(), iso());
      log(id, 'geweigerd', `${unit.name}: kan niet`, unit.id);
    });
    if (row.stage === 'dichtstbij') {
      cancelTimer(id);
      escalate(id, `${unit.name} kan niet`);
    } else {
      changed();
    }
    return state();
  }

  function onSite(me: Me, id: number) {
    const row = incidentRow(id);
    const unitId = acceptedUnitOf(me, id);
    if (row.status !== 'geaccepteerd' && row.status !== 'ter_plaatse') throw httpError(409, 'Deze melding is niet meer open');
    const unit = unitById(unitId)!;
    db.transaction(() => {
      if (row.status === 'geaccepteerd') run("UPDATE incidents SET status = 'ter_plaatse', on_site_at = ? WHERE id = ?", iso(), id);
      log(id, 'ter_plaatse', `${unit.name} is ter plaatse`, unitId);
    });
    copyToCoordinator(incidentRow(id), `${unit.name} is ter plaatse.`);
    changed();
    return state();
  }

  function close(me: Me, id: number, body: CloseIncident) {
    const row = incidentRow(id);
    const unitId = acceptedUnitOf(me, id);
    if (row.status !== 'geaccepteerd' && row.status !== 'ter_plaatse') throw httpError(409, 'Deze melding is niet meer open');
    const unit = unitById(unitId)!;
    db.transaction(() => {
      run(`UPDATE incidents SET status = 'afgerond', closed_at = ?, outcome = ?, outcome_persons = ?, outcome_note = ?, on_site_at = COALESCE(on_site_at, ?)
           WHERE id = ?`, iso(), body.outcome, body.persons, body.note?.trim() || null, iso(), id);
      // Alleen een vaste eenheid "blijft hier"; een mobiele eenheid geeft haar positie zelf door.
      const stay = body.stayHere && unit.kind === 'vast' && row.post_id !== unit.postId ? (row.post_id as number) : null;
      run('UPDATE ehbo_units SET stay_post_id = ? WHERE id = ?', stay, unitId);
      // In dezelfde stap op pauze, zodat er tussendoor geen oproep binnenkomt.
      if (body.pause) run("UPDATE ehbo_units SET availability = 'pauze' WHERE id = ?", unitId);
      log(id, 'afgerond', `Afgerond door ${unit.name}${body.pause ? ', daarna pauze' : ''}`, unitId);
    });
    copyToCoordinator(incidentRow(id), `Afgerond door ${unit.name}.`);
    changed();
    return state();
  }

  function withdraw(me: Me, id: number) {
    const row = incidentRow(id);
    if (!atPost(me, row.post_id as number) && !me.isAdmin && !isCoordinator(me)) throw httpError(403, 'Alleen de post kan de melding intrekken');
    if (!['verstuurd', 'geaccepteerd', 'ter_plaatse'].includes(row.status as string)) return state();
    const post = posts().get(row.post_id as number)!;
    db.transaction(() => {
      run("UPDATE incidents SET status = 'ingetrokken', closed_at = ?, escalates_at = NULL WHERE id = ?", iso(), id);
      log(id, 'ingetrokken', `Ingetrokken door ${personName(me.phone)}`);
    });
    cancelTimer(id);
    const reached = dispatchesOf(id).filter((d) => !d.declinedAt).map((d) => d.unitId);
    for (const unit of units().filter((u) => reached.includes(u.id))) {
      notify(unit.members, { title: 'Melding ingetrokken', body: `${post.name} heeft geen hulp meer nodig.`, tag: tag(id), url: unitUrl(id) });
    }
    copyToCoordinator(row, `Ingetrokken door ${post.name}.`);
    changed();
    return state();
  }

  function setAvailability(me: Me, unitId: number, availability: UnitAvailability) {
    const unit = requireUnitMember(me, unitId);
    db.transaction(() => {
      run('UPDATE ehbo_units SET availability = ? WHERE id = ?', availability, unit.id);
      // Vaste eenheid: in dienst en de eigen EHBO-post open zijn hetzelfde (functioneel ontwerp, "Post open of dicht").
      if (unit.kind === 'vast' && unit.postId !== null && availability !== 'pauze') {
        run('UPDATE posts SET is_open = ? WHERE id = ?', availability === 'vrij' ? 1 : 0, unit.postId);
      }
      if (availability === 'uit_dienst') {
        run('UPDATE ehbo_units SET stay_post_id = NULL WHERE id = ?', unit.id);
        positions.delete(unit.id);
      }
    });
    changed();
    return state();
  }

  function setPosition(me: Me, unitId: number, position: { lat: number; lng: number }) {
    const unit = requireUnitMember(me, unitId);
    if (unit.kind !== 'mobiel') return;
    positions.set(unit.id, { lat: position.lat, lng: position.lng, at: now().getTime() });
    // Iedereen ziet de mobiele eenheid op de kaart meebewegen.
    changed();
  }

  function setPostOpen(me: Me, postId: number, open: boolean) {
    const post = posts().get(postId);
    if (!post) throw httpError(404, 'Post niet gevonden');
    const lead = me.assignments.some((a) => a.kind === 'post' && a.postId === postId && a.role === 'verantwoordelijke');
    const ownEhboPost = post.isEhbo && units().some((u) => u.kind === 'vast' && u.postId === postId && memberOf(me, u.id));
    if (!lead && !ownEhboPost && !me.isAdmin) throw httpError(403, 'Alleen de postverantwoordelijke kan de post open of dicht zetten');
    db.transaction(() => {
      run('UPDATE posts SET is_open = ? WHERE id = ?', open ? 1 : 0, postId);
      // Een vaste eenheid op deze EHBO-post gaat mee in dienst of uit dienst.
      run(`UPDATE ehbo_units SET availability = ? WHERE kind = 'vast' AND post_id = ? AND availability <> 'pauze'`, open ? 'vrij' : 'uit_dienst', postId);
    });
    changed();
    return state();
  }

  /** Na een herstart: lopende escalaties en herhalingen opnieuw inplannen. */
  function resume() {
    for (const row of all("SELECT id, stage, escalates_at FROM incidents WHERE status = 'verstuurd'")) {
      const id = row.id as number;
      if (row.stage === 'dichtstbij' && row.escalates_at) {
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

  return {
    state,
    subscribe(listener: (state: LiveState) => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    report, update, accept, assign, decline, onSite, close, withdraw, setAvailability, setPosition, setPostOpen, resume, stop,
    /** Wijziging van buitenaf (bijv. beheer): iedereen de nieuwe stand sturen. */
    changed,
  };
}
