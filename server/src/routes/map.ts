// Kaart: tegels, lettertypen en iconen voor iedereen (ook deelnemers), en het ophalen ervan voor beheerders.
import type { FastifyInstance } from 'fastify';
import type { ApiError, MapStatus } from '@ehbo/shared';
import { requireAdmin } from '../auth.ts';
import type { EventDb } from '../event-db.ts';
import { mapMeta, mapVersion, prepareMap, type MapSource } from '../map.ts';

export interface MapRouteOptions {
  db: EventDb;
  /** Bron van de kaart; standaard de openbare Protomaps-bestanden. */
  mapSource: () => Promise<MapSource>;
  /** The map version is part of the live state: tell everyone there is a new one. */
  changed: () => void;
}

const IMMUTABLE = 'public, max-age=31536000, immutable';

export async function mapRoutes(app: FastifyInstance, { db, mapSource, changed }: MapRouteOptions) {
  const job: Omit<MapStatus, 'current'> = { state: 'idle', done: 0, total: 0, message: '' };
  let running: Promise<void> | null = null;

  app.addHook('onClose', async () => {
    await running?.catch(() => {});
  });

  // De versie zit in het pad: een nieuwe kaart krijgt nieuwe adressen, zodat telefoons nooit een oude tegel bewaren.
  const checkVersion = (version: string) => Number(version) === mapVersion(db) && mapVersion(db) > 0;

  app.get<{ Params: { version: string; z: string; x: string; file: string } }>('/map/:version/tiles/:z/:x/:file', async (request, reply) => {
    const { version, z, x, file } = request.params;
    const y = /^(\d+)\.mvt$/.exec(file)?.[1];
    if (!checkVersion(version) || y === undefined) return reply.code(404).send({ error: 'Tegel niet gevonden' } satisfies ApiError);
    const row = db.raw.prepare('SELECT data FROM map_tiles WHERE z = ? AND x = ? AND y = ?').get(Number(z), Number(x), Number(y)) as { data: Uint8Array } | undefined;
    // Geen tegel = niets te tekenen op die plek (bijv. water); MapLibre verwacht dan een leeg antwoord.
    if (!row) return reply.code(204).header('Cache-Control', IMMUTABLE).send();
    return reply
      .header('Content-Type', 'application/vnd.mapbox-vector-tile')
      .header('Content-Encoding', 'gzip')
      .header('Cache-Control', IMMUTABLE)
      .send(Buffer.from(row.data));
  });

  app.get<{ Params: { version: string; '*': string } }>('/map/:version/*', async (request, reply) => {
    const path = request.params['*'];
    if (!checkVersion(request.params.version)) return reply.code(404).send({ error: 'Kaartbestand niet gevonden' } satisfies ApiError);
    const row = db.raw.prepare('SELECT content_type, data FROM map_assets WHERE path = ?').get(path) as { content_type: string; data: Uint8Array } | undefined;
    if (!row) return reply.code(404).send({ error: 'Kaartbestand niet gevonden' } satisfies ApiError);
    return reply.header('Content-Type', row.content_type).header('Cache-Control', IMMUTABLE).send(Buffer.from(row.data));
  });

  const status = (): MapStatus => ({ ...job, current: mapMeta(db) });

  app.get<{ Reply: MapStatus }>('/api/admin/map', { preHandler: requireAdmin }, async () => status());

  app.post<{ Reply: MapStatus | ApiError }>('/api/admin/map', { preHandler: requireAdmin }, async (request, reply) => {
    if (job.state === 'running') return reply.code(409).send({ error: 'De kaart wordt al opgehaald' });
    Object.assign(job, { state: 'running', done: 0, total: 0, message: 'Kaart ophalen…' });
    running = (async () => {
      try {
        const meta = await prepareMap(db, await mapSource(), (done, total) => Object.assign(job, { done, total }));
        Object.assign(job, { state: 'done', message: `${meta.tiles} kaarttegels opgeslagen` });
        changed();
        request.log.info(meta, 'kaart opgehaald');
      } catch (err) {
        Object.assign(job, { state: 'error', message: (err as Error).message });
        request.log.error(err, 'kaart ophalen mislukt');
      }
    })();
    return reply.code(202).send(status());
  });
}
