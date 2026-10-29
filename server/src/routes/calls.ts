// Oproepen, beschikbaarheid van eenheden en post open/dicht; plus de live stand (SSE) voor alle medewerkers.
import type { ServerResponse } from 'node:http';
import type { FastifyInstance } from 'fastify';
import {
  INCIDENT_PERSONS,
  INCIDENT_WHAT,
  LIVE_HEARTBEAT_MS,
  NOTE_MAX,
  OUTCOMES,
  RESPONSIVE,
  type CloseIncident,
  type IncidentDetails,
  type LiveState,
  type NewIncident,
  type UnitAvailability,
} from '@ehbo/shared';
import { requireMe } from '../auth.ts';
import type { Calls } from '../calls.ts';

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
const unitBody = { type: 'object', required: ['unitId'], properties: { unitId: { type: 'integer', minimum: 1 } } } as const;

type Id = { Params: { id: number } };

export async function callRoutes(app: FastifyInstance, { calls }: { calls: Calls }) {
  app.addHook('preHandler', requireMe);

  // Open SSE-verbindingen sluiten bij afsluiten, anders wacht de server erop.
  const streams = new Set<ServerResponse>();
  app.addHook('onClose', async () => {
    for (const res of streams) res.end();
  });

  app.get<{ Reply: LiveState }>('/api/live/state', async () => calls.state());

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
    const heartbeat = setInterval(() => res.write(': hartslag\n\n'), LIVE_HEARTBEAT_MS);
    streams.add(res);
    request.raw.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
      streams.delete(res);
    });
  });

  app.post<{ Body: NewIncident }>('/api/incidents', {
    schema: {
      body: {
        type: 'object',
        required: ['postId', 'clientId', ...detailsRequired],
        properties: {
          postId: { type: 'integer', minimum: 1 },
          clientId: { type: 'string', minLength: 8, maxLength: 64 },
          reportedAt: { type: 'string', format: 'date-time' },
          ...details,
        },
      },
    },
  }, async (request, reply) => reply.code(201).send(calls.report(request.me!, request.body)));

  app.put<Id & { Body: IncidentDetails; Reply: LiveState }>('/api/incidents/:id', {
    schema: { params: idParams, body: { type: 'object', required: detailsRequired, properties: details } },
  }, async (request) => calls.update(request.me!, request.params.id, request.body));

  app.post<Id & { Body: { unitId: number }; Reply: LiveState }>('/api/incidents/:id/accept', { schema: { params: idParams, body: unitBody } },
    async (request) => calls.accept(request.me!, request.params.id, request.body.unitId));
  app.post<Id & { Body: { unitId: number }; Reply: LiveState }>('/api/incidents/:id/decline', { schema: { params: idParams, body: unitBody } },
    async (request) => calls.decline(request.me!, request.params.id, request.body.unitId));
  app.post<Id & { Body: { unitId: number }; Reply: LiveState }>('/api/incidents/:id/assign', { schema: { params: idParams, body: unitBody } },
    async (request) => calls.assign(request.me!, request.params.id, request.body.unitId));
  app.post<Id & { Reply: LiveState }>('/api/incidents/:id/on-site', { schema: { params: idParams } },
    async (request) => calls.onSite(request.me!, request.params.id));
  app.post<Id & { Reply: LiveState }>('/api/incidents/:id/withdraw', { schema: { params: idParams } },
    async (request) => calls.withdraw(request.me!, request.params.id));
  app.post<Id & { Body: CloseIncident; Reply: LiveState }>('/api/incidents/:id/close', {
    schema: {
      params: idParams,
      body: {
        type: 'object',
        required: ['outcome', 'persons', 'note', 'stayHere'],
        properties: { outcome: { enum: Object.keys(OUTCOMES) }, persons: details.persons, note, stayHere: { type: 'boolean' }, pause: { type: 'boolean' } },
      },
    },
  }, async (request) => calls.close(request.me!, request.params.id, request.body));

  app.put<Id & { Body: { availability: UnitAvailability }; Reply: LiveState }>('/api/units/:id/availability', {
    schema: { params: idParams, body: { type: 'object', required: ['availability'], properties: { availability: { enum: ['vrij', 'pauze', 'uit_dienst'] } } } },
  }, async (request) => calls.setAvailability(request.me!, request.params.id, request.body.availability));

  // Mobiele eenheden delen elke minuut hun positie; de server bewaart alleen de laatste, in het geheugen.
  app.put<Id & { Body: { lat: number; lng: number } }>('/api/units/:id/position', {
    schema: {
      params: idParams,
      body: { type: 'object', required: ['lat', 'lng'], properties: { lat: { type: 'number', minimum: -90, maximum: 90 }, lng: { type: 'number', minimum: -180, maximum: 180 } } },
    },
  }, async (request, reply) => {
    calls.setPosition(request.me!, request.params.id, request.body);
    return reply.code(204).send();
  });

  app.put<Id & { Body: { open: boolean }; Reply: LiveState }>('/api/posts/:id/open', {
    schema: { params: idParams, body: { type: 'object', required: ['open'], properties: { open: { type: 'boolean' } } } },
  }, async (request) => calls.setPostOpen(request.me!, request.params.id, request.body.open));
}
