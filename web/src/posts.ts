// Posten in het evenementpakket: contactpersoon, eenheden, dichtstbijzijnde EHBO.
import { DEFAULT_AT_POST_M, POSITION_MAX_AGE_MS, awayPostIds, distanceKm, formatKm, isAway, isManned, type EventPackage, type LiveIncident, type LngLat, type PackagePost, type PackageUnit, type LiveUnit, sameFunction } from '@ehbo/shared';

/** "km 2,1", and "+1" when the longest run comes by more often. */
export function kmLabel(post: Pick<PackagePost, 'km' | 'passages'>) {
  if (post.km === null) return null;
  const more = (post.passages[0]?.km.length ?? 1) - 1;
  return `km ${formatKm(post.km)}${more > 0 ? ` +${more}` : ''}`;
}
export const lngLat = (p: PackagePost): LngLat | null => (p.lat !== null && p.lng !== null ? [p.lng, p.lat] : null);

/** Is this post part of this run? It comes by according to the GPX, and start/finish always belongs. A turnaround belongs to its own run only. */
export const isOnRun = (pkg: EventPackage, post: PackagePost, runId: number) =>
  (post.runId === null || post.runId === runId)
  && (post.passages.some((r) => r.runId === runId) || pkg.postTypes.find((t) => t.id === post.typeId)?.key === 'start_finish');

/** People are there (#69): an AED, toilets or a turnaround have nobody, so no open or closed. */
export const manned = (pkg: EventPackage | null, post: PackagePost) => (pkg ? isManned(post, pkg.postTypes) : true);

/** The posts along a run in its order: a post it passes twice is there twice. Start/finish without a pass comes last. */
export function routeStops(pkg: EventPackage, runId: number) {
  return pkg.posts.filter((post) => isOnRun(pkg, post, runId))
    .flatMap((post) => (post.passages.find((r) => r.runId === runId)?.km ?? [null]).map((km) => ({ post, km })))
    .sort((a, b) => (a.km ?? Infinity) - (b.km ?? Infinity));
}

/** Wie je belt voor een post: de verantwoordelijke, anders de eerste contactpersoon. */
export const primaryContact = (post: PackagePost) =>
  post.contacts?.find((c) => c.role === 'verantwoordelijke') ?? post.contacts?.[0] ?? null;

/** EHBO-eenheden die bij deze post horen: vast op deze post, of mobiel met deze post als standplaats. */
export const unitsAt = (pkg: EventPackage, postId: number) => pkg.units.filter((u) => u.postId === postId);

export interface UnitDistance {
  unit: PackageUnit;
  post: PackagePost;
  km: number;
}

/**
 * EHBO-eenheden op afstand, hemelsbreed: een vaste eenheid op haar EHBO-post, een mobiele op haar standplaats.
 * Werkt zonder bereik, uit het evenementpakket. Eenheden zonder plek tellen niet mee; wie uit dienst is (als dat bekend is) ook niet.
 */
/** Teams by distance from a post, or from where someone asks for help. */
export function unitsByDistance(pkg: EventPackage, post: { lat: number | null; lng: number | null }, offDuty: (unitId: number) => boolean = () => false): UnitDistance[] {
  const from = post.lat != null && post.lng != null ? [post.lng, post.lat] as LngLat : null;
  if (!from) return [];
  return pkg.units.flatMap((unit) => {
    const at = unit.postId !== null ? pkg.posts.find((p) => p.id === unit.postId) : undefined;
    const to = at && lngLat(at);
    return at && to && !offDuty(unit.id) ? [{ unit, post: at, km: distanceKm(from, to) }] : [];
  }).sort((a, b) => a.km - b.km);
}

export const nearestUnit = (pkg: EventPackage, post: PackagePost) => unitsByDistance(pkg, post)[0] ?? null;

/** De evenementcoördinator uit het kernteam (alleen in het pakket van medewerkers). */
export const coordinatorOf = (pkg: EventPackage | null) => pkg?.coreTeam.find((c) => c.isCoordinator) ?? null;
/** Kernteamlid met deze functie, bijv. "EHBO-coördinator". */
export const coreTeamMember = (pkg: EventPackage | null, fn: string) => pkg?.coreTeam.find((c) => sameFunction(c.function, fn)) ?? null;

/** available: beschikbaar (groen); anders pauze of bezig met een oproep (rood). */
export interface Ambulance { id: number; name: string; lng: number; lat: number; available: boolean; busy: boolean }

/**
 * Mobiele EHBO-eenheden op de kaart. Onderweg (verder dan 50 m van haar standplaats) staat ze er als ambulance op;
 * thuis niet, dan zegt het kruisje bij de post genoeg. awayPostIds: standplaatsen waar nu niemand is, voor een grijs kruisje.
 */
/** How close counts as at a post, as the admin set it. A package from before the setting has the default. */
export const atPostM = (pkg: EventPackage | null) => pkg?.event.atPostM ?? DEFAULT_AT_POST_M;

export function mobileUnits(pkg: EventPackage | null, units: LiveUnit[], now: number): { ambulances: Ambulance[]; awayPostIds: number[] } {
  if (!pkg) return { ambulances: [], awayPostIds: [] };
  const ambulances = units.flatMap((u) => {
    const unit = pkg.units.find((x) => x.id === u.id);
    if (!unit || !u.position || !isAway(unit, u, pkg.posts.find((p) => p.id === unit.postId), now, atPostM(pkg))) return [];
    const busy = u.incidentId !== null;
    return [{ id: u.id, name: unit.name, lng: u.position.lng, lat: u.position.lat, busy, available: !busy && u.availability === 'vrij' }];
  });
  return { ambulances, awayPostIds: awayPostIds(pkg.units, units, pkg.posts, now, atPostM(pkg)) };
}

/**
 * A line from each team on its way to where the call is, so you see at once which team goes where.
 * It starts at the team's last GPS position, or else at its own post. Once on site there's nothing left to show.
 */
export function callLines(pkg: EventPackage | null, units: LiveUnit[], incidents: LiveIncident[], now: number): [LngLat, LngLat][] {
  if (!pkg) return [];
  return units.flatMap((u) => {
    const incident = incidents.find((i) => i.id === u.incidentId && i.status === 'geaccepteerd');
    if (!incident || incident.post.lat === null || incident.post.lng === null) return [];
    const fresh = u.position && now - new Date(u.position.at).getTime() <= POSITION_MAX_AGE_MS ? u.position : null;
    const home = pkg.posts.find((p) => p.id === pkg.units.find((x) => x.id === u.id)?.postId);
    const from = fresh ? [fresh.lng, fresh.lat] as LngLat : home ? lngLat(home) : null;
    return from ? [[from, [incident.post.lng, incident.post.lat]] as [LngLat, LngLat]] : [];
  });
}

/** "12:00 – 16:00", or what's known of it. */
export const shiftText = (unit: { timeFrom: string | null; timeTo: string | null } | undefined) => {
  if (!unit) return '';
  if (unit.timeFrom && unit.timeTo) return `${unit.timeFrom} – ${unit.timeTo}`;
  return unit.timeFrom ? `vanaf ${unit.timeFrom}` : unit.timeTo ? `tot ${unit.timeTo}` : '';
};
