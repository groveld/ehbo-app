// Stijl per evenement: kleuren, korte naam en de eigen logo's (groot logo en vierkant app-icoon).
// De app maakt de afbeeldingen zelf op maat (PNG); de server controleert alleen of ze kloppen en bewaart ze.
import { DEFAULT_STYLE, SHORT_NAME_MAX, type Brand, type EventStyle } from '@ehbo/shared';
import type { EventDb } from './event-db.ts';

/** Afbeeldingen met hun vaste maat (null = vrij), en het standaardicoon als er geen eigen is. */
export const BRAND_IMAGES = {
  'logo': { size: null, fallback: null },
  'icon-192': { size: 192, fallback: '/icons/icon-192.png' },
  'icon-512': { size: 512, fallback: '/icons/icon-512.png' },
  'icon-maskable-512': { size: 512, fallback: '/icons/icon-maskable-512.png' },
  'apple-touch-icon': { size: 180, fallback: '/icons/apple-touch-icon.png' },
} as const;
export type BrandImage = keyof typeof BRAND_IMAGES;
export const ICON_IMAGES = ['icon-192', 'icon-512', 'icon-maskable-512', 'apple-touch-icon'] as const satisfies BrandImage[];

/** Grootste breedte of hoogte van het grote logo. */
export const LOGO_MAX_SIDE = 2000;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Breedte en hoogte uit de kop van een PNG, of null als het geen PNG is. */
export function pngSize(data: Buffer) {
  if (data.length < 24 || !data.subarray(0, 8).equals(PNG_SIGNATURE) || data.toString('latin1', 12, 16) !== 'IHDR') return null;
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

export function getStyle(db: EventDb): EventStyle {
  const row = db.raw.prepare('SELECT style_json FROM event WHERE id = 1').get() as { style_json: string | null };
  return { ...DEFAULT_STYLE, ...(row.style_json ? JSON.parse(row.style_json) as Partial<EventStyle> : {}) };
}

export function saveStyle(db: EventDb, style: EventStyle) {
  const value: EventStyle = {
    shortName: style.shortName?.trim() || null,
    primaryColor: style.primaryColor.toUpperCase(),
    accentColor: style.accentColor.toUpperCase(),
  };
  db.raw.prepare('UPDATE event SET style_json = ? WHERE id = 1').run(JSON.stringify(value));
}

const brandVersion = (db: EventDb) => (db.raw.prepare('SELECT brand_version FROM event WHERE id = 1').get() as { brand_version: number }).brand_version;

/** Adres van een afbeelding; de versie verandert bij elke nieuwe upload, zodat telefoons hem opnieuw ophalen. */
export const brandUrl = (db: EventDb, name: BrandImage) => `/brand/${name}.png?v=${brandVersion(db)}`;

export function getBrand(db: EventDb): Brand {
  const has = (name: BrandImage) => db.raw.prepare('SELECT 1 FROM brand_images WHERE name = ?').get(name) !== undefined;
  return {
    logo: has('logo') ? brandUrl(db, 'logo') : null,
    icon: has('icon-192') ? brandUrl(db, 'icon-192') : null,
  };
}

export function getBrandImage(db: EventDb, name: BrandImage) {
  return (db.raw.prepare('SELECT data FROM brand_images WHERE name = ?').get(name) as { data: Uint8Array } | undefined)?.data;
}

/** Afbeeldingen opslaan (null = verwijderen), in één keer. */
export function setBrandImages(db: EventDb, images: Partial<Record<BrandImage, Buffer | null>>) {
  db.transaction(() => {
    for (const [name, data] of Object.entries(images)) {
      if (data) db.raw.prepare('INSERT INTO brand_images (name, data) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET data = excluded.data').run(name, data);
      else db.raw.prepare('DELETE FROM brand_images WHERE name = ?').run(name);
    }
    db.raw.prepare('UPDATE event SET brand_version = brand_version + 1 WHERE id = 1').run();
  });
}

/** Het webmanifest: naam, kleur en iconen van dit evenement. */
export function buildManifest(db: EventDb) {
  const { name } = db.getEvent();
  const style = getStyle(db);
  const icon = (image: BrandImage, size: number, purpose: string) => ({ src: brandUrl(db, image), sizes: `${size}x${size}`, type: 'image/png', purpose });
  return {
    id: '/',
    name,
    short_name: style.shortName || name.slice(0, SHORT_NAME_MAX),
    description: `Posten, contacten en EHBO-oproepen tijdens ${name}.`,
    lang: 'nl',
    start_url: '/?bron=app',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: style.primaryColor,
    theme_color: style.primaryColor,
    icons: [icon('icon-192', 192, 'any'), icon('icon-512', 512, 'any'), icon('icon-maskable-512', 512, 'maskable')],
  };
}
