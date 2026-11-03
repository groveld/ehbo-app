// Posten in het evenementpakket: contactpersoon, eenheden, dichtstbijzijnde EHBO.
import { DEFAULT_AT_LOCATION_M, POSITION_MAX_AGE_MS, awayLocationIds, distanceKm, formatKm, isAway, isStaffed, type EventPackage, type LiveIncident, type LngLat, type PackageLocation, type PackageTeam, type LiveTeam, type LocationContactRole, sameFunction } from '@ehbo/shared';

/** "km 2,1", and "+1" when the longest run comes by more often. */
export function kmLabel(location: Pick<PackageLocation, 'km' | 'passages'>) {
  if (location.km === null) return null;
  const more = (location.passages[0]?.km.length ?? 1) - 1;
  return `km ${formatKm(location.km)}${more > 0 ? ` +${more}` : ''}`;
}
export const lngLat = (p: PackageLocation): LngLat | null => (p.lat !== null && p.lng !== null ? [p.lng, p.lat] : null);

/** Is this post part of this run? It comes by according to the GPX, and start/finish always belongs. A turnaround belongs to its own run only. */
export const isOnRun = (pkg: EventPackage, location: PackageLocation, runId: number) =>
  (location.runId === null || location.runId === runId)
  && (location.passages.some((r) => r.runId === runId) || pkg.functionTypes.find((t) => t.id === location.typeId)?.key === 'start_finish');

/** People are there (#69): an AED, toilets or a turnaround have nobody, so no open or closed. */
export const staffed = (pkg: EventPackage | null, location: PackageLocation) => (pkg ? isStaffed(location, pkg.functionTypes) : true);

/** The locations along a run in its order: a post it passes twice is there twice. Start/finish without a pass comes last. */
export function routeStops(pkg: EventPackage, runId: number) {
  return pkg.locations.filter((location) => isOnRun(pkg, location, runId))
    .flatMap((location) => (location.passages.find((r) => r.runId === runId)?.km ?? [null]).map((km) => ({ location, km })))
    .sort((a, b) => (a.km ?? Infinity) - (b.km ?? Infinity));
}

/** A contact's role as a word in a list: verantwoordelijke, lid, reserve. */
export const ROLE_TEXT: Record<LocationContactRole, string> = { lead: 'verantwoordelijke', member: 'lid', reserve: 'reserve' };

/** Wie je belt voor een post: de verantwoordelijke, anders de eerste contactpersoon. */
export const primaryContact = (location: PackageLocation) =>
  location.contacts?.find((c) => c.role === 'lead') ?? location.contacts?.[0] ?? null;

/** EHBO-eenheden die bij deze post horen: vast op deze post, of mobiel met deze post als standplaats. */
export const teamsAt = (pkg: EventPackage, locationId: number) => pkg.teams.filter((u) => u.locationId === locationId);

export interface TeamDistance {
  team: PackageTeam;
  location: PackageLocation;
  km: number;
}

/**
 * EHBO-eenheden op afstand, hemelsbreed: een vaste eenheid op haar EHBO-post, een mobiele op haar standplaats.
 * Werkt zonder bereik, uit het evenementpakket. Eenheden zonder plek tellen niet mee; wie uit dienst is (als dat bekend is) ook niet.
 */
/** Teams by distance from a post, or from where someone asks for help. */
export function teamsByDistance(pkg: EventPackage, location: { lat: number | null; lng: number | null }, offDuty: (teamId: number) => boolean = () => false): TeamDistance[] {
  const from = location.lat != null && location.lng != null ? [location.lng, location.lat] as LngLat : null;
  if (!from) return [];
  return pkg.teams.flatMap((team) => {
    const at = team.locationId !== null ? pkg.locations.find((p) => p.id === team.locationId) : undefined;
    const to = at && lngLat(at);
    return at && to && !offDuty(team.id) ? [{ team, location: at, km: distanceKm(from, to) }] : [];
  }).sort((a, b) => a.km - b.km);
}

export const nearestTeam = (pkg: EventPackage, location: PackageLocation) => teamsByDistance(pkg, location)[0] ?? null;

/** De evenementcoördinator uit het kernteam (alleen in het pakket van medewerkers). */
export const coordinatorOf = (pkg: EventPackage | null) => pkg?.coreTeam.find((c) => c.isCoordinator) ?? null;
/** Kernteamlid met deze functie, bijv. "EHBO-coördinator". */
export const coreTeamMember = (pkg: EventPackage | null, fn: string) => pkg?.coreTeam.find((c) => sameFunction(c.function, fn)) ?? null;

/** available: beschikbaar (groen); anders pauze of bezig met een oproep (rood). */
export interface Ambulance { id: number; name: string; lng: number; lat: number; available: boolean; busy: boolean }

/**
 * Mobiele EHBO-eenheden op de kaart. Onderweg (verder dan 50 m van haar standplaats) staat ze er als ambulance op;
 * thuis niet, dan zegt het kruisje bij de post genoeg. awayLocationIds: standplaatsen waar nu niemand is, voor een grijs kruisje.
 */
/** How close counts as at a post, as the admin set it. A package from before the setting has the default. */
export const atLocationM = (pkg: EventPackage | null) => pkg?.event.atLocationM ?? DEFAULT_AT_LOCATION_M;

export function mobileTeams(pkg: EventPackage | null, teams: LiveTeam[], now: number): { ambulances: Ambulance[]; awayLocationIds: number[] } {
  if (!pkg) return { ambulances: [], awayLocationIds: [] };
  const ambulances = teams.flatMap((u) => {
    const team = pkg.teams.find((x) => x.id === u.id);
    if (!team || !u.position || !isAway(team, u, pkg.locations.find((p) => p.id === team.locationId), now, atLocationM(pkg))) return [];
    const busy = u.incidentId !== null;
    return [{ id: u.id, name: team.name, lng: u.position.lng, lat: u.position.lat, busy, available: !busy && u.availability === 'available' }];
  });
  return { ambulances, awayLocationIds: awayLocationIds(pkg.teams, teams, pkg.locations, now, atLocationM(pkg)) };
}

/**
 * A line from each team on its way to where the call is, so you see at once which team goes where.
 * It starts at the team's last GPS position, or else at its own post. Once on site there's nothing left to show.
 */
export function callLines(pkg: EventPackage | null, teams: LiveTeam[], incidents: LiveIncident[], now: number): [LngLat, LngLat][] {
  if (!pkg) return [];
  return teams.flatMap((u) => {
    const incident = incidents.find((i) => i.id === u.incidentId && i.status === 'accepted');
    if (!incident || incident.location.lat === null || incident.location.lng === null) return [];
    const fresh = u.position && now - new Date(u.position.at).getTime() <= POSITION_MAX_AGE_MS ? u.position : null;
    const home = pkg.locations.find((p) => p.id === pkg.teams.find((x) => x.id === u.id)?.locationId);
    const from = fresh ? [fresh.lng, fresh.lat] as LngLat : home ? lngLat(home) : null;
    return from ? [[from, [incident.location.lng, incident.location.lat]] as [LngLat, LngLat]] : [];
  });
}

/** "12:00 – 16:00", or what's known of it. */
export const shiftText = (team: { timeFrom: string | null; timeTo: string | null } | undefined) => {
  if (!team) return '';
  if (team.timeFrom && team.timeTo) return `${team.timeFrom} – ${team.timeTo}`;
  return team.timeFrom ? `vanaf ${team.timeFrom}` : team.timeTo ? `tot ${team.timeTo}` : '';
};
