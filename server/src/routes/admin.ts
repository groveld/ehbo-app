// Beheer-API: alleen voor beheerders. Elke wijziging geeft de nieuwe stand terug.
import type { FastifyInstance } from 'fastify';
import {
  LOGIN_CODE_PATTERN,
  COLOR_PATTERN,
  DATE_PATTERN,
  AT_LOCATION_MAX_M,
  AT_LOCATION_MIN_M,
  SHARE_AFTER_MAX_MIN,
  ESCALATION_MAX_SECONDS,
  ESCALATION_MIN_SECONDS,
  IMAGE_MAX_BASE64,
  INFO_SECTIONS_MAX,
  SHORT_NAME_MAX,
  TIME_PATTERN,
  normalizeEmergencyNumber,
  normalizePhone,
  styleProblem,
  type AddAdminRequest,
  type ImportPreview,
  type ImportRequest,
  type PeopleOverview,
  type AdminState,
  type CoreTeamEntry,
  type EmergencyNumber,
  type EventSettings,
  type IconUpload,
  type InfoSettings,
  type LogoUpload,
  type LocationData,
  type Report,
  type RunData,
  type TeamData,
  type ZoneData,
  ZONE_POINTS_MAX,
  zoneProblem,
} from '@ehbo/shared';
import { adminDb } from '../admin-db.ts';
import { BRAND_IMAGES, ICON_IMAGES, LOGO_MAX_SIDE, pngSize, setBrandImages } from '../brand.ts';
import type { Calls } from '../calls.ts';
import { nextMidnight, requireAdmin, sessionsEnded, sqliteTime } from '../auth.ts';
import type { EventDb } from '../event-db.ts';
import { parseGpx } from '../gpx.ts';
import { peopleCsv, peopleOverview } from '../people.ts';
import { SHEET_KEYS, exportCsv, exportXlsx, planImport, sheetFileName } from '../spreadsheet.ts';
import { buildReport, reportCsv } from '../report.ts';

const GPX_LIMIT = 10 * 1024 * 1024;
/** An import as base64 JSON: an .xlsx of an event is a few hundred kB at most. */
const IMPORT_LIMIT = 8 * 1024 * 1024;

declare module 'fastify' {
  interface FastifyContextConfig {
    /** Changes nothing, so the event package keeps its version (e.g. checking an import). */
    readOnly?: boolean;
  }
}

const badRequest = (message: string) => Object.assign(new Error(message), { statusCode: 400 });
const notFound = (message: string) => Object.assign(new Error(message), { statusCode: 404 });
const conflict = (message: string) => Object.assign(new Error(message), { statusCode: 409 });

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
  required: ['name', 'startLocation', 'startDate', 'endDate', 'escalationSeconds', 'atLocationM', 'shareAfterMin', 'loginCode', 'style'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 80 },
    startLocation: optionalText(120),
    startDate: date,
    endDate: date,
    escalationSeconds: { type: 'integer', minimum: ESCALATION_MIN_SECONDS, maximum: ESCALATION_MAX_SECONDS },
    atLocationM: { type: 'integer', minimum: AT_LOCATION_MIN_M, maximum: AT_LOCATION_MAX_M },
    shareAfterMin: { type: 'integer', minimum: 0, maximum: SHARE_AFTER_MAX_MIN },
    loginCode: { type: 'string', pattern: LOGIN_CODE_PATTERN },
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

const coordinate = { type: 'array', minItems: 2, maxItems: 2, items: [{ type: 'number', minimum: -180, maximum: 180 }, { type: 'number', minimum: -90, maximum: 90 }] } as const;
const zoneSchema = {
  type: 'object',
  required: ['kind', 'name', 'note', 'points'],
  properties: {
    kind: { type: 'string', enum: ['parking', 'food'] },
    name: { type: 'string', minLength: 1, maxLength: 60 },
    note: optionalText(200),
    points: { type: 'array', maxItems: ZONE_POINTS_MAX, items: coordinate },
  },
} as const;

const personSchema = {
  type: 'object',
  required: ['name', 'phone'],
  properties: { name: text(80), phone: { type: 'string', minLength: 1, maxLength: 32 } },
} as const;

