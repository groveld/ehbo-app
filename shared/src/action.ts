// Changes a phone makes to the live state. The phone applies each one to its own state at once and queues it for the server,
// so nothing ever waits for the network; the queue goes out in order as soon as there is a connection.
import { incidentsOf, requestsOf } from './incident.ts';
import type { CloseIncident, Dispatch, IncidentDetails, IncidentEventType, IncidentPost, LiveIncident, LiveState, LiveTeam, NewSelfIncident, TeamAvailability } from './incident.ts';
import type { LiveRequest, NewRequest, RequestKind } from './request.ts';

export type LiveAction =
  | { type: 'accept' | 'decline' | 'assign'; incidentId: number; teamId: number }
  /** tempId: a negative id until the server has given the real one. post: how it shows meanwhile. */
  | { type: 'selfStart'; tempId: number; body: NewSelfIncident; post: IncidentPost; offPost: boolean; postId: number }
  | { type: 'onSite' | 'withdraw'; incidentId: number }
  | { type: 'close'; incidentId: number; body: CloseIncident }
  | { type: 'update'; incidentId: number; details: IncidentDetails }
  | { type: 'availability'; teamId: number; availability: TeamAvailability }
  | { type: 'postOpen'; postId: number; open: boolean }
  /** After the warning that it's about to close. */
  | { type: 'keepPost'; postId: number }
  | { type: 'keepTeam'; teamId: number }
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
  teams: { id: number; name: string; kind: 'fixed' | 'mobile'; postId: number | null; members?: { phone: string }[] }[];
}

const OPEN_REQUEST = ['sent', 'accepted'];

const changeIncident = (state: LiveState, id: number, change: (incident: LiveIncident) => LiveIncident): LiveState =>
  ({ ...state, helpRequests: state.helpRequests.map((h) => (h.id === id && h.handling === 'dispatch' ? change(h) : h)) });

/** A team or post the state doesn't list yet (a phone that never had a connection) is added. */
function changeTeam(state: LiveState, id: number, change: (team: LiveTeam) => LiveTeam): LiveState {
  if (state.teams.some((u) => u.id === id)) return { ...state, teams: state.teams.map((u) => (u.id === id ? change(u) : u)) };
  return { ...state, teams: [...state.teams, change({ id, availability: 'off_duty', incidentId: null, stayPostId: null, position: null, closesAt: null })] };
}

function setPostOpen(state: LiveState, id: number, isOpen: boolean): LiveState {
  const change = { isOpen, closesAt: null, autoClosedAt: null };
  if (state.posts.some((p) => p.id === id)) return { ...state, posts: state.posts.map((p) => (p.id === id ? { ...p, ...change } : p)) };
  return { ...state, posts: [...state.posts, { id, ...change }] };
}

const changeRequest = (state: LiveState, id: number, change: (request: LiveRequest) => LiveRequest): LiveState =>
  ({ ...state, helpRequests: state.helpRequests.map((h) => (h.id === id && h.handling === 'queue' ? change(h) : h)) });

/** The same line as the server's, once: the server's own may already be in the state while the action is still on its way. */
const logged = (incident: LiveIncident, at: string, type: IncidentEventType, text: string, teamId: number | null = null): LiveIncident =>
  (incident.events.some((e) => e.type === type && e.text === text) ? incident : { ...incident, events: [...incident.events, { at, type, teamId, text }] });

/** The team of this person that took the incident. */
function myAcceptedTeam(incident: LiveIncident, { me, teams }: ActionContext) {
  const accepted = incident.dispatches.filter((d) => d.acceptedAt).map((d) => teams.find((u) => u.id === d.teamId)).filter((u) => u !== undefined);
  return accepted.find((u) => u.members?.some((m) => m.phone === me?.phone)) ?? accepted[0];
}

function take(state: LiveState, at: string, incidentId: number, teamId: number, manual: boolean, context: ActionContext) {
  const name = context.teams.find((u) => u.id === teamId)?.name ?? 'Eenheid';
  const accepted = changeIncident(state, incidentId, (i) => {
    const dispatches: Dispatch[] = i.dispatches.some((d) => d.teamId === teamId)
      ? i.dispatches.map((d) => (d.teamId === teamId ? { ...d, acceptedAt: at, declinedAt: null } : d))
      : [...i.dispatches, { teamId, at, reason: manual ? 'manual' : 'all', distanceKm: null, declinedAt: null, acceptedAt: at }];
    const first = i.status === 'sent'
      ? { status: 'accepted' as const, teamId, acceptedBy: manual ? null : context.me, acceptedAt: at, escalatesAt: null }
      : {};
    return logged({ ...i, dispatches, ...first }, at, manual ? 'assigned' : 'accepted', manual ? `Toegewezen aan ${name}` : `Geaccepteerd door ${name} (${context.me?.name})`, teamId);
  });
  return changeTeam(accepted, teamId, (u) => ({ ...u, availability: 'available', stayPostId: null, incidentId }));
}

