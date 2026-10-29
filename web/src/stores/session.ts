// Het evenement en de aangemelde medewerker. Beide worden lokaal bewaard, zodat de app zonder bereik blijft werken.
import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import { DEFAULT_STYLE, type LoginUnknown, type Me, type PublicEvent } from '@ehbo/shared';
import { api, ApiRequestError } from '../api.ts';
import { load, save } from '../storage.ts';
import { usePackageStore } from './package.ts';

const RANK = { beheerder: 0, kernteam: 1, ehbo: 2, post: 3 } as const;

export const useSessionStore = defineStore('session', () => {
  const stored = load<Omit<PublicEvent, 'style' | 'brand'> & Partial<PublicEvent>>('ehbo.event');
  // Bewaard door een oudere versie van de app: zonder stijl en logo's.
  const event = ref<PublicEvent | null>(stored && { style: DEFAULT_STYLE, brand: { logo: null, icon: null }, ...stored });
  const me = ref<Me | null>(load('ehbo.me'));
  /** Laatste aanmelding met een onbekend nummer, voor het scherm "nummer niet bekend". */
  const unknown = ref<LoginUnknown | null>(null);

  watch(event, (value) => save('ehbo.event', value));
  watch(me, (value) => save('ehbo.me', value));

  const firstName = computed(() => me.value?.name.split(' ')[0] ?? '');
  /** Je functies, belangrijkste bovenaan: beheer, dan kernteam, dan EHBO en posten. Zo in het menu en na het aanmelden. */
  const functions = computed(() => [...(me.value?.assignments ?? [])].sort((a, b) => RANK[a.kind] - RANK[b.kind]));

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
      if (err instanceof ApiRequestError && err.status === 401) {
        me.value = null;
        usePackageStore().clearStaffData();
      }
    }
  }

  /** Geeft 'ok' of 'unknown'; gooit ApiRequestError bij een ongeldig nummer of te veel pogingen. */
  async function login(phone: string): Promise<'ok' | 'unknown'> {
    try {
      me.value = await api<Me>('/api/session', { method: 'POST', body: { phone } });
      unknown.value = null;
      // Medewerkers krijgen het pakket met namen en nummers.
      void usePackageStore().refresh();
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
    usePackageStore().clearStaffData();
    void usePackageStore().refresh();
  }

  return { event, me, unknown, firstName, functions, loadEvent, refresh, login, logout };
});
