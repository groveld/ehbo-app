// Posten in het evenementpakket: contactpersoon, eenheden, dichtstbijzijnde EHBO.
import { distanceKm, formatKm, type EventPackage, type LngLat, type PackagePost, type PackageUnit, type LiveUnit, POSITION_MAX_AGE_MS, sameFunction } from '@ehbo/shared';

export const kmLabel = (km: number | null) => (km === null ? null : `km ${formatKm(km)}`);
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

/** Binnen deze afstand van haar standplaats is een mobiele eenheid thuis. */
export const HOME_RADIUS_KM = 0.05;

/**
 * Mobiele EHBO-eenheden op de kaart. Een eenheid in dienst met een recente GPS-positie verder dan 50 m van haar standplaats
 * is onderweg: een ambulance. Dichterbij is ze thuis en staat ze er niet op; het kruisje bij de post zegt dan genoeg.
 * awayPostIds: standplaatsen waar nu geen eenheid is (elke eenheid die daar hoort is onderweg), voor een grijs kruisje.
 */
export function mobileUnits(pkg: EventPackage | null, units: LiveUnit[], now: number): { ambulances: Ambulance[]; awayPostIds: number[] } {
  const ambulances: Ambulance[] = [];
  const awayUnitIds = new Set<number>();
  const basePostIds = new Set<number>();
  for (const u of units) {
    const unit = pkg?.units.find((x) => x.id === u.id);
    if (!unit || unit.kind !== 'mobiel' || !u.position || u.availability === 'uit_dienst') continue;
    if (now - new Date(u.position.at).getTime() > POSITION_MAX_AGE_MS) continue;
    const base = unit.postId !== null ? pkg!.posts.find((p) => p.id === unit.postId) : undefined;
    const home = base && lngLat(base);
    if (home && distanceKm([u.position.lng, u.position.lat], home) <= HOME_RADIUS_KM) continue;
    awayUnitIds.add(u.id);
    if (base) basePostIds.add(base.id);
    const busy = u.incidentId !== null;
    ambulances.push({ id: u.id, name: unit.name, lng: u.position.lng, lat: u.position.lat, busy, available: !busy && u.availability === 'vrij' });
  }
  const awayPostIds = [...basePostIds].filter((id) => unitsAt(pkg!, id).every((u) => awayUnitIds.has(u.id)));
  return { ambulances, awayPostIds };
}
