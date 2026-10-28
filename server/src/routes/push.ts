// Push-abonnementen van medewerkers en de testmelding.
import type { FastifyInstance } from 'fastify';
import {
  TEST_PUSH_MAX_DELAY,
  type ApiError,
  type PushPayload,
  type PushSubscriptionData,
  type SubscribeRequest,
  type TestPushRequest,
  type TestPushResponse,
  type UnsubscribeRequest,
} from '@ehbo/shared';
import { requireMe } from '../auth.ts';
import type { EventDb } from '../event-db.ts';
import { sendPush, type Vapid } from '../webpush.ts';

const subscriptionSchema = {
  type: 'object',
  required: ['endpoint', 'keys'],
  properties: {
    endpoint: { type: 'string', maxLength: 2047 },
    keys: {
      type: 'object',
      required: ['p256dh', 'auth'],
      properties: { p256dh: { type: 'string', maxLength: 128 }, auth: { type: 'string', maxLength: 64 } },
    },
  },
} as const;

export interface PushRouteOptions {
  db: EventDb;
  vapid: Vapid;
  /** Alleen voor tests: push-endpoints via http toestaan. */
  allowInsecureEndpoints: boolean;
}

export async function pushRoutes(app: FastifyInstance, { db, vapid, allowInsecureEndpoints }: PushRouteOptions) {
  const lastTestPush = new Map<string, number>();
  const pendingPushes = new Set<NodeJS.Timeout>();
  const endpointPattern = allowInsecureEndpoints ? /^https?:\/\// : /^https:\/\//;

  app.addHook('onClose', async () => {
    for (const timer of pendingPushes) clearTimeout(timer);
  });

  async function pushTo(subscription: PushSubscriptionData, payload: PushPayload) {
    const result = await sendPush(subscription, payload, vapid, { ttl: 120, urgency: 'high' });
    db.markPush(subscription.endpoint, result.status);
    if (result.gone) db.deleteSubscription(subscription.endpoint);
    app.log.info({ status: result.status, host: new URL(subscription.endpoint).host, detail: result.ok ? undefined : result.body }, 'push');
    return result;
  }

  app.post<{ Body: SubscribeRequest }>('/api/subscriptions', {
    preHandler: requireMe,
    schema: { body: { type: 'object', required: ['subscription'], properties: { subscription: subscriptionSchema } } },
  }, async (request, reply) => {
    const { subscription } = request.body;
    if (!endpointPattern.test(subscription.endpoint)) return reply.code(400).send({ error: 'Ongeldig abonnement' } satisfies ApiError);
    db.upsertSubscription(subscription, request.me!.phone, request.headers['user-agent']);
    return { ok: true };
  });

  app.delete<{ Body: UnsubscribeRequest }>('/api/subscriptions', {
    preHandler: requireMe,
    schema: { body: { type: 'object', required: ['endpoint'], properties: { endpoint: { type: 'string' } } } },
  }, async (request) => {
    const subscription = db.getSubscription(request.body.endpoint);
    if (subscription?.phone === request.me!.phone) db.deleteSubscription(request.body.endpoint);
    return { ok: true };
  });

  // Testmeldingen komen niet in het rapport; je kunt er alleen jezelf een sturen.
  app.post<{ Body: TestPushRequest; Reply: TestPushResponse | ApiError }>('/api/test-push', {
    preHandler: requireMe,
    schema: {
      body: {
        type: 'object',
        required: ['endpoint'],
        properties: { endpoint: { type: 'string' }, delaySeconds: { type: 'number', minimum: 0, maximum: TEST_PUSH_MAX_DELAY } },
      },
    },
  }, async (request, reply) => {
    const { endpoint, delaySeconds = 0 } = request.body;
    const subscription = db.getSubscription(endpoint);
    if (!subscription || subscription.phone !== request.me!.phone) {
      return reply.code(404).send({ error: 'Abonnement niet gevonden; zet meldingen opnieuw aan' });
    }
    const now = Date.now();
    if (now - (lastTestPush.get(endpoint) ?? 0) < 5000) return reply.code(429).send({ error: 'Wacht een paar seconden tussen testmeldingen' });
    lastTestPush.set(endpoint, now);

    const delay = Math.round(delaySeconds);
    const payload: PushPayload = {
      title: delay ? 'Testoproep (vertraagd)' : 'Testmelding',
      body: `Meldingen werken. Verstuurd om ${new Date(now + delay * 1000).toLocaleTimeString('nl-NL', { timeZone: 'Europe/Amsterdam' })}.`,
      tag: 'test',
      url: '/',
      urgent: delay > 0,
    };
    if (delay) {
      const timer = setTimeout(() => {
        pendingPushes.delete(timer);
        pushTo(subscription, payload).catch((err: Error) => app.log.error(err, 'push mislukt'));
      }, delay * 1000);
      pendingPushes.add(timer);
      return reply.code(202).send({ ok: true, scheduledInSeconds: delay });
    }
    const result = await pushTo(subscription, payload);
    if (!result.ok) return reply.code(502).send({ error: `Push-dienst gaf status ${result.status}`, detail: result.body, gone: result.gone });
    return { ok: true };
  });
}
