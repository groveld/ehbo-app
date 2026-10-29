// Stijl van het evenement toepassen: kleuren, en de naam onder het icoon als iemand de app installeert.
// Signaalkleuren (rood, groen, soorten posten) staan vast in style.css en veranderen hier niet.
import { DEFAULT_STYLE, looksLikeSignal, type PublicEvent } from '@ehbo/shared';

function setMeta(name: string, content: string) {
  document.querySelector(`meta[name="${name}"]`)?.setAttribute('content', content);
}

export function applyTheme(event: PublicEvent | null) {
  const style = event?.style ?? DEFAULT_STYLE;
  const root = document.documentElement.style;
  // Een rode of groene hoofdkleur (van vóór de controle bij het opslaan) zou knoppen op 112 laten lijken: dan de standaard.
  root.setProperty('--primary', looksLikeSignal(style.primaryColor) ? DEFAULT_STYLE.primaryColor : style.primaryColor);
  root.setProperty('--accent', style.accentColor);
  setMeta('theme-color', style.primaryColor);
  if (!event) return;
  // iOS leest de naam en het icoon bij "Zet op beginscherm" uit de pagina, niet uit het manifest.
  setMeta('apple-mobile-web-app-title', style.shortName || event.name);
  if (event.brand.icon) document.querySelector('link[rel="apple-touch-icon"]')?.setAttribute('href', event.brand.icon.replace('icon-192', 'apple-touch-icon'));
  document.title = event.name;
}
