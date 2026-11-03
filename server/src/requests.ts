// Eenvoudige aanvragen van posten: water, verkeer, vrijwilliger. Gaan naar de wachtrij van de evenementcoördinator, zonder alarm.
// Aangevraagd → opgepakt → afgehandeld, of ingetrokken door de post.
import { helpRequestType, requestDetailLabel, type LiveRequest, type Me, type NewRequest, type PushPayload, type RequestKind, type RequestStatus } from '@ehbo/shared';
import type { EventDb } from './event-db.ts';

const httpError = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });

type Row = Record<string, string | number | null>;

export interface RequestsOptions {
  notify: (phones: Iterable<string>, payload: PushPayload) => void;
  /** De live stand is veranderd: iedereen het nieuwe overzicht sturen. */
  changed: () => void;
  /** Opens a post that closed by time; false if a person closed it. */
  reopen: (postId: number) => boolean;
  now?: () => Date;
}

export type Requests = ReturnType<typeof createRequests>;

export function createRequests(db: EventDb, { notify: send, changed, reopen, now = () => new Date() }: RequestsOptions) {
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
    const rows = all('SELECT * FROM queue_requests ORDER BY id DESC');
    const queue = rows.filter((r) => r.status === 'sent' || r.status === 'accepted').map((r) => r.id as number).reverse();
    return rows.map((r) => {
      const acceptedBy = r.picked_by as string | null;
      const position = queue.indexOf(r.id as number);
      return {
        id: r.id as number,
        handling: 'queue' as const,
        type: r.kind as RequestKind,
        isTest: r.is_test === 1,
        postId: r.post_id as number,
        postName: postName(r.post_id as number),
        detail: r.detail as string | null,
        status: r.status as RequestStatus,
        reportedAt: r.created_at as string,
        acceptedAt: r.picked_at as string | null,
        acceptedBy: acceptedBy ? { name: personName(acceptedBy), phone: acceptedBy } : null,
        closedAt: r.done_at as string | null,
        position: position >= 0 ? position + 1 : null,
      };
    });
  }

  function row(id: number) {
    const r = get('SELECT * FROM queue_requests WHERE id = ?', id);
    if (!r) throw httpError(404, 'Aanvraag niet gevonden');
    return r;
  }

  /** A kind of help request by its key, from the table: a new kind is a row (#86). */
  const typeOf = (kind: RequestKind) => helpRequestType(db.helpRequestTypes(), kind);
  const checkDetail = (kind: RequestKind, detail: string | null) => {
    if (detail !== null && !typeOf(kind).choices.some((c) => c.key === detail)) throw httpError(400, 'Onbekende keuze bij deze aanvraag');
  };

  const describe = (r: Row) => [typeOf(r.kind as RequestKind).name, requestDetailLabel(db.helpRequestTypes(), r.kind as RequestKind, r.detail as string | null)]
    .filter(Boolean).join(' · ');

  function create(me: Me, body: NewRequest) {
    const existing = get('SELECT id FROM help_requests WHERE client_id = ?', body.clientId);
    if (existing) return list().find((r) => r.id === existing.id)!;
    const post = get('SELECT id, is_open FROM posts WHERE id = ?', body.postId);
    if (!post) throw httpError(404, 'Locatie niet gevonden');
    if (!atPost(me, body.postId) && !handles(me)) throw httpError(403, 'Je kunt alleen een aanvraag doen vanaf je eigen locatie');
    if (post.is_open !== 1 && !reopen(body.postId)) throw httpError(409, 'Deze locatie is dicht. Zet de locatie eerst open.');
    checkDetail(body.type, body.detail);
    // A request is a help request of a queue type (#86).
    const id = Number(run(`INSERT INTO help_requests (client_id, type_id, post_id, detail, status, reported_by, reported_at, is_test)
                           VALUES (?, (SELECT id FROM help_request_types WHERE key = ?), ?, ?, 'sent', ?, ?, ?)`,
      body.clientId, body.type, body.postId, body.detail, me.phone, iso(), db.testMode() ? 1 : 0).lastInsertRowid);
    const coordinator = db.coordinatorPhone();
    if (coordinator) {
      notify([coordinator], { title: `${typeOf(body.type).name} · ${postName(body.postId)}`, body: `${describe(row(id))}. Staat in de wachtrij.`, tag: `aanvraag-${id}`, url: '/overzicht/meldingen' });
    }
    changed();
    return list().find((r) => r.id === id)!;
  }

  function setDetail(me: Me, id: number, detail: string | null) {
    const r = row(id);
    if (!atPost(me, r.post_id as number) && !handles(me)) throw httpError(403, 'Alleen de locatie kan de aanvraag aanpassen');
    if (r.status !== 'sent' && r.status !== 'accepted') throw httpError(409, 'Deze aanvraag is al afgehandeld');
    checkDetail(r.kind as RequestKind, detail);
    run('UPDATE help_requests SET detail = ? WHERE id = ?', detail, id);
    changed();
    return list();
  }

  function pick(me: Me, id: number) {
    if (!handles(me)) throw httpError(403, 'Alleen de evenementcoördinator pakt aanvragen op');
    const r = row(id);
    if (r.status !== 'sent') throw httpError(409, r.status === 'accepted' ? `Al opgepakt door ${personName(r.picked_by as string)}` : 'Deze aanvraag is niet meer open');
    run("UPDATE help_requests SET status = 'accepted', accepted_at = ?, accepted_by = ? WHERE id = ?", iso(), me.phone, id);
    notify(postPhones(r.post_id as number), { title: `${typeOf(r.kind as RequestKind).name} wordt geregeld`, body: `${personName(me.phone)} heeft je aanvraag opgepakt.`, tag: `aanvraag-${id}`, url: `/aanvraag/${id}` });
    changed();
    return list();
  }

  function done(me: Me, id: number) {
    if (!handles(me)) throw httpError(403, 'Alleen de evenementcoördinator handelt aanvragen af');
    const r = row(id);
    if (r.status !== 'sent' && r.status !== 'accepted') return list();
    run("UPDATE help_requests SET status = 'closed', closed_at = ?, accepted_at = COALESCE(accepted_at, ?), accepted_by = COALESCE(accepted_by, ?) WHERE id = ?", iso(), iso(), me.phone, id);
    notify(postPhones(r.post_id as number), { title: `${typeOf(r.kind as RequestKind).name}: afgehandeld`, body: `${personName(me.phone)} heeft je aanvraag afgehandeld.`, tag: `aanvraag-${id}`, url: `/aanvraag/${id}` });
    changed();
    return list();
  }

  function withdraw(me: Me, id: number) {
    const r = row(id);
    if (!atPost(me, r.post_id as number) && !handles(me)) throw httpError(403, 'Alleen de locatie kan de aanvraag intrekken');
    if (r.status !== 'sent' && r.status !== 'accepted') return list();
    run("UPDATE help_requests SET status = 'withdrawn', closed_at = ? WHERE id = ?", iso(), id);
    changed();
    return list();
  }

  /** End of the day: nothing stays in the queue overnight. */
  function finishAll() {
    run("UPDATE help_requests SET status = 'closed', closed_at = ?, accepted_at = COALESCE(accepted_at, ?) WHERE status IN ('sent', 'accepted') AND id IN (SELECT id FROM queue_requests)", iso(), iso());
  }

  return { list, create, setDetail, pick, done, withdraw, finishAll };
}
