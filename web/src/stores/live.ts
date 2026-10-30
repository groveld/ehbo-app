// Live stand: oproepen, eenheden en open/dicht van posten. Via SSE zolang de app open is; de laatste stand blijft bewaard voor zonder bereik.
import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import type {
  CloseIncident,
  IncidentDetails,
  LiveIncident,
  LiveRequest,
  LiveState,
  NewIncident,
  NewRequest,
  RequestKind,
  UnitAvailability,
} from '@ehbo/shared';
import { POSITION_SHARE_MS } from '@ehbo/shared';
import { api, ApiRequestError } from '../api.ts';
import { load, save } from '../storage.ts';
import { usePackageStore } from './package.ts';
import { useSessionStore } from './session.ts';

/** Zonder bericht (ook geen hartslag) in deze tijd is de verbinding stuk: opnieuw verbinden. */
const STALE_MS = 75_000;
/** After a change in admin: wait a moment, spread over the phones, so a series of edits doesn't fetch the package every time. */
const SYNC_DELAY_MS = 3_000;
const SYNC_SPREAD_MS = 5_000;
const OPEN = ['verstuurd', 'geaccepteerd', 'ter_plaatse'] as const;

export const isOpen = (incident: LiveIncident) => (OPEN as readonly string[]).includes(incident.status);

/** De melding kwam niet aan (geen of slecht bereik); hij staat klaar en gaat vanzelf weg zodra er bereik is. */
export class OfflineError extends Error {
  clientId: string;

  constructor(clientId: string) {
    super('Geen bereik');
    this.clientId = clientId;
  }
}

