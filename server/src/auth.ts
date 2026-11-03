// Aanmelden: een willekeurige sessiesleutel in een HttpOnly-cookie; in de database staat alleen de hash.
import crypto from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ApiError, Me } from '@ehbo/shared';
import type { Calls } from './calls.ts';
import type { EventDb } from './event-db.ts';
import { resolveMe } from './roles.ts';

export const SESSION_COOKIE = 'ehbo_sessie';

declare module 'fastify' {
  interface FastifyRequest {
    /** De aangemelde medewerker, of null. Alleen gevuld voor /api/-routes. */
    me: Me | null;
    sessionHash: string | null;
  }
}

export const newSessionToken = () => crypto.randomBytes(32).toString('base64url');
export const hashSessionToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

/** SQLite-tijd ("jjjj-mm-dd uu:mm:ss", UTC), zodat vergelijken met datetime('now') klopt. */
export const sqliteTime = (date: Date) => date.toISOString().replace('T', ' ').slice(0, 19);

/** The coming midnight in Dutch time. */
export function nextMidnight(now = new Date()): Date {
  const zone = { timeZone: 'Europe/Amsterdam' } as const;
  const [y, m, d] = now.toLocaleDateString('en-CA', zone).split('-').map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d + 1);
  // The clock in Amsterdam at that moment, read as UTC, is ahead by the offset (1 or 2 hours). Clocks never change at midnight here.
  const wall = new Date(new Date(guess).toLocaleString('en-US', zone) + ' UTC').getTime();
  return new Date(guess - (wall - guess));
}

/**
 * Aangemeld blijven tot het einde van het evenement: tot de dag ná de einddatum voorbij is.
 * Zonder einddatum 60 dagen; altijd minstens één dag. In the test mode until midnight, so testers are logged out after a test day.
 */
export function sessionExpiry(endDate: string | null, now = new Date(), testMode = false): Date {
  if (testMode) return nextMidnight(now);
  const minimum = new Date(now.getTime() + 24 * 3600 * 1000);
  if (!endDate) return new Date(now.getTime() + 60 * 24 * 3600 * 1000);
  const end = new Date(`${endDate}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 2);
  return end > minimum ? end : minimum;
}

/** Zet request.me voor elke API-aanvraag. Is het nummer nergens meer ingepland, dan vervalt de sessie. */
export function registerSessions(app: FastifyInstance, db: EventDb) {
  app.decorateRequest('me', null);
  app.decorateRequest('sessionHash', null);

  app.addHook('onRequest', async (request) => {
    if (!request.url.startsWith('/api/')) return;
    const token = request.cookies[SESSION_COOKIE];
    if (!token) return;
    const hash = hashSessionToken(token);
    const session = db.getSession(hash);
    if (!session) return;
    const me = resolveMe(db, session.phone);
    if (!me) {
      db.deleteSession(hash);
      return;
    }
    db.touchSession(hash);
    request.me = me;
    request.sessionHash = hash;
  });
}

/** Sessions of these numbers ended: a number logged in nowhere gets no pushes any more, and what nobody is logged in for closes. */
export function sessionsEnded(db: EventDb, calls: Calls, phones: Iterable<string>) {
  const unique = new Set(phones);
  if (!unique.size) return;
  for (const phone of unique) if (!db.hasSession(phone)) db.deleteSubscriptionsFor(phone);
  calls.leave(unique);
}

/** preHandler voor routes die alleen voor medewerkers zijn. */
export async function requireMe(request: FastifyRequest, reply: FastifyReply) {
  if (!request.me) return reply.code(401).send({ error: 'Niet aangemeld' } satisfies ApiError);
}

/** preHandler voor routes die alleen voor beheerders zijn. */
export async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  if (!request.me) return reply.code(401).send({ error: 'Niet aangemeld' } satisfies ApiError);
  if (!request.me.isAdmin) return reply.code(403).send({ error: 'Alleen voor beheerders' } satisfies ApiError);
}
