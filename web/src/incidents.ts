// Weergave van oproepen: korte omschrijving, tijden, reistijd.
import { INCIDENT_WHAT, type EventPackage, type IncidentDetails, type IncidentPersons, type LiveIncident, type PackagePost, type PackageUnit, type UnitMobility } from '@ehbo/shared';

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
