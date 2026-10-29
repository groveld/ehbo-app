// EHBO-oproepen: van verzoek tot afronden, en de live stand die alle medewerkers zien.
import type { UnitKind } from './event.ts';
import { distanceKm } from './geo.ts';
import type { LiveRequest } from './request.ts';

/** Gemeld (op de telefoon) → verstuurd → geaccepteerd → ter plaatse → afgerond, of ingetrokken. */
export type IncidentStatus = 'verstuurd' | 'geaccepteerd' | 'ter_plaatse' | 'afgerond' | 'ingetrokken';
/** Eerst de dichtstbijzijnde beschikbare eenheid (en bij niet aanspreekbaar ook de dichtstbijzijnde met AED), daarna alle beschikbare eenheden. */
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
export const UNIT_AVAILABILITY = { vrij: 'Beschikbaar', pauze: 'Pauze', uit_dienst: 'Uit dienst' } as const;

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
  /** Daarna pauze (lunch, wc) in plaats van weer beschikbaar. */
  pause?: boolean;
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
  /** Gedaan in de testmodus: telt niet mee in het rapport. */
  isTest: boolean;
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
  /** Mobiele eenheid: laatste GPS-positie (alleen in het geheugen van de server, nooit opgeslagen). */
  position: { lat: number; lng: number; at: string } | null;
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
  /** Testmodus: oproepen en aanvragen zijn proef en komen niet in het rapport. */
  testMode: boolean;
}

/** SSE: hartslag, zodat Cloudflare de verbinding niet na 100 s stil sluit. */
export const LIVE_HEARTBEAT_MS = 30_000;
/** Een mobiele eenheid deelt elke minuut haar positie; ouder dan dit telt niet meer. */
export const POSITION_MAX_AGE_MS = 3 * 60_000;
/** Binnen deze afstand van haar standplaats is een mobiele eenheid thuis. */
export const HOME_RADIUS_KM = 0.05;

/**
 * Onderweg: een mobiele eenheid in dienst met een recente GPS-positie, verder dan 50 m van haar standplaats (of zonder standplaats).
 * Zonder recente positie telt ze als thuis. Een vaste eenheid is altijd op haar post.
 */
export function isAway(unit: { kind: UnitKind }, live: LiveUnit | undefined, base: { lat: number | null; lng: number | null } | undefined, now: number) {
  if (unit.kind !== 'mobiel' || !live?.position || live.availability === 'uit_dienst') return false;
  if (now - new Date(live.position.at).getTime() > POSITION_MAX_AGE_MS) return false;
  return !(base?.lat != null && base.lng != null && distanceKm([live.position.lng, live.position.lat], [base.lng, base.lat]) <= HOME_RADIUS_KM);
}

/** Posten waar EHBO hoort maar nu niemand is: elke eenheid met die post als standplaats is onderweg. Voor een grijs kruisje. */
export function awayPostIds(
  units: { id: number; kind: UnitKind; postId: number | null }[], live: LiveUnit[], posts: { id: number; lat: number | null; lng: number | null }[], now: number,
): number[] {
  const away = new Set(units.filter((u) => isAway(u, live.find((l) => l.id === u.id), posts.find((p) => p.id === u.postId), now)).map((u) => u.id));
  const postIds = new Set(units.flatMap((u) => (u.postId !== null ? [u.postId] : [])));
  return [...postIds].filter((id) => units.filter((u) => u.postId === id).every((u) => away.has(u.id)));
}

/** GET /api/ehbo-status: voor iedereen, ook deelnemers. Alleen welke posten nu zonder EHBO zijn; geen posities of namen. */
export interface EhboStatus {
  awayPostIds: number[];
}
/** Zo vaak deelt een mobiele eenheid in dienst haar positie; bij een statuswissel meteen. */
export const POSITION_SHARE_MS = 60_000;
