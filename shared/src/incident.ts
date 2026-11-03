// EHBO-oproepen: van verzoek tot afronden, en de live stand die alle medewerkers zien.
import type { TeamKind } from './event.ts';
import { distanceKm, formatKm } from './geo.ts';
import type { LiveRequest, NewRequest } from './request.ts';

/** Gemeld (op de telefoon) → verstuurd → geaccepteerd → ter plaatse → afgerond, of ingetrokken. */
export type IncidentStatus = 'sent' | 'accepted' | 'on_site' | 'closed' | 'withdrawn';
/** Eerst de dichtstbijzijnde beschikbare eenheid (en bij niet aanspreekbaar ook de dichtstbijzijnde met AED), daarna alle beschikbare eenheden. */
export type IncidentStage = 'nearest' | 'all';

export const INCIDENT_WHAT = {
  unwell: 'Onwel / flauw',
  injury: 'Gevallen / letsel',
  cramp: 'Kramp / blessure',
  unknown: 'Weet ik niet',
} as const;
export type IncidentWhat = keyof typeof INCIDENT_WHAT;

export const INCIDENT_PERSONS = ['1', '2', '3+'] as const;
export type IncidentPersons = (typeof INCIDENT_PERSONS)[number];

export const RESPONSIVE = { yes: 'Ja', no: 'Nee', unknown: 'Weet niet' } as const;
export type Responsive = keyof typeof RESPONSIVE;

export const OUTCOMES = {
  treated: 'Ter plaatse geholpen',
  stopped: 'Gestopt, naar finish',
  ambulance: 'Ambulance (112)',
  referred: 'Doorverwezen SEH/arts',
  refused: 'Hulp geweigerd',
  false_alarm: 'Loos alarm',
} as const;
export type Outcome = keyof typeof OUTCOMES;

/** Wat de eenheid zelf instelt. "Bezet" volgt uit een lopende oproep. */
export type TeamAvailability = 'available' | 'unavailable' | 'off_duty';
export const TEAM_AVAILABILITY = { available: 'Beschikbaar', unavailable: 'Niet beschikbaar', off_duty: 'Uit dienst' } as const;

export const NOTE_MAX = 500;

/** Wat de post invult; alles is optioneel. */
export interface IncidentDetails {
  what: IncidentWhat | null;
  persons: IncidentPersons | null;
  responsive: Responsive | null;
  note: string | null;
}

/** POST /api/incidents */
/** A help request of the first-aid type (#86): POST /api/help-requests. */
export interface NewIncident extends IncidentDetails {
  type: 'first_aid';
  /** The post asking for help; null for a request from where you are, with a GPS position. */
  postId: number | null;
  /** From where you are (#102): the position, sent once with the request and kept as the place of the incident. */
  lat?: number | null;
  lng?: number | null;
  accuracyM?: number | null;
  /** Door de telefoon gekozen id: een melding die zonder bereik is bewaard en later opnieuw wordt verstuurd, telt maar één keer. */
  clientId: string;
  /** Wanneer de post op versturen tikte (ISO), als dat eerder was dan nu. */
  reportedAt?: string;
}

