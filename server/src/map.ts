// Kaart voor offline gebruik: alleen het gebied rond parcours en posten, uit de openbare Protomaps-bestanden.
// De tegels komen in het evenementbestand; telefoons slaan ze daarna allemaal vooraf op.
import zlib from 'node:zlib';
import { PMTiles } from 'pmtiles';
import type { Bbox, LngLat } from '@ehbo/shared';
import type { EventDb } from './event-db.ts';

export const MAX_ZOOM = 15;
/** Ruim genoeg voor een marathon (± 15 × 15 km); voorkomt dat een fout punt de halve wereld ophaalt. */
export const MAX_TILES = 6000;
const PADDING_KM = 2;
const CONCURRENCY = 8;

const BUILDS_URL = 'https://build-metadata.protomaps.dev/builds.json';
const BUILD_URL = (key: string) => `https://build.protomaps.com/${key}`;
const ASSETS_URL = 'https://protomaps.github.io/basemaps-assets';

/** Lettertypen van de Protomaps-stijl, en de tekenreeksen voor Nederlandse namen (Latijn, accenten, leestekens). */
export const FONTS = ['Noto Sans Regular', 'Noto Sans Medium', 'Noto Sans Italic'];
export const GLYPH_RANGES = ['0-255', '256-511', '8192-8447'];
export const SPRITE_FILES = ['light.json', 'light.png', 'light@2x.json', 'light@2x.png'];

export interface MapMeta {
  build: string;
  bbox: Bbox;
  tiles: number;
  bytes: number;
  preparedAt: string;
}

/** Waar de kaart vandaan komt; in tests een nep-bron zonder internet. */
export interface MapSource {
  build: string;
  getTile(z: number, x: number, y: number): Promise<Uint8Array | undefined>;
  getAsset(path: string): Promise<Uint8Array>;
}

/** Gebied rond alle punten, met een marge in km aan elke kant. */
export function areaBbox(points: LngLat[], paddingKm = PADDING_KM): Bbox {
  if (!points.length) throw new Error('Geen parcours of posten met een locatie; voeg eerst een GPX-bestand of een post met GPS toe');
  let [west, south, east, north] = [180, 90, -180, -90];
  for (const [lng, lat] of points) {
    west = Math.min(west, lng);
    east = Math.max(east, lng);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }
  const dLat = paddingKm / 111.32;
  const dLng = paddingKm / (111.32 * Math.cos(((south + north) / 2) * (Math.PI / 180)));
  const round = (n: number) => Math.round(n * 1e5) / 1e5;
  return [round(west - dLng), round(south - dLat), round(east + dLng), round(north + dLat)];
}

const tileX = (lng: number, z: number) => Math.floor(((lng + 180) / 360) * 2 ** z);
const tileY = (lat: number, z: number) => {
  const rad = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z);
};

/** Alle tegels die het gebied raken, van zoom 0 tot en met maxZoom. */
export function tilesForBbox([west, south, east, north]: Bbox, maxZoom = MAX_ZOOM): [number, number, number][] {
  const tiles: [number, number, number][] = [];
  for (let z = 0; z <= maxZoom; z++) {
    const max = 2 ** z - 1;
    const [x0, x1] = [Math.max(0, tileX(west, z)), Math.min(max, tileX(east, z))];
    const [y0, y1] = [Math.max(0, tileY(north, z)), Math.min(max, tileY(south, z))];
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) tiles.push([z, x, y]);
  }
  return tiles;
}

/** De nieuwste wereldkaart van Protomaps, gelezen met range-verzoeken: alleen de nodige stukken worden gedownload. */
export async function protomapsSource(): Promise<MapSource> {
  const res = await fetch(BUILDS_URL);
  if (!res.ok) throw new Error(`Protomaps-overzicht niet bereikbaar (${res.status})`);
  const builds = (await res.json()) as { key: string }[];
  const key = builds.at(-1)?.key;
  if (!key) throw new Error('Geen Protomaps-bestand gevonden');
  const archive = new PMTiles(BUILD_URL(key));
  return {
    build: key.replace(/\.pmtiles$/, ''),
    getTile: async (z, x, y) => {
      const tile = await archive.getZxy(z, x, y);
      return tile ? new Uint8Array(tile.data) : undefined;
    },
    getAsset: async (path) => {
      const asset = await fetch(`${ASSETS_URL}/${path.split('/').map(encodeURIComponent).join('/')}`);
      if (!asset.ok) throw new Error(`Kaartbestand ${path} niet gevonden (${asset.status})`);
      return new Uint8Array(await asset.arrayBuffer());
    },
  };
}

