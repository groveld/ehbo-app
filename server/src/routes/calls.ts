// Oproepen, beschikbaarheid van eenheden en post open/dicht; plus de live stand (SSE) voor alle medewerkers.
import type { ServerResponse } from 'node:http';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  ACTION_AT_HEADER,
  ACTION_ID_HEADER,
  INCIDENT_PERSONS,
  INCIDENT_WHAT,
  LIVE_HEARTBEAT_MS,
  NOTE_MAX,
  OUTCOMES,
  RESPONSIVE,
  type CloseIncident,
  type ControlResult,
  type IncidentDetails,
  type LastSeen,
  type LiveState,
  type NewIncident,
  type NewSelfIncident,
  type TeamAvailability,
} from '@ehbo/shared';
import { requireMe } from '../auth.ts';
import type { Calls } from '../calls.ts';
import type { Requests } from '../requests.ts';

const nullable = (values: readonly string[]) => ({ enum: [...values, null] });
const note = { type: ['string', 'null'], maxLength: NOTE_MAX } as const;
const details = {
  what: nullable(Object.keys(INCIDENT_WHAT)),
  persons: nullable(INCIDENT_PERSONS),
  responsive: nullable(Object.keys(RESPONSIVE)),
  note,
} as const;
const detailsRequired = ['what', 'persons', 'responsive', 'note'];
const idParams = { type: 'object', required: ['id'], properties: { id: { type: 'integer', minimum: 1 } } } as const;
const teamBody = { type: 'object', required: ['teamId'], properties: { teamId: { type: 'integer', minimum: 1 } } } as const;

type Id = { Params: { id: number } };

/** Id and time of a change from a phone's queue. */
export const actionHeaders = (request: FastifyRequest) => [request.headers[ACTION_ID_HEADER], request.headers[ACTION_AT_HEADER]] as [string | undefined, string | undefined];

export async function callRoutes(app: FastifyInstance, { calls, requests }: { calls: Calls; requests: Requests }) {
  app.addHook('preHandler', requireMe);

  // Open SSE-verbindingen sluiten bij afsluiten, anders wacht de server erop.
  const streams = new Set<ServerResponse>();
  app.addHook('onClose', async () => {
    for (const res of streams) res.end();
  });

  app.get<{ Reply: LiveState }>('/api/live/state', async () => calls.state());

  app.get<{ Reply: LastSeen }>('/api/live/last-seen', async (request) => calls.lastSeen(request.me!));
  app.post<{ Reply: ControlResult }>('/api/control/open-all', async (request) => calls.openAll(request.me!));
  app.post<{ Reply: ControlResult }>('/api/control/close-all', async (request) => calls.closeAll(request.me!));
  app.post<{ Reply: ControlResult }>('/api/control/close-day', async (request) => calls.closeDay(request.me!, () => requests.finishAll()));

  app.get('/api/live', (request, reply) => {
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      // Geen buffering onderweg: elke wijziging moet direct door.
      'X-Accel-Buffering': 'no',
    });
    const send = (state: LiveState) => res.write(`event: state\ndata: ${JSON.stringify(state)}\n\n`);
    res.write('retry: 3000\n\n');
    send(calls.state());
    const unsubscribe = calls.subscribe(send);
    // A real event, not a comment: the phone has to see it to know the connection is alive.
    const heartbeat = setInterval(() => {
      res.write('event: ping\ndata: 1\n\n');
      if (request.sessionHash) calls.seen(request.sessionHash);
    }, LIVE_HEARTBEAT_MS);
    streams.add(res);
    request.raw.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
      streams.delete(res);
    });
  });

  app.put<Id & { Body: { availability: TeamAvailability }; Reply: LiveState }>('/api/teams/:id/availability', {
    schema: { params: idParams, body: { type: 'object', required: ['availability'], properties: { availability: { enum: ['available', 'unavailable', 'off_duty'] } } } },
  }, async (request) => calls.once(...actionHeaders(request), () => calls.setAvailability(request.me!, request.params.id, request.body.availability)));

  // Members of a mobile team on duty share their position every minute; the server keeps only the last one, in memory.
  app.put<{ Body: { lat: number; lng: number } }>('/api/position', {
    schema: {
      body: { type: 'object', required: ['lat', 'lng'], properties: { lat: { type: 'number', minimum: -90, maximum: 90 }, lng: { type: 'number', minimum: -180, maximum: 180 } } },
    },
  }, async (request, reply) => {
    calls.setPosition(request.me!, request.body);
    return reply.code(204).send();
  });

  app.post<Id & { Reply: LiveState }>('/api/locations/:id/keep-open', { schema: { params: idParams } },
    async (request) => calls.once(...actionHeaders(request), () => calls.keepLocation(request.me!, request.params.id)));
  app.post<Id & { Reply: LiveState }>('/api/teams/:id/keep-on-duty', { schema: { params: idParams } },
    async (request) => calls.once(...actionHeaders(request), () => calls.keepTeam(request.me!, request.params.id)));

  app.put<Id & { Body: { open: boolean }; Reply: LiveState }>('/api/locations/:id/open', {
    schema: { params: idParams, body: { type: 'object', required: ['open'], properties: { open: { type: 'boolean' } } } },
  }, async (request) => calls.once(...actionHeaders(request), () => calls.setLocationOpen(request.me!, request.params.id, request.body.open)));
}
