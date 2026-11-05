// Evenement (openbaar), aanmelden, afmelden en wie ben ik.
import type { FastifyInstance } from 'fastify';
import { DEFAULT_INFO, loginCodeOf, normalizePhone, type ApiError, type InfoSection, type LoginRequest, type LoginUnknown, type Me, type PublicEvent } from '@ehbo/shared';
import { SESSION_COOKIE, hashSessionToken, newSessionToken, requireMe, sessionExpiry, sessionsEnded, sqliteTime } from '../auth.ts';
import { getBrand, getStyle } from '../brand.ts';
import type { Calls } from '../calls.ts';
import type { EventDb } from '../event-db.ts';
import { resolveMe } from '../roles.ts';

const LOGIN_LIMIT = 10;
const LOGIN_WINDOW_MS = 60_000;

export async function sessionRoutes(app: FastifyInstance, { db, calls }: { db: EventDb; calls: Calls }) {
  // Mislukte pogingen afremmen per IP-adres, zodat niemand de lijst met nummers kan aflopen.
  // Gelukte aanmeldingen tellen niet mee: bij een briefing zitten twintig mensen achter één wifi-adres.
  const failures = new Map<string, number[]>();
  const recentFailures = (ip: string) => {
    const now = Date.now();
    const recent = (failures.get(ip) ?? []).filter((t) => now - t < LOGIN_WINDOW_MS);
    if (recent.length) failures.set(ip, recent);
    else failures.delete(ip);
    return recent;
  };
  const addFailure = (ip: string) => failures.set(ip, [...recentFailures(ip), Date.now()]);

  app.get<{ Reply: PublicEvent }>('/api/event', async () => {
    const event = db.getEvent();
    const fill = (text: string) => text
      .replaceAll('{evenement}', event.name)
      .replaceAll('{beleid}', event.info_policy || 'het verwijderplan van de organisatie')
      .replaceAll('{contact}', event.info_contact || 'de evenementcoördinator');
    const info: InfoSection[] = event.info_json ? JSON.parse(event.info_json) : DEFAULT_INFO;
    return {
      name: event.name,
      startDate: event.start_date,
      endDate: event.end_date,
      info: info.map((s) => ({ title: fill(s.title), body: fill(s.body) })),
      style: getStyle(db),
      brand: getBrand(db),
      needsLoginCode: loginCodeOf(event.login_code, event.start_date) !== '',
    };
  });

  app.post<{ Body: LoginRequest; Reply: Me | LoginUnknown | ApiError }>('/api/session', {
    schema: { body: { type: 'object', required: ['phone'], properties: { phone: { type: 'string', maxLength: 32 }, code: { type: 'string', maxLength: 32 } } } },
  }, async (request, reply) => {
    if (recentFailures(request.ip).length >= LOGIN_LIMIT) return reply.code(429).send({ error: 'Te veel pogingen; wacht een minuut' });
    // The code of the briefing first, so a participant who knows a number of the staff gets no further, not even to "unknown number".
    const event = db.getEvent();
    const code = loginCodeOf(event.login_code, event.start_date);
    if (code && (request.body.code ?? '').replace(/\s/g, '') !== code) {
      addFailure(request.ip);
      return reply.code(403).send({ error: 'Deze code klopt niet. Je hoort de code op de briefing.' });
    }
    const phone = normalizePhone(request.body.phone);
    if (!phone) {
      addFailure(request.ip);
      return reply.code(400).send({ error: 'Dit is geen geldig telefoonnummer' });
    }

    const userAgent = request.headers['user-agent'];
    const me = resolveMe(db, phone);
    if (!me) {
      addFailure(request.ip);
      db.logLogin(phone, userAgent, 'onbekend');
      return reply.code(404).send({ error: 'Dit nummer staat niet in de lijst', phone, coordinatorPhone: db.coordinatorPhone() });
    }

    if (request.sessionHash) db.deleteSession(request.sessionHash);
    // The first one in for a post or team finds it closed: opening it means "I'm here".
    calls.arrive(phone);
    const token = newSessionToken();
    const expires = sessionExpiry(event.end_date, new Date(), db.testMode());
    db.createSession(hashSessionToken(token), phone, userAgent, sqliteTime(expires));
    db.logLogin(phone, userAgent, 'ok');
    request.log.info({ phone: `…${phone.slice(-4)}` }, 'aangemeld');

    reply.setCookie(SESSION_COOKIE, token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: request.protocol === 'https',
      expires,
    });
    return me;
  });

  app.get('/api/me', { preHandler: requireMe }, async (request) => request.me!);

  // Logging out is the person leaving: every device of this number is logged out, also an old install or Safari next to the app,
  // so nothing keeps their location or team open. With no session left the number gets no pushes; the endpoint is sent along anyway.
  app.delete<{ Body: { endpoint?: unknown } | undefined }>('/api/session', async (request, reply) => {
    const me = request.me;
    if (me && request.sessionHash) {
      const endpoint = request.body?.endpoint;
      if (typeof endpoint === 'string' && db.getSubscription(endpoint)?.phone === me.phone) db.deleteSubscription(endpoint);
      db.deleteSessionsFor(me.phone);
      sessionsEnded(db, calls, [me.phone]);
    }
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.code(204).send();
  });
}
