// Evenementpakket (GET /api/package): alles voor gebruik zonder bereik, in één antwoord met een versie.
import type { FastifyInstance } from 'fastify';
import { sameFunction, type FirstAidStatus, type EventPackage, type LngLat, type PackageMap } from '@ehbo/shared';
import { adminDb } from '../admin-db.ts';
import type { Calls } from '../calls.ts';
import type { EventDb } from '../event-db.ts';
import { cleanGpx, type GpxWaypoint } from '../gpx.ts';
import { assetPaths, mapMeta, mapVersion, MAX_ZOOM } from '../map.ts';

/** Ophogen als de vorm van het pakket verandert, zodat telefoons met een oud pakket het nieuwe ophalen (geen 304). */
const PACKAGE_FORMAT = 12;

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
    event: { name: state.event.name, startDate: state.event.startDate, endDate: state.event.endDate, startLocation: state.event.startLocation, atLocationM: state.event.atLocationM },
    functionTypes: state.functionTypes,
    locations: state.locations.map((p) => ({
      id: p.id, typeId: p.typeId, functionIds: p.functionIds, runId: p.runId, name: p.name, km: p.km, passages: p.passages, lat: p.lat, lng: p.lng, isOpen: p.isOpen, timeFrom: p.timeFrom, timeTo: p.timeTo,
      // Namen, nummers en aanrijroutes alleen voor medewerkers.
      ...(staff ? { address: p.address, accessRoute: p.accessRoute, contacts: p.contacts.map(({ name, phone, role }) => ({ name, phone, role })) } : {}),
    })),
    runs: state.runs.map((r) => ({ id: r.id, name: r.name, distanceKm: r.distanceKm, discipline: r.discipline, date: r.date, startTime: r.startTime, line: lines.get(r.id) ?? null })),
    // Deelnemers zien waar EHBO staat (het kruisje op de kaart), maar niet wie.
    teams: state.teams.map(({ availability: _, ...u }) => (staff ? u : { ...u, name: '', mobility: null, hasAed: false, timeFrom: null, timeTo: null, members: [] })),
    coreTeam: staff ? state.coreTeam.filter((c) => c.phone).map((c) => ({ ...c, phone: c.phone! })) : [],
    emergencyNumbers: staff ? state.emergencyNumbers : [],
    helpRequestTypes: staff ? db.helpRequestTypes() : [],
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
    // Every post this run passes, in the order you meet them; the symbol of its main function, and all its functions in the text (#83).
    const waypoints = (db.raw.prepare(`
      SELECT p.name, p.lat, p.lng, t.key, json_group_array(pp.km) AS km,
             (SELECT group_concat(name, ' · ') FROM (SELECT ft.name FROM location_functions f JOIN function_types ft ON ft.id = f.type_id WHERE f.location_id = p.id ORDER BY f.sort)) AS type_name
      FROM km_points pp JOIN locations p ON p.id = pp.location_id JOIN function_types t ON t.id = p.type_id
      WHERE pp.run_id = ? AND p.lat IS NOT NULL AND p.lng IS NOT NULL AND (p.run_id IS NULL OR p.run_id = pp.run_id)
      GROUP BY p.id ORDER BY MIN(pp.km)`).all(Number(id)) as { name: string; lat: number; lng: number; key: string | null; type_name: string; km: string }[])
      .map((r): GpxWaypoint => ({ name: r.name, lat: r.lat, lng: r.lng, typeKey: r.key, typeName: r.type_name, km: (JSON.parse(r.km) as number[]).sort((a, b) => a - b) }));
    const filename = run.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'route';
    return reply
      .header('Cache-Control', 'no-cache')
      .header('Content-Disposition', `attachment; filename="${filename}.gpx"`)
      .type('application/gpx+xml')
      .send(cleanGpx(run.name, run.gpx, JSON.parse(run.track_json) as LngLat[], waypoints));
  });

  // Voor iedereen, ook zonder aanmelding: welke standplaatsen nu zonder EHBO zijn (grijs kruisje). Geen posities of namen.
  app.get<{ Reply: FirstAidStatus }>('/api/first-aid-status', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return calls.ehboStatus();
  });
}
