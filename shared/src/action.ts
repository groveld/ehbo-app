// Changes a phone makes to the live state. The phone applies each one to its own state at once and queues it for the server,
// so nothing ever waits for the network; the queue goes out in order as soon as there is a connection.
import type { CloseIncident, Dispatch, IncidentDetails, IncidentEventType, IncidentPost, LiveIncident, LiveState, LiveUnit, NewSelfIncident, UnitAvailability } from './incident.ts';
import type { LiveRequest, NewRequest, RequestKind } from './request.ts';

export type LiveAction =
  | { type: 'accept' | 'decline' | 'assign'; incidentId: number; unitId: number }
  /** tempId: a negative id until the server has given the real one. post: how it shows meanwhile. */
  | { type: 'selfStart'; tempId: number; body: NewSelfIncident; post: IncidentPost; offPost: boolean; postId: number }
  | { type: 'onSite' | 'withdraw'; incidentId: number }
  | { type: 'close'; incidentId: number; body: CloseIncident }
  | { type: 'update'; incidentId: number; details: IncidentDetails }
  | { type: 'availability'; unitId: number; availability: UnitAvailability }
  | { type: 'postOpen'; postId: number; open: boolean }
  /** After the warning that it's about to close. */
  | { type: 'keepPost'; postId: number }
  | { type: 'keepUnit'; unitId: number }
  /** tempId: a negative id until the server has given the real one. */
  | { type: 'requestNew'; tempId: number; clientId: string; postId: number; postName: string; kind: RequestKind }
  | { type: 'requestDetail'; requestId: number; detail: string | null }
  | { type: 'requestPick' | 'requestDone' | 'requestWithdraw'; requestId: number };

export interface QueuedAction {
  /** The server carries out each id once, so sending again after a lost answer is always safe. */
  id: string;
  /** When it happened on the phone; this is the time that goes in the log. */
  at: string;
  action: LiveAction;
}

/** Headers of a queued change: X-Action-Id (QueuedAction.id) and X-Action-At (QueuedAction.at). */
export const ACTION_ID_HEADER = 'x-action-id';
export const ACTION_AT_HEADER = 'x-action-at';
/** A time from a queue older than this is not believed; the server then uses the time of arrival. */
export const ACTION_MAX_AGE_MS = 12 * 3600_000;

/** What applying an action needs to know from the fixed data. */
export interface ActionContext {
  me: { name: string; phone: string } | null;
  units: { id: number; name: string; kind: 'vast' | 'mobiel'; postId: number | null; members?: { phone: string }[] }[];
}

const OPEN_REQUEST = ['aangevraagd', 'opgepakt'];

const changeIncident = (state: LiveState, id: number, change: (incident: LiveIncident) => LiveIncident): LiveState =>
  ({ ...state, incidents: state.incidents.map((i) => (i.id === id ? change(i) : i)) });

/** A unit or post the state doesn't list yet (a phone that never had a connection) is added. */
function changeUnit(state: LiveState, id: number, change: (unit: LiveUnit) => LiveUnit): LiveState {
  if (state.units.some((u) => u.id === id)) return { ...state, units: state.units.map((u) => (u.id === id ? change(u) : u)) };
  return { ...state, units: [...state.units, change({ id, availability: 'uit_dienst', incidentId: null, stayPostId: null, position: null, closesAt: null })] };
}

function setPostOpen(state: LiveState, id: number, isOpen: boolean): LiveState {
  const change = { isOpen, closesAt: null, autoClosedAt: null };
  if (state.posts.some((p) => p.id === id)) return { ...state, posts: state.posts.map((p) => (p.id === id ? { ...p, ...change } : p)) };
  return { ...state, posts: [...state.posts, { id, ...change }] };
}

const changeRequest = (state: LiveState, id: number, change: (request: LiveRequest) => LiveRequest): LiveState =>
  ({ ...state, requests: state.requests.map((r) => (r.id === id ? change(r) : r)) });

/** The same line as the server's, once: the server's own may already be in the state while the action is still on its way. */
const logged = (incident: LiveIncident, at: string, type: IncidentEventType, text: string, unitId: number | null = null): LiveIncident =>
  (incident.events.some((e) => e.type === type && e.text === text) ? incident : { ...incident, events: [...incident.events, { at, type, unitId, text }] });

/** The unit of this person that took the incident. */
function myAcceptedUnit(incident: LiveIncident, { me, units }: ActionContext) {
  const accepted = incident.dispatches.filter((d) => d.acceptedAt).map((d) => units.find((u) => u.id === d.unitId)).filter((u) => u !== undefined);
  return accepted.find((u) => u.members?.some((m) => m.phone === me?.phone)) ?? accepted[0];
}

