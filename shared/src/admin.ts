// Beheer: vorm van de gegevens die het beheerscherm leest en opslaat.
import type { Brand, EventStyle, InfoSection, PostContactRole, UnitKind, UnitMobility } from './event.ts';
import type { UnitAvailability } from './incident.ts';

/** Datum als jjjj-mm-dd, tijd als uu:mm. */
export const DATE_PATTERN = '^\\d{4}-\\d{2}-\\d{2}$';
export const TIME_PATTERN = '^([01]\\d|2[0-3]):[0-5]\\d$';

export const ESCALATION_MIN_SECONDS = 10;
export const ESCALATION_MAX_SECONDS = 120;
/** Within this distance of a post you count as at that post (#63). GPS on a phone is often 10–30 m off. */
export const AT_POST_MIN_M = 20;
export const AT_POST_MAX_M = 500;
export const AT_POST_STEP_M = 10;

export interface EventSettings {
  name: string;
  startLocation: string | null;
  startDate: string | null;
  endDate: string | null;
  /** Na zoveel seconden zonder acceptatie gaat een EHBO-oproep naar alle beschikbare eenheden. */
  escalationSeconds: number;
  /** Within this many metres of a post a position counts as that post: a mobile team at its standplaats, a self-started incident, a help request. */
  atPostM: number;
  style: EventStyle;
}

export interface RunData {
  name: string;
  distanceKm: number | null;
  /** Bijv. "hardlopen" of "hardlopen + wandelen". */
  discipline: string | null;
  date: string | null;
  startTime: string | null;
}

export interface AdminRun extends RunData {
  id: number;
  /** Samenvatting van het geüploade GPX-bestand, of null als het ontbreekt. */
  gpx: { filename: string; points: number; km: number } | null;
}

export interface PostTypeInfo {
  id: number;
  key: string | null;
  name: string;
  letter: string;
  color: string;
  /** People are there (#69). An AED, toilets or a turnaround aren't. */
  manned: boolean;
}

/** Bij opslaan mag het nummer in elke schrijfwijze; de server maakt er E.164 van. */
export interface ContactData {
  name: string;
  phone: string;
  role: PostContactRole;
  timeFrom: string | null;
  timeTo: string | null;
}

/** The passes of one run along a post, in km from the start, calculated from the GPX. */
export interface PostPassages {
  runId: number;
  km: number[];
}

export interface PostData {
  /** What's at this location (#83), at least one. The main function follows from MARKER_ORDER. */
  functionIds: number[];
  /** A turnaround belongs to one run (#69); null otherwise. */
  runId: number | null;
  name: string;
  lat: number | null;
  lng: number | null;
  /** Nauwkeurigheid van de GPS-positie in meters. */
  accuracyM: number | null;
  address: string | null;
  accessRoute: string | null;
  timeFrom: string | null;
  timeTo: string | null;
  contacts: ContactData[];
}

export interface AdminPost extends PostData {
  id: number;
  /** The main function: icon, colour and layer of the marker. */
  typeId: number;
  isOpen: boolean;
  /** First pass on the longest run that comes by; null without a GPX or position. */
  km: number | null;
  /** Per run, longest run first. */
  passages: PostPassages[];
}

export interface MemberData {
  name: string;
  phone: string;
}

export interface UnitData {
  name: string;
  kind: UnitKind;
  /** Alleen bij mobiel. */
  mobility: UnitMobility | null;
  /** Vast: de eigen EHBO-post. Mobiel: de standplaats (optioneel). */
  postId: number | null;
  hasAed: boolean;
  /** Planned shift, like a post. Calls keep going to a team that's available, whatever these say. */
  timeFrom: string | null;
  timeTo: string | null;
  members: MemberData[];
}

export interface AdminUnit extends UnitData {
  id: number;
  availability: UnitAvailability;
}

export interface CoreTeamEntry {
  function: string;
  name: string;
  /** Leeg = functie nog niet ingevuld. */
  phone: string | null;
  isCoordinator: boolean;
}

export interface EmergencyNumber {
  label: string;
  number: string;
}

export interface AdminPerson {
  phone: string;
  name: string;
}

/** GET /api/admin: alles wat het beheerscherm nodig heeft, in één keer. */
export interface AdminState {
  event: EventSettings;
  runs: AdminRun[];
  postTypes: PostTypeInfo[];
  posts: AdminPost[];
  units: AdminUnit[];
  coreTeam: CoreTeamEntry[];
  emergencyNumbers: EmergencyNumber[];
  admins: AdminPerson[];
  brand: Brand;
  /** Testmodus aan: oproepen en aanvragen zijn proef en komen niet in het rapport. */
  testMode: boolean;
  /** Devices logged in now, for "Iedereen afmelden". */
  sessions: number;
  info: InfoSettings;
}

/** Import from a spreadsheet (#43): per sheet what would change, and every problem by row. Nothing is saved while there are problems. */
export interface ImportSheetSummary {
  sheet: string;
  added: number;
  changed: number;
  unchanged: number;
  removed: number;
}

export interface ImportProblem {
  sheet: string;
  /** Row in the file, as Excel shows it; null for the file as a whole. */
  row: number | null;
  message: string;
}

export interface ImportPreview {
  sheets: ImportSheetSummary[];
  problems: ImportProblem[];
  removeMissing: boolean;
}

/** POST /api/admin/import and /import/check: one .xlsx, or one or more CSV files, as base64. */
export interface ImportRequest {
  files: { name: string; data: string }[];
  /** Remove locations, teams, core team functions and numbers that aren't in the file. */
  removeMissing: boolean;
}

/** Beheer › Mensen (#70): where someone is listed, linking to that page. */
export interface PersonLink {
  kind: 'post' | 'unit' | 'core' | 'admin';
  /** Post or team; null for the core team and the admin list, which are one page each. */
  id: number | null;
  label: string;
}

export interface PersonOverview {
  phone: string;
  name: string;
  links: PersonLink[];
  /** A device is logged in with this number now. */
  loggedIn: boolean;
  /** A device gets pushes for this number. */
  push: boolean;
  /** What to look at: no name, listed nowhere, overlapping times. */
  problems: string[];
}

export interface PeopleOverview {
  people: PersonOverview[];
  /** Still to fill in: a post without a lead, a team without members, a core team function without a number. */
  gaps: PersonLink[];
}

/** Info & voorwaarden (2.6). In de teksten vult de app {evenement}, {beleid} en {contact} in. */
export interface InfoSettings {
  /** null = de standaardtekst. */
  sections: InfoSection[] | null;
  /** Waar het verwijderplan staat, bijv. "het verwijderplan van Stichting Silvesterloop". */
  policy: string | null;
  /** Voor vragen, bijv. een naam en e-mailadres. */
  contact: string | null;
}

export const INFO_SECTIONS_MAX = 12;

/** Grootste afbeelding die de server aanneemt, in base64-tekens (ongeveer 1,1 MB). */
export const IMAGE_MAX_BASE64 = 1_500_000;
/** Kleinste maat van het vierkante logo, zodat het app-icoon scherp is. */
export const ICON_MIN_SIZE = 512;

/** PUT /api/admin/brand/icon: het vierkante logo in alle maten, door de app gemaakt (PNG, base64). */
export interface IconUpload {
  icon512: string;
  icon192: string;
  maskable512: string;
  appleTouch: string;
}

/** PUT /api/admin/brand/logo: het grote logo (PNG, base64). */
export interface LogoUpload {
  png: string;
}

export interface AddAdminRequest {
  phone: string;
  name?: string;
}
