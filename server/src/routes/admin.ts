// Beheer-API: alleen voor beheerders. Elke wijziging geeft de nieuwe stand terug.
import type { FastifyInstance } from 'fastify';
import {
  DATE_PATTERN,
  ESCALATION_MAX_SECONDS,
  ESCALATION_MIN_SECONDS,
  TIME_PATTERN,
  normalizePhone,
  type AddAdminRequest,
  type AdminState,
  type CoreTeamEntry,
  type EmergencyNumber,
  type EventSettings,
  type PostData,
  type RunData,
  type UnitData,
} from '@ehbo/shared';
import { adminDb } from '../admin-db.ts';
import { requireAdmin } from '../auth.ts';
import type { EventDb } from '../event-db.ts';
import { parseGpx } from '../gpx.ts';

const GPX_LIMIT = 10 * 1024 * 1024;

const badRequest = (message: string) => Object.assign(new Error(message), { statusCode: 400 });
const notFound = (message: string) => Object.assign(new Error(message), { statusCode: 404 });

/** Telefoonnummer in E.164, of een foutmelding die zegt bij wie het nummer niet klopt. */
function phoneOf(input: string, who: string) {
  const phone = normalizePhone(input);
  if (!phone) throw badRequest(`Ongeldig telefoonnummer bij ${who.trim() || 'een van de personen'}: ${input}`);
  return phone;
}

const text = (max: number) => ({ type: 'string', maxLength: max }) as const;
const optionalText = (max: number) => ({ type: ['string', 'null'], maxLength: max }) as const;
const date = { type: ['string', 'null'], pattern: DATE_PATTERN } as const;
const time = { type: ['string', 'null'], pattern: TIME_PATTERN } as const;
const idParams = { type: 'object', required: ['id'], properties: { id: { type: 'integer', minimum: 1 } } } as const;

const eventSchema = {
  type: 'object',
  required: ['name', 'startLocation', 'startDate', 'endDate', 'escalationSeconds'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 80 },
    startLocation: optionalText(120),
    startDate: date,
    endDate: date,
    escalationSeconds: { type: 'integer', minimum: ESCALATION_MIN_SECONDS, maximum: ESCALATION_MAX_SECONDS },
  },
} as const;

const runSchema = {
  type: 'object',
  required: ['name', 'distanceKm', 'discipline', 'date', 'startTime'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 60 },
    distanceKm: { type: ['number', 'null'], minimum: 0, maximum: 1000 },
    discipline: optionalText(60),
    date,
    startTime: time,
  },
} as const;

const personSchema = {
  type: 'object',
  required: ['name', 'phone'],
  properties: { name: text(80), phone: { type: 'string', minLength: 1, maxLength: 32 } },
} as const;

const postSchema = {
  type: 'object',
  required: ['typeId', 'name', 'km', 'lat', 'lng', 'accuracyM', 'address', 'accessRoute', 'timeFrom', 'timeTo', 'contacts'],
  properties: {
    typeId: { type: 'integer' },
    name: { type: 'string', minLength: 1, maxLength: 80 },
    km: { type: ['number', 'null'], minimum: 0, maximum: 1000 },
    lat: { type: ['number', 'null'], minimum: -90, maximum: 90 },
    lng: { type: ['number', 'null'], minimum: -180, maximum: 180 },
    accuracyM: { type: ['number', 'null'], minimum: 0 },
    address: optionalText(200),
    accessRoute: optionalText(1000),
    timeFrom: time,
    timeTo: time,
    contacts: {
      type: 'array',
      maxItems: 50,
      items: {
        type: 'object',
        required: ['name', 'phone', 'role', 'timeFrom', 'timeTo'],
        properties: {
          ...personSchema.properties,
          role: { enum: ['verantwoordelijke', 'lid', 'reserve'] },
          timeFrom: time,
          timeTo: time,
        },
      },
    },
  },
} as const;

