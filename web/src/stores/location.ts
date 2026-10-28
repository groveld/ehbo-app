// Toestemming voor locatie: nodig voor je eigen positie op de kaart, en voor mobiele EHBO zolang die in dienst is.
import { defineStore } from 'pinia';
import { ref } from 'vue';

export type LocationPermission = 'granted' | 'denied' | 'prompt' | 'unsupported';

export const useLocationStore = defineStore('location', () => {
  const permission = ref<LocationPermission>('geolocation' in navigator ? 'prompt' : 'unsupported');

  async function check() {
    if (!('geolocation' in navigator) || !navigator.permissions) return;
    try {
      const status = await navigator.permissions.query({ name: 'geolocation' });
      permission.value = status.state;
      status.onchange = () => { permission.value = status.state; };
    } catch {
      // Oudere Safari: geen Permissions API. De status blijft "prompt" tot de eerste vraag.
    }
  }

  /** Vraagt toestemming door één keer de positie op te vragen. */
  function request(): Promise<LocationPermission> {
    return new Promise((resolve) => {
      if (!('geolocation' in navigator)) return resolve('unsupported');
      navigator.geolocation.getCurrentPosition(
        () => resolve((permission.value = 'granted')),
        (err) => resolve((permission.value = err.code === err.PERMISSION_DENIED ? 'denied' : permission.value)),
        { enableHighAccuracy: false, timeout: 15_000, maximumAge: 60_000 },
      );
    });
  }

  return { permission, check, request };
});