/** POST /api/incidents/self: someone came to an EHBO team, which is already there. */
export interface NewSelfIncident extends IncidentDetails {
  clientId: string;
  teamId: number;
  /** The post the team chose, or its own; with a position only the fallback. */
  postId: number;
  /** GPS of the team, when there is one and no post was chosen by hand. */
  lat: number | null;
  lng: number | null;
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

export type DispatchReason = 'nearest' | 'aed' | 'all' | 'manual';

/** Een eenheid die deze oproep heeft gekregen. */
export interface Dispatch {
  teamId: number;
  at: string;
  reason: DispatchReason;
  /** Hemelsbreed, in km; null als de positie van de eenheid onbekend is. */
  distanceKm: number | null;
  declinedAt: string | null;
  /** Meer dan één eenheid kan aannemen: bij niet aanspreekbaar komt de AED-eenheid ook. */
  acceptedAt: string | null;
}

export type IncidentEventType =
  | 'reported' | 'sent' | 'added' | 'declined' | 'escalated' | 'repeated'
  | 'accepted' | 'assigned' | 'on_site' | 'closed' | 'withdrawn';

/** Eén regel in de tijdlijn (scherm en rapport). */
export interface IncidentEvent {
  at: string;
  type: IncidentEventType;
  teamId: number | null;
  text: string;
}

/** What an incident says about its post, so a call works before the new event package has arrived. */
export interface IncidentPost {
  typeId: number;
  name: string;
  km: number | null;
  lat: number | null;
  lng: number | null;
}

export interface LiveIncident extends IncidentDetails {
  id: number;
  type: 'first_aid';
  handling: 'dispatch';
  /** Gedaan in de testmodus: telt niet mee in het rapport. */
  isTest: boolean;
  /** Started by the team that was there, not reported by a post. */
  selfStarted: boolean;
  /** Not at its post: post then says where it was, and postId is only the nearest post, for the report. */
  offPost: boolean;
  /** How precise the place was, in metres, for a request from a GPS position. */
  accuracyM: number | null;
  postId: number;
  post: IncidentPost;
  /** Phone number of who reported it. */
  reportedBy: string;
  status: IncidentStatus;
  stage: IncidentStage;
  /** Niet aanspreekbaar: AED meenemen, en de post krijgt het advies 112 te bellen. */
  aed: boolean;
  reportedAt: string;
  sentAt: string;
  /** Wanneer de oproep naar alle eenheden gaat, zolang hij nog bij de dichtstbijzijnde ligt. */
  escalatesAt: string | null;
  teamId: number | null;
  acceptedBy: { name: string; phone: string } | null;
  acceptedAt: string | null;
  onSiteAt: string | null;
  closedAt: string | null;
  outcome: Outcome | null;
  dispatches: Dispatch[];
  events: IncidentEvent[];
}

export interface LiveTeam {
  id: number;
  availability: TeamAvailability;
  /** De oproep waar de eenheid mee bezig is (geaccepteerd of ter plaatse). */
  incidentId: number | null;
  /** Vaste eenheid die na afronden bij een andere post bleef. */
  stayPostId: number | null;
  /** Mobiele eenheid: laatste GPS-positie (alleen in het geheugen van de server, nooit opgeslagen). */
  position: { lat: number; lng: number; at: string } | null;
  /** The team has been warned: it goes off duty at this time, unless it stays on. */
  closesAt: string | null;
}

export interface LivePost {
  id: number;
  isOpen: boolean;
  /** The post has been warned: it closes at this time, unless it's kept open. */
  closesAt: string | null;
  /** It was closed by the planned time, not by a person. */
  autoClosedAt: string | null;
}

/** GET /api/live/state, en elk bericht op GET /api/live (SSE). Iedere medewerker ziet hetzelfde. */
export interface LiveState {
  /** Telt op bij elke wijziging. */
  version: number;
  /** Version of the fixed data; when it differs from the event package, the phone fetches the new one. */
  dataVersion: string;
  serverTime: string;
  /** Every help request, newest first: incidents (dispatch) and requests in the coordinator's queue (#86). */
  helpRequests: LiveHelpRequest[];
  teams: LiveTeam[];
  posts: LivePost[];
  /** Testmodus: oproepen en aanvragen zijn proef en komen niet in het rapport. */
  testMode: boolean;
}

/** GET /api/live/last-seen: last contact by id, for the coordinator. Open posts and teams on duty only. */
export interface LastSeen {
  posts: Record<number, string | null>;
  teams: Record<number, string | null>;
}

/** Opening or closing everything: the new state, and what was skipped (closing: busy with a call; opening: nobody logged in). */
export interface ControlResult {
  state: LiveState;
  skipped: string[];
}

/** SSE: hartslag, zodat Cloudflare de verbinding niet na 100 s stil sluit. */
export const LIVE_HEARTBEAT_MS = 30_000;
/** Een mobiele eenheid deelt elke minuut haar positie; ouder dan dit telt niet meer. */
export const POSITION_MAX_AGE_MS = 3 * 60_000;
/** At a post: within this distance, unless the admin set another (event.at_post_m, #63). The same as a post's distance to a route in the GPX. */
export const DEFAULT_AT_POST_M = 30;

/**
 * Onderweg: een mobiele eenheid in dienst met een recente GPS-positie, verder dan atPostM van haar standplaats (of zonder standplaats).
 * Zonder recente positie telt ze als thuis. Een vaste eenheid is altijd op haar post.
 */
export function isAway(team: { kind: TeamKind }, live: LiveTeam | undefined, base: { lat: number | null; lng: number | null } | undefined, now: number, atPostM: number) {
  if (team.kind !== 'mobile' || !live?.position || live.availability === 'off_duty') return false;
  if (now - new Date(live.position.at).getTime() > POSITION_MAX_AGE_MS) return false;
  return !(base?.lat != null && base.lng != null && distanceKm([live.position.lng, live.position.lat], [base.lng, base.lat]) * 1000 <= atPostM);
}

/** Posten waar EHBO hoort maar nu niemand is: elke eenheid met die post als standplaats is onderweg. Voor een grijs kruisje. */
export function awayPostIds(
  teams: { id: number; kind: TeamKind; postId: number | null }[], live: LiveTeam[], posts: { id: number; lat: number | null; lng: number | null }[], now: number, atPostM: number,
): number[] {
  const away = new Set(teams.filter((u) => isAway(u, live.find((l) => l.id === u.id), posts.find((p) => p.id === u.postId), now, atPostM)).map((u) => u.id));
  const postIds = new Set(teams.flatMap((u) => (u.postId !== null ? [u.postId] : [])));
  return [...postIds].filter((id) => teams.filter((u) => u.postId === id).every((u) => away.has(u.id)));
}

/** GET /api/ehbo-status: voor iedereen, ook deelnemers. Alleen welke posten nu zonder EHBO zijn; geen posities of namen. */
export interface EhboStatus {
  awayPostIds: number[];
  /** Same as in the live state: participants have no live connection. */
  dataVersion: string;
}
/** Zo vaak deelt een mobiele eenheid in dienst haar positie; bij een statuswissel meteen. */
export const POSITION_SHARE_MS = 60_000;

/** A post or team closes this long after its planned end, never during an open call or request. */
export const AUTO_CLOSE_AFTER_MIN = 30;
/** Everyone gets this warning before anything closes by itself. */
export const CLOSE_WARNING_MIN = 10;
/** "Open houden": this much longer, then a new warning. */
export const KEEP_OPEN_MIN = 30;
/** No contact for this long is shown to the coordinator. Only shown: a phone in a pocket has no connection either, so it never closes anything. */
export const QUIET_AFTER_MIN = 15;

const EVENT_ZONE = 'Europe/Amsterdam';
const localParts = (now: number) => {
  const local = new Date(now).toLocaleString('sv-SE', { timeZone: EVENT_ZONE });
  return { day: local.slice(0, 10), time: local.slice(11, 16) };
};

/** The moment of a day and time in Dutch time. */
function eventInstant(day: string, time: string) {
  const guess = Date.parse(`${day}T${time}:00Z`);
  const { day: d, time: t } = localParts(guess);
  return guess - (Date.parse(`${d}T${t}:00Z`) - guess);
}

/**
 * When something planned should be closed, in ms: its end time plus the margin, on today or the last day of the event.
 * Without an end time only when the event is over: until then a person closes it. Null before the event, and without a date.
 */
export function plannedClose(plan: { timeTo: string | null }, event: { startDate: string | null; endDate: string | null }, now: number) {
  if (!event.startDate) return null;
  const last = event.endDate ?? event.startDate;
  const { day: today } = localParts(now);
  if (today < event.startDate) return null;
  if (plan.timeTo) return eventInstant(today > last ? last : today, plan.timeTo) + AUTO_CLOSE_AFTER_MIN * 60_000;
  return today > last ? eventInstant(last, '23:59') : null;
}

/**
 * Where a position is: the post itself within the same radius as a mobile team and its standplaats, otherwise a distance from the nearest post.
 * Null without any post with a position.
 */
export function placeOf(posts: { id: number; name: string; lat: number | null; lng: number | null }[], at: [number, number], atPostM: number) {
  const nearest = posts.flatMap((p) => (p.lat != null && p.lng != null ? [{ post: p, km: distanceKm(at, [p.lng, p.lat]) }] : [])).sort((a, b) => a.km - b.km)[0];
  if (!nearest) return null;
  const { post, km } = nearest;
  if (km * 1000 <= atPostM) return { postId: post.id, atPost: true, name: post.name };
  return { postId: post.id, atPost: false, name: `${km < 1 ? `${Math.round(km * 1000)} m` : `${formatKm(km)} km`} van ${post.name}` };
}

/** Should this post be open by now? Within its time slot, on a day of the event, in Dutch time. */
export function isDueOpen(post: { timeFrom: string | null; timeTo: string | null }, event: { startDate: string | null; endDate: string | null }, now: number) {
  if (!post.timeFrom || !event.startDate) return false;
  const local = new Date(now).toLocaleString('sv-SE', { timeZone: 'Europe/Amsterdam' });
  const [day, time] = [local.slice(0, 10), local.slice(11, 16)];
  if (day < event.startDate || day > (event.endDate ?? event.startDate)) return false;
  return time >= post.timeFrom && (!post.timeTo || time < post.timeTo);
}

/** A mobile team on duty that hasn't shared a position lately, so nobody knows where it is. */
export function lacksPosition(team: { kind: TeamKind }, live: LiveTeam | undefined | null, now: number) {
  if (team.kind !== 'mobile' || !live || live.availability === 'off_duty') return false;
  return !live.position || now - new Date(live.position.at).getTime() > POSITION_MAX_AGE_MS;
}

/** One help request (#86): the type decides the handling, dispatch (an incident) or queue (a request). */
export type LiveHelpRequest = LiveIncident | LiveRequest;
export type NewHelpRequest = NewIncident | NewRequest;

export const incidentsOf = (state: { helpRequests: LiveHelpRequest[] }) => state.helpRequests.filter((h): h is LiveIncident => h.handling === 'dispatch');
export const requestsOf = (state: { helpRequests: LiveHelpRequest[] }) => state.helpRequests.filter((h): h is LiveRequest => h.handling === 'queue');
