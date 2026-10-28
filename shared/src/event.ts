// Evenement, rollen en aanmelden.
import type { ApiError } from './index.ts';

export type PostContactRole = 'verantwoordelijke' | 'lid' | 'reserve';
export type UnitKind = 'vast' | 'mobiel';
export type UnitMobility = 'te_voet' | 'fiets' | 'auto' | 'anders';

export const POST_CONTACT_ROLE_LABEL: Record<PostContactRole, string> = {
  verantwoordelijke: 'Postverantwoordelijke',
  lid: 'Posthouder',
  reserve: 'Reserve',
};

/** Standaardsoorten posten bij een nieuw evenement; de beheerder kan ze aanpassen en aanvullen. */
export const DEFAULT_POST_TYPES = [
  { key: 'start_finish', name: 'Start/finish', letter: 'S/F', color: '#16181D' },
  { key: 'water', name: 'Waterpost', letter: 'W', color: '#1F6FB2' },
  { key: 'stempel', name: 'Stempelpost', letter: 'St', color: '#7A4BB7' },
  { key: 'verkeer', name: 'Verkeer', letter: 'V', color: '#D9781C', personLabel: 'Verkeersregelaar' },
  { key: 'ehbo', name: 'EHBO-post', letter: '+', color: '#0A7D4F' },
  { key: 'anders', name: 'Anders', letter: 'A', color: '#6B7079' },
] as const;

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
  { title: 'Waarvoor is deze app?', body: 'Ter ondersteuning van de EHBO en de posten tijdens {evenement}. De app vervangt 112 niet.' },
  {
    title: 'Welke gegevens?',
    body: 'Van medewerkers: naam, telefoonnummer, functie en post. Locatie: mobiele EHBO-eenheden delen hun positie zolang ze in dienst zijn; van anderen alleen om je eigen positie op de kaart te tonen. Posities worden niet bewaard.',
  },
  {
    title: 'Wie ziet wat?',
    body: 'Medewerkers zien elkaars naam en nummer, zodat iedereen elkaar kan bereiken. Deelnemers zien alleen de route en posten.',
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

/** Waarom deze kleuren niet leesbaar zijn, of null als ze goed zijn. */
export function styleProblem(style: Pick<EventStyle, 'primaryColor' | 'accentColor'>) {
  if (contrastRatio(style.primaryColor, '#FFFFFF') < MIN_CONTRAST) return 'De hoofdkleur is te licht: witte tekst erop is slecht leesbaar';
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
export interface Assignment {
  kind: 'post' | 'ehbo' | 'kernteam' | 'beheerder';
  /** Bijv. "Posthouder", "EHBO Team 3", "Evenementcoördinator". */
  title: string;
  /** Bijv. "Waterpost 3 · brug · km 21,1". */
  detail?: string;
  /** Bijv. "10:15 – 13:30". */
  times?: string;
  letter: string;
  color: string;
  postId?: number;
  unitId?: number;
  /** Alleen bij posten: de postverantwoordelijke zet de post open en dicht. */
  role?: PostContactRole;
}

/** Startscherm na aanmelden, volgens de belangrijkste rol. */
export type HomeScreen = 'overzicht' | 'ehbo' | 'post';

/** De aangemelde medewerker: GET /api/me, en het antwoord op POST /api/session. */
export interface Me {
  phone: string;
  name: string;
  isAdmin: boolean;
  assignments: Assignment[];
  home: HomeScreen;
  /** Info & voorwaarden eenmalig bevestigd. */
  infoAccepted: boolean;
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