function take(state: LiveState, at: string, incidentId: number, unitId: number, manual: boolean, context: ActionContext) {
  const name = context.units.find((u) => u.id === unitId)?.name ?? 'Eenheid';
  const accepted = changeIncident(state, incidentId, (i) => {
    const dispatches: Dispatch[] = i.dispatches.some((d) => d.unitId === unitId)
      ? i.dispatches.map((d) => (d.unitId === unitId ? { ...d, acceptedAt: at, declinedAt: null } : d))
      : [...i.dispatches, { unitId, at, reason: manual ? 'handmatig' : 'alle', distanceKm: null, declinedAt: null, acceptedAt: at }];
    const first = i.status === 'verstuurd'
      ? { status: 'geaccepteerd' as const, unitId, acceptedBy: manual ? null : context.me, acceptedAt: at, escalatesAt: null }
      : {};
    return logged({ ...i, dispatches, ...first }, at, manual ? 'toegewezen' : 'geaccepteerd', manual ? `Toegewezen aan ${name}` : `Geaccepteerd door ${name} (${context.me?.name})`, unitId);
  });
  return changeUnit(accepted, unitId, (u) => ({ ...u, availability: 'vrij', stayPostId: null, incidentId }));
}

/** The state as this phone should show it after the action, the same way the server will do it. An unknown incident or request changes nothing. */
export function applyAction(state: LiveState, { at, action }: QueuedAction, context: ActionContext): LiveState {
  switch (action.type) {
    case 'selfStart': {
      const { body, tempId, post, offPost, postId } = action;
      const name = context.units.find((u) => u.id === body.unitId)?.name ?? 'Eenheid';
      const incident: LiveIncident = {
        id: tempId, isTest: state.testMode, selfStarted: true, offPost, postId, post, status: 'ter_plaatse', stage: 'dichtstbij', aed: body.responsive === 'nee',
        what: body.what, persons: body.persons, responsive: body.responsive, note: body.note, reportedAt: at, sentAt: at, escalatesAt: null,
        unitId: body.unitId, acceptedBy: context.me, acceptedAt: at, onSiteAt: at, closedAt: null, outcome: null,
        dispatches: [{ unitId: body.unitId, at, reason: 'handmatig', distanceKm: 0, declinedAt: null, acceptedAt: at }],
        events: [{ at, type: 'gemeld', unitId: body.unitId, text: `Zelf gestart door ${name} · ${post.name}` }],
      };
      return changeUnit({ ...state, incidents: [incident, ...state.incidents] }, body.unitId, (u) => ({ ...u, availability: 'vrij', stayPostId: null, incidentId: tempId }));
    }
    case 'accept': return take(state, at, action.incidentId, action.unitId, false, context);
    case 'assign': return take(state, at, action.incidentId, action.unitId, true, context);
    case 'decline': {
      const name = context.units.find((u) => u.id === action.unitId)?.name ?? 'Eenheid';
      return changeIncident(state, action.incidentId, (i) => {
        const dispatches: Dispatch[] = i.dispatches.some((d) => d.unitId === action.unitId)
          ? i.dispatches.map((d) => (d.unitId === action.unitId ? { ...d, declinedAt: at } : d))
          : [...i.dispatches, { unitId: action.unitId, at, reason: 'alle', distanceKm: null, declinedAt: at, acceptedAt: null }];
        return logged({ ...i, dispatches }, at, 'geweigerd', `${name}: kan niet`, action.unitId);
      });
    }
    case 'onSite': return changeIncident(state, action.incidentId, (i) => {
      const unit = myAcceptedUnit(i, context);
      return logged({ ...i, status: 'ter_plaatse', onSiteAt: i.onSiteAt ?? at }, at, 'ter_plaatse', `${unit?.name ?? 'Eenheid'} is ter plaatse`, unit?.id ?? null);
    });
    case 'close': {
      const incident = state.incidents.find((i) => i.id === action.incidentId);
      if (!incident) return state;
      const unit = myAcceptedUnit(incident, context);
      const { outcome, pause, stayHere } = action.body;
      const closed = changeIncident(state, action.incidentId, (i) => logged(
        { ...i, status: 'afgerond', closedAt: at, outcome, onSiteAt: i.onSiteAt ?? at }, at, 'afgerond',
        `Afgerond door ${unit?.name ?? 'Eenheid'}${pause ? ', daarna pauze' : ''}`, unit?.id ?? null,
      ));
      if (!unit) return closed;
      const stay = stayHere && unit.kind === 'vast' && incident.postId !== unit.postId ? incident.postId : null;
      return changeUnit(closed, unit.id, (u) => ({ ...u, incidentId: null, stayPostId: stay, availability: pause ? 'pauze' : u.availability }));
    }
    case 'withdraw': {
      const withdrawn = changeIncident(state, action.incidentId, (i) => logged(
        { ...i, status: 'ingetrokken', closedAt: at, escalatesAt: null }, at, 'ingetrokken', `Ingetrokken door ${context.me?.name}`,
      ));
      return { ...withdrawn, units: withdrawn.units.map((u) => (u.incidentId === action.incidentId ? { ...u, incidentId: null } : u)) };
    }
    case 'update': return changeIncident(state, action.incidentId, (i) => ({ ...i, ...action.details, aed: i.aed || action.details.responsive === 'nee' }));
    case 'availability': {
      const { availability, unitId } = action;
      const changed = changeUnit(state, unitId, (u) => (availability === 'uit_dienst' ? { ...u, availability, stayPostId: null, position: null, closesAt: null } : { ...u, availability }));
      const unit = context.units.find((u) => u.id === unitId);
      if (unit?.kind !== 'vast' || unit.postId === null || availability === 'pauze') return changed;
      // A fixed unit on duty and its own EHBO post open are the same thing, as long as no other shift is still there.
      const othersOnDuty = context.units.some((u) => u.id !== unitId && u.kind === 'vast' && u.postId === unit.postId
        && (changed.units.find((l) => l.id === u.id)?.availability ?? 'uit_dienst') !== 'uit_dienst');
      return availability === 'vrij' || !othersOnDuty ? setPostOpen(changed, unit.postId, availability === 'vrij') : changed;
    }
    case 'keepPost': return { ...state, posts: state.posts.map((p) => (p.id === action.postId ? { ...p, isOpen: true, closesAt: null, autoClosedAt: null } : p)) };
    case 'keepUnit': return changeUnit(state, action.unitId, (u) => ({ ...u, closesAt: null }));
    case 'postOpen': {
      const fixed = context.units.filter((u) => u.kind === 'vast' && u.postId === action.postId);
      // Opening: your own team, when you're on one; the other shift stays as it is.
      const mine = fixed.filter((u) => u.members?.some((m) => m.phone === context.me?.phone));
      return (action.open && mine.length ? mine : fixed).reduce(
        (s, u) => (s.units.find((l) => l.id === u.id)?.availability === 'pauze' ? s : changeUnit(s, u.id, (l) => ({ ...l, availability: action.open ? 'vrij' : 'uit_dienst' }))),
        setPostOpen(state, action.postId, action.open),
      );
    }
    case 'requestNew': return {
      ...state,
      requests: [{
        id: action.tempId, isTest: state.testMode, postId: action.postId, postName: action.postName, kind: action.kind, detail: null, status: 'aangevraagd',
        createdAt: at, pickedAt: null, pickedBy: null, doneAt: null, position: state.requests.filter((r) => OPEN_REQUEST.includes(r.status)).length + 1,
      }, ...state.requests],
    };
    case 'requestDetail': return changeRequest(state, action.requestId, (r) => ({ ...r, detail: action.detail }));
    case 'requestPick': return changeRequest(state, action.requestId, (r) => ({ ...r, status: 'opgepakt', pickedAt: at, pickedBy: context.me }));
    case 'requestDone': return changeRequest(state, action.requestId, (r) => ({ ...r, status: 'afgehandeld', doneAt: at, position: null, pickedAt: r.pickedAt ?? at, pickedBy: r.pickedBy ?? context.me }));
    case 'requestWithdraw': return changeRequest(state, action.requestId, (r) => ({ ...r, status: 'ingetrokken', doneAt: at, position: null }));
  }
}

