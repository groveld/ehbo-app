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
/** Alleen letters vergelijken, zodat "EHBO coördinator" en "EHBO-Coördinator" ook gevonden worden. */
const letters = (text: string) => text.toLowerCase().normalize('NFD').replace(/[^a-z]/g, '');
export const coreTeamMember = (pkg: EventPackage | null, fn: string) => pkg?.coreTeam.find((c) => letters(c.function) === letters(fn)) ?? null;
