// Live stand: oproepen, eenheden en open/dicht van posten. Via SSE zolang de app open is; de laatste stand blijft bewaard voor zonder bereik.
// Every change happens on the phone first and goes into a queue, so the app never waits for the network (shared/src/action.ts).
import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import type {
  CloseIncident,
  ControlResult,
  IncidentDetails,
  LiveAction,
  LngLat,
  LiveIncident,
  LiveRequest,
  LiveState,
  NewIncident,
  QueuedAction,
  RequestKind,
  UnitAvailability,
} from '@ehbo/shared';
import { ACTION_AT_HEADER, ACTION_ID_HEADER, LIVE_HEARTBEAT_MS, POSITION_SHARE_MS, actionRequest, applyAction, placeOf } from '@ehbo/shared';
import { api, ApiRequestError, noAnswer } from '../api.ts';
import { messageDialog } from '../composables/useDialog.ts';
import { load, save } from '../storage.ts';
import { usePackageStore } from './package.ts';
import { useSessionStore } from './session.ts';

/** Zonder bericht (ook geen hartslag) in deze tijd is de verbinding stuk: opnieuw verbinden. */
const STALE_MS = LIVE_HEARTBEAT_MS + 15_000;
/** A dropped connection often comes back by itself; only after this long does the phone count as offline. */
const OFFLINE_AFTER_MS = 4_000;
/** How long an action waits for the server before the screen moves on; the change is already on the phone and stays in the queue. */
const ACTION_WAIT_MS = 1_500;
/** Bad signal: don't wait for an answer, try again later. */
const SEND_TIMEOUT_MS = 8_000;
/** An EHBO request without an answer in this time goes straight to calling; it keeps being sent. */
const REPORT_TIMEOUT_MS = 4_000;
const RETRY_MS = 10_000;
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
  /** The last state from the server. */
  const base = ref<LiveState | null>(stored?.dataVersion ? stored : null);
  /** Changes made on this phone that the server doesn't have yet, oldest first. */
  const queue = ref<QueuedAction[]>(load('ehbo.queue') ?? []);
  watch(queue, (value) => save('ehbo.queue', value.length ? value : null), { deep: true });
  /** A request made without signal has a temporary id; this maps it to the real one, so its screen keeps working. */
  const requestIds = ref<Record<number, number>>(load('ehbo.requestIds') ?? {});
  watch(requestIds, (value) => save('ehbo.requestIds', Object.keys(value).length ? value : null), { deep: true });
  /** The same for an incident an EHBO team started without signal. */
  const incidentIds = ref<Record<number, number>>(load('ehbo.incidentIds') ?? {});
  watch(incidentIds, (value) => save('ehbo.incidentIds', Object.keys(value).length ? value : null), { deep: true });
  /** What every screen shows: the server's state with this phone's own changes on top, so nothing ever waits for the network. */
  const state = computed<LiveState | null>(() => {
    if (!queue.value.length) return base.value;
    const context = { me: session.me, units: pkg.pkg?.units ?? [] };
    return queue.value.reduce((s, item) => applyAction(s, item, context), base.value ?? {
      version: 0, dataVersion: '', serverTime: new Date().toISOString(), incidents: [], units: [], posts: [], requests: [], testMode: false,
    });
  });
  /** Nog niet bij de server aangekomen. De server telt dezelfde clientId maar één keer, dus opnieuw versturen kan altijd. */
  const outbox = ref<NewIncident[]>(load('ehbo.outbox') ?? []);
  watch(outbox, (value) => save('ehbo.outbox', value.length ? value : null), { deep: true });
  const connected = ref(false);
  const browserOnline = ref(navigator.onLine);
  /** The server can't be reached, although the phone may think it has a network. */
  const serverLost = ref(false);
  const offline = computed(() => !browserOnline.value || serverLost.value);
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
    if (base.value && value.version < base.value.version && value.serverTime <= base.value.serverTime) return;
    base.value = value;
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
    source.addEventListener('ping', () => { lastMessage = Date.now(); });
    source.addEventListener('open', () => {
      lastMessage = Date.now();
      connected.value = true;
      void flush();
    });
    source.addEventListener('error', () => { connected.value = false; });
    watchdog = setInterval(() => {
      if (Date.now() - lastMessage <= STALE_MS) return;
      connected.value = false;
      void refresh().then(connect);
    }, 10_000);
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
      setState(await api<LiveState>('/api/live/state', { timeoutMs: SEND_TIMEOUT_MS }));
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
      base.value = null;
      save('ehbo.live', null);
      outbox.value = [];
      queue.value = [];
      requestIds.value = {};
      incidentIds.value = {};
    }
  }, { immediate: true });

  // Offline only after a moment: a connection that is back within seconds doesn't count.
  let lostTimer: ReturnType<typeof setTimeout> | undefined;
  function watchLink() {
    clearTimeout(lostTimer);
    serverLost.value = false;
    if (session.me && !connected.value) lostTimer = setTimeout(() => { serverLost.value = true; }, OFFLINE_AFTER_MS);
  }
  watch([connected, () => session.me?.phone], watchLink, { immediate: true });

  // Without a session there is no live connection: ask now and then whether the server is there.
  async function ping() {
    if (session.me || document.visibilityState !== 'visible') return;
    try {
      await api('/api/ehbo-status', { timeoutMs: SEND_TIMEOUT_MS });
      serverLost.value = false;
    } catch {
      serverLost.value = true;
    }
  }
  void ping();
  setInterval(() => void ping(), 30_000);

  window.addEventListener('online', () => { browserOnline.value = true; void flush(); });
  window.addEventListener('offline', () => { browserOnline.value = false; });

  // Back in the app: don't wait for the watchdog. A connection can look open while it died in the background.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    void ping();
    if (!session.me) return;
    watchLink();
    if (!source || source.readyState === EventSource.CLOSED || Date.now() - lastMessage > STALE_MS) connect();
    void refresh();
    void flush();
  });

  // ---- Afgeleid ----

  const serverNow = computed(() => now.value + clockOffset.value);
  const incidents = computed(() => state.value?.incidents ?? []);
  const openIncidents = computed(() => incidents.value.filter(isOpen));
  const incidentById = (id: number) => {
    const real = incidentIds.value[id] ?? id;
    return incidents.value.find((i) => i.id === real) ?? null;
  };
  const unitState = (id: number) => state.value?.units.find((u) => u.id === id) ?? null;
  /** Live open/dicht; zonder live stand wat in het evenementpakket staat. */
  const postOpen = (postId: number, fallback = false) => state.value?.posts.find((p) => p.id === postId)?.isOpen ?? fallback;
  const postState = (postId: number) => state.value?.posts.find((p) => p.id === postId) ?? null;

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

  const requestById = (id: number) => {
    const real = requestIds.value[id] ?? id;
    return state.value?.requests?.find((r) => r.id === real) ?? null;
  };

  const secondsLeft = (incident: LiveIncident) =>
    incident.escalatesAt ? Math.max(0, Math.ceil((new Date(incident.escalatesAt).getTime() - serverNow.value) / 1000)) : null;

  // ---- Acties: elk antwoord is de nieuwe stand ----

  /** Actions that a screen is still waiting for: a refusal goes to that screen, otherwise it gets its own dialog. */
  const waitedFor = new Map<string, string | null>();

  /** Happens on the phone right away and goes to the server as soon as it can; only a refusal by the server is an error. */
  async function act(action: LiveAction) {
    const item: QueuedAction = { id: crypto.randomUUID(), at: new Date(serverNow.value).toISOString(), action };
    queue.value.push(item);
    waitedFor.set(item.id, null);
    await sendQueueBriefly(offline.value ? 0 : ACTION_WAIT_MS);
    const refusal = waitedFor.get(item.id);
    waitedFor.delete(item.id);
    startRetrying();
    if (refusal) throw new Error(refusal);
  }

  async function sendAction(item: QueuedAction) {
    const { method, path, body } = actionRequest(item.action);
    const headers = { [ACTION_ID_HEADER]: item.id, [ACTION_AT_HEADER]: item.at };
    const answer = await api<LiveState | LiveRequest | LiveIncident>(path, { method, body, headers, timeoutMs: SEND_TIMEOUT_MS });
    if (item.action.type === 'selfStart') {
      const created = answer as LiveIncident;
      const { tempId } = item.action;
      incidentIds.value[tempId] = created.id;
      for (const { action } of queue.value) if ('incidentId' in action && action.incidentId === tempId) action.incidentId = created.id;
      // Until the next state from the server, so the screen of this incident doesn't lose it for a moment.
      if (base.value && !base.value.incidents.some((i) => i.id === created.id)) base.value = { ...base.value, incidents: [created, ...base.value.incidents] };
      return;
    }
    if (item.action.type !== 'requestNew') {
      setState(answer as LiveState);
      return;
    }
    const created = answer as LiveRequest;
    const { tempId } = item.action;
    requestIds.value[tempId] = created.id;
    for (const { action } of queue.value) if ('requestId' in action && action.requestId === tempId) action.requestId = created.id;
    // Until the next state from the server, so the screen of this request doesn't lose it for a moment.
    if (base.value && !base.value.requests.some((r) => r.id === created.id)) base.value = { ...base.value, requests: [created, ...base.value.requests] };
  }

  const incidentOf = (action: LiveAction) => (action.type === 'selfStart' ? action.tempId : 'incidentId' in action ? action.incidentId : null);

  function refuse(item: QueuedAction, reason: string) {
    // What came after it on the same incident can't work any more, and one message is enough.
    const incidentId = incidentOf(item.action);
    queue.value = queue.value.filter((q) => q.id !== item.id && (incidentId === null || incidentOf(q.action) !== incidentId));
    if (waitedFor.has(item.id)) waitedFor.set(item.id, reason);
    else void messageDialog({ title: 'Wijziging niet doorgevoerd', text: `Je wijziging kon niet worden verwerkt: ${reason}`, confirm: 'Begrepen' });
  }

  /** In order, one at a time: a later change can depend on an earlier one. Stops at the first that doesn't get through. */
  let sending: Promise<void> | null = null;
  async function drainQueue() {
    while (queue.value.length && session.me) {
      const item = queue.value[0]!;
      try {
        await sendAction(item);
        queue.value = queue.value.filter((q) => q.id !== item.id);
      } catch (err) {
        if (noAnswer(err)) return;
        if (err instanceof ApiRequestError && err.status === 401) {
          await session.refresh();
          return;
        }
        refuse(item, (err as Error).message);
      }
    }
  }
  function sendQueue() {
    sending ??= drainQueue().finally(() => { sending = null; });
    return sending;
  }
  /** The queue gets a moment, but never holds up the caller for long. */
  const sendQueueBriefly = (ms: number) => Promise.race([sendQueue(), new Promise((resolve) => { setTimeout(resolve, ms); })]);

  // ---- Melding zonder bereik: blijft op de telefoon staan en gaat vanzelf weg zodra er bereik is ----

  /** Wat later alsnog is aangekomen (clientId → melding), of door de server is geweigerd (clientId → reden). */
  const delivered = ref<Record<string, number>>({});
  const refused = ref<Record<string, string>>({});

  async function post(item: NewIncident) {
    // Slecht bereik: niet eindeloos wachten. Komt hij toch aan, dan telt de server hem bij de volgende poging niet dubbel.
    const res = await fetch('/api/incidents', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(item), signal: AbortSignal.timeout(REPORT_TIMEOUT_MS),
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
    // No connection: straight to calling. Every second counts, so don't try first.
    if (offline.value) {
      startRetrying();
      throw new OfflineError(item.clientId);
    }
    try {
      // A post opened without signal has to be open on the server before it can ask for help.
      await sendQueueBriefly(ACTION_WAIT_MS);
      const incident = await post(item);
      drop(item.clientId);
      delivered.value[item.clientId] = incident.id;
      await refresh();
      return incident;
    } catch (err) {
      if (!noAnswer(err)) {
        drop(item.clientId);
        throw err;
      }
      startRetrying();
      throw new OfflineError(item.clientId);
    }
  }

  let flushing = false;
  /** Everything that's waiting: first the changes, then the EHBO requests (a post opened without signal must be open first). */
  async function flush() {
    if (flushing || !session.me) return;
    flushing = true;
    try {
      await sendQueue();
      for (const item of [...outbox.value]) {
        try {
          delivered.value[item.clientId] = (await post(item)).id;
          drop(item.clientId);
        } catch (err) {
          if (noAnswer(err)) break; // nog geen bereik: later opnieuw
          refused.value[item.clientId] = (err as Error).message;
          drop(item.clientId);
        }
      }
      if (Object.keys(delivered.value).length) await refresh();
    } finally {
      flushing = false;
    }
  }

  let retryTimer: ReturnType<typeof setInterval> | null = null;
  function startRetrying() {
    retryTimer ??= setInterval(() => {
      if (!outbox.value.length && !queue.value.length) {
        clearInterval(retryTimer!);
        retryTimer = null;
        return;
      }
      void flush();
    }, RETRY_MS);
  }
  if (outbox.value.length || queue.value.length) {
    startRetrying();
    void flush();
  }

  return {
    state, connected, offline, syncing, serverNow, sharingUnit, incidents, openIncidents, invitations, myActive, myUnitIds, myPostIds,
    incidentById, unitState, postOpen, postState, secondsLeft, needsAed, refresh, connect, report, checkData,
    /** "Opnieuw laden": everything at once. */
    reload: () => Promise.all([syncData(), refresh()]),
    outbox, delivered, refused, flush,
    update: (incidentId: number, details: IncidentDetails) => act({ type: 'update', incidentId, details }),
    accept: (incidentId: number, unitId: number) => act({ type: 'accept', incidentId, unitId }),
    decline: (incidentId: number, unitId: number) => act({ type: 'decline', incidentId, unitId }),
    assign: (incidentId: number, unitId: number) => act({ type: 'assign', incidentId, unitId }),
    onSite: (incidentId: number) => act({ type: 'onSite', incidentId }),
    close: (incidentId: number, body: CloseIncident) => act({ type: 'close', incidentId, body }),
    withdraw: (incidentId: number) => act({ type: 'withdraw', incidentId }),
    /** Someone came to the team. Gives the id to open it with; without signal that's a temporary one, which keeps working afterwards. */
    async selfStart({ unitId, postId, position, ...details }: IncidentDetails & { unitId: number; postId: number; position: LngLat | null }) {
      const tempId = -Date.now();
      const known = pkg.postById.get(postId);
      const place = position ? placeOf(pkg.pkg?.posts ?? [], position) : null;
      const shown = place ? pkg.postById.get(place.postId) ?? known : known;
      await act({
        type: 'selfStart', tempId, postId: shown?.id ?? postId, offPost: place !== null && !place.atPost,
        post: {
          typeId: shown?.typeId ?? 0, name: place?.name ?? shown?.name ?? 'Post', km: shown?.km ?? null,
          lat: place && !place.atPost ? position![1] : shown?.lat ?? null, lng: place && !place.atPost ? position![0] : shown?.lng ?? null,
        },
        body: { clientId: crypto.randomUUID(), unitId, postId, lat: position?.[1] ?? null, lng: position?.[0] ?? null, ...details },
      });
      return incidentIds.value[tempId] ?? tempId;
    },
    setAvailability: (unitId: number, availability: UnitAvailability) => act({ type: 'availability', unitId, availability }),
    setPostOpen: (postId: number, open: boolean) => act({ type: 'postOpen', postId, open }),
    keepPost: (postId: number) => act({ type: 'keepPost', postId }),
    keepUnit: (unitId: number) => act({ type: 'keepUnit', unitId }),
    /** The coordinator's buttons: these change everything at once, so they need the server. */
    async control(action: 'open-all' | 'close-all' | 'close-day') {
      const answer = await api<ControlResult>(`/api/control/${action}`, { method: 'POST' });
      setState(answer.state);
      return answer.skipped;
    },
    // Aanvragen (water, verkeer, vrijwilliger) gaan ook zonder bereik door: ze wachten in de wachtrij.
    requests: computed(() => state.value?.requests ?? []),
    requestById,
    /** Gives the id to open the request with; without signal that's a temporary one, which keeps working afterwards. */
    async request(postId: number, kind: RequestKind) {
      const tempId = -Date.now();
      await act({ type: 'requestNew', tempId, clientId: crypto.randomUUID(), postId, postName: pkg.postById.get(postId)?.name ?? 'Post', kind });
      return { id: requestIds.value[tempId] ?? tempId };
    },
    setRequestDetail: (requestId: number, detail: string | null) => act({ type: 'requestDetail', requestId, detail }),
    pickRequest: (requestId: number) => act({ type: 'requestPick', requestId }),
    finishRequest: (requestId: number) => act({ type: 'requestDone', requestId }),
    withdrawRequest: (requestId: number) => act({ type: 'requestWithdraw', requestId }),
  };
});