/** The state as this phone should show it after the action, the same way the server will do it. An unknown incident or request changes nothing. */
export function applyAction(state: LiveState, { at, action }: QueuedAction, context: ActionContext): LiveState {
  switch (action.type) {
    case 'selfStart': {
      const { body, tempId, post, offPost, postId } = action;
      const name = context.teams.find((u) => u.id === body.teamId)?.name ?? 'Eenheid';
      const incident: LiveIncident = {
        id: tempId, type: 'first_aid', handling: 'dispatch', isTest: state.testMode, selfStarted: true, offPost, accuracyM: null, postId, post, reportedBy: context.me?.phone ?? '', status: 'on_site', stage: 'nearest', aed: body.responsive === 'no',
        what: body.what, persons: body.persons, responsive: body.responsive, note: body.note, reportedAt: at, sentAt: at, escalatesAt: null,
        teamId: body.teamId, acceptedBy: context.me, acceptedAt: at, onSiteAt: at, closedAt: null, outcome: null,
        dispatches: [{ teamId: body.teamId, at, reason: 'manual', distanceKm: 0, declinedAt: null, acceptedAt: at }],
        events: [{ at, type: 'reported', teamId: body.teamId, text: `Zelf gestart door ${name} · ${post.name}` }],
      };
      return changeTeam({ ...state, helpRequests: [incident, ...state.helpRequests] }, body.teamId, (u) => ({ ...u, availability: 'available', stayPostId: null, incidentId: tempId }));
    }
    case 'accept': return take(state, at, action.incidentId, action.teamId, false, context);
    case 'assign': return take(state, at, action.incidentId, action.teamId, true, context);
    case 'decline': {
      const name = context.teams.find((u) => u.id === action.teamId)?.name ?? 'Eenheid';
      return changeIncident(state, action.incidentId, (i) => {
        const dispatches: Dispatch[] = i.dispatches.some((d) => d.teamId === action.teamId)
          ? i.dispatches.map((d) => (d.teamId === action.teamId ? { ...d, declinedAt: at } : d))
          : [...i.dispatches, { teamId: action.teamId, at, reason: 'all', distanceKm: null, declinedAt: at, acceptedAt: null }];
        return logged({ ...i, dispatches }, at, 'declined', `${name}: kan niet`, action.teamId);
      });
    }
    case 'onSite': return changeIncident(state, action.incidentId, (i) => {
      const team = myAcceptedTeam(i, context);
      return logged({ ...i, status: 'on_site', onSiteAt: i.onSiteAt ?? at }, at, 'on_site', `${team?.name ?? 'Eenheid'} is ter plaatse`, team?.id ?? null);
    });
    case 'close': {
      const incident = incidentsOf(state).find((i) => i.id === action.incidentId);
      if (!incident) return state;
      const team = myAcceptedTeam(incident, context);
      const { outcome, pause, stayHere } = action.body;
      const closed = changeIncident(state, action.incidentId, (i) => logged(
        { ...i, status: 'closed', closedAt: at, outcome, onSiteAt: i.onSiteAt ?? at }, at, 'closed',
        `Afgerond door ${team?.name ?? 'Eenheid'}${pause ? ', daarna pauze' : ''}`, team?.id ?? null,
      ));
      if (!team) return closed;
      const stay = stayHere && team.kind === 'fixed' && incident.postId !== team.postId ? incident.postId : null;
      return changeTeam(closed, team.id, (u) => ({ ...u, incidentId: null, stayPostId: stay, availability: pause ? 'unavailable' : u.availability }));
    }
    case 'withdraw': {
      const withdrawn = changeIncident(state, action.incidentId, (i) => logged(
        { ...i, status: 'withdrawn', closedAt: at, escalatesAt: null }, at, 'withdrawn', `Ingetrokken door ${context.me?.name}`,
      ));
      return { ...withdrawn, teams: withdrawn.teams.map((u) => (u.incidentId === action.incidentId ? { ...u, incidentId: null } : u)) };
    }
    case 'update': return changeIncident(state, action.incidentId, (i) => ({ ...i, ...action.details, aed: i.aed || action.details.responsive === 'no' }));
    case 'availability': {
      const { availability, teamId } = action;
      const changed = changeTeam(state, teamId, (u) => (availability === 'off_duty' ? { ...u, availability, stayPostId: null, position: null, closesAt: null } : { ...u, availability }));
      const team = context.teams.find((u) => u.id === teamId);
      if (team?.kind !== 'fixed' || team.postId === null || availability === 'unavailable') return changed;
      // A fixed team on duty and its own EHBO post open are the same thing, as long as no other shift is still there.
      const othersOnDuty = context.teams.some((u) => u.id !== teamId && u.kind === 'fixed' && u.postId === team.postId
        && (changed.teams.find((l) => l.id === u.id)?.availability ?? 'off_duty') !== 'off_duty');
      return availability === 'available' || !othersOnDuty ? setPostOpen(changed, team.postId, availability === 'available') : changed;
    }
    case 'keepPost': return { ...state, posts: state.posts.map((p) => (p.id === action.postId ? { ...p, isOpen: true, closesAt: null, autoClosedAt: null } : p)) };
    case 'keepTeam': return changeTeam(state, action.teamId, (u) => ({ ...u, closesAt: null }));
    case 'postOpen': {
      const fixed = context.teams.filter((u) => u.kind === 'fixed' && u.postId === action.postId);
      // Opening: your own team, when you're on one; the other shift stays as it is.
      const mine = fixed.filter((u) => u.members?.some((m) => m.phone === context.me?.phone));
      return (action.open && mine.length ? mine : fixed).reduce(
        (s, u) => (s.teams.find((l) => l.id === u.id)?.availability === 'unavailable' ? s : changeTeam(s, u.id, (l) => ({ ...l, availability: action.open ? 'available' : 'off_duty' }))),
        setPostOpen(state, action.postId, action.open),
      );
    }
    case 'requestNew': return {
      ...state,
      helpRequests: [{
        id: action.tempId, handling: 'queue', type: action.kind, isTest: state.testMode, postId: action.postId, postName: action.postName, detail: null, status: 'sent',
        reportedAt: at, acceptedAt: null, acceptedBy: null, closedAt: null, position: requestsOf(state).filter((r) => OPEN_REQUEST.includes(r.status)).length + 1,
      }, ...state.helpRequests],
    };
    case 'requestDetail': return changeRequest(state, action.requestId, (r) => ({ ...r, detail: action.detail }));
    case 'requestPick': return changeRequest(state, action.requestId, (r) => ({ ...r, status: 'accepted', acceptedAt: at, acceptedBy: context.me }));
    case 'requestDone': return changeRequest(state, action.requestId, (r) => ({ ...r, status: 'closed', closedAt: at, position: null, acceptedAt: r.acceptedAt ?? at, acceptedBy: r.acceptedBy ?? context.me }));
    case 'requestWithdraw': return changeRequest(state, action.requestId, (r) => ({ ...r, status: 'withdrawn', closedAt: at, position: null }));
  }
}

