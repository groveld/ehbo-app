// Evenement (openbaar), aanmelden, afmelden en wie ben ik.
import type { FastifyInstance } from 'fastify';
import { DEFAULT_INFO, normalizePhone, type ApiError, type InfoSection, type LoginRequest, type LoginUnknown, type Me, type PublicEvent } from '@ehbo/shared';
import { SESSION_COOKIE, hashSessionToken, newSessionToken, requireMe, sessionExpiry, sqliteTime } from '../auth.ts';
import type { EventDb } from '../event-db.ts';
import { resolveMe } from '../roles.ts';

const LOGIN_LIMIT = 10;
const LOGIN_WINDOW_MS = 60_000;

export async function sessionRoutes(app: FastifyInstance, { db }: { db: EventDb }) {
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
    };
  });

  app.post<{ Body: LoginRequest; Reply: Me | LoginUnknown | ApiError }>('/api/session', {
    schema: { body: { type: 'object', required: ['phone'], properties: { phone: { type: 'string', maxLength: 32 } } } },
  }, async (request, reply) => {
    if (recentFailures(request.ip).length >= LOGIN_LIMIT) return reply.code(429).send({ error: 'Te veel pogingen; wacht een minuut' });
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
    const token = newSessionToken();
    const expires = sessionExpiry(db.getEvent().end_date);
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

  app.post('/api/me/info-accepted', { preHandler: requireMe }, async (request, reply) => {
    db.acceptInfo(request.me!.phone);
    return reply.code(204).send();
  });

  app.delete('/api/session', async (request, reply) => {
    if (request.sessionHash) db.deleteSession(request.sessionHash);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.code(204).send();
  });
}