export const useLiveStore = defineStore('live', () => {
  const session = useSessionStore();
  const pkg = usePackageStore();
  // A state saved by an older version of the app lacks what the screens expect; the server sends a new one right away.
  const stored = load<LiveState>('ehbo.live');
  const state = ref<LiveState | null>(stored?.dataVersion ? stored : null);
  /** Nog niet bij de server aangekomen. De server telt dezelfde clientId maar één keer, dus opnieuw versturen kan altijd. */
  const outbox = ref<NewIncident[]>(load('ehbo.outbox') ?? []);
  watch(outbox, (value) => save('ehbo.outbox', value.length ? value : null), { deep: true });
  const connected = ref(false);
  /** Verschil tussen de klok van de server en die van de telefoon, voor de aftelring. */
  const clockOffset = ref(0);
  /** Tikt elke seconde, zodat aftellen en "sinds" bijwerken. */
  const now = ref(Date.now());
  setInterval(() => (now.value = Date.now()), 1000);

  let source: EventSource | null = null;
  let lastMessage = 0;
  let watchdog: ReturnType<typeof setInterval> | null = null;
  let syncTimer: ReturnType<typeof setTimeout> | undefined;
  /** The fixed data is being fetched again. */
  const syncing = ref(false);

  function setState(value: LiveState) {
    // Een oudere stand (bijv. een antwoord dat later binnenkomt dan een SSE-bericht) overschrijft een nieuwere niet.
    if (state.value && value.version < state.value.version && value.serverTime <= state.value.serverTime) return;
    state.value = value;
    clockOffset.value = new Date(value.serverTime).getTime() - Date.now();
    save('ehbo.live', value);
    checkData(value.dataVersion);
  }

  /** Fetch everything that changes through admin: the event package, my functions, and the style and logos. */
  async function syncData() {
    clearTimeout(syncTimer);
    syncTimer = undefined;
    syncing.value = true;
    await Promise.all([pkg.refresh(), session.loadEvent(), session.me ? session.refresh() : null]);
    syncing.value = false;
  }

  /** Called with the version from the server: a different one means something changed in admin. */
  function checkData(dataVersion: string) {
    if (syncTimer !== undefined || pkg.isCurrent(dataVersion)) return;
    syncTimer = setTimeout(() => void syncData(), SYNC_DELAY_MS + Math.random() * SYNC_SPREAD_MS);
  }

  function connect() {
    disconnect();
    if (!session.me || typeof EventSource === 'undefined') return;
    source = new EventSource('/api/live');
    lastMessage = Date.now();
    source.addEventListener('state', (e) => {
      lastMessage = Date.now();
      connected.value = true;
      setState(JSON.parse((e as MessageEvent<string>).data) as LiveState);
    });
    // De hartslag is een commentaarregel; die komt niet als gebeurtenis binnen, maar houdt de verbinding wel open.
    source.addEventListener('open', () => {
      lastMessage = Date.now();
      connected.value = true;
      void flush();
    });
    source.addEventListener('error', () => { connected.value = false; });
    watchdog = setInterval(() => {
      if (Date.now() - lastMessage > STALE_MS) void refresh().then(connect);
    }, 30_000);
  }

  function disconnect() {
    source?.close();
    source = null;
    connected.value = false;
    if (watchdog) clearInterval(watchdog);
    watchdog = null;
  }

  async function refresh() {
    if (!session.me) return;
    try {
      setState(await api<LiveState>('/api/live/state'));
      lastMessage = Date.now();
    } catch {
      // Geen bereik: de bewaarde stand blijft staan.
    }
  }

  // Aanmelden en afmelden: verbinding openen of sluiten; na afmelden geen oproepen van anderen op de telefoon.
  watch(() => session.me?.phone, (phone) => {
    if (phone) connect();
    else {
      disconnect();
      state.value = null;
      save('ehbo.live', null);
      outbox.value = [];
    }
  }, { immediate: true });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && session.me && (!source || source.readyState === EventSource.CLOSED)) connect();
  });

  // ---- Afgeleid ----

  const serverNow = computed(() => now.value + clockOffset.value);
  const incidents = computed(() => state.value?.incidents ?? []);
  const openIncidents = computed(() => incidents.value.filter(isOpen));
  const incidentById = (id: number) => incidents.value.find((i) => i.id === id) ?? null;
  const unitState = (id: number) => state.value?.units.find((u) => u.id === id) ?? null;
  /** Live open/dicht; zonder live stand wat in het evenementpakket staat. */
  const postOpen = (postId: number, fallback = false) => state.value?.posts.find((p) => p.id === postId)?.isOpen ?? fallback;

  const myUnitIds = computed(() => session.me?.assignments.filter((a) => a.kind === 'ehbo').map((a) => a.unitId!) ?? []);
  const myPostIds = computed(() => session.me?.assignments.filter((a) => a.kind === 'post').map((a) => a.postId!) ?? []);

  const hasAed = (unitId: number) => pkg.pkg?.units.find((u) => u.id === unitId)?.hasAed ?? false;

  /** Bij niet aanspreekbaar blijft een eenheid met AED opgeroepen tot er een eenheid met AED heeft geaccepteerd (zoals de server). */
  const needsAed = (incident: LiveIncident, unitId: number) =>
    incident.aed && hasAed(unitId) && !incident.dispatches.some((d) => d.acceptedAt && hasAed(d.unitId));

  /** Oproepen waar een eenheid van mij op kan reageren: opgeroepen, niet geweigerd, nog niet aangenomen. */
  const invitations = computed(() => openIncidents.value.filter((i) => i.dispatches.some((d) =>
    myUnitIds.value.includes(d.unitId) && !d.declinedAt && !d.acceptedAt && (i.status === 'verstuurd' || needsAed(i, d.unitId)))));

  /** Oproep waar een eenheid van mij mee bezig is. */
  const myActive = computed(() => openIncidents.value.find((i) => i.dispatches.some((d) => myUnitIds.value.includes(d.unitId) && d.acceptedAt)) ?? null);

  // Safety net: something refers to a post or unit this phone doesn't know yet. Don't wait: this may be a call.
  const unknownData = computed(() => {
    if (!pkg.pkg) return '';
    const assignments = session.me?.assignments ?? [];
    const posts = [...incidents.value.map((i) => i.postId), ...(state.value?.requests ?? []).map((r) => r.postId), ...myPostIds.value];
    const units = [...(state.value?.units ?? []).map((u) => u.id), ...assignments.flatMap((a) => (a.unitId == null ? [] : [a.unitId]))];
    return [
      ...posts.filter((id) => !pkg.postById.has(id)).map((id) => `post ${id}`),
      ...units.filter((id) => !pkg.pkg!.units.some((u) => u.id === id)).map((id) => `unit ${id}`),
    ].join();
  });
  watch(unknownData, (unknown) => { if (unknown) void syncData(); });

  // Mobiele eenheid in dienst: elke minuut de positie naar de server (dichtstbijzijnde bepalen, ambulance op de kaart);
  // bij een statuswissel meteen, zodat de kaart van iedereen direct klopt.
  // Een webapp krijgt geen positie zolang hij op de achtergrond staat; dan telt na 3 minuten weer de standplaats.
  const sharingUnit = computed(() => myUnitIds.value.find((id) =>
    pkg.pkg?.units.find((u) => u.id === id)?.kind === 'mobiel' && (unitState(id)?.availability ?? 'uit_dienst') !== 'uit_dienst') ?? null);
  let geoWatch: number | null = null;
  let lastSent = 0;
  const sendPosition = (unitId: number, coords: GeolocationCoordinates) => {
    lastSent = Date.now();
    fetch(`/api/units/${unitId}/position`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat: coords.latitude, lng: coords.longitude }),
    }).catch(() => {});
  };
  watch(sharingUnit, (unitId) => {
    if (geoWatch !== null) navigator.geolocation.clearWatch(geoWatch);
    geoWatch = null;
    if (unitId === null || !('geolocation' in navigator)) return;
    geoWatch = navigator.geolocation.watchPosition(({ coords }) => {
      if (Date.now() - lastSent >= POSITION_SHARE_MS) sendPosition(unitId, coords);
    }, () => {}, { enableHighAccuracy: true, maximumAge: 30_000 });
  }, { immediate: true });
  // Status gewijzigd (bijv. van pauze naar beschikbaar): de positie meteen sturen, niet pas na een minuut.
  watch(() => (sharingUnit.value !== null ? unitState(sharingUnit.value)?.availability : null), (availability, before) => {
    const unitId = sharingUnit.value;
    if (unitId === null || !availability || availability === before || !('geolocation' in navigator)) return;
    navigator.geolocation.getCurrentPosition(({ coords }) => sendPosition(unitId, coords), () => {}, { enableHighAccuracy: true, maximumAge: 15_000, timeout: 15_000 });
  });

  const secondsLeft = (incident: LiveIncident) =>
    incident.escalatesAt ? Math.max(0, Math.ceil((new Date(incident.escalatesAt).getTime() - serverNow.value) / 1000)) : null;

  // ---- Acties: elk antwoord is de nieuwe stand ----

  const act = async (path: string, method: 'POST' | 'PUT', body?: object) => {
    setState(await api<LiveState>(path, { method, body }));
    return state.value!;
  };

  // ---- Melding zonder bereik: blijft op de telefoon staan en gaat vanzelf weg zodra er bereik is ----

  /** Wat later alsnog is aangekomen (clientId → melding), of door de server is geweigerd (clientId → reden). */
  const delivered = ref<Record<string, number>>({});
  const refused = ref<Record<string, string>>({});

  async function post(item: NewIncident) {
    // Slecht bereik: niet eindeloos wachten. Komt hij toch aan, dan telt de server hem bij de volgende poging niet dubbel.
    const res = await fetch('/api/incidents', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(item), signal: AbortSignal.timeout(10_000),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiRequestError(res.status, body);
    return body as LiveIncident;
  }

  const drop = (clientId: string) => { outbox.value = outbox.value.filter((i) => i.clientId !== clientId); };

  /** Gooit OfflineError als de melding (nog) niet is aangekomen; hij staat dan in de outbox. */
  async function report(request: Omit<NewIncident, 'clientId' | 'reportedAt'>) {
    const item: NewIncident = { ...request, clientId: crypto.randomUUID(), reportedAt: new Date(serverNow.value).toISOString() };
    outbox.value.push(item);
    try {
      const incident = await post(item);
      drop(item.clientId);
      delivered.value[item.clientId] = incident.id;
      await refresh();
      return incident;
    } catch (err) {
      if (err instanceof ApiRequestError) {
        drop(item.clientId);
        throw err;
      }
      startFlushing();
      throw new OfflineError(item.clientId);
    }
  }

  let flushing = false;
  async function flush() {
    if (flushing || !session.me) return;
    flushing = true;
    try {
      for (const item of [...outbox.value]) {
        try {
          delivered.value[item.clientId] = (await post(item)).id;
          drop(item.clientId);
        } catch (err) {
          if (!(err instanceof ApiRequestError)) break; // nog geen bereik: later opnieuw
          refused.value[item.clientId] = err.message;
          drop(item.clientId);
        }
      }
      if (Object.keys(delivered.value).length) await refresh();
    } finally {
      flushing = false;
    }
  }

  let flushTimer: ReturnType<typeof setInterval> | null = null;
  function startFlushing() {
    flushTimer ??= setInterval(() => {
      if (!outbox.value.length) {
        clearInterval(flushTimer!);
        flushTimer = null;
        return;
      }
      void flush();
    }, 10_000);
  }
  window.addEventListener('online', () => void flush());
  if (outbox.value.length) {
    startFlushing();
    void flush();
  }

  return {
    state, connected, syncing, serverNow, sharingUnit, incidents, openIncidents, invitations, myActive, myUnitIds, myPostIds,
    incidentById, unitState, postOpen, secondsLeft, needsAed, refresh, connect, report, checkData,
    /** "Opnieuw laden": everything at once. */
    reload: () => Promise.all([syncData(), refresh()]),
    outbox, delivered, refused, flush,
    update: (id: number, details: IncidentDetails) => act(`/api/incidents/${id}`, 'PUT', details),
    accept: (id: number, unitId: number) => act(`/api/incidents/${id}/accept`, 'POST', { unitId }),
    decline: (id: number, unitId: number) => act(`/api/incidents/${id}/decline`, 'POST', { unitId }),
    assign: (id: number, unitId: number) => act(`/api/incidents/${id}/assign`, 'POST', { unitId }),
    onSite: (id: number) => act(`/api/incidents/${id}/on-site`, 'POST'),
    close: (id: number, body: CloseIncident) => act(`/api/incidents/${id}/close`, 'POST', body),
    withdraw: (id: number) => act(`/api/incidents/${id}/withdraw`, 'POST'),
    setAvailability: (unitId: number, availability: UnitAvailability) => act(`/api/units/${unitId}/availability`, 'PUT', { availability }),
    setPostOpen: (postId: number, open: boolean) => act(`/api/posts/${postId}/open`, 'PUT', { open }),
    // Aanvragen (water, verkeer, vrijwilliger): geen spoed, dus zonder outbox; zonder bereik bel je de coördinator.
    requests: computed(() => state.value?.requests ?? []),
    requestById: (id: number) => state.value?.requests?.find((r) => r.id === id) ?? null,
    async request(postId: number, kind: RequestKind) {
      const created = await api<LiveRequest>('/api/requests', {
        method: 'POST', body: { postId, kind, detail: null, clientId: crypto.randomUUID() } satisfies NewRequest,
      });
      await refresh();
      return created;
    },
    setRequestDetail: (id: number, detail: string | null) => act(`/api/requests/${id}`, 'PUT', { detail }),
    pickRequest: (id: number) => act(`/api/requests/${id}/pick`, 'POST'),
    finishRequest: (id: number) => act(`/api/requests/${id}/done`, 'POST'),
    withdrawRequest: (id: number) => act(`/api/requests/${id}/withdraw`, 'POST'),
  };
});
