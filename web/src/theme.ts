// Stijl van het evenement toepassen: kleuren, en de naam onder het icoon als iemand de app installeert.
// Signaalkleuren (rood, groen, soorten posten) staan vast in style.css en veranderen hier niet.
import { DEFAULT_STYLE, looksLikeSignal, type PublicEvent } from '@ehbo/shared';

const luminance = (rgb: number[]) => {
  const [r, g, b] = rgb.map((c) => (c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/**
 * The primary colour on a dark background: a dark one is mixed with white until it shows there (3:1),
 * which still leaves white text on it readable. A lighter one stays as it is.
 */
function forDark(hex: string) {
  const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  for (let mix = 0; mix <= 1; mix += 0.02) {
    const lifted = rgb.map((c) => Math.round(c + (255 - c) * mix));
    if (luminance(lifted) >= 0.12) return `#${lifted.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
  }
  return hex;
}

function setMeta(name: string, content: string) {
  document.querySelector(`meta[name="${name}"]`)?.setAttribute('content', content);
}

export function applyTheme(event: PublicEvent | null) {
  const style = event?.style ?? DEFAULT_STYLE;
  const root = document.documentElement.style;
  // Een rode of groene hoofdkleur (van vóór de controle bij het opslaan) zou knoppen op 112 laten lijken: dan de standaard.
  const primary = looksLikeSignal(style.primaryColor) ? DEFAULT_STYLE.primaryColor : style.primaryColor;
  // style.css picks one of the two for light or dark.
  root.setProperty('--event-primary', primary);
  root.setProperty('--event-primary-dark', forDark(primary));
  root.setProperty('--accent', style.accentColor);
  setMeta('theme-color', style.primaryColor);
  if (!event) return;
  // iOS leest de naam en het icoon bij "Zet op beginscherm" uit de pagina, niet uit het manifest.
  setMeta('apple-mobile-web-app-title', style.shortName || event.name);
  if (event.brand.icon) document.querySelector('link[rel="apple-touch-icon"]')?.setAttribute('href', event.brand.icon.replace('icon-192', 'apple-touch-icon'));
  document.title = event.name;
}
