// Navigeren met de navigatie-app van de telefoon, of de app die iemand zelf kiest.
import { isAndroid, isIOS } from './platform.ts';
import { load, save } from './storage.ts';

export type NavApp = 'telefoon' | 'google' | 'waze' | 'apple';

export const NAV_APPS: { value: NavApp; label: string }[] = [
  { value: 'telefoon', label: 'Standaard van de telefoon' },
  { value: 'google', label: 'Google Maps' },
  { value: 'waze', label: 'Waze' },
  { value: 'apple', label: 'Apple Kaarten' },
];

export const getNavApp = (): NavApp => load<NavApp>('ehbo.nav') ?? 'telefoon';
export const setNavApp = (app: NavApp) => save('ehbo.nav', app);

/** Link die de navigatie-app opent met de route naar dit punt. */
export function navigationUrl(lat: number, lng: number, label: string, app: NavApp = getNavApp()) {
  const at = `${lat},${lng}`;
  switch (app) {
    case 'google': return `https://www.google.com/maps/dir/?api=1&destination=${at}`;
    case 'waze': return `https://waze.com/ul?ll=${at}&navigate=yes`;
    case 'apple': return `https://maps.apple.com/?daddr=${at}&q=${encodeURIComponent(label)}`;
    default:
      if (isIOS) return `maps://?daddr=${at}&q=${encodeURIComponent(label)}`;
      // Android: geo: opent de standaard kaart-app, met een speld op de post.
      if (isAndroid) return `geo:${at}?q=${at}(${encodeURIComponent(label)})`;
      return `https://www.google.com/maps/dir/?api=1&destination=${at}`;
  }
}
