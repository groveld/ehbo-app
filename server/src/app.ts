// HTTP: de API en de gebouwde webapp (web/dist).
import fs from 'node:fs';
import path from 'node:path';
import Fastify, { LogController, type FastifyError, type FastifyServerOptions } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import type { ApiError, AppInfo } from '@ehbo/shared';
import { registerSessions } from './auth.ts';
import { createCalls, type CallsOptions } from './calls.ts';
import type { EventDb } from './event-db.ts';
import { protomapsSource, type MapSource } from './map.ts';
import { createNotifier } from './notify.ts';
import { createRequests, type Requests } from './requests.ts';
import { adminRoutes } from './routes/admin.ts';
import { brandRoutes } from './routes/brand.ts';
import { callRoutes } from './routes/calls.ts';
import { mapRoutes } from './routes/map.ts';
import { packageRoutes } from './routes/package.ts';
import { pushRoutes } from './routes/push.ts';
import { requestRoutes } from './routes/requests.ts';
import { sessionRoutes } from './routes/session.ts';
import type { Vapid } from './webpush.ts';

export interface AppOptions {
  db: EventDb;
  vapid: Vapid;
  build: Pick<AppInfo, 'version' | 'commit' | 'builtAt'>;
  /** Map met de gebouwde webapp. Ontbreekt hij, dan draait alleen de API (bij `npm run dev` levert Vite de pagina's). */
  webDir?: string;
  /** Alleen voor tests: push-endpoints via http toestaan. */
  allowInsecureEndpoints?: boolean;
  /** Bron van de kaart; tests geven een nep-bron mee. */
  mapSource?: () => Promise<MapSource>;
  /** Alleen voor tests: meldingen opvangen, timers zelf laten aflopen en de klok zetten. */
  calls?: Partial<Pick<CallsOptions, 'notify' | 'schedule' | 'now'>>;
  logger?: FastifyServerOptions['logger'];
}

// Bestanden die nooit lang in een cache (ook niet bij Cloudflare) mogen blijven.
const NO_CACHE = new Set(['index.html', 'sw.js']);

export function buildApp({ db, vapid, build, webDir, allowInsecureEndpoints = false, mapSource = protomapsSource, calls: callOptions = {}, logger = false }: AppOptions) {
  const app = Fastify({
    logger,
    logController: new LogController({ disableRequestLogging: true }),
    bodyLimit: 16 * 1024,
    // Bereikbaar via Cloudflare Tunnel: request.protocol en request.ip komen uit X-Forwarded-*.
    trustProxy: true,
  });

  app.addHook('onSend', async (request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'same-origin');
    if (request.url.startsWith('/api/') || request.url === '/healthz') reply.header('Cache-Control', 'no-store');
  });

  app.setErrorHandler<FastifyError>((err, request, reply) => {
    const status = err.statusCode ?? 500;
    if (status >= 500) request.log.error(err);
    const error = err.validation ? 'Ongeldig verzoek' : status < 500 ? err.message : 'Serverfout';
    return reply.code(status).send({ error } satisfies ApiError);
  });

  app.register(fastifyCookie);
  app.after(() => registerSessions(app, db));

  app.get('/healthz', async () => ({ ok: true }));

  app.get<{ Reply: AppInfo }>('/api/info', async () => ({
    ...build,
    vapidPublicKey: vapid.publicKey,
    subscriptions: db.countSubscriptions(),
  }));

  const notifier = createNotifier(db, vapid, app.log);
  // Oproepen en aanvragen delen één live stand; de aanvragen melden hun wijzigingen via calls.changed.
  let requests: Requests | null = null;
  const calls = createCalls(db, { notify: notifier.toPhones, requests: () => requests?.list() ?? [], ...callOptions });
  requests = createRequests(db, { notify: callOptions.notify ?? notifier.toPhones, changed: calls.changed, now: callOptions.now });
  // Lopende oproepen gaan na een herstart verder waar ze waren.
  app.addHook('onReady', async () => calls.resume());
  app.addHook('onClose', async () => calls.stop());

  app.register(sessionRoutes, { db });
  app.register(pushRoutes, { db, notifier, allowInsecureEndpoints });
  app.register(callRoutes, { calls });
  app.register(requestRoutes, { calls, requests });
  app.register(adminRoutes, { db, calls });
  app.register(brandRoutes, { db });
  app.register(packageRoutes, { db });
  app.register(mapRoutes, { db, mapSource });

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
