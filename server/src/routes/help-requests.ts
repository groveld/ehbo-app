// One API for every help request (#86): first aid goes to a team (dispatch), water, traffic and volunteer to the coordinator's queue.
// The type decides the handling; actions that belong to one way of handling refuse the other.
import type { FastifyInstance } from 'fastify';
import {
  INCIDENT_PERSONS,
  INCIDENT_WHAT,
  NOTE_MAX,
  OUTCOMES,
  RESPONSIVE,
  type CloseIncident,
  type IncidentDetails,
  type LiveHelpRequest,
  type LiveState,
  type NewHelpRequest,
  type NewIncident,
  type NewRequest,
  type NewSelfIncident,
} from '@ehbo/shared';
import { requireMe } from '../auth.ts';
import type { Calls } from '../calls.ts';
import type { EventDb } from '../event-db.ts';
import type { Requests } from '../requests.ts';
import { actionHeaders } from './calls.ts';

const nullable = (values: readonly string[]) => ({ enum: [...values, null] });
const note = { type: ['string', 'null'], maxLength: NOTE_MAX } as const;
const details = {
  what: nullable(Object.keys(INCIDENT_WHAT)),
  persons: nullable(INCIDENT_PERSONS),
  responsive: nullable(Object.keys(RESPONSIVE)),
  note,
} as const;
const detailsRequired = ['what', 'persons', 'responsive', 'note'];
/** A queue request has one choice of its type, or none. */
const detail = { type: ['string', 'null'], maxLength: 40 } as const;
const clientId = { type: 'string', minLength: 8, maxLength: 64 } as const;
const coordinate = (max: number) => ({ type: ['number', 'null'], minimum: -max, maximum: max }) as const;
const idParams = { type: 'object', required: ['id'], properties: { id: { type: 'integer', minimum: 1 } } } as const;
const teamBody = { type: 'object', required: ['teamId'], properties: { teamId: { type: 'integer', minimum: 1 } } } as const;

type Id = { Params: { id: number } };

const httpError = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });

