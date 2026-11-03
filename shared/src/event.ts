// Evenement, rollen en aanmelden.
import type { ApiError } from './index.ts';

export type LocationContactRole = 'lead' | 'member' | 'reserve';
export type TeamKind = 'fixed' | 'mobile';
export type TeamMobility = 'on_foot' | 'bike' | 'car' | 'other';

export const LOCATION_CONTACT_ROLE_LABEL: Record<LocationContactRole, string> = {
  lead: 'Locatieverantwoordelijke',
  member: 'Lid',
  reserve: 'Reserve',
};

/**
 * Which function of a location matters most, lowest first: it goes on top on the map (#72), and it's the main function of a
 * location with several (#83), which gives its marker the icon and colour. A custom type counts as "other".
 */
export const MARKER_ORDER = ['other', 'turnaround', 'toilet', 'traffic', 'water', 'stamp', 'aed', 'first_aid', 'start_finish'];
export const markerRank = (key: string | null | undefined) => Math.max(MARKER_ORDER.indexOf(key ?? ''), 0);

/** The main function of a location: the highest in MARKER_ORDER; between equals the first chosen. */
export function mainFunction(functionIds: number[], types: { id: number; key: string | null }[]) {
  const rank = (id: number) => markerRank(types.find((t) => t.id === id)?.key);
  return functionIds.reduce((best, id) => (rank(id) > rank(best) ? id : best), functionIds[0]!);
}

/**
 * Standaardsoorten posten bij een nieuw evenement; de beheerder kan ze aanpassen en aanvullen.
 * Unmanned (#69): a fixed AED, toilets and a turnaround have nobody, so no contacts, open or closed, requests or tab.
 * A checkpoint is the stamp post: the app doesn't time runners, so the two are the same.
 */
export const DEFAULT_FUNCTION_TYPES = [
  { key: 'start_finish', name: 'Start/finish', letter: 'S/F', color: '#16181D', staffed: true },
  { key: 'water', name: 'Waterpost', letter: 'W', color: '#1F6FB2', staffed: true },
  { key: 'stamp', name: 'Stempel-/controlepost', letter: 'St', color: '#7A4BB7', staffed: true },
  { key: 'traffic', name: 'Verkeer', letter: 'V', color: '#D9781C', personLabel: 'Verkeersregelaar', staffed: true },
  { key: 'first_aid', name: 'EHBO-post', letter: '+', color: '#0A7D4F', staffed: true },
  // Magenta: clear of the red for urgent and the green for EHBO.
  { key: 'aed', name: 'AED', letter: 'AED', color: '#B5179E', staffed: false },
  { key: 'toilet', name: 'Toiletten', letter: 'WC', color: '#5B6B7A', staffed: false },
  { key: 'turnaround', name: 'Keerpunt', letter: 'K', color: '#6D4C41', staffed: false },
  { key: 'other', name: 'Anders', letter: 'A', color: '#6B7079', staffed: true },
] as const;

/** A location has people when one of its functions has (#69). */
export const isStaffed = (location: { functionIds: number[] }, types: { id: number; staffed: boolean }[]) =>
  location.functionIds.some((id) => types.find((t) => t.id === id)?.staffed ?? true);

/** Voorstel voor het kernteam bij een nieuw evenement (functies zonder naam en nummer). */
export const DEFAULT_CORE_TEAM = [
  'Evenementcoördinator',
  'Wedstrijdleiding',
  'EHBO-coördinator',
  'Veiligheids- en verkeerscoördinator',
  'Coördinator vrijwilligers',
] as const;

export interface InfoSection {
  title: string;
  body: string;
}

/** Standaardtekst van de info-pagina. {evenement}, {beleid} en {contact} vult de server in. */
export const DEFAULT_INFO: InfoSection[] = [
  { title: 'Waarvoor is deze app?', body: 'Ter ondersteuning van de EHBO en de locaties tijdens {evenement}. De app vervangt 112 niet.' },
  {
    title: 'Welke gegevens?',
    body: 'Van medewerkers: naam, telefoonnummer, functie en post. Locatie: mobiele EHBO-eenheden delen hun positie zolang ze in dienst zijn; van anderen alleen om je eigen positie op de kaart te tonen, en één keer bij een hulpvraag vanaf je plek. Posities worden niet bewaard, behalve de plek van een incident buiten een post.',
  },
  {
    title: 'Wie ziet wat?',
    body: 'Medewerkers zien elkaars naam en nummer, zodat iedereen elkaar kan bereiken. Deelnemers zien alleen de route en locaties.',
  },
  { title: 'Incidenten', body: 'We leggen vast wanneer, waar en hoe een melding is afgehandeld. Geen namen of medische gegevens van slachtoffers.' },
  { title: 'Bewaren & vragen', body: 'Na het evenement worden de gegevens verwijderd volgens {beleid}. Vragen: {contact}.' },
];

