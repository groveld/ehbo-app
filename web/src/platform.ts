// Toestel en manier van openen: bepaalt of we de installatie-uitleg of de app tonen.
const ua = navigator.userAgent;

export const isIOS = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
export const isAndroid = /Android/.test(ua);

export const iosVersion = (() => {
  const m = /OS (\d+)_(\d+)/.exec(ua);
  return m ? { major: Number(m[1]), minor: Number(m[2]) } : null;
})();

/** Pushmeldingen in een geïnstalleerde web-app kunnen pas vanaf iOS 16.4. */
export const iosTooOld = iosVersion !== null && (iosVersion.major < 16 || (iosVersion.major === 16 && iosVersion.minor < 4));

export const isStandalone =
  window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

/** ?browser=1: de app in een gewone browser bekijken, zonder te installeren (voor beheer en testen). */
export const browserTest = new URLSearchParams(location.search).has('browser');

export const deviceLabel = isIOS
  ? `iPhone/iPad${iosVersion ? ` · iOS ${iosVersion.major}.${iosVersion.minor}` : ''}`
  : isAndroid ? 'Android' : 'Computer';