export async function helpRequestRoutes(app: FastifyInstance, { db, calls, requests }: { db: EventDb; calls: Calls; requests: Requests }) {
  app.addHook('preHandler', requireMe);

  /** This help request is handled this way, or the action doesn't apply to it. */
  const require = (id: number, handling: 'dispatch' | 'queue') => {
    const found = calls.handlingOf(id);
    if (found === null) throw httpError(404, 'Melding niet gevonden');
    if (found !== handling) throw httpError(409, handling === 'dispatch' ? 'Dit is een aanvraag, geen incident' : 'Dit is een incident, geen aanvraag');
  };

  // Asking for help: the type says what else the request needs.
  app.post<{ Body: NewHelpRequest; Reply: LiveHelpRequest }>('/api/help-requests', {
    schema: {
      body: {
        type: 'object',
        required: ['type', 'postId', 'clientId'],
        properties: {
          type: { type: 'string', maxLength: 40 },
          clientId,
          postId: { type: ['integer', 'null'], minimum: 1 },
          reportedAt: { type: 'string', format: 'date-time' },
          lat: coordinate(90),
          lng: coordinate(180),
          accuracyM: { type: ['number', 'null'], minimum: 0, maximum: 100000 },
          ...details,
          detail,
        },
      },
    },
  }, async (request, reply) => {
    const body = request.body as NewHelpRequest & Record<string, unknown>;
    const type = db.helpRequestTypes().find((t) => t.key === body.type);
    if (!type) throw httpError(400, 'Onbekende soort hulpvraag');
    if (type.handling === 'dispatch') {
      if (!detailsRequired.every((k) => k in body)) throw httpError(400, 'Ongeldig verzoek');
      return reply.code(201).send(calls.report(request.me!, body as NewIncident));
    }
    if (typeof body.postId !== 'number' || !('detail' in body)) throw httpError(400, 'Ongeldig verzoek');
    return reply.code(201).send(calls.at(actionHeaders(request)[1], () => requests.create(request.me!, body as NewRequest)));
  });

  app.post<{ Body: NewSelfIncident }>('/api/help-requests/self', {
    schema: {
      body: {
        type: 'object',
        required: ['clientId', 'teamId', 'postId', 'lat', 'lng', ...detailsRequired],
        properties: { clientId, teamId: { type: 'integer', minimum: 1 }, postId: { type: 'integer', minimum: 1 }, lat: coordinate(90), lng: coordinate(180), ...details },
      },
    },
  }, async (request, reply) => reply.code(201).send(calls.at(actionHeaders(request)[1], () => calls.selfStart(request.me!, request.body))));

  // Adding to it: an incident's details, or a request's choice.
  app.put<Id & { Body: Partial<IncidentDetails> & { detail?: string | null }; Reply: LiveState }>('/api/help-requests/:id', {
    schema: { params: idParams, body: { type: 'object', properties: { ...details, detail } } },
  }, async (request) => calls.once(...actionHeaders(request), () => {
    const { id } = request.params;
    const body = request.body;
    if (calls.handlingOf(id) === 'queue') {
      if (!('detail' in body)) throw httpError(400, 'Ongeldig verzoek');
      requests.setDetail(request.me!, id, body.detail ?? null);
      return calls.state();
    }
    require(id, 'dispatch');
    if (!detailsRequired.every((k) => k in body)) throw httpError(400, 'Ongeldig verzoek');
    return calls.update(request.me!, id, body as IncidentDetails);
  }));

  app.post<Id & { Reply: LiveState }>('/api/help-requests/:id/withdraw', { schema: { params: idParams } },
    async (request) => calls.once(...actionHeaders(request), () => {
      const { id } = request.params;
      if (calls.handlingOf(id) === 'queue') {
        requests.withdraw(request.me!, id);
        return calls.state();
      }
      require(id, 'dispatch');
      return calls.withdraw(request.me!, id);
    }));

  // Only for an incident: a team reacts, goes and closes it.
  for (const action of ['accept', 'decline', 'assign'] as const) {
    app.post<Id & { Body: { teamId: number }; Reply: LiveState }>(`/api/help-requests/:id/${action}`, { schema: { params: idParams, body: teamBody } },
      async (request) => calls.once(...actionHeaders(request), () => {
        require(request.params.id, 'dispatch');
        return calls[action](request.me!, request.params.id, request.body.teamId);
      }));
  }
  app.post<Id & { Reply: LiveState }>('/api/help-requests/:id/on-site', { schema: { params: idParams } },
    async (request) => calls.once(...actionHeaders(request), () => {
      require(request.params.id, 'dispatch');
      return calls.onSite(request.me!, request.params.id);
    }));
  app.post<Id & { Body: CloseIncident; Reply: LiveState }>('/api/help-requests/:id/close', {
    schema: {
      params: idParams,
      body: {
        type: 'object',
        required: ['outcome', 'persons', 'note', 'stayHere'],
        properties: { outcome: { enum: Object.keys(OUTCOMES) }, persons: details.persons, note, stayHere: { type: 'boolean' }, pause: { type: 'boolean' } },
      },
    },
  }, async (request) => calls.once(...actionHeaders(request), () => {
    require(request.params.id, 'dispatch');
    return calls.close(request.me!, request.params.id, request.body);
  }));

  // Only for a request in the queue: the coordinator picks it up and handles it.
  for (const action of ['pick', 'done'] as const) {
    app.post<Id & { Reply: LiveState }>(`/api/help-requests/:id/${action}`, { schema: { params: idParams } },
      async (request) => calls.once(...actionHeaders(request), () => {
        require(request.params.id, 'queue');
        requests[action](request.me!, request.params.id);
        return calls.state();
      }));
  }
}
