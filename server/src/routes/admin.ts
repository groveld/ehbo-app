// Beheer-API: alleen voor beheerders. Elke wijziging geeft de nieuwe stand terug.
import type { FastifyInstance } from 'fastify';
import {
  COLOR_PATTERN,
  DATE_PATTERN,
  ESCALATION_MAX_SECONDS,
  ESCALATION_MIN_SECONDS,
  IMAGE_MAX_BASE64,
  SHORT_NAME_MAX,
  TIME_PATTERN,
  normalizePhone,
  styleProblem,
  type AddAdminRequest,
  type AdminState,
  type CoreTeamEntry,
  type EmergencyNumber,
  type EventSettings,
  type IconUpload,
  type LogoUpload,
  type PostData,
  type RunData,
  type UnitData,
} from '@ehbo/shared';
import { adminDb } from '../admin-db.ts';
import { BRAND_IMAGES, ICON_IMAGES, LOGO_MAX_SIDE, pngSize, setBrandImages } from '../brand.ts';
import type { Calls } from '../calls.ts';
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
  required: ['name', 'startLocation', 'startDate', 'endDate', 'escalationSeconds', 'style'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 80 },
    startLocation: optionalText(120),
    startDate: date,
    endDate: date,
    escalationSeconds: { type: 'integer', minimum: ESCALATION_MIN_SECONDS, maximum: ESCALATION_MAX_SECONDS },
    style: {
      type: 'object',
      required: ['shortName', 'primaryColor', 'accentColor'],
      properties: {
        shortName: optionalText(SHORT_NAME_MAX),
        primaryColor: { type: 'string', pattern: COLOR_PATTERN },
        accentColor: { type: 'string', pattern: COLOR_PATTERN },
      },
    },
  },
} as const;

/** PNG als base64. */
const png = { type: 'string', minLength: 1, maxLength: IMAGE_MAX_BASE64 } as const;
const IMAGE_BODY_LIMIT = 4 * 1024 * 1024;

/** PNG uit base64, met de juiste maat; anders een foutmelding. */
function pngOf(base64: string, what: string, size: number | null) {
  const data = Buffer.from(base64, 'base64');
  const dims = pngSize(data);
  if (!dims) throw badRequest(`${what} is geen PNG`);
  if (size !== null && (dims.width !== size || dims.height !== size)) throw badRequest(`${what} moet ${size} × ${size} pixels zijn`);
  if (size === null && (Math.max(dims.width, dims.height) > LOGO_MAX_SIDE || Math.min(dims.width, dims.height) < 1)) {
    throw badRequest(`${what} mag hoogstens ${LOGO_MAX_SIDE} pixels breed of hoog zijn`);
  }
  return data;
}

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

export async function adminRoutes(app: FastifyInstance, { db, calls }: { db: EventDb; calls: Calls }) {
  const admin = adminDb(db);

  app.addHook('preHandler', requireAdmin);
  // Na elke geslaagde wijziging een nieuwe versie van het evenementpakket.
  app.addHook('onResponse', async (request, reply) => {
    if (request.method === 'GET' || reply.statusCode >= 300) return;
    db.bumpVersion();
    // Eenheden of posten kunnen veranderd zijn: de live stand opnieuw naar iedereen.
    calls.changed();
  });

  // GPX-bestanden komen binnen als tekst, los van de JSON-limiet van 16 kB.
  app.addContentTypeParser(['application/gpx+xml', 'application/xml', 'text/xml', 'application/octet-stream'],
    { parseAs: 'string', bodyLimit: GPX_LIMIT }, (_request, body, done) => done(null, body));

  app.get<{ Reply: AdminState }>('/api/admin', async () => admin.getState());

  app.put<{ Body: EventSettings; Reply: AdminState }>('/api/admin/event', { schema: { body: eventSchema } }, async (request) => {
    const { startDate, endDate } = request.body;
    if (startDate && endDate && endDate < startDate) throw badRequest('De einddatum ligt voor de begindatum');
    const problem = styleProblem(request.body.style);
    if (problem) throw badRequest(problem);
    admin.saveEvent(request.body);
    return admin.getState();
  });

  // Logo's: de app stuurt kant-en-klare PNG's; elke upload of verwijdering geeft een nieuwe versie van de afbeeldingen.
  app.put<{ Body: LogoUpload; Reply: AdminState }>('/api/admin/brand/logo', {
    bodyLimit: IMAGE_BODY_LIMIT,
    schema: { body: { type: 'object', required: ['png'], properties: { png } } },
  }, async (request) => {
    setBrandImages(db, { logo: pngOf(request.body.png, 'Het logo', null) });
    return admin.getState();
  });
  app.put<{ Body: IconUpload; Reply: AdminState }>('/api/admin/brand/icon', {
    bodyLimit: IMAGE_BODY_LIMIT,
    schema: { body: { type: 'object', required: ['icon512', 'icon192', 'maskable512', 'appleTouch'], properties: { icon512: png, icon192: png, maskable512: png, appleTouch: png } } },
  }, async (request) => {
    const { icon512, icon192, maskable512, appleTouch } = request.body;
    setBrandImages(db, {
      'icon-512': pngOf(icon512, 'Het app-icoon', BRAND_IMAGES['icon-512'].size),
      'icon-192': pngOf(icon192, 'Het kleine app-icoon', BRAND_IMAGES['icon-192'].size),
      'icon-maskable-512': pngOf(maskable512, 'Het Android-icoon', BRAND_IMAGES['icon-maskable-512'].size),
      'apple-touch-icon': pngOf(appleTouch, 'Het iPhone-icoon', BRAND_IMAGES['apple-touch-icon'].size),
    });
    return admin.getState();
  });
  app.delete<{ Reply: AdminState }>('/api/admin/brand/logo', async () => {
    setBrandImages(db, { logo: null });
    return admin.getState();
  });
  app.delete<{ Reply: AdminState }>('/api/admin/brand/icon', async () => {
    setBrandImages(db, Object.fromEntries(ICON_IMAGES.map((name) => [name, null])));
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