/** The API call that carries out an action. */
export function actionRequest(action: LiveAction): { method: 'POST' | 'PUT'; path: string; body?: object } {
  switch (action.type) {
    case 'selfStart': return { method: 'POST', path: '/api/incidents/self', body: action.body };
    case 'accept': return { method: 'POST', path: `/api/incidents/${action.incidentId}/accept`, body: { unitId: action.unitId } };
    case 'decline': return { method: 'POST', path: `/api/incidents/${action.incidentId}/decline`, body: { unitId: action.unitId } };
    case 'assign': return { method: 'POST', path: `/api/incidents/${action.incidentId}/assign`, body: { unitId: action.unitId } };
    case 'onSite': return { method: 'POST', path: `/api/incidents/${action.incidentId}/on-site` };
    case 'withdraw': return { method: 'POST', path: `/api/incidents/${action.incidentId}/withdraw` };
    case 'close': return { method: 'POST', path: `/api/incidents/${action.incidentId}/close`, body: action.body };
    case 'update': return { method: 'PUT', path: `/api/incidents/${action.incidentId}`, body: action.details };
    case 'availability': return { method: 'PUT', path: `/api/units/${action.unitId}/availability`, body: { availability: action.availability } };
    case 'postOpen': return { method: 'PUT', path: `/api/posts/${action.postId}/open`, body: { open: action.open } };
    case 'keepPost': return { method: 'POST', path: `/api/posts/${action.postId}/keep-open` };
    case 'keepUnit': return { method: 'POST', path: `/api/units/${action.unitId}/keep-on-duty` };
    case 'requestNew': return {
      method: 'POST', path: '/api/requests',
      body: { postId: action.postId, kind: action.kind, detail: null, clientId: action.clientId } satisfies NewRequest,
    };
    case 'requestDetail': return { method: 'PUT', path: `/api/requests/${action.requestId}`, body: { detail: action.detail } };
    case 'requestPick': return { method: 'POST', path: `/api/requests/${action.requestId}/pick` };
    case 'requestDone': return { method: 'POST', path: `/api/requests/${action.requestId}/done` };
    case 'requestWithdraw': return { method: 'POST', path: `/api/requests/${action.requestId}/withdraw` };
  }
}
