// Aanvragen voor water, verkeer en vrijwilligers: de post vraagt aan, de coördinator pakt op en handelt af.
import type { FastifyInstance } from 'fastify';
import { REQUEST_KINDS, type LiveRequest, type LiveState, type NewRequest } from '@ehbo/shared';
import { requireMe } from '../auth.ts';
import type { Calls } from '../calls.ts';
import type { Requests } from '../requests.ts';

const idParams = { type: 'object', required: ['id'], properties: { id: { type: 'integer', minimum: 1 } } } as const;
const detail = { type: ['string', 'null'], maxLength: 40 } as const;

type Id = { Params: { id: number } };

export async function requestRoutes(app: FastifyInstance, { calls, requests }: { calls: Calls; requests: Requests }) {
  app.addHook('preHandler', requireMe);

  app.post<{ Body: NewRequest; Reply: LiveRequest }>('/api/requests', {
    schema: {
      body: {
        type: 'object',
        required: ['postId', 'kind', 'detail', 'clientId'],
        properties: {
          postId: { type: 'integer', minimum: 1 },
          kind: { enum: Object.keys(REQUEST_KINDS) },
          detail,
          clientId: { type: 'string', minLength: 8, maxLength: 64 },
        },
      },
    },
  }, async (request, reply) => reply.code(201).send(requests.create(request.me!, request.body)));

  // Elke wijziging geeft de hele live stand terug, net als bij de oproepen.
  app.put<Id & { Body: { detail: string | null }; Reply: LiveState }>('/api/requests/:id', {
    schema: { params: idParams, body: { type: 'object', required: ['detail'], properties: { detail } } },
  }, async (request) => {
    requests.setDetail(request.me!, request.params.id, request.body.detail);
    return calls.state();
  });
  for (const action of ['pick', 'done', 'withdraw'] as const) {
    app.post<Id & { Reply: LiveState }>(`/api/requests/:id/${action}`, { schema: { params: idParams } }, async (request) => {
      requests[action](request.me!, request.params.id);
      return calls.state();
    });
  }
}