const unitSchema = {
  type: 'object',
  required: ['name', 'kind', 'mobility', 'postId', 'hasAed', 'members'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 60 },
    kind: { enum: ['vast', 'mobiel'] },
    mobility: { enum: ['te_voet', 'fiets', 'auto', 'anders', null] },
    postId: { type: ['integer', 'null'] },
    hasAed: { type: 'boolean' },
    members: { type: 'array', maxItems: 20, items: personSchema },
  },
} as const;

export async function adminRoutes(app: FastifyInstance, { db }: { db: EventDb }) {
  const admin = adminDb(db);

  app.addHook('preHandler', requireAdmin);
  // Na elke geslaagde wijziging een nieuwe versie van het evenementpakket.
  app.addHook('onResponse', async (request, reply) => {
    if (request.method !== 'GET' && reply.statusCode < 300) db.bumpVersion();
  });

  // GPX-bestanden komen binnen als tekst, los van de JSON-limiet van 16 kB.
  app.addContentTypeParser(['application/gpx+xml', 'application/xml', 'text/xml', 'application/octet-stream'],
    { parseAs: 'string', bodyLimit: GPX_LIMIT }, (_request, body, done) => done(null, body));

  app.get<{ Reply: AdminState }>('/api/admin', async () => admin.getState());

  app.put<{ Body: EventSettings; Reply: AdminState }>('/api/admin/event', { schema: { body: eventSchema } }, async (request) => {
    const { startDate, endDate } = request.body;
    if (startDate && endDate && endDate < startDate) throw badRequest('De einddatum ligt voor de begindatum');
    admin.saveEvent(request.body);
    return admin.getState();
  });

  // Lopen
  app.post<{ Body: RunData; Reply: AdminState }>('/api/admin/runs', { schema: { body: runSchema } }, async (request) => {
    admin.saveRun(null, request.body);
    return admin.getState();
  });
  app.put<{ Params: { id: number }; Body: RunData; Reply: AdminState }>('/api/admin/runs/:id', { schema: { params: idParams, body: runSchema } }, async (request) => {
    if (admin.saveRun(request.params.id, request.body) === null) throw notFound('Loop niet gevonden');
    return admin.getState();
  });
  app.delete<{ Params: { id: number }; Reply: AdminState }>('/api/admin/runs/:id', { schema: { params: idParams } }, async (request) => {
    if (!admin.deleteRun(request.params.id)) throw notFound('Loop niet gevonden');
    return admin.getState();
  });
  app.put<{ Params: { id: number }; Querystring: { filename?: string }; Body: string; Reply: AdminState }>('/api/admin/runs/:id/gpx', {
    schema: { params: idParams, querystring: { type: 'object', properties: { filename: { type: 'string', maxLength: 120 } } } },
  }, async (request) => {
    if (typeof request.body !== 'string') throw badRequest('Stuur het GPX-bestand mee');
    let track;
    try {
      track = parseGpx(request.body);
    } catch (err) {
      throw badRequest((err as Error).message);
    }
    if (!admin.setRunGpx(request.params.id, request.query.filename || 'parcours.gpx', request.body, track)) throw notFound('Loop niet gevonden');
    return admin.getState();
  });

  // Posten
  const checkPost = (body: PostData): PostData => {
    if (!admin.postTypeExists(body.typeId)) throw badRequest('Onbekende soort post');
    if ((body.lat === null) !== (body.lng === null)) throw badRequest('Vul zowel breedte- als lengtegraad in');
    return { ...body, contacts: body.contacts.map((c) => ({ ...c, name: c.name.trim(), phone: phoneOf(c.phone, c.name) })) };
  };
  app.post<{ Body: PostData; Reply: AdminState }>('/api/admin/posts', { schema: { body: postSchema } }, async (request) => {
    admin.savePost(null, checkPost(request.body));
    return admin.getState();
  });
  app.put<{ Params: { id: number }; Body: PostData; Reply: AdminState }>('/api/admin/posts/:id', { schema: { params: idParams, body: postSchema } }, async (request) => {
    if (admin.savePost(request.params.id, checkPost(request.body)) === null) throw notFound('Post niet gevonden');
    return admin.getState();
  });
  app.delete<{ Params: { id: number }; Reply: AdminState }>('/api/admin/posts/:id', { schema: { params: idParams } }, async (request) => {
    if (!admin.deletePost(request.params.id)) throw notFound('Post niet gevonden');
    return admin.getState();
  });

  // EHBO-eenheden
  const checkUnit = (body: UnitData): UnitData => {
    if (body.kind === 'vast' && body.postId === null) throw badRequest('Kies de EHBO-post van deze vaste eenheid');
    if (body.postId !== null && !admin.postExists(body.postId)) throw badRequest('Onbekende post');
    return { ...body, members: body.members.map((m) => ({ name: m.name.trim(), phone: phoneOf(m.phone, m.name) })) };
  };
  app.post<{ Body: UnitData; Reply: AdminState }>('/api/admin/units', { schema: { body: unitSchema } }, async (request) => {
    admin.saveUnit(null, checkUnit(request.body));
    return admin.getState();
  });
  app.put<{ Params: { id: number }; Body: UnitData; Reply: AdminState }>('/api/admin/units/:id', { schema: { params: idParams, body: unitSchema } }, async (request) => {
    if (admin.saveUnit(request.params.id, checkUnit(request.body)) === null) throw notFound('EHBO-eenheid niet gevonden');
    return admin.getState();
  });
  app.delete<{ Params: { id: number }; Reply: AdminState }>('/api/admin/units/:id', { schema: { params: idParams } }, async (request) => {
    if (!admin.deleteUnit(request.params.id)) throw notFound('EHBO-eenheid niet gevonden');
    return admin.getState();
  });

  // Kernteam en noodnummers: de hele lijst in één keer.
  app.put<{ Body: CoreTeamEntry[]; Reply: AdminState }>('/api/admin/core-team', {
    schema: {
      body: {
        type: 'array',
        maxItems: 30,
        items: {
          type: 'object',
          required: ['function', 'name', 'phone', 'isCoordinator'],
          properties: { function: { type: 'string', minLength: 1, maxLength: 60 }, name: text(80), phone: optionalText(32), isCoordinator: { type: 'boolean' } },
        },
      },
    },
  }, async (request) => {
    if (request.body.filter((c) => c.isCoordinator).length > 1) throw badRequest('Er is maar één evenementcoördinator');
    admin.saveCoreTeam(request.body.map((c) => ({ ...c, phone: c.phone?.trim() ? phoneOf(c.phone, c.name || c.function) : null })));
    return admin.getState();
  });

  app.put<{ Body: EmergencyNumber[]; Reply: AdminState }>('/api/admin/emergency-numbers', {
    schema: {
      body: {
        type: 'array',
        maxItems: 20,
        items: {
          type: 'object',
          required: ['label', 'number'],
          // Noodnummers mogen ook kort of 0900 zijn; alleen cijfers, spaties, streepjes en +.
          properties: { label: { type: 'string', minLength: 1, maxLength: 60 }, number: { type: 'string', minLength: 3, maxLength: 20, pattern: '^[0-9+][0-9 -]*$' } },
        },
      },
    },
  }, async (request) => {
    admin.saveEmergencyNumbers(request.body);
    return admin.getState();
  });

  // Beheerders
  app.post<{ Body: AddAdminRequest; Reply: AdminState }>('/api/admin/admins', {
    schema: { body: { type: 'object', required: ['phone'], properties: { phone: text(32), name: text(80) } } },
  }, async (request) => {
    admin.addAdmin(phoneOf(request.body.phone, request.body.name ?? 'de nieuwe beheerder'), request.body.name ?? '');
    return admin.getState();
  });
  app.delete<{ Params: { phone: string }; Reply: AdminState }>('/api/admin/admins/:phone', async (request) => {
    const phone = phoneOf(request.params.phone, 'de beheerder');
    if (phone === request.me!.phone) throw badRequest('Je kunt je eigen nummer niet verwijderen');
    if (!admin.removeAdmin(phone)) throw notFound('Geen beheerder met dit nummer');
    return admin.getState();
  });
}