/** The API call that carries out an action. */
export function actionRequest(action: LiveAction): { method: 'POST' | 'PUT'; path: string; body?: object } {
  switch (action.type) {
    case 'selfStart': return { method: 'POST', path: '/api/help-requests/self', body: action.body };
    case 'accept': return { method: 'POST', path: `/api/help-requests/${action.incidentId}/accept`, body: { teamId: action.teamId } };
    case 'decline': return { method: 'POST', path: `/api/help-requests/${action.incidentId}/decline`, body: { teamId: action.teamId } };
    case 'assign': return { method: 'POST', path: `/api/help-requests/${action.incidentId}/assign`, body: { teamId: action.teamId } };
    case 'onSite': return { method: 'POST', path: `/api/help-requests/${action.incidentId}/on-site` };
    case 'withdraw': return { method: 'POST', path: `/api/help-requests/${action.incidentId}/withdraw` };
    case 'close': return { method: 'POST', path: `/api/help-requests/${action.incidentId}/close`, body: action.body };
    case 'update': return { method: 'PUT', path: `/api/help-requests/${action.incidentId}`, body: action.details };
    case 'availability': return { method: 'PUT', path: `/api/teams/${action.teamId}/availability`, body: { availability: action.availability } };
    case 'postOpen': return { method: 'PUT', path: `/api/posts/${action.postId}/open`, body: { open: action.open } };
    case 'keepPost': return { method: 'POST', path: `/api/posts/${action.postId}/keep-open` };
    case 'keepTeam': return { method: 'POST', path: `/api/teams/${action.teamId}/keep-on-duty` };
    case 'requestNew': return {
      method: 'POST', path: '/api/help-requests',
      body: { type: action.kind, postId: action.postId, detail: null, clientId: action.clientId } satisfies NewRequest,
    };
    case 'requestDetail': return { method: 'PUT', path: `/api/help-requests/${action.requestId}`, body: { detail: action.detail } };
    case 'requestPick': return { method: 'POST', path: `/api/help-requests/${action.requestId}/pick` };
    case 'requestDone': return { method: 'POST', path: `/api/help-requests/${action.requestId}/done` };
    case 'requestWithdraw': return { method: 'POST', path: `/api/help-requests/${action.requestId}/withdraw` };
  }
}