/** Paden van de lettertypen en iconen, zoals de app ze opvraagt onder /map/<versie>/. */
export const assetPaths = () => [
  ...FONTS.flatMap((font) => GLYPH_RANGES.map((range) => `fonts/${font}/${range}.pbf`)),
  ...SPRITE_FILES.map((file) => `sprites/v4/${file}`),
];

const contentType = (path: string) =>
  path.endsWith('.pbf') ? 'application/x-protobuf' : path.endsWith('.json') ? 'application/json' : 'image/png';

/** Alle punten van parcours en posten, voor het kaartgebied. */
export function eventPoints(db: EventDb): LngLat[] {
  const points: LngLat[] = [];
  for (const row of db.raw.prepare('SELECT track_json FROM runs WHERE track_json IS NOT NULL').all() as { track_json: string }[]) {
    points.push(...(JSON.parse(row.track_json) as LngLat[]));
  }
  for (const row of db.raw.prepare('SELECT lng, lat FROM posts WHERE lat IS NOT NULL AND lng IS NOT NULL').all() as { lng: number; lat: number }[]) {
    points.push([row.lng, row.lat]);
  }
  return points;
}

/**
 * Haalt het kaartgebied op en vervangt de vorige kaart in één keer.
 * progress(done, total) loopt over tegels én lettertypen/iconen.
 */
export async function prepareMap(db: EventDb, source: MapSource, progress: (done: number, total: number) => void = () => {}): Promise<MapMeta> {
  const bbox = areaBbox(eventPoints(db));
  const coords = tilesForBbox(bbox);
  if (coords.length > MAX_TILES) throw new Error(`Het gebied is te groot (${coords.length} tegels). Controleer of alle posten en GPX-bestanden in de buurt liggen.`);
  const assets = assetPaths();
  const total = coords.length + assets.length;
  let done = 0;

  const tiles: { z: number; x: number; y: number; data: Buffer }[] = [];
  let next = 0;
  // Een paar tegels tegelijk ophalen; lege tegels (bijv. open water) ontbreken in het bronbestand.
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (next < coords.length) {
      const [z, x, y] = coords[next++]!;
      const data = await source.getTile(z, x, y);
      if (data?.length) tiles.push({ z, x, y, data: zlib.gzipSync(data) });
      progress(++done, total);
    }
  }));
  const assetData: { path: string; data: Uint8Array }[] = [];
  for (const path of assets) {
    assetData.push({ path, data: await source.getAsset(path) });
    progress(++done, total);
  }

  const meta: MapMeta = {
    build: source.build,
    bbox,
    tiles: tiles.length,
    bytes: tiles.reduce((sum, t) => sum + t.data.length, 0) + assetData.reduce((sum, a) => sum + a.data.length, 0),
    preparedAt: new Date().toISOString(),
  };
  db.transaction(() => {
    db.raw.exec('DELETE FROM map_tiles; DELETE FROM map_assets;');
    const tile = db.raw.prepare('INSERT INTO map_tiles (z, x, y, data) VALUES (?, ?, ?, ?)');
    for (const t of tiles) tile.run(t.z, t.x, t.y, t.data);
    const asset = db.raw.prepare('INSERT INTO map_assets (path, content_type, data) VALUES (?, ?, ?)');
    for (const a of assetData) asset.run(a.path, contentType(a.path), a.data);
    db.raw.prepare('UPDATE event SET map_version = map_version + 1, map_json = ? WHERE id = 1').run(JSON.stringify(meta));
  });
  db.bumpVersion();
  return meta;
}

export function mapVersion(db: EventDb) {
  return (db.raw.prepare('SELECT map_version FROM event WHERE id = 1').get() as { map_version: number }).map_version;
}

export function mapMeta(db: EventDb): MapMeta | null {
  const row = db.raw.prepare('SELECT map_json FROM event WHERE id = 1').get() as { map_json: string | null };
  return row.map_json ? (JSON.parse(row.map_json) as MapMeta) : null;
}
