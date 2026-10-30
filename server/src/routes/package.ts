// Evenementpakket (GET /api/package): alles voor gebruik zonder bereik, in één antwoord met een versie.
import type { FastifyInstance } from 'fastify';
import { sameFunction, type EhboStatus, type EventPackage, type LngLat, type PackageMap } from '@ehbo/shared';
import { adminDb } from '../admin-db.ts';
import type { Calls } from '../calls.ts';
import type { EventDb } from '../event-db.ts';
import { cleanGpx } from '../gpx.ts';
import { assetPaths, mapMeta, mapVersion, MAX_ZOOM } from '../map.ts';

/** Ophogen als de vorm van het pakket verandert, zodat telefoons met een oud pakket het nieuwe ophalen (geen 304). */
const PACKAGE_FORMAT = 4;

export function buildPackage(db: EventDb, staff: boolean): EventPackage {
  const state = adminDb(db).getState();
  const lines = new Map((db.raw.prepare('SELECT id, track_json FROM runs WHERE track_json IS NOT NULL').all() as { id: number; track_json: string }[])
    .map((r) => [r.id, JSON.parse(r.track_json) as LngLat[]]));

  const meta = mapMeta(db);
  const map: PackageMap | null = meta && {
    version: mapVersion(db),
    bbox: meta.bbox,
    maxZoom: MAX_ZOOM,
    tiles: (db.raw.prepare('SELECT z, x, y FROM map_tiles ORDER BY z, x, y').all() as { z: number; x: number; y: number }[]).map((t) => [t.z, t.x, t.y]),
    assets: assetPaths(),
  };

  return {
    version: `${db.dataVersion()}.${staff ? 's' : 'p'}${PACKAGE_FORMAT}`,
    staff,
    event: { name: state.event.name, startDate: state.event.startDate, endDate: state.event.endDate, startLocation: state.event.startLocation },
    postTypes: state.postTypes,
    posts: state.posts.map((p) => ({
      id: p.id, typeId: p.typeId, name: p.name, km: p.km, passages: p.passages, lat: p.lat, lng: p.lng, isOpen: p.isOpen, timeFrom: p.timeFrom, timeTo: p.timeTo,
      // Namen, nummers en aanrijroutes alleen voor medewerkers.
      ...(staff ? { address: p.address, accessRoute: p.accessRoute, contacts: p.contacts.map(({ name, phone, role }) => ({ name, phone, role })) } : {}),
    })),
    runs: state.runs.map((r) => ({ id: r.id, name: r.name, distanceKm: r.distanceKm, discipline: r.discipline, date: r.date, startTime: r.startTime, line: lines.get(r.id) ?? null })),
    // Deelnemers zien waar EHBO staat (het kruisje op de kaart), maar niet wie.
    units: state.units.map(({ availability: _, ...u }) => (staff ? u : { ...u, name: '', mobility: null, hasAed: false, members: [] })),
    coreTeam: staff ? state.coreTeam.filter((c) => c.phone).map((c) => ({ ...c, phone: c.phone! })) : [],
    emergencyNumbers: staff ? state.emergencyNumbers : [],
    ehboPhone: (state.coreTeam.find((c) => c.phone && sameFunction(c.function, 'EHBO-coördinator')) ?? state.coreTeam.find((c) => c.phone && c.isCoordinator))?.phone ?? null,
    map,
  };
}

export async function packageRoutes(app: FastifyInstance, { db, calls }: { db: EventDb; calls: Calls }) {
  app.get('/api/package', async (request, reply) => {
    const pkg = buildPackage(db, request.me !== null);
    const etag = `"${pkg.version}"`;
    reply.header('ETag', etag);
    // De app stuurt de versie die hij al heeft; dan hoeft er niets over de lijn.
    if (request.headers['if-none-match'] === etag) return reply.code(304).send();
    return pkg satisfies EventPackage;
  });

  // For everyone: the route of a run, for a watch or bike computer.
  app.get<{ Params: { file: string } }>('/gpx/:file', async (request, reply) => {
    const id = /^(\d+)\.gpx$/.exec(request.params.file)?.[1];
    const run = id ? db.raw.prepare('SELECT name, gpx, track_json FROM runs WHERE id = ? AND track_json IS NOT NULL').get(Number(id)) as { name: string; gpx: string | null; track_json: string } | undefined : undefined;
    if (!run) return reply.code(404).send({ error: 'Geen route gevonden' });
    const filename = run.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'route';
    return reply
      .header('Cache-Control', 'no-cache')
      .header('Content-Disposition', `attachment; filename="${filename}.gpx"`)
      .type('application/gpx+xml')
      .send(cleanGpx(run.name, run.gpx, JSON.parse(run.track_json) as LngLat[]));
  });

  // Voor iedereen, ook zonder aanmelding: welke standplaatsen nu zonder EHBO zijn (grijs kruisje). Geen posities of namen.
  app.get<{ Reply: EhboStatus }>('/api/ehbo-status', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return calls.ehboStatus();
  });
}
