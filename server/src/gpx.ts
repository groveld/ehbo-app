// Parcours uit een GPX-bestand: de punten van de route (trkpt of rtept) en de lengte.

export interface Track {
  /** [lengtegraad, breedtegraad], zoals MapLibre ze verwacht; hooguit MAX_POINTS. */
  line: [number, number][];
  /** Aantal punten in het originele bestand. */
  points: number;
  km: number;
}

const MAX_POINTS = 2000;

/** Afstand in km tussen twee punten (haversine). */
export function distanceKm([lng1, lat1]: [number, number], [lng2, lat2]: [number, number]) {
  const rad = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * rad) / 2) ** 2
    + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lng2 - lng1) * rad) / 2) ** 2;
  return 6371.0088 * 2 * Math.asin(Math.sqrt(a));
}

export function parseGpx(xml: string): Track {
  const all: [number, number][] = [];
  // Een track (trkpt) heeft voorrang; routes (rtept) alleen als er geen track in staat.
  for (const tag of ['trkpt', 'rtept']) {
    for (const [element] of xml.matchAll(new RegExp(`<${tag}\\b[^>]*>`, 'g'))) {
      const lat = Number(/\blat\s*=\s*["']([^"']+)["']/.exec(element)?.[1]);
      const lng = Number(/\blon\s*=\s*["']([^"']+)["']/.exec(element)?.[1]);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
        throw new Error('Het GPX-bestand bevat een ongeldig punt');
      }
      all.push([lng, lat]);
    }
    if (all.length) break;
  }
  if (all.length < 2) throw new Error('Geen route gevonden in dit GPX-bestand');

  let km = 0;
  for (let i = 1; i < all.length; i++) km += distanceKm(all[i - 1]!, all[i]!);

  // Uitdunnen voor de kaart: elk zoveelste punt, begin en eind blijven.
  const step = Math.ceil(all.length / MAX_POINTS);
  const line = all.filter((_, i) => i % step === 0 || i === all.length - 1)
    .map(([lng, lat]) => [Math.round(lng * 1e6) / 1e6, Math.round(lat * 1e6) / 1e6] as [number, number]);

  return { line, points: all.length, km: Math.round(km * 100) / 100 };
}
