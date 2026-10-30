// Parcours uit een GPX-bestand: de punten van de route (trkpt of rtept) en de lengte.
import type { DatabaseSync } from 'node:sqlite';
import { distanceKm, type LngLat } from '@ehbo/shared';

export { distanceKm };

export interface Track {
  /** [lengtegraad, breedtegraad], zoals MapLibre ze verwacht; hooguit MAX_POINTS. */
  line: [number, number][];
  /** Aantal punten in het originele bestand. */
  points: number;
  km: number;
}

const MAX_POINTS = 2000;
/** A run passes a post when it comes this close. */
const PASSAGE_RADIUS_KM = 0.03;
/** Two passes closer together than this are one: the line wobbling around the post. */
const PASSAGE_MERGE_KM = 0.1;

function readPoints(xml: string) {
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
  return all;
}

export function parseGpx(xml: string): Track {
  const all = readPoints(xml);
  if (all.length < 2) throw new Error('Geen route gevonden in dit GPX-bestand');

  let km = 0;
  for (let i = 1; i < all.length; i++) km += distanceKm(all[i - 1]!, all[i]!);

  // Uitdunnen voor de kaart: elk zoveelste punt, begin en eind blijven.
  const step = Math.ceil(all.length / MAX_POINTS);
  const line = all.filter((_, i) => i % step === 0 || i === all.length - 1)
    .map(([lng, lat]) => [Math.round(lng * 1e6) / 1e6, Math.round(lat * 1e6) / 1e6] as [number, number]);

  return { line, points: all.length, km: Math.round(km * 100) / 100 };
}

/** Nearest point on the segment a–b, as a fraction of it, and the distance to it. Flat is precise enough at this scale. */
function nearestOnSegment(a: LngLat, b: LngLat, point: LngLat) {
  const scale = Math.cos((point[1] * Math.PI) / 180);
  const [dx, dy] = [(b[0] - a[0]) * scale, b[1] - a[1]];
  const [px, py] = [(point[0] - a[0]) * scale, point[1] - a[1]];
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, (px * dx + py * dy) / length));
  return { t, km: distanceKm([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])], point) };
}

/** Every pass of a route along a point, in km from the start. */
export function passages(line: LngLat[], point: LngLat, trackKm?: number): number[] {
  const lengths = line.slice(1).map((p, i) => distanceKm(line[i]!, p));
  // The line is thinned out for the map, so it's a little shorter than the real route.
  const lineKm = lengths.reduce((a, b) => a + b, 0);
  const scale = trackKm && lineKm ? trackKm / lineKm : 1;

  const found: number[] = [];
  let along = 0;
  let current: { at: number; km: number } | null = null;
  for (const [i, length] of lengths.entries()) {
    const { t, km } = nearestOnSegment(line[i]!, line[i + 1]!, point);
    const near = km <= PASSAGE_RADIUS_KM;
    // Two long segments can both come close while the route leaves in between: then the start of this one is far away.
    const continues = near && distanceKm(line[i]!, point) <= PASSAGE_RADIUS_KM;
    if (current && !continues) {
      found.push(current.at);
      current = null;
    }
    if (near && (!current || km < current.km)) current = { at: along + t * length, km };
    along += length;
  }
  if (current) found.push(current.at);

  return found
    .filter((at, i) => i === 0 || at - found[i - 1]! >= PASSAGE_MERGE_KM)
    .map((at) => Math.round(at * scale * 10) / 10);
}

/**
 * Recalculates all km points. Runs after every change to a GPX or a post's position.
 * posts.km is the first pass on the longest run that comes by, for wherever one km is shown.
 */
export function recomputePassages(db: DatabaseSync) {
  const runs = db.prepare('SELECT id, track_json, track_km FROM runs WHERE track_json IS NOT NULL ORDER BY track_km DESC, id').all() as { id: number; track_json: string; track_km: number }[];
  const posts = db.prepare('SELECT id, lat, lng FROM posts WHERE lat IS NOT NULL AND lng IS NOT NULL').all() as { id: number; lat: number; lng: number }[];
  db.exec('DELETE FROM post_passages; UPDATE posts SET km = NULL;');
  const insert = db.prepare('INSERT INTO post_passages (post_id, run_id, seq, km) VALUES (?, ?, ?, ?)');
  const setKm = db.prepare('UPDATE posts SET km = ? WHERE id = ? AND km IS NULL');
  for (const run of runs) {
    const line = JSON.parse(run.track_json) as LngLat[];
    for (const post of posts) {
      const found = passages(line, [post.lng, post.lat], run.track_km);
      found.forEach((km, seq) => insert.run(post.id, run.id, seq, km));
      if (found.length) setKm.run(found[0]!, post.id);
    }
  }
}

/** A GPX for participants: only the route. Whatever else the uploaded file holds (author, device, times) stays out. */
export function cleanGpx(name: string, source: string | null, line: LngLat[]) {
  const points = source ? readPoints(source) : line;
  const title = name.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const track = points.map(([lng, lat]) => `<trkpt lat="${lat}" lon="${lng}"/>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Silvesterloop" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>${title}</name><trkseg>${track}</trkseg></trk></gpx>\n`;
}