const locationSchema = {
  type: 'object',
  required: ['functionIds', 'runId', 'name', 'lat', 'lng', 'accuracyM', 'address', 'accessRoute', 'timeFrom', 'timeTo', 'contacts'],
  properties: {
    functionIds: { type: 'array', minItems: 1, maxItems: 12, uniqueItems: true, items: { type: 'integer' } },
    runId: { type: ['integer', 'null'] },
    name: { type: 'string', minLength: 1, maxLength: 80 },
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
          role: { enum: ['lead', 'member', 'reserve'] },
          timeFrom: time,
          timeTo: time,
        },
      },
    },
  },
} as const;

const teamSchema = {
  type: 'object',
  required: ['name', 'kind', 'mobility', 'locationId', 'hasAed', 'members'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 60 },
    kind: { enum: ['fixed', 'mobile'] },
    mobility: { enum: ['on_foot', 'bike', 'car', 'other', null] },
    locationId: { type: ['integer', 'null'] },
    hasAed: { type: 'boolean' },
    timeFrom: time,
    timeTo: time,
    members: { type: 'array', maxItems: 20, items: personSchema },
  },
} as const;

export async function adminRoutes(app: FastifyInstance, { db, calls }: { db: EventDb; calls: Calls }) {
  const admin = adminDb(db);

  app.addHook('preHandler', requireAdmin);
  // Na elke geslaagde wijziging een nieuwe versie van het evenementpakket.
  app.addHook('onResponse', async (request, reply) => {
    if (request.method === 'GET' || reply.statusCode >= 300 || request.routeOptions.config.readOnly) return;
    db.bumpVersion();
    // Eenheden of posten kunnen veranderd zijn: de live stand opnieuw naar iedereen.
    calls.changed();
  });

  // Rapport (6.1): als JSON voor het scherm en de afdrukpagina, en als CSV om te downloaden.
  app.get<{ Reply: Report }>('/api/admin/report', async () => buildReport(db));
  app.get('/api/admin/report.csv', async (_request, reply) => {
    const report = buildReport(db);
    const day = report.event.startDate ?? report.generatedAt.slice(0, 10);
    reply.header('Content-Disposition', `attachment; filename="rapport-${day}.csv"`).type('text/csv; charset=utf-8');
    return reportCsv(report);
  });

  // Import and export (#43): one .xlsx as export and template, or a CSV per sheet. Checking first shows what would change.
  app.get('/api/admin/export.xlsx', async (_request, reply) => {
    reply.header('Content-Disposition', 'attachment; filename="evenement.xlsx"').type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    return exportXlsx(admin.getState());
  });
  app.get<{ Params: { file: string } }>('/api/admin/export/:file', async (request, reply) => {
    const state = admin.getState();
    const key = SHEET_KEYS.find((k) => `${sheetFileName(state, k)}.csv` === request.params.file);
    if (!key) throw notFound('Onbekend tabblad');
    reply.header('Content-Disposition', `attachment; filename="${request.params.file}"`).type('text/csv; charset=utf-8');
    return exportCsv(state, key);
  });
  const importSchema = {
    body: {
      type: 'object',
      required: ['files', 'removeMissing'],
      properties: {
        files: { type: 'array', minItems: 1, maxItems: 10, items: { type: 'object', required: ['name', 'data'], properties: { name: text(200), data: { type: 'string' } } } },
        removeMissing: { type: 'boolean' },
      },
    },
  } as const;
  const importFiles = (body: ImportRequest) => body.files.map((f) => ({ name: f.name, data: Buffer.from(f.data, 'base64') }));
  app.post<{ Body: ImportRequest; Reply: ImportPreview }>('/api/admin/import/check', { bodyLimit: IMPORT_LIMIT, schema: importSchema, config: { readOnly: true } },
    async (request) => planImport(admin, importFiles(request.body), request.body.removeMissing).preview);
  app.post<{ Body: ImportRequest; Reply: AdminState }>('/api/admin/import', { bodyLimit: IMPORT_LIMIT, schema: importSchema }, async (request) => {
    const plan = planImport(admin, importFiles(request.body), request.body.removeMissing);
    db.transaction(plan.apply);
    return admin.getState();
  });

  // Beheer › Mensen: everyone at once, to see who's missing or listed twice. Only the name can be changed here.
  app.get<{ Reply: PeopleOverview }>('/api/admin/people', async () => peopleOverview(db));
  app.get('/api/admin/people.csv', async (_request, reply) => {
    reply.header('Content-Disposition', 'attachment; filename="mensen.csv"').type('text/csv; charset=utf-8');
    return peopleCsv(peopleOverview(db));
  });
  app.put<{ Params: { phone: string }; Body: { name: string }; Reply: PeopleOverview }>('/api/admin/people/:phone', {
    schema: { body: { type: 'object', required: ['name'], properties: { name: { type: 'string', maxLength: 80 } } } },
  }, async (request) => {
    const phone = normalizePhone(request.params.phone);
    if (!phone || db.raw.prepare('UPDATE people SET name = ? WHERE phone = ?').run(request.body.name.trim(), phone).changes === 0) throw notFound('Persoon niet gevonden');
    return peopleOverview(db);
  });

  // Testmodus: proefoproepen en -aanvragen komen niet in het rapport. Na afloop kun je ze wissen.
  app.put<{ Body: { on: boolean }; Reply: AdminState }>('/api/admin/test-mode', {
    schema: { body: { type: 'object', required: ['on'], properties: { on: { type: 'boolean' } } } },
  }, async (request) => {
    db.raw.prepare('UPDATE event SET test_mode = ? WHERE id = 1').run(request.body.on ? 1 : 0);
    // Testers are logged out after the test day: sessions that are already there end at midnight too.
    if (request.body.on) db.shortenSessions(sqliteTime(nextMidnight()));
    return admin.getState();
  });
  // Everyone except the admin who presses it. Their phones get no pushes any more, and what nobody is logged in for closes.
  app.post<{ Reply: AdminState }>('/api/admin/logout-all', async (request) => {
    sessionsEnded(db, calls, db.deleteOtherSessions(request.sessionHash));
    return admin.getState();
  });
  app.delete<{ Reply: AdminState }>('/api/admin/test-data', async () => {
    const open = db.raw.prepare("SELECT COUNT(*) AS n FROM incidents WHERE is_test = 1 AND status IN ('sent', 'accepted', 'on_site')").get() as { n: number };
    if (open.n) throw Object.assign(new Error('Er lopen nog proefoproepen. Rond ze eerst af of trek ze in.'), { statusCode: 409 });
    db.transaction(() => {
      db.raw.prepare('DELETE FROM help_requests WHERE is_test = 1').run();
    });
    return admin.getState();
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

  // Zones (#172)
  const checkZone = (body: ZoneData) => {
    const problem = zoneProblem(body);
    if (problem) throw badRequest(`${body.name.trim()}: ${problem.toLowerCase()}`);
    return body;
  };
  app.post<{ Body: ZoneData; Reply: AdminState }>('/api/admin/zones', { schema: { body: zoneSchema } }, async (request) => {
    admin.saveZone(null, checkZone(request.body));
    return admin.getState();
  });
  app.put<{ Params: { id: number }; Body: ZoneData; Reply: AdminState }>('/api/admin/zones/:id', { schema: { params: idParams, body: zoneSchema } }, async (request) => {
    if (admin.saveZone(request.params.id, checkZone(request.body)) === null) throw notFound('Zone niet gevonden');
    return admin.getState();
  });
  app.delete<{ Params: { id: number }; Reply: AdminState }>('/api/admin/zones/:id', { schema: { params: idParams } }, async (request) => {
    if (!admin.deleteZone(request.params.id)) throw notFound('Zone niet gevonden');
    return admin.getState();
  });

  // Posten
  const checkLocation = (body: LocationData): LocationData => {
    if (!body.functionIds.every((id) => admin.functionTypeExists(id))) throw badRequest('Onbekende functie');
    if (body.runId !== null && !admin.runExists(body.runId)) throw badRequest('Onbekende loop');
    // One lead per location (#83): two people responsible apart from each other means two locations.
    if (body.contacts.filter((c) => c.role === 'lead').length > 1) throw badRequest(`${body.name.trim()}: kies één locatieverantwoordelijke`);
    if ((body.lat === null) !== (body.lng === null)) throw badRequest('Vul zowel breedte- als lengtegraad in');
    return { ...body, contacts: body.contacts.map((c) => ({ ...c, name: c.name.trim(), phone: phoneOf(c.phone, c.name) })) };
  };
  app.post<{ Body: LocationData; Reply: AdminState }>('/api/admin/locations', { schema: { body: locationSchema } }, async (request) => {
    admin.saveLocation(null, checkLocation(request.body));
    return admin.getState();
  });
  app.put<{ Params: { id: number }; Body: LocationData; Reply: AdminState }>('/api/admin/locations/:id', { schema: { params: idParams, body: locationSchema } }, async (request) => {
    if (admin.saveLocation(request.params.id, checkLocation(request.body)) === null) throw notFound('Locatie niet gevonden');
    return admin.getState();
  });
  app.delete<{ Params: { id: number }; Reply: AdminState }>('/api/admin/locations/:id', { schema: { params: idParams } }, async (request) => {
    if (admin.locationHasHistory(request.params.id)) throw conflict('Deze locatie heeft oproepen of aanvragen en kan daarom niet weg. Zet haar dicht, of wis eerst de proefgegevens in het rapport.');
    if (!admin.deleteLocation(request.params.id)) throw notFound('Locatie niet gevonden');
    return admin.getState();
  });

  // EHBO-eenheden
  const checkTeam = (body: TeamData): TeamData => {
    if (body.kind === 'fixed' && body.locationId === null) throw badRequest('Kies de EHBO-post van deze vaste eenheid');
    if (body.locationId !== null && !admin.locationExists(body.locationId)) throw badRequest('Onbekende locatie');
    return { ...body, members: body.members.map((m) => ({ name: m.name.trim(), phone: phoneOf(m.phone, m.name) })) };
  };
  app.post<{ Body: TeamData; Reply: AdminState }>('/api/admin/teams', { schema: { body: teamSchema } }, async (request) => {
    admin.saveTeam(null, checkTeam(request.body));
    return admin.getState();
  });
  app.put<{ Params: { id: number }; Body: TeamData; Reply: AdminState }>('/api/admin/teams/:id', { schema: { params: idParams, body: teamSchema } }, async (request) => {
    if (admin.saveTeam(request.params.id, checkTeam(request.body)) === null) throw notFound('EHBO-eenheid niet gevonden');
    return admin.getState();
  });
  app.delete<{ Params: { id: number }; Reply: AdminState }>('/api/admin/teams/:id', { schema: { params: idParams } }, async (request) => {
    if (!admin.deleteTeam(request.params.id)) throw notFound('EHBO-eenheid niet gevonden');
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

  // Info & voorwaarden: eigen teksten, of null voor de standaardtekst.
  app.put<{ Body: InfoSettings; Reply: AdminState }>('/api/admin/info', {
    schema: {
      body: {
        type: 'object',
        required: ['sections', 'policy', 'contact'],
        properties: {
          sections: {
            type: ['array', 'null'],
            maxItems: INFO_SECTIONS_MAX,
            items: { type: 'object', required: ['title', 'body'], properties: { title: text(80), body: text(2000) } },
          },
          policy: optionalText(200),
          contact: optionalText(200),
        },
      },
    },
  }, async (request) => {
    admin.saveInfo(request.body);
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
          // Noodnummers mogen ook kort of 0800/0900 zijn; normalizeEmergencyNumber keurt ze verder.
          properties: { label: { type: 'string', minLength: 1, maxLength: 60 }, number: { type: 'string', minLength: 3, maxLength: 24 } },
        },
      },
    },
  }, async (request) => {
    admin.saveEmergencyNumbers(request.body.map(({ label, number }) => {
      const normalized = normalizeEmergencyNumber(number);
      if (!normalized) throw badRequest(`Ongeldig noodnummer bij ${label.trim()}: ${number}`);
      return { label, number: normalized };
    }));
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
