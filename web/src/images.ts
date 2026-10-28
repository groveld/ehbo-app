// Logo's op maat maken in de browser, zodat de server geen beeldbewerking nodig heeft.
// Alles gaat als PNG naar de server, ook als de beheerder een JPEG, WebP of SVG kiest.
import { ICON_MIN_SIZE, IMAGE_MAX_BASE64, type IconUpload } from '@ehbo/shared';

export const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/svg+xml';

/** Het grote logo past hierin; groter is op een telefoon en in het rapport niet nodig. */
const LOGO_BOX = { width: 1200, height: 600 };

interface Loaded {
  img: HTMLImageElement;
  vector: boolean;
  width: number;
  height: number;
}

/** Afbeelding inlezen; het tijdelijke adres blijft geldig tot het tekenen klaar is (Safari heeft dat nodig voor SVG). */
async function withImage<T>(file: File, fn: (image: Loaded) => T | Promise<T>): Promise<T> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode().catch(() => {
      throw new Error('Deze afbeelding kan de app niet lezen. Kies een PNG, JPEG, WebP of SVG.');
    });
    // Een SVG zonder vaste maat heeft geen eigen afmetingen; dan tekenen we hem op de maat die nodig is.
    return await fn({ img, vector: file.type === 'image/svg+xml', width: img.naturalWidth || 1024, height: img.naturalHeight || 1024 });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function canvas(width: number, height: number) {
  const el = document.createElement('canvas');
  el.width = width;
  el.height = height;
  const ctx = el.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  return { el, ctx };
}

const toBase64 = (el: HTMLCanvasElement) => el.toDataURL('image/png').slice('data:image/png;base64,'.length);

/** Groot logo: verhouding blijft, niet groter dan nodig, en klein genoeg voor de server. */
export function makeLogo(file: File) {
  return withImage(file, ({ img, width, height }) => {
    let scale = Math.min(1, LOGO_BOX.width / width, LOGO_BOX.height / height);
    for (;;) {
      const { el, ctx } = canvas(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)));
      ctx.drawImage(img, 0, 0, el.width, el.height);
      const png = toBase64(el);
      if (png.length <= IMAGE_MAX_BASE64) return png;
      scale *= 0.75;
    }
  });
}

/**
 * Vierkant logo in alle maten van het app-icoon. Niet vierkant: het midden wordt gebruikt.
 * Android knipt een rand weg (maskable) en iOS toont geen doorzichtigheid; die krijgen een achtergrond in de kleur van de hoek van het logo.
 */
export function makeIconSet(file: File): Promise<IconUpload> {
  return withImage(file, iconSet);
}

function iconSet({ img, vector, width, height }: Loaded): IconUpload {
  const side = Math.min(width, height);
  if (!vector && side < ICON_MIN_SIZE) {
    throw new Error(`Het vierkante logo moet minstens ${ICON_MIN_SIZE} × ${ICON_MIN_SIZE} pixels zijn; dit is ${width} × ${height}.`);
  }
  const crop = { x: (width - side) / 2, y: (height - side) / 2 };

  const draw = (size: number, fill: string | null, scale = 1) => {
    const { el, ctx } = canvas(size, size);
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fillRect(0, 0, size, size);
    }
    const inner = size * scale;
    ctx.drawImage(img, crop.x, crop.y, side, side, (size - inner) / 2, (size - inner) / 2, inner, inner);
    return el;
  };

  const corner = draw(ICON_MIN_SIZE, null).getContext('2d')!.getImageData(0, 0, 1, 1).data;
  const background = corner[3]! > 250 ? `rgb(${corner[0]}, ${corner[1]}, ${corner[2]})` : '#FFFFFF';

  return {
    icon512: toBase64(draw(512, null)),
    icon192: toBase64(draw(192, null)),
    // Android toont alleen de binnenste 80 %.
    maskable512: toBase64(draw(512, background, 0.8)),
    appleTouch: toBase64(draw(180, background)),
  };
}
