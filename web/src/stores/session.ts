// Het evenement en de aangemelde medewerker. Beide worden lokaal bewaard, zodat de app zonder bereik blijft werken.
import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import type { LoginUnknown, Me, PublicEvent } from '@ehbo/shared';
import { api, ApiRequestError } from '../api.ts';
import { load, save } from '../storage.ts';

export const useSessionStore = defineStore('session', () => {
  const event = ref<PublicEvent | null>(load('ehbo.event'));
  const me = ref<Me | null>(load('ehbo.me'));
  /** Gekozen plek als iemand op meer plekken staat (index in me.assignments). Wisselen kan later via het menu. */
  const placeIndex = ref<number>(load('ehbo.place') ?? 0);
  /** Laatste aanmelding met een onbekend nummer, voor het scherm "nummer niet bekend". */
  const unknown = ref<LoginUnknown | null>(null);

  watch(event, (value) => save('ehbo.event', value));
  watch(me, (value) => save('ehbo.me', value));
  watch(placeIndex, (value) => save('ehbo.place', value));

  const firstName = computed(() => me.value?.name.split(' ')[0] ?? '');
  const place = computed(() => me.value?.assignments[placeIndex.value] ?? me.value?.assignments[0] ?? null);

  async function loadEvent() {
    try {
      event.value = await api<PublicEvent>('/api/event');
    } catch {
      // Geen bereik: de bewaarde versie blijft staan.
    }
  }

  /** Bij het opstarten: klopt de sessie nog? Zonder bereik blijft de bewaarde medewerker staan. */
  async function refresh() {
    try {
      me.value = await api<Me>('/api/me');
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 401) me.value = null;
    }
  }

  /** Geeft 'ok' of 'unknown'; gooit ApiRequestError bij een ongeldig nummer of te veel pogingen. */
  async function login(phone: string): Promise<'ok' | 'unknown'> {
    try {
      me.value = await api<Me>('/api/session', { method: 'POST', body: { phone } });
      placeIndex.value = 0;
      unknown.value = null;
      return 'ok';
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 404) {
        unknown.value = err.body as LoginUnknown;
        return 'unknown';
      }
      throw err;
    }
  }

  async function logout() {
    await api('/api/session', { method: 'DELETE' }).catch(() => {});
    me.value = null;
    placeIndex.value = 0;
  }

  async function acceptInfo() {
    await api('/api/me/info-accepted', { method: 'POST' });
    if (me.value) me.value = { ...me.value, infoAccepted: true };
  }

  return { event, me, placeIndex, unknown, firstName, place, loadEvent, refresh, login, logout, acceptInfo };
});
