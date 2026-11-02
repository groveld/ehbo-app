// Weergave van oproepen: korte omschrijving, tijden, reistijd.
import { INCIDENT_WHAT, OUTCOMES, REQUEST_KINDS, type EventPackage, type IncidentDetails, type IncidentEventType, type IncidentPersons, type LiveIncident, type LiveRequest, type PackagePost, type PackageUnit, type UnitMobility } from '@ehbo/shared';

const PERSONS: Record<IncidentPersons, string> = { '1': '1 persoon', '2': '2 personen', '3+': '3 of meer personen' };

/** "Onwel / flauw · 1 persoon", zoals in de oproep. */
export const incidentSummary = (d: IncidentDetails) =>
  [d.what ? INCIDENT_WHAT[d.what] : null, d.persons ? PERSONS[d.persons] : null].filter(Boolean).join(' · ') || 'EHBO nodig';

/** "11:02" in Nederlandse tijd. */
export const clock = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Amsterdam' }) : '–';

/** Gemiddelde snelheid in km/u voor een ruwe reistijd; hemelsbreed, dus het blijft een schatting. Een vaste eenheid telt als "anders". */
const SPEED: Record<UnitMobility, number> = { te_voet: 5, fiets: 15, auto: 30, anders: 15 };

export function travelMinutes(km: number | null, unit: PackageUnit | undefined) {
  if (km === null) return null;
  return Math.max(1, Math.round((km / SPEED[unit?.mobility ?? 'anders']) * 60));
}

/** The post of an incident; until the new event package has arrived, what the incident itself says about it. */
export const postOf = (posts: Map<number, PackagePost>, incident: LiveIncident): PackagePost =>
  posts.get(incident.postId) ?? { id: incident.postId, isOpen: true, timeFrom: null, timeTo: null, passages: [], ...incident.post };

export const unitOf = (pkg: EventPackage | null, id: number | null) => (id === null ? undefined : pkg?.units.find((u) => u.id === id));

/** De inzetten van een eenheid: afgeronde of ingetrokken oproepen die ze had aangenomen, nieuwste eerst. */
export const myDeployments = (incidents: LiveIncident[], unitId: number) =>
  incidents.filter((i) => (i.status === 'afgerond' || i.status === 'ingetrokken') && i.dispatches.some((d) => d.unitId === unitId && d.acceptedAt));

/** One step in a log (ActivityLog.vue). */
export interface LogEntry {
  at: string | null;
  text: string;
  /** done: a step that happened. warn: something went wrong on the way. stop: withdrawn or refused. waiting: yet to come. */
  tone?: 'done' | 'warn' | 'stop' | 'waiting';
}

const EVENT_TONE: Partial<Record<IncidentEventType, LogEntry['tone']>> = { geescaleerd: 'warn', herhaald: 'warn', geweigerd: 'warn', ingetrokken: 'stop' };

export function incidentLog(incident: LiveIncident): LogEntry[] {
  const log = incident.events.map((e): LogEntry => ({ at: e.at, text: e.text, tone: EVENT_TONE[e.type] ?? 'done' }));
  if (incident.outcome) log.push({ at: incident.closedAt, text: `Afloop: ${OUTCOMES[incident.outcome]}` });
  return log;
}

export function requestLog(request: LiveRequest): LogEntry[] {
  const log: LogEntry[] = [{ at: request.createdAt, text: `${REQUEST_KINDS[request.kind].label} aangevraagd door ${request.postName}` }];
  if (request.pickedAt) log.push({ at: request.pickedAt, text: `Opgepakt door ${request.pickedBy?.name ?? 'de coördinator'}` });
  if (request.status === 'afgehandeld') log.push({ at: request.doneAt, text: 'Afgehandeld' });
  else if (request.status === 'ingetrokken') log.push({ at: request.doneAt, text: 'Ingetrokken', tone: 'stop' });
  else log.push({ at: null, text: request.pickedAt ? 'Nog af te handelen' : 'Wacht in de rij', tone: 'waiting' });
  return log;
}
