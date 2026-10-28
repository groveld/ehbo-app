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

/**
 * ?browser=1: de app in een gewone browser gebruiken, zonder te installeren (voor beheer en testen).
 * Blijft gelden voor dit tabblad, ook na navigeren.
 */
export const browserTest = (() => {
  try {
    if (new URLSearchParams(location.search).has('browser')) sessionStorage.setItem('ehbo.browser', '1');
    return sessionStorage.getItem('ehbo.browser') === '1';
  } catch {
    return new URLSearchParams(location.search).has('browser');
  }
})();

/** Medewerkers moeten de app installeren; in testmodus mag het in de browser. */
export const canUseAsStaff = isStandalone || browserTest;

export const deviceLabel = isIOS
  ? `iPhone/iPad${iosVersion ? ` · iOS ${iosVersion.major}.${iosVersion.minor}` : ''}`
  : isAndroid ? 'Android' : 'Computer';
