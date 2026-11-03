// Lokaal bewaren voor gebruik zonder bereik. localStorage kan ontbreken (privévenster); dan werkt alles nog, alleen niet offline.
export function load<T>(key: string): T | null {
  try {
    const value = localStorage.getItem(key);
    return value === null ? null : (JSON.parse(value) as T);
  } catch {
    return null;
  }
}

/**
 * What a phone kept from an older version of the app, in the words of this one: run once at the start, before anything reads it.
 * A change that waits in the queue keeps its meaning, so nothing is lost by updating. Steps are added, never changed.
 */
const STORAGE_STEPS: ((read: <T>(key: string) => T | null, write: (key: string, value: unknown) => void) => void)[] = [
  // 1: team and contact values in English (docs/begrippen.md).
  (read, write) => {
    const AVAILABILITY: Record<string, string> = { vrij: 'available', pauze: 'unavailable', uit_dienst: 'off_duty' };
    const KIND: Record<string, string> = { vast: 'fixed', mobiel: 'mobile' };
    const MOBILITY: Record<string, string> = { te_voet: 'on_foot', fiets: 'bike', auto: 'car', anders: 'other' };
    const ROLE: Record<string, string> = { verantwoordelijke: 'lead', lid: 'member' };
    type Any = Record<string, any>;
    const queue = read<Any[]>('ehbo.queue');
    if (queue) write('ehbo.queue', queue.map((q) => (q.action?.type === 'availability' ? { ...q, action: { ...q.action, availability: AVAILABILITY[q.action.availability] ?? q.action.availability } } : q)));
    const live = read<Any>('ehbo.live');
    if (live?.units) write('ehbo.live', { ...live, units: live.units.map((u: Any) => ({ ...u, availability: AVAILABILITY[u.availability] ?? u.availability })) });
    const pkg = read<Any>('ehbo.package');
    if (pkg?.units) {
      write('ehbo.package', {
        ...pkg,
        units: pkg.units.map((u: Any) => ({ ...u, kind: KIND[u.kind] ?? u.kind, mobility: MOBILITY[u.mobility] ?? u.mobility })),
        posts: (pkg.posts ?? []).map((p: Any) => ({ ...p, contacts: p.contacts?.map((c: Any) => ({ ...c, role: ROLE[c.role] ?? c.role })) })),
      });
    }
    const me = read<Any>('ehbo.me');
    if (me?.assignments) write('ehbo.me', { ...me, assignments: me.assignments.map((a: Any) => (a.role ? { ...a, role: ROLE[a.role] ?? a.role } : a)) });
  },
  // 2: an EHBO unit is a team: units → teams and unitId → teamId wherever they are, and the action keepUnit → keepTeam.
  (read, write) => {
    const KEYS: Record<string, string> = { units: 'teams', unitId: 'teamId' };
    const rename = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(rename);
      if (!value || typeof value !== 'object') return value;
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [KEYS[k] ?? k, k === 'type' && v === 'keepUnit' ? 'keepTeam' : rename(v)]));
    };
    for (const key of ['ehbo.queue', 'ehbo.live', 'ehbo.package', 'ehbo.me', 'ehbo.outbox']) {
      const value = read<unknown>(key);
      if (value !== null) write(key, rename(value));
    }
  },
  // 3: one help request with a type (#86): statuses and values in English, and a request's id is 1,000,000 higher.
  (read, write) => {
    const STATUS: Record<string, string> = {
      verstuurd: 'sent', geaccepteerd: 'accepted', ter_plaatse: 'on_site', afgerond: 'closed', ingetrokken: 'withdrawn', aangevraagd: 'sent', opgepakt: 'accepted', afgehandeld: 'closed',
    };
    const STAGE: Record<string, string> = { dichtstbij: 'nearest', alle: 'all' };
    const REASON: Record<string, string> = { dichtstbij: 'nearest', alle: 'all', handmatig: 'manual' };
    const EVENT: Record<string, string> = {
      gemeld: 'reported', verstuurd: 'sent', aangevuld: 'added', geweigerd: 'declined', geescaleerd: 'escalated', herhaald: 'repeated',
      geaccepteerd: 'accepted', toegewezen: 'assigned', ter_plaatse: 'on_site', afgerond: 'closed', ingetrokken: 'withdrawn',
    };
    const WHAT: Record<string, string> = { onwel: 'unwell', letsel: 'injury', kramp: 'cramp', onbekend: 'unknown' };
    const RESPONSIVE: Record<string, string> = { ja: 'yes', nee: 'no', onbekend: 'unknown' };
    const OUTCOME: Record<string, string> = { geholpen: 'treated', gestopt: 'stopped', doorverwezen: 'referred', geweigerd: 'refused', loos: 'false_alarm' };
    const KIND: Record<string, string> = { verkeer: 'traffic', vrijwilliger: 'volunteer' };
    const DETAIL: Record<string, string> = {
      beetje: 'little', flink: 'lots', bijna_op: 'almost_empty', druk: 'busy', onveilig: 'unsafe', afzetting: 'closure', aflossing: 'relief', uitval: 'dropout',
    };
    type Any = Record<string, any>;
    const map = (table: Record<string, string>, value: unknown) => (typeof value === 'string' ? table[value] ?? value : value);
    /** A request id on the server; a negative one is a request still waiting on this phone. */
    const requestId = (id: unknown) => (typeof id === 'number' && id > 0 ? id + 1_000_000 : id);
    const details = (d: Any | undefined) => (d ? { ...d, what: map(WHAT, d.what), responsive: map(RESPONSIVE, d.responsive) } : d);
    const incident = (i: Any) => ({
      ...details(i), status: map(STATUS, i.status), stage: map(STAGE, i.stage), outcome: map(OUTCOME, i.outcome),
      dispatches: i.dispatches?.map((d: Any) => ({ ...d, reason: map(REASON, d.reason) })),
      events: i.events?.map((e: Any) => ({ ...e, type: map(EVENT, e.type) })),
    });
    const request = (r: Any) => ({ ...r, id: requestId(r.id), kind: map(KIND, r.kind), detail: map(DETAIL, r.detail), status: map(STATUS, r.status) });

    const live = read<Any>('ehbo.live');
    if (live) write('ehbo.live', { ...live, incidents: live.incidents?.map(incident), requests: live.requests?.map(request) });
    const queue = read<Any[]>('ehbo.queue');
    if (queue) {
      write('ehbo.queue', queue.map((q) => {
        const a = q.action ?? {};
        const action = {
          ...a,
          ...(a.details ? { details: details(a.details) } : {}),
          ...(a.body ? { body: { ...details(a.body), outcome: map(OUTCOME, a.body.outcome) } } : {}),
          ...('requestId' in a ? { requestId: requestId(a.requestId) } : {}),
          ...(a.kind ? { kind: map(KIND, a.kind) } : {}),
          ...('detail' in a ? { detail: map(DETAIL, a.detail) } : {}),
        };
        return { ...q, action };
      }));
    }
    const outbox = read<Any[]>('ehbo.outbox');
    if (outbox) write('ehbo.outbox', outbox.map(details));
    const ids = read<Record<string, number>>('ehbo.requestIds');
    if (ids) write('ehbo.requestIds', Object.fromEntries(Object.entries(ids).map(([temp, id]) => [temp, requestId(id) as number])));
  },
];

export function upgradeStorage() {
  const done = load<number>('ehbo.storage') ?? 0;
  for (let i = done; i < STORAGE_STEPS.length; i++) {
    try {
      STORAGE_STEPS[i]!(load, save);
    } catch {
      // Something unreadable: the next fetch from the server replaces it.
    }
  }
  if (done < STORAGE_STEPS.length) save('ehbo.storage', STORAGE_STEPS.length);
}

export function save(key: string, value: unknown) {
  try {
    if (value === null || value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Niet bewaard; de app werkt dan alleen met bereik.
  }
}
