// Zones on the map (#172): where participants can park or eat. Drawn in admin, in the package for everyone, so they work offline.
import type { LngLat } from './package.ts';

export type ZoneKind = 'parking' | 'food';

/** Fixed per kind, like the colours of the functions: the legend and the map say the same. */
export const ZONE_KINDS: Record<ZoneKind, { label: string; letter: string; color: string }> = {
  parking: { label: 'Parkeren', letter: 'P', color: '#2D63B8' },
  food: { label: 'Eten & drinken', letter: 'E', color: '#C9641A' },
};
export const ZONE_KIND_ORDER: ZoneKind[] = ['parking', 'food'];

/** A zone is always an area, a closed polygon: a strip along a road is a narrow area. */
export const ZONE_POINTS_MIN = 3;
export const ZONE_POINTS_MAX = 200;

export interface ZoneData {
  kind: ZoneKind;
  name: string;
  /** Such as "vol vanaf 11:00" or "€ 2". */
  note: string | null;
  points: LngLat[];
}

export interface Zone extends ZoneData {
  id: number;
}

/** What's wrong with a drawn zone, or null when it can be saved. */
export function zoneProblem(z: Pick<ZoneData, 'points'>): string | null {
  if (z.points.length < ZONE_POINTS_MIN) return `Tik minstens ${ZONE_POINTS_MIN} punten voor een zone`;
  if (z.points.length > ZONE_POINTS_MAX) return `Hoogstens ${ZONE_POINTS_MAX} punten`;
  return null;
}

/** The middle of a zone's points, to navigate to without a tap on it. */
export function zoneCentre(points: LngLat[]): LngLat {
  const [lng, lat] = points.reduce(([a, b], [x, y]) => [a + x, b + y], [0, 0]);
  return [lng / points.length, lat / points.length];
}
