// Posten in het evenementpakket: contactpersoon, eenheden, dichtstbijzijnde EHBO.
import { awayPostIds, distanceKm, formatKm, isAway, type EventPackage, type LngLat, type PackagePost, type PackageUnit, type LiveUnit, sameFunction } from '@ehbo/shared';

/** "km 2,1", and "+1" when the longest run comes by more often. */
export function kmLabel(post: Pick<PackagePost, 'km' | 'passages'>) {
  if (post.km === null) return null;
  const more = (post.passages[0]?.km.length ?? 1) - 1;
  return `km ${formatKm(post.km)}${more > 0 ? ` +${more}` : ''}`;
}
export const lngLat = (p: PackagePost): LngLat | null => (p.lat !== null && p.lng !== null ? [p.lng, p.lat] : null);

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
export function unitsByDistance(pkg: EventPackage, post: PackagePost, offDuty: (unitId: number) => boolean = () => false): UnitDistance[] {
  const from = lngLat(post);
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
export function mobileUnits(pkg: EventPackage | null, units: LiveUnit[], now: number): { ambulances: Ambulance[]; awayPostIds: number[] } {
  if (!pkg) return { ambulances: [], awayPostIds: [] };
  const ambulances = units.flatMap((u) => {
    const unit = pkg.units.find((x) => x.id === u.id);
    if (!unit || !u.position || !isAway(unit, u, pkg.posts.find((p) => p.id === unit.postId), now)) return [];
    const busy = u.incidentId !== null;
    return [{ id: u.id, name: unit.name, lng: u.position.lng, lat: u.position.lat, busy, available: !busy && u.availability === 'vrij' }];
  });
  return { ambulances, awayPostIds: awayPostIds(pkg.units, units, pkg.posts, now) };
}
