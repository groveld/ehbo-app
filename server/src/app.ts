// HTTP: de API voor pushmeldingen en de gebouwde webapp (web/dist).
import fs from 'node:fs';
import path from 'node:path';
import Fastify, { LogController, type FastifyError, type FastifyServerOptions } from 'fastify';
import fastifyStatic from '@fastify/static';
import {
  TEST_PUSH_MAX_DELAY,
  type ApiError,
  type AppInfo,
  type PushPayload,
  type SubscribeRequest,
  type TestPushRequest,
  type TestPushResponse,
  type UnsubscribeRequest,
} from '@ehbo/shared';
import type { Db } from './db.ts';
import { sendPush, type Vapid } from './webpush.ts';

export interface AppOptions {
  db: Db;
  vapid: Vapid;
  build: Pick<AppInfo, 'version' | 'commit' | 'builtAt'>;
  /** Map met de gebouwde webapp. Ontbreekt hij, dan draait alleen de API (bij `npm run dev` levert Vite de pagina's). */
  webDir?: string;
  /** Alleen voor tests: push-endpoints via http toestaan. */
  allowInsecureEndpoints?: boolean;
  logger?: FastifyServerOptions['logger'];
}

// Bestanden die nooit lang in een cache (ook niet bij Cloudflare) mogen blijven.
const NO_CACHE = new Set(['index.html', 'sw.js', 'manifest.webmanifest']);

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

export function buildApp({ db, vapid, build, webDir, allowInsecureEndpoints = false, logger = false }: AppOptions) {
  const app = Fastify({
    logger,
    logController: new LogController({ disableRequestLogging: true }),
    bodyLimit: 16 * 1024,
  });
  const lastTestPush = new Map<string, number>();
  const pendingPushes = new Set<NodeJS.Timeout>();
  const endpointPattern = allowInsecureEndpoints ? /^https?:\/\// : /^https:\/\//;

  async function pushTo(subscription: SubscribeRequest['subscription'], payload: PushPayload) {
    const result = await sendPush(subscription, payload, vapid, { ttl: 120, urgency: 'high' });
    db.markPush(subscription.endpoint, result.status);
    if (result.gone) db.deleteSubscription(subscription.endpoint);
    app.log.info({ status: result.status, host: new URL(subscription.endpoint).host, detail: result.ok ? undefined : result.body }, 'push');
    return result;
  }

  app.addHook('onSend', async (request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'same-origin');
    if (request.url.startsWith('/api/') || request.url === '/healthz') reply.header('Cache-Control', 'no-store');
  });

  app.addHook('onClose', async () => {
    for (const timer of pendingPushes) clearTimeout(timer);
  });

  app.setErrorHandler<FastifyError>((err, request, reply) => {
    const status = err.statusCode ?? 500;
    if (status >= 500) request.log.error(err);
    const error = err.validation ? 'Ongeldig verzoek' : status < 500 ? err.message : 'Serverfout';
    return reply.code(status).send({ error } satisfies ApiError);
  });

  app.get('/healthz', async () => ({ ok: true }));

  app.get<{ Reply: AppInfo }>('/api/info', async () => ({
    ...build,
    vapidPublicKey: vapid.publicKey,
    subscriptions: db.countSubscriptions(),
  }));

  app.post<{ Body: SubscribeRequest }>('/api/subscriptions', {
    schema: { body: { type: 'object', required: ['subscription'], properties: { subscription: subscriptionSchema } } },
  }, async (request, reply) => {
    const { subscription } = request.body;
    if (!endpointPattern.test(subscription.endpoint)) return reply.code(400).send({ error: 'Ongeldig abonnement' } satisfies ApiError);
    db.upsertSubscription(subscription, request.headers['user-agent']);
    return { ok: true };
  });

  app.delete<{ Body: UnsubscribeRequest }>('/api/subscriptions', {
    schema: { body: { type: 'object', required: ['endpoint'], properties: { endpoint: { type: 'string' } } } },
  }, async (request) => {
    db.deleteSubscription(request.body.endpoint);
    return { ok: true };
  });

  app.post<{ Body: TestPushRequest; Reply: TestPushResponse | ApiError }>('/api/test-push', {
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
    if (!subscription) return reply.code(404).send({ error: 'Abonnement niet gevonden; zet meldingen opnieuw aan' });
    const now = Date.now();
    if (now - (lastTestPush.get(endpoint) ?? 0) < 5000) return reply.code(429).send({ error: 'Wacht een paar seconden tussen testmeldingen' });
    lastTestPush.set(endpoint, now);

    const delay = Math.round(delaySeconds);
    const payload: PushPayload = {
      title: delay ? 'Testoproep (vertraagd)' : 'Testmelding',
      body: `Pushmeldingen werken. Verstuurd om ${new Date(now + delay * 1000).toLocaleTimeString('nl-NL', { timeZone: 'Europe/Amsterdam' })}.`,
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

  const hasWeb = webDir !== undefined && fs.existsSync(path.join(webDir, 'index.html'));
  if (hasWeb) {
    app.register(fastifyStatic, {
      root: webDir,
      cacheControl: false,
      setHeaders(reply, filePath) {
        const name = path.basename(filePath);
        if (NO_CACHE.has(name)) reply.header('Cache-Control', 'no-cache');
        else if (path.basename(path.dirname(filePath)) === 'assets') reply.header('Cache-Control', 'public, max-age=31536000, immutable');
        else reply.header('Cache-Control', 'public, max-age=3600');
        if (name === 'sw.js') reply.header('Service-Worker-Allowed', '/');
      },
    });
  } else if (webDir !== undefined) {
    app.log.warn(`Geen webapp gevonden in ${webDir}; alleen de API draait. Bouw hem met npm run build, of gebruik npm run dev.`);
  }

  app.setNotFoundHandler((request, reply) => {
    const { pathname } = new URL(request.url, 'http://localhost');
    const isPage = (request.method === 'GET' || request.method === 'HEAD') && !pathname.startsWith('/api/') && !path.extname(pathname);
    // App-routes (zonder extensie) vallen terug op de app; de app bepaalt zelf wat hij toont.
    if (hasWeb && isPage) return reply.sendFile('index.html');
    return reply.code(404).send({ error: 'Niet gevonden' } satisfies ApiError);
  });

  return app;
}
