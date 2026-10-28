// EHBO-oproepen: van verzoek tot afronden, en de live stand die alle medewerkers zien.
import type { LiveRequest } from './request.ts';

/** Gemeld (op de telefoon) → verstuurd → geaccepteerd → ter plaatse → afgerond, of ingetrokken. */
export type IncidentStatus = 'verstuurd' | 'geaccepteerd' | 'ter_plaatse' | 'afgerond' | 'ingetrokken';
/** Eerst de dichtstbijzijnde vrije eenheid (en bij niet aanspreekbaar ook de dichtstbijzijnde met AED), daarna alle vrije eenheden. */
export type IncidentStage = 'dichtstbij' | 'alle';

export const INCIDENT_WHAT = {
  onwel: 'Onwel / flauw',
  letsel: 'Gevallen / letsel',
  kramp: 'Kramp / blessure',
  onbekend: 'Weet ik niet',
} as const;
export type IncidentWhat = keyof typeof INCIDENT_WHAT;

export const INCIDENT_PERSONS = ['1', '2', '3+'] as const;
export type IncidentPersons = (typeof INCIDENT_PERSONS)[number];

export const RESPONSIVE = { ja: 'Ja', nee: 'Nee', onbekend: 'Weet niet' } as const;
export type Responsive = keyof typeof RESPONSIVE;

export const OUTCOMES = {
  geholpen: 'Ter plaatse geholpen',
  gestopt: 'Gestopt, naar finish',
  ambulance: 'Ambulance (112)',
  doorverwezen: 'Doorverwezen SEH/arts',
  geweigerd: 'Hulp geweigerd',
  loos: 'Loos alarm',
} as const;
export type Outcome = keyof typeof OUTCOMES;

/** Wat de eenheid zelf instelt. "Bezet" volgt uit een lopende oproep. */
export type UnitAvailability = 'vrij' | 'pauze' | 'uit_dienst';
export const UNIT_AVAILABILITY = { vrij: 'Vrij', pauze: 'Even pauze', uit_dienst: 'Uit dienst' } as const;

export const NOTE_MAX = 500;

/** Wat de post invult; alles is optioneel. */
export interface IncidentDetails {
  what: IncidentWhat | null;
  persons: IncidentPersons | null;
  responsive: Responsive | null;
  note: string | null;
}

/** POST /api/incidents */
export interface NewIncident extends IncidentDetails {
  postId: number;
  /** Door de telefoon gekozen id: een melding die zonder bereik is bewaard en later opnieuw wordt verstuurd, telt maar één keer. */
  clientId: string;
  /** Wanneer de post op versturen tikte (ISO), als dat eerder was dan nu. */
  reportedAt?: string;
}

export interface CloseIncident {
  outcome: Outcome;
  persons: IncidentPersons | null;
  note: string | null;
  /** Vaste eenheid: "ik blijf hier even", dan telt deze post als haar plek tot ze terug is. */
  stayHere: boolean;
}

export type DispatchReason = 'dichtstbij' | 'aed' | 'alle' | 'handmatig';

/** Een eenheid die deze oproep heeft gekregen. */
export interface Dispatch {
  unitId: number;
  at: string;
  reason: DispatchReason;
  /** Hemelsbreed, in km; null als de positie van de eenheid onbekend is. */
  distanceKm: number | null;
  declinedAt: string | null;
  /** Meer dan één eenheid kan aannemen: bij niet aanspreekbaar komt de AED-eenheid ook. */
  acceptedAt: string | null;
}

export type IncidentEventType =
  | 'gemeld' | 'verstuurd' | 'aangevuld' | 'geweigerd' | 'geescaleerd' | 'herhaald'
  | 'geaccepteerd' | 'toegewezen' | 'ter_plaatse' | 'afgerond' | 'ingetrokken';

/** Eén regel in de tijdlijn (scherm en rapport). */
export interface IncidentEvent {
  at: string;
  type: IncidentEventType;
  unitId: number | null;
  text: string;
}

export interface LiveIncident extends IncidentDetails {
  id: number;
  postId: number;
  status: IncidentStatus;
  stage: IncidentStage;
  /** Niet aanspreekbaar: AED meenemen, en de post krijgt het advies 112 te bellen. */
  aed: boolean;
  reportedAt: string;
  sentAt: string;
  /** Wanneer de oproep naar alle eenheden gaat, zolang hij nog bij de dichtstbijzijnde ligt. */
  escalatesAt: string | null;
  unitId: number | null;
  acceptedBy: { name: string; phone: string } | null;
  acceptedAt: string | null;
  onSiteAt: string | null;
  closedAt: string | null;
  outcome: Outcome | null;
  dispatches: Dispatch[];
  events: IncidentEvent[];
}

export interface LiveUnit {
  id: number;
  availability: UnitAvailability;
  /** De oproep waar de eenheid mee bezig is (geaccepteerd of ter plaatse). */
  incidentId: number | null;
  /** Vaste eenheid die na afronden bij een andere post bleef. */
  stayPostId: number | null;
}

/** GET /api/live/state, en elk bericht op GET /api/live (SSE). Iedere medewerker ziet hetzelfde. */
export interface LiveState {
  /** Telt op bij elke wijziging. */
  version: number;
  serverTime: string;
  incidents: LiveIncident[];
  units: LiveUnit[];
  posts: { id: number; isOpen: boolean }[];
  /** Aanvragen voor water, verkeer en vrijwilligers (wachtrij van de coördinator). */
  requests: LiveRequest[];
}

/** SSE: hartslag, zodat Cloudflare de verbinding niet na 100 s stil sluit. */
export const LIVE_HEARTBEAT_MS = 30_000;
/** Een mobiele eenheid deelt elke minuut haar positie; ouder dan dit telt niet meer. */
export const POSITION_MAX_AGE_MS = 3 * 60_000;
