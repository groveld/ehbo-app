// Eenvoudige aanvragen van posten (water, verkeer, vrijwilliger): naar de wachtrij van de evenementcoördinator, zonder alarm.
// Functioneel ontwerp, "Modulair en opschalen": aangevraagd → opgepakt → afgehandeld.

/**
 * A kind of help request (#86): how it's handled and what it looks like. These are rows in help_request_types, sent in the event
 * package, so a new kind is a setting and not code. The tile and chip colours come from the screen design.
 */
export interface HelpRequestType {
  key: string;
  name: string;
  handling: 'dispatch' | 'queue';
  /** Under the name on its tile. */
  sub: string | null;
  /** The question above its choices, e.g. "Hoeveel?". */
  ask: string | null;
  /** What can be added, by value; optional. */
  choices: { key: string; label: string }[];
  /** An icon from web/src/icons.ts. */
  icon: string;
  /** The tile (background, line, icon and its text) and the chip in Meldingen (background and text). */
  colors: { bg: string; line: string; icon: string; iconText: string; chip: string; chipText: string };
}

/** The kinds a new event starts with; the migration writes the same into an existing one. */
export const DEFAULT_HELP_REQUEST_TYPES: HelpRequestType[] = [
  { key: 'first_aid', name: 'EHBO', handling: 'dispatch', sub: 'Eerste hulp nodig', ask: null, choices: [], icon: 'ehbo',
    colors: { bg: '#FBE3E1', line: '#F2B8B3', icon: '#C8261E', iconText: '#FFFFFF', chip: '#FBE3E1', chipText: '#8A1A14' } },
  { key: 'water', name: 'Water', handling: 'queue', sub: 'Bijvullen', ask: 'Hoeveel?', icon: 'drop',
    choices: [{ key: 'little', label: 'Beetje' }, { key: 'lots', label: 'Flink' }, { key: 'almost_empty', label: 'Bijna op' }],
    colors: { bg: '#E4EEF7', line: '#B8D0E6', icon: '#1F6FB2', iconText: '#FFFFFF', chip: '#E4EEF7', chipText: '#124A78' } },
  { key: 'traffic', name: 'Verkeer', handling: 'queue', sub: 'Hulp bij regelen', ask: 'Wat is er?', icon: 'cone',
    choices: [{ key: 'busy', label: 'Druk' }, { key: 'unsafe', label: 'Onveilig' }, { key: 'closure', label: 'Afzetting nodig' }],
    colors: { bg: '#FBE6D2', line: '#EDC7A2', icon: '#D9781C', iconText: '#16181D', chip: '#FBE6D2', chipText: '#7A3F06' } },
  { key: 'volunteer', name: 'Vrijwilliger', handling: 'queue', sub: 'Aflossing, uitval', ask: 'Wat is er nodig?', icon: 'personAdd',
    choices: [{ key: 'relief', label: 'Aflossing nodig' }, { key: 'dropout', label: 'Iemand valt uit' }, { key: 'extra', label: 'Extra hulp' }],
    colors: { bg: '#EDE4F7', line: '#D2C1EA', icon: '#7A4BB7', iconText: '#FFFFFF', chip: '#EDE4F7', chipText: '#4E2A82' } },
];

/** The colours of a kind that has none of its own. */
export const PLAIN_HELP_REQUEST_COLORS: HelpRequestType['colors'] = { bg: '#F0EFEA', line: '#D9D7D0', icon: '#6B7079', iconText: '#FFFFFF', chip: '#F0EFEA', chipText: '#3E434B' };

/** The key of a help request type. */
export type RequestKind = string;

/** A kind by its key; an unknown one (a package from before it existed) gets a plain stand-in, so nothing breaks. */
export const helpRequestType = (types: HelpRequestType[] | undefined, key: string): HelpRequestType =>
  types?.find((t) => t.key === key) ?? DEFAULT_HELP_REQUEST_TYPES.find((t) => t.key === key)
  ?? { key, name: key, handling: 'queue', sub: null, ask: null, choices: [], icon: 'more', colors: PLAIN_HELP_REQUEST_COLORS };

export type RequestStatus = 'sent' | 'accepted' | 'closed' | 'withdrawn';

/** A help request of a queue type (#86): POST /api/help-requests. */
export interface NewRequest {
  type: RequestKind;
  postId: number;
  /** One of the choices of its type, or null. */
  detail: string | null;
  /** Door de telefoon gekozen id: twee keer versturen telt één keer. */
  clientId: string;
}

export interface LiveRequest {
  id: number;
  handling: 'queue';
  type: RequestKind;
  /** Gedaan in de testmodus. */
  isTest: boolean;
  postId: number;
  /** Shown before the new event package has arrived. */
  postName: string;
  detail: string | null;
  status: RequestStatus;
  reportedAt: string;
  /** Picked up by the coordinator. */
  acceptedAt: string | null;
  acceptedBy: { name: string; phone: string } | null;
  closedAt: string | null;
  /** Plek in de wachtrij (1 = eerstvolgende), zolang de aanvraag open is. */
  position: number | null;
}

export const requestDetailLabel = (types: HelpRequestType[] | undefined, kind: RequestKind, detail: string | null) =>
  detail ? helpRequestType(types, kind).choices.find((c) => c.key === detail)?.label ?? null : null;
