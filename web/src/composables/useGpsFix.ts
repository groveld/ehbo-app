// GPS-positie vastleggen: een paar seconden meten en de nauwkeurigste meting houden.
import { onBeforeUnmount, ref } from 'vue';

export interface GpsFix {
  lat: number;
  lng: number;
  accuracyM: number;
}

/** Stopt zodra de positie op GOOD_ENOUGH_M meter nauwkeurig is, of na MAX_SECONDS. */
const GOOD_ENOUGH_M = 8;
const MAX_SECONDS = 20;

export function useGpsFix() {
  const measuring = ref(false);
  const best = ref<GpsFix | null>(null);
  const error = ref('');
  let watchId: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function stop() {
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    if (timer !== null) clearTimeout(timer);
    watchId = null;
    timer = null;
    measuring.value = false;
  }

  function start(): Promise<GpsFix | null> {
    error.value = '';
    best.value = null;
    if (!('geolocation' in navigator)) {
      error.value = 'Deze telefoon kan geen locatie bepalen.';
      return Promise.resolve(null);
    }
    measuring.value = true;
    return new Promise((resolve) => {
      const finish = () => {
        stop();
        if (!best.value && !error.value) error.value = 'Geen GPS-positie gevonden. Ga naar buiten of probeer het opnieuw.';
        resolve(best.value);
      };
      timer = setTimeout(finish, MAX_SECONDS * 1000);
      watchId = navigator.geolocation.watchPosition(
        ({ coords }) => {
          if (!best.value || coords.accuracy < best.value.accuracyM) {
            best.value = { lat: Math.round(coords.latitude * 1e6) / 1e6, lng: Math.round(coords.longitude * 1e6) / 1e6, accuracyM: Math.round(coords.accuracy) };
          }
          if (coords.accuracy <= GOOD_ENOUGH_M) finish();
        },
        (err) => {
          error.value = err.code === err.PERMISSION_DENIED
            ? 'Geen toestemming voor locatie. Zet locatie aan voor de app.'
            : 'Geen GPS-positie gevonden. Ga naar buiten of probeer het opnieuw.';
          finish();
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: MAX_SECONDS * 1000 },
      );
    });
  }

  onBeforeUnmount(stop);
  return { measuring, best, error, start, stop };
}
