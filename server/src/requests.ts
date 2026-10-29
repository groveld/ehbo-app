// Eenvoudige aanvragen van posten: water, verkeer, vrijwilliger. Gaan naar de wachtrij van de evenementcoördinator, zonder alarm.
// Aangevraagd → opgepakt → afgehandeld, of ingetrokken door de post.
import { REQUEST_KINDS, requestDetailLabel, type LiveRequest, type Me, type NewRequest, type PushPayload, type RequestKind, type RequestStatus } from '@ehbo/shared';
import type { EventDb } from './event-db.ts';

const httpError = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });

type Row = Record<string, string | number | null>;

export interface RequestsOptions {
  notify: (phones: Iterable<string>, payload: PushPayload) => void;
  /** De live stand is veranderd: iedereen het nieuwe overzicht sturen. */
  changed: () => void;
  now?: () => Date;
}

export type Requests = ReturnType<typeof createRequests>;

export function createRequests(db: EventDb, { notify: send, changed, now = () => new Date() }: RequestsOptions) {
  const notify: RequestsOptions['notify'] = (phones, payload) => send(phones, db.testMode() ? { ...payload, title: `Test · ${payload.title}` } : payload);
  const sql = db.raw;
  const get = (query: string, ...params: (string | number | null)[]) => sql.prepare(query).get(...params) as Row | undefined;
  const all = (query: string, ...params: (string | number | null)[]) => sql.prepare(query).all(...params) as Row[];
  const run = (query: string, ...params: (string | number | null)[]) => sql.prepare(query).run(...params);
  const iso = () => now().toISOString();

  const personName = (phone: string) => (get('SELECT name FROM people WHERE phone = ?', phone)?.name as string | undefined) || phone;
  const postName = (postId: number) => (get('SELECT name FROM posts WHERE id = ?', postId)?.name as string | undefined) ?? 'Post';
  const postPhones = (postId: number) => all('SELECT phone FROM post_contacts WHERE post_id = ?', postId).map((r) => r.phone as string);

  const isCoordinator = (me: Me) => db.coordinatorPhone() === me.phone;
  /** De wachtrij beheren: de evenementcoördinator, het kernteam en beheerders. */
  const handles = (me: Me) => isCoordinator(me) || me.isAdmin || me.assignments.some((a) => a.kind === 'kernteam');
  const atPost = (me: Me, postId: number) => me.assignments.some((a) => a.kind === 'post' && a.postId === postId);

  function list(): LiveRequest[] {
    const rows = all('SELECT * FROM requests ORDER BY id DESC');
    const queue = rows.filter((r) => r.status === 'aangevraagd' || r.status === 'opgepakt').map((r) => r.id as number).reverse();
    return rows.map((r) => {
      const pickedBy = r.picked_by as string | null;
      const position = queue.indexOf(r.id as number);
      return {
        id: r.id as number,
        isTest: r.is_test === 1,
        postId: r.post_id as number,
        kind: r.kind as RequestKind,
        detail: r.detail as string | null,
        status: r.status as RequestStatus,
        createdAt: r.created_at as string,
        pickedAt: r.picked_at as string | null,
        pickedBy: pickedBy ? { name: personName(pickedBy), phone: pickedBy } : null,
        doneAt: r.done_at as string | null,
        position: position >= 0 ? position + 1 : null,
      };
    });
  }

  function row(id: number) {
    const r = get('SELECT * FROM requests WHERE id = ?', id);
    if (!r) throw httpError(404, 'Aanvraag niet gevonden');
    return r;
  }

  const checkDetail = (kind: RequestKind, detail: string | null) => {
    if (detail !== null && !(detail in REQUEST_KINDS[kind].details)) throw httpError(400, 'Onbekende keuze bij deze aanvraag');
  };

  const describe = (r: Row) => [REQUEST_KINDS[r.kind as RequestKind].label, requestDetailLabel(r.kind as RequestKind, r.detail as string | null)]
    .filter(Boolean).join(' · ');

  function create(me: Me, body: NewRequest) {
    const existing = get('SELECT id FROM requests WHERE client_id = ?', body.clientId);
    if (existing) return list().find((r) => r.id === existing.id)!;
    const post = get('SELECT id, is_open FROM posts WHERE id = ?', body.postId);
    if (!post) throw httpError(404, 'Post niet gevonden');
    if (!atPost(me, body.postId) && !handles(me)) throw httpError(403, 'Je kunt alleen een aanvraag doen vanaf je eigen post');
    if (post.is_open !== 1) throw httpError(409, 'Deze post is dicht. Zet de post eerst open.');
    checkDetail(body.kind, body.detail);
    const id = Number(run(`INSERT INTO requests (client_id, post_id, kind, detail, status, reported_by, created_at, is_test)
                           VALUES (?, ?, ?, ?, 'aangevraagd', ?, ?, ?)`, body.clientId, body.postId, body.kind, body.detail, me.phone, iso(), db.testMode() ? 1 : 0).lastInsertRowid);
    const coordinator = db.coordinatorPhone();
    if (coordinator) {
      notify([coordinator], { title: `${REQUEST_KINDS[body.kind].label} · ${postName(body.postId)}`, body: `${describe(row(id))}. Staat in de wachtrij.`, tag: `aanvraag-${id}`, url: '/overzicht/meldingen' });
    }
    changed();
    return list().find((r) => r.id === id)!;
  }

  function setDetail(me: Me, id: number, detail: string | null) {
    const r = row(id);
    if (!atPost(me, r.post_id as number) && !handles(me)) throw httpError(403, 'Alleen de post kan de aanvraag aanpassen');
    if (r.status !== 'aangevraagd' && r.status !== 'opgepakt') throw httpError(409, 'Deze aanvraag is al afgehandeld');
    checkDetail(r.kind as RequestKind, detail);
    run('UPDATE requests SET detail = ? WHERE id = ?', detail, id);
    changed();
    return list();
  }

  function pick(me: Me, id: number) {
    if (!handles(me)) throw httpError(403, 'Alleen de evenementcoördinator pakt aanvragen op');
    const r = row(id);
    if (r.status !== 'aangevraagd') throw httpError(409, r.status === 'opgepakt' ? `Al opgepakt door ${personName(r.picked_by as string)}` : 'Deze aanvraag is niet meer open');
    run("UPDATE requests SET status = 'opgepakt', picked_at = ?, picked_by = ? WHERE id = ?", iso(), me.phone, id);
    notify(postPhones(r.post_id as number), { title: `${REQUEST_KINDS[r.kind as RequestKind].label} wordt geregeld`, body: `${personName(me.phone)} heeft je aanvraag opgepakt.`, tag: `aanvraag-${id}`, url: `/aanvraag/${id}` });
    changed();
    return list();
  }

  function done(me: Me, id: number) {
    if (!handles(me)) throw httpError(403, 'Alleen de evenementcoördinator handelt aanvragen af');
    const r = row(id);
    if (r.status !== 'aangevraagd' && r.status !== 'opgepakt') return list();
    run("UPDATE requests SET status = 'afgehandeld', done_at = ?, picked_at = COALESCE(picked_at, ?), picked_by = COALESCE(picked_by, ?) WHERE id = ?", iso(), iso(), me.phone, id);
    notify(postPhones(r.post_id as number), { title: `${REQUEST_KINDS[r.kind as RequestKind].label}: afgehandeld`, body: `${personName(me.phone)} heeft je aanvraag afgehandeld.`, tag: `aanvraag-${id}`, url: `/aanvraag/${id}` });
    changed();
    return list();
  }

  function withdraw(me: Me, id: number) {
    const r = row(id);
    if (!atPost(me, r.post_id as number) && !handles(me)) throw httpError(403, 'Alleen de post kan de aanvraag intrekken');
    if (r.status !== 'aangevraagd' && r.status !== 'opgepakt') return list();
    run("UPDATE requests SET status = 'ingetrokken', done_at = ? WHERE id = ?", iso(), id);
    changed();
    return list();
  }

  return { list, create, setDetail, pick, done, withdraw };
}
