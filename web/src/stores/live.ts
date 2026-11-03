// Live stand: oproepen, eenheden en open/dicht van posten. Via SSE zolang de app open is; de laatste stand blijft bewaard voor zonder bereik.
// Every change happens on the phone first and goes into a queue, so the app never waits for the network (shared/src/action.ts).
import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import { incidentsOf, requestsOf } from '@ehbo/shared';
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
  TeamAvailability,
} from '@ehbo/shared';
import { ACTION_AT_HEADER, ACTION_ID_HEADER, LIVE_HEARTBEAT_MS, POSITION_SHARE_MS, actionRequest, applyAction, placeOf } from '@ehbo/shared';
import { api, ApiRequestError, noAnswer } from '../api.ts';
import { messageDialog } from '../composables/useDialog.ts';
import { atLocationM } from '../locations.ts';
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
const OPEN = ['sent', 'accepted', 'on_site'] as const;

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
  const stored = load<LiveState>('app.live');
  /** The last state from the server. */
  const base = ref<LiveState | null>(stored?.dataVersion ? stored : null);
  /** Changes made on this phone that the server doesn't have yet, oldest first. */
  const queue = ref<QueuedAction[]>(load('app.queue') ?? []);
  watch(queue, (value) => save('app.queue', value.length ? value : null), { deep: true });
  /** A request made without signal has a temporary id; this maps it to the real one, so its screen keeps working. */
  /** A help request made on the phone has a negative id until the server gives it its own (#86: one map for every type). */
  const tempIds = ref<Record<number, number>>(load('app.tempIds') ?? {});
  watch(tempIds, (value) => save('app.tempIds', Object.keys(value).length ? value : null), { deep: true });
  /** The same for an incident an EHBO team started without signal. */
  /** What every screen shows: the server's state with this phone's own changes on top, so nothing ever waits for the network. */
  const state = computed<LiveState | null>(() => {
    if (!queue.value.length) return base.value;
    const context = { me: session.me, teams: pkg.pkg?.teams ?? [] };
    return queue.value.reduce((s, item) => applyAction(s, item, context), base.value ?? {
      version: 0, dataVersion: '', serverTime: new Date().toISOString(), helpRequests: [], teams: [], locations: [], testMode: false,
    });
  });
  /** Nog niet bij de server aangekomen. De server telt dezelfde clientId maar één keer, dus opnieuw versturen kan altijd. */
  /** Wat later alsnog is aangekomen (clientId → melding), of door de server is geweigerd (clientId → reden). */
  const delivered = ref<Record<string, number>>({});
  const refused = ref<Record<string, string>>({});
  /** EHBO requests still on their way: they wait in the same queue as every other change, in order. */
  const outbox = computed(() => queue.value.flatMap((q) => (q.action.type === 'report' ? [q.action.body] : [])));
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
    save('app.live', value);
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
      save('app.live', null);
      queue.value = [];
      tempIds.value = {};
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
      await api('/api/first-aid-status', { timeoutMs: SEND_TIMEOUT_MS });
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
  // One list on the server (#86); the screens look at incidents and requests apart.
  const incidents = computed(() => (state.value ? incidentsOf(state.value) : []));
  const requests = computed(() => (state.value ? requestsOf(state.value) : []));
  const openIncidents = computed(() => incidents.value.filter(isOpen));
  const incidentById = (id: number) => {
    const real = tempIds.value[id] ?? id;
    return incidents.value.find((i) => i.id === real) ?? null;
  };
  const teamState = (id: number) => state.value?.teams.find((u) => u.id === id) ?? null;
  /** Live open/dicht; zonder live stand wat in het evenementpakket staat. */
  const locationOpen = (locationId: number, fallback = false) => state.value?.locations.find((p) => p.id === locationId)?.isOpen ?? fallback;
  const locationState = (locationId: number) => state.value?.locations.find((p) => p.id === locationId) ?? null;

  const myTeamIds = computed(() => session.me?.assignments.filter((a) => a.kind === 'team').map((a) => a.teamId!) ?? []);
  const myLocationIds = computed(() => session.me?.assignments.filter((a) => a.kind === 'location').map((a) => a.locationId!) ?? []);

  const hasAed = (teamId: number) => pkg.pkg?.teams.find((u) => u.id === teamId)?.hasAed ?? false;

  /** Bij niet aanspreekbaar blijft een eenheid met AED opgeroepen tot er een eenheid met AED heeft geaccepteerd (zoals de server). */
  const needsAed = (incident: LiveIncident, teamId: number) =>
    incident.aed && hasAed(teamId) && !incident.dispatches.some((d) => d.acceptedAt && hasAed(d.teamId));

  /** Oproepen waar een eenheid van mij op kan reageren: opgeroepen, niet geweigerd, nog niet aangenomen. */
  const invitations = computed(() => openIncidents.value.filter((i) => i.dispatches.some((d) =>
    myTeamIds.value.includes(d.teamId) && !d.declinedAt && !d.acceptedAt && (i.status === 'sent' || needsAed(i, d.teamId)))));

  /** Oproep waar een eenheid van mij mee bezig is. */
  const myActive = computed(() => openIncidents.value.find((i) => i.dispatches.some((d) => myTeamIds.value.includes(d.teamId) && d.acceptedAt)) ?? null);

  // Safety net: something refers to a post or team this phone doesn't know yet. Don't wait: this may be a call.
  const unknownData = computed(() => {
    if (!pkg.pkg) return '';
    const assignments = session.me?.assignments ?? [];
    const locations = [...incidents.value.map((i) => i.locationId), ...requests.value.map((r) => r.locationId), ...myLocationIds.value];
    const teams = [...(state.value?.teams ?? []).map((u) => u.id), ...assignments.flatMap((a) => (a.teamId == null ? [] : [a.teamId]))];
    return [
      ...locations.filter((id) => !pkg.locationById.has(id)).map((id) => `post ${id}`),
      ...teams.filter((id) => !pkg.pkg!.teams.some((u) => u.id === id)).map((id) => `team ${id}`),
    ].join();
  });
  watch(unknownData, (unknown) => { if (unknown) void syncData(); });

  // Sharing a position belongs to a person (#101), but only with a reason: being on a mobile team on duty. Every minute to the server
  // (nearest team, ambulance on the map); at once on a change of status, so everyone's map is right straight away.
  // Een webapp krijgt geen positie zolang hij op de achtergrond staat; dan telt na 3 minuten weer de standplaats.
  const sharingTeam = computed(() => myTeamIds.value.find((id) =>
    pkg.pkg?.teams.find((u) => u.id === id)?.kind === 'mobile' && (teamState(id)?.availability ?? 'off_duty') !== 'off_duty') ?? null);
  let geoWatch: number | null = null;
  let lastSent = 0;
  /** This phone's own position while it shares: every fix, not once a minute. It stays on the phone; the server gets one a minute. */
  const ownFix = ref<{ lat: number; lng: number; at: string } | null>(null);
  const sendPosition = (coords: GeolocationCoordinates) => {
    lastSent = Date.now();
    fetch('/api/position', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat: coords.latitude, lng: coords.longitude }),
    }).catch(() => {});
  };
  watch(sharingTeam, (teamId) => {
    if (geoWatch !== null) navigator.geolocation.clearWatch(geoWatch);
    geoWatch = null;
    ownFix.value = null;
    if (teamId === null || !('geolocation' in navigator)) return;
    geoWatch = navigator.geolocation.watchPosition(({ coords }) => {
      ownFix.value = { lat: coords.latitude, lng: coords.longitude, at: new Date(serverNow.value).toISOString() };
      if (Date.now() - lastSent >= POSITION_SHARE_MS) sendPosition(coords);
    }, () => {}, { enableHighAccuracy: true, maximumAge: 5_000 });
  }, { immediate: true });
  /** The teams as the server has them, with my own mobile team at my live position: on my own map I don't lag behind myself. */
  const teams = computed(() => (state.value?.teams ?? []).map((u) => (u.id === sharingTeam.value && ownFix.value ? { ...u, position: ownFix.value } : u)));
  // Status gewijzigd (bijv. van pauze naar beschikbaar): de positie meteen sturen, niet pas na een minuut.
  watch(() => (sharingTeam.value !== null ? teamState(sharingTeam.value)?.availability : null), (availability, before) => {
    const teamId = sharingTeam.value;
    if (teamId === null || !availability || availability === before || !('geolocation' in navigator)) return;
    navigator.geolocation.getCurrentPosition(({ coords }) => sendPosition(coords), () => {}, { enableHighAccuracy: true, maximumAge: 15_000, timeout: 15_000 });
  });

  const requestById = (id: number) => {
    const real = tempIds.value[id] ?? id;
    return requests.value.find((r) => r.id === real) ?? null;
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
    // Asking for EHBO waits less long: with bad signal the phone offers calling instead.
    const timeoutMs = item.action.type === 'report' ? REPORT_TIMEOUT_MS : SEND_TIMEOUT_MS;
    const answer = await api<LiveState | LiveRequest | LiveIncident>(path, { method, body, headers, timeoutMs });
    if (item.action.type === 'report') {
      const created = answer as LiveIncident;
      delivered.value[item.action.body.clientId] = created.id;
      if (base.value && !base.value.helpRequests.some((h) => h.id === created.id)) base.value = { ...base.value, helpRequests: [created, ...base.value.helpRequests] };
      return;
    }
    if (item.action.type === 'selfStart') {
      const created = answer as LiveIncident;
      const { tempId } = item.action;
      tempIds.value[tempId] = created.id;
      for (const { action } of queue.value) if ('incidentId' in action && action.incidentId === tempId) action.incidentId = created.id;
      // Until the next state from the server, so the screen of this incident doesn't lose it for a moment.
      if (base.value && !base.value.helpRequests.some((h) => h.id === created.id)) base.value = { ...base.value, helpRequests: [created, ...base.value.helpRequests] };
      return;
    }
    if (item.action.type !== 'requestNew') {
      setState(answer as LiveState);
      return;
    }
    const created = answer as LiveRequest;
    const { tempId } = item.action;
    tempIds.value[tempId] = created.id;
    for (const { action } of queue.value) if ('requestId' in action && action.requestId === tempId) action.requestId = created.id;
    // Until the next state from the server, so the screen of this request doesn't lose it for a moment.
    if (base.value && !base.value.helpRequests.some((h) => h.id === created.id)) base.value = { ...base.value, helpRequests: [created, ...base.value.helpRequests] };
  }

  const incidentOf = (action: LiveAction) => (action.type === 'selfStart' ? action.tempId : 'incidentId' in action ? action.incidentId : null);

  function refuse(item: QueuedAction, reason: string) {
    // What came after it on the same incident can't work any more, and one message is enough.
    const incidentId = incidentOf(item.action);
    queue.value = queue.value.filter((q) => q.id !== item.id && (incidentId === null || incidentOf(q.action) !== incidentId));
    // A refused EHBO request says so on the screen that offers calling.
    if (item.action.type === 'report') refused.value[item.action.body.clientId] = reason;
    if (waitedFor.has(item.id)) waitedFor.set(item.id, reason);
    else if (item.action.type === 'report') return;
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


  /**
   * Asking for EHBO: in the queue behind what came before (a post opened without signal is open first on the server), and
   * sent the same way, once by its clientId. Throws OfflineError when it hasn't arrived yet: the phone then offers calling.
   */
  async function report(request: Omit<NewIncident, 'type' | 'clientId' | 'reportedAt'>) {
    const body: NewIncident = { ...request, type: 'first_aid', clientId: crypto.randomUUID(), reportedAt: new Date(serverNow.value).toISOString() };
    const item: QueuedAction = { id: crypto.randomUUID(), at: body.reportedAt!, action: { type: 'report', body } };
    queue.value.push(item);
    // No connection: straight to calling. Every second counts, so don't try first.
    if (offline.value) {
      startRetrying();
      throw new OfflineError(body.clientId);
    }
    waitedFor.set(item.id, null);
    await sendQueueBriefly(ACTION_WAIT_MS + REPORT_TIMEOUT_MS);
    const refusal = waitedFor.get(item.id);
    waitedFor.delete(item.id);
    if (refusal) throw new Error(refusal);
    const id = delivered.value[body.clientId];
    if (id === undefined) {
      startRetrying();
      throw new OfflineError(body.clientId);
    }
    await refresh();
    return incidentById(id) ?? state.value!.helpRequests.find((h) => h.id === id) as LiveIncident;
  }

  /** Everything that's waiting, in order. */
  async function flush() {
    if (!session.me) return;
    const before = Object.keys(delivered.value).length;
    await sendQueue();
    if (Object.keys(delivered.value).length > before) await refresh();
  }

  let retryTimer: ReturnType<typeof setInterval> | null = null;
  function startRetrying() {
    retryTimer ??= setInterval(() => {
      if (!queue.value.length) {
        clearInterval(retryTimer!);
        retryTimer = null;
        return;
      }
      void flush();
    }, RETRY_MS);
  }
  if (queue.value.length) {
    startRetrying();
    void flush();
  }

  return {
    state, teams, connected, offline, syncing, serverNow, sharingTeam, incidents, openIncidents, invitations, myActive, myTeamIds, myLocationIds,
    incidentById, teamState, locationOpen, locationState, secondsLeft, needsAed, refresh, connect, report, checkData,
    /** "Opnieuw laden": everything at once. */
    reload: () => Promise.all([syncData(), refresh()]),
    outbox, delivered, refused, flush,
    update: (incidentId: number, details: IncidentDetails) => act({ type: 'update', incidentId, details }),
    accept: (incidentId: number, teamId: number) => act({ type: 'accept', incidentId, teamId }),
    decline: (incidentId: number, teamId: number) => act({ type: 'decline', incidentId, teamId }),
    assign: (incidentId: number, teamId: number) => act({ type: 'assign', incidentId, teamId }),
    onSite: (incidentId: number) => act({ type: 'onSite', incidentId }),
    close: (incidentId: number, body: CloseIncident) => act({ type: 'close', incidentId, body }),
    withdraw: (incidentId: number) => act({ type: 'withdraw', incidentId }),
    /** Someone came to the team. Gives the id to open it with; without signal that's a temporary one, which keeps working afterwards. */
    async selfStart({ teamId, locationId, position, ...details }: IncidentDetails & { teamId: number; locationId: number; position: LngLat | null }) {
      const tempId = -Date.now();
      const known = pkg.locationById.get(locationId);
      const place = position ? placeOf(pkg.pkg?.locations ?? [], position, atLocationM(pkg.pkg)) : null;
      const shown = place ? pkg.locationById.get(place.locationId) ?? known : known;
      await act({
        type: 'selfStart', tempId, locationId: shown?.id ?? locationId, offLocation: place !== null && !place.atLocation,
        location: {
          typeId: shown?.typeId ?? 0, name: place?.name ?? shown?.name ?? 'Locatie', km: shown?.km ?? null,
          lat: place && !place.atLocation ? position![1] : shown?.lat ?? null, lng: place && !place.atLocation ? position![0] : shown?.lng ?? null,
        },
        body: { clientId: crypto.randomUUID(), teamId, locationId, lat: position?.[1] ?? null, lng: position?.[0] ?? null, ...details },
      });
      return tempIds.value[tempId] ?? tempId;
    },
    setAvailability: (teamId: number, availability: TeamAvailability) => act({ type: 'availability', teamId, availability }),
    setLocationOpen: (locationId: number, open: boolean) => act({ type: 'locationOpen', locationId, open }),
    keepLocation: (locationId: number) => act({ type: 'keepLocation', locationId }),
    keepTeam: (teamId: number) => act({ type: 'keepTeam', teamId }),
    /** The coordinator's buttons: these change everything at once, so they need the server. */
    async control(action: 'open-all' | 'close-all' | 'close-day') {
      const answer = await api<ControlResult>(`/api/control/${action}`, { method: 'POST' });
      setState(answer.state);
      return answer.skipped;
    },
    // Aanvragen (water, verkeer, vrijwilliger) gaan ook zonder bereik door: ze wachten in de wachtrij.
    requests,
    requestById,
    /** Gives the id to open the request with; without signal that's a temporary one, which keeps working afterwards. */
    async request(locationId: number, kind: RequestKind) {
      const tempId = -Date.now();
      await act({ type: 'requestNew', tempId, clientId: crypto.randomUUID(), locationId, locationName: pkg.locationById.get(locationId)?.name ?? 'Post', kind });
      return { id: tempIds.value[tempId] ?? tempId };
    },
    setRequestDetail: (requestId: number, detail: string | null) => act({ type: 'requestDetail', requestId, detail }),
    pickRequest: (requestId: number) => act({ type: 'requestPick', requestId }),
    finishRequest: (requestId: number) => act({ type: 'requestDone', requestId }),
    withdrawRequest: (requestId: number) => act({ type: 'requestWithdraw', requestId }),
  };
});
