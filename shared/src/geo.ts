// Afstanden hemelsbreed: werkt offline en is voorspelbaar (functioneel ontwerp, "Dichtstbijzijnd bepalen").
import type { LngLat } from './package.ts';

/** Afstand in km tussen twee punten (haversine). */
export function distanceKm([lng1, lat1]: LngLat, [lng2, lat2]: LngLat) {
  const rad = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * rad) / 2) ** 2
    + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lng2 - lng1) * rad) / 2) ** 2;
  return 6371.0088 * 2 * Math.asin(Math.sqrt(a));
}

/** "21,1" — km zoals in het Nederlands geschreven. */
export const formatKm = (km: number, digits = 1) => km.toLocaleString('nl-NL', { minimumFractionDigits: digits, maximumFractionDigits: digits });
/** "1,5, 2,5": the passes of a run. The label already says these are km points. */
export const formatKmList = (km: number[]) => km.map((k) => formatKm(k)).join(', ');
