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
