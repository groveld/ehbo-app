// Posten in het evenementpakket: contactpersoon, eenheden, dichtstbijzijnde EHBO.
import { distanceKm, formatKm, type EventPackage, type LngLat, type PackagePost, type PackageUnit } from '@ehbo/shared';

export const kmLabel = (km: number | null) => (km === null ? null : `km ${formatKm(km)}`);
export const lngLat = (p: PackagePost): LngLat | null => (p.lat !== null && p.lng !== null ? [p.lng, p.lat] : null);

/** Wie je belt voor een post: de verantwoordelijke, anders de eerste contactpersoon. */
export const primaryContact = (post: PackagePost) =>
  post.contacts?.find((c) => c.role === 'verantwoordelijke') ?? post.contacts?.[0] ?? null;

/** EHBO-eenheden die bij deze post horen: vast op deze post, of mobiel met deze post als standplaats. */
export const unitsAt = (pkg: EventPackage, postId: number) => pkg.units.filter((u) => u.postId === postId);

/** Tweede regel onder de naam van een post, zoals in het overzicht. */
export function postSubtitle(pkg: EventPackage, post: PackagePost) {
  const units = unitsAt(pkg, post.id).map((u) => u.name);
  const who = units.length ? units.join(', ') : primaryContact(post)?.name;
  return [kmLabel(post.km), who].filter(Boolean).join(' · ');
}

/**
 * Dichtstbijzijnde EHBO-eenheid, hemelsbreed: een vaste eenheid op haar EHBO-post, een mobiele op haar standplaats.
 * Eenheden zonder plek tellen niet mee. (Status vrij/bezet komt met de oproepen in fase 3.)
 */
export function nearestUnit(pkg: EventPackage, post: PackagePost): { unit: PackageUnit; post: PackagePost; km: number } | null {
  const from = lngLat(post);
  if (!from) return null;
  let best: { unit: PackageUnit; post: PackagePost; km: number } | null = null;
  for (const unit of pkg.units) {
    const at = unit.postId !== null ? pkg.posts.find((p) => p.id === unit.postId) : undefined;
    const to = at && lngLat(at);
    if (!at || !to) continue;
    const km = distanceKm(from, to);
    if (!best || km < best.km) best = { unit, post: at, km };
  }
  return best;
}

/** De evenementcoördinator uit het kernteam (alleen in het pakket van medewerkers). */
export const coordinatorOf = (pkg: EventPackage | null) => pkg?.coreTeam.find((c) => c.isCoordinator) ?? null;
/** Kernteamlid met deze functie, bijv. "EHBO-coördinator". */
export const coreTeamMember = (pkg: EventPackage | null, fn: string) => pkg?.coreTeam.find((c) => c.function.toLowerCase() === fn.toLowerCase()) ?? null;