/** Stijl per evenement. De signaalkleuren (rood, groen, soorten posten) liggen vast. */
export interface EventStyle {
  /** Naam onder het app-icoon; leeg = de naam van het evenement. */
  shortName: string | null;
  /** Hoofdkleur: knoppen en donkere vlakken, met witte tekst. */
  primaryColor: string;
  /** Accentkleur: vlakken met donkere tekst. */
  accentColor: string;
}

export const DEFAULT_STYLE: EventStyle = { shortName: null, primaryColor: '#16181D', accentColor: '#F2C230' };
export const SHORT_NAME_MAX = 12;
export const COLOR_PATTERN = '^#[0-9A-Fa-f]{6}$';
/** Tekstkleur op de accentkleur; ook op een licht accent is tekst zo leesbaar. */
export const INK = '#16181D';
/** Minimaal contrast voor gewone tekst (WCAG AA). */
export const MIN_CONTRAST = 4.5;

/** Contrastverhouding tussen twee kleuren (#rrggbb) volgens WCAG, van 1 tot 21. */
export function contrastRatio(a: string, b: string) {
  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Zelfde functienaam, ongeacht hoofdletters, spaties of streepjes: "EHBO coördinator" = "EHBO-Coördinator". */
export const sameFunction = (a: string, b: string) => {
  const letters = (text: string) => text.toLowerCase().normalize('NFD').replace(/[^a-z]/g, '');
  return letters(a) === letters(b);
};

/** Lijkt deze kleur op een signaalkleur: rood (noodgeval, 112) of groen (in orde)? Dan mag hij geen hoofdkleur zijn. */
export function looksLikeSignal(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === 0 || (max - min) / max < 0.35) return false;
  const d = max - min;
  const hue = max === r ? (60 * ((g - b) / d) + 360) % 360 : max === g ? 60 * ((b - r) / d) + 120 : 60 * ((r - g) / d) + 240;
  const near = (target: number) => Math.min(Math.abs(hue - target), 360 - Math.abs(hue - target)) < 25;
  return near(3) || near(156);
}

/** Waarom deze kleuren niet bruikbaar zijn, of null als ze goed zijn. */
export function styleProblem(style: Pick<EventStyle, 'primaryColor' | 'accentColor'>) {
  if (contrastRatio(style.primaryColor, '#FFFFFF') < MIN_CONTRAST) return 'De hoofdkleur is te licht: witte tekst erop is slecht leesbaar';
  if (looksLikeSignal(style.primaryColor)) return 'De hoofdkleur lijkt op rood of groen; die zijn voor noodgeval en in orde. Kies een andere kleur';
  if (contrastRatio(style.accentColor, INK) < MIN_CONTRAST) return 'De accentkleur is te donker: donkere tekst erop is slecht leesbaar';
  return null;
}

/** Eigen logo's van het evenement, als adres; null = geen eigen logo (de app toont dan de standaard). */
export interface Brand {
  /** Groot logo (startscherm, rapport). */
  logo: string | null;
  /** Vierkant logo als app-icoon, 192 × 192. */
  icon: string | null;
}

/** Wat iedereen mag zien, ook zonder aanmelding: GET /api/event */
export interface PublicEvent {
  name: string;
  /** ISO-datum (jjjj-mm-dd) of null als nog niet ingesteld. */
  startDate: string | null;
  endDate: string | null;
  info: InfoSection[];
  style: EventStyle;
  brand: Brand;
}

/** Eén plek of functie waarop iemand is ingepland. */
const MOBILITY_LABEL: Record<TeamMobility, string | null> = { on_foot: 'te voet', bike: 'fiets', car: 'auto', other: null };

/** "mobiel (auto)", or just "mobiel" when it's nothing in particular. */
export const mobilityLabel = (mobility: TeamMobility | null) => {
  const how = MOBILITY_LABEL[mobility ?? 'other'];
  return how ? `mobiel (${how})` : 'mobiel';
};

export interface Assignment {
  kind: 'location' | 'team' | 'core_team' | 'admin';
  /** Bijv. "Lid", "EHBO Team 3", "Evenementcoördinator". */
  title: string;
  /** Bijv. "Waterpost 3 · brug · km 21,1". */
  detail?: string;
  /** Bijv. "10:15 – 13:30". */
  times?: string;
  letter: string;
  color: string;
  locationId?: number;
  teamId?: number;
  /** Alleen bij posten: de locatieverantwoordelijke zet de post open en dicht. */
  role?: LocationContactRole;
}

/** Startscherm na aanmelden, volgens de belangrijkste rol. */
export type HomeScreen = 'map' | 'first_aid' | 'location';

/** De aangemelde medewerker: GET /api/me, en het antwoord op POST /api/session. */
export interface Me {
  phone: string;
  name: string;
  isAdmin: boolean;
  assignments: Assignment[];
  home: HomeScreen;
}

/** POST /api/session */
export interface LoginRequest {
  phone: string;
}

/** POST /api/session met een onbekend nummer (404). */
export interface LoginUnknown extends ApiError {
  phone: string;
  /** Om te bellen vanaf het scherm "nummer niet bekend". */
  coordinatorPhone: string | null;
}
