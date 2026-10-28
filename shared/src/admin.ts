// Beheer: vorm van de gegevens die het beheerscherm leest en opslaat.
import type { Brand, EventStyle, PostContactRole, UnitKind, UnitMobility } from './event.ts';
import type { UnitAvailability } from './incident.ts';

/** Datum als jjjj-mm-dd, tijd als uu:mm. */
export const DATE_PATTERN = '^\\d{4}-\\d{2}-\\d{2}$';
export const TIME_PATTERN = '^([01]\\d|2[0-3]):[0-5]\\d$';

export const ESCALATION_MIN_SECONDS = 10;
export const ESCALATION_MAX_SECONDS = 120;

export interface EventSettings {
  name: string;
  startLocation: string | null;
  startDate: string | null;
  endDate: string | null;
  /** Na zoveel seconden zonder acceptatie gaat een EHBO-oproep naar alle vrije eenheden. */
  escalationSeconds: number;
  style: EventStyle;
}

export interface RunData {
  name: string;
  distanceKm: number | null;
  /** Bijv. "lopen" of "lopen + wandelen". */
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
}

/** Bij opslaan mag het nummer in elke schrijfwijze; de server maakt er E.164 van. */
export interface ContactData {
  name: string;
  phone: string;
  role: PostContactRole;
  timeFrom: string | null;
  timeTo: string | null;
}

export interface PostData {
  typeId: number;
  name: string;
  km: number | null;
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
  isOpen: boolean;
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
}

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
