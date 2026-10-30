// Evenementpakket: alles wat een telefoon nodig heeft om zonder bereik te werken, met één versienummer.
import type { PostPassages, PostTypeInfo } from './admin.ts';
import type { PostContactRole, UnitKind, UnitMobility } from './event.ts';

/** [lengtegraad, breedtegraad] */
export type LngLat = [number, number];
/** [west, zuid, oost, noord] */
export type Bbox = [number, number, number, number];

export interface PackageContact {
  name: string;
  phone: string;
  role: PostContactRole;
}

export interface PackagePost {
  id: number;
  typeId: number;
  name: string;
  /** First pass on the longest run that comes by; null without a GPX or position. */
  km: number | null;
  /** All passes per run, longest run first. */
  passages: PostPassages[];
  lat: number | null;
  lng: number | null;
  isOpen: boolean;
  timeFrom: string | null;
  timeTo: string | null;
  /** Alleen voor medewerkers. */
  address?: string | null;
  accessRoute?: string | null;
  contacts?: PackageContact[];
}

export interface PackageRun {
  id: number;
  name: string;
  distanceKm: number | null;
  discipline: string | null;
  date: string | null;
  startTime: string | null;
  /** Het parcours, of null zonder GPX. */
  line: LngLat[] | null;
}

export interface PackageUnit {
  id: number;
  name: string;
  kind: UnitKind;
  mobility: UnitMobility | null;
  postId: number | null;
  hasAed: boolean;
  members: { name: string; phone: string }[];
}

export interface PackageMap {
  version: number;
  bbox: Bbox;
  maxZoom: number;
  /** Alle tegels van het gebied, om vooraf op te slaan: [z, x, y]. */
  tiles: [number, number, number][];
  /** Lettertypen en iconen, als paden onder /map/<versie>/. */
  assets: string[];
}

/** GET /api/package. Deelnemers krijgen dezelfde vorm zonder namen, nummers en aanrijroutes. */
export interface EventPackage {
  /** Verandert bij elke wijziging; de server antwoordt 304 als de telefoon deze al heeft. */
  version: string;
  staff: boolean;
  event: { name: string; startDate: string | null; endDate: string | null; startLocation: string | null };
  postTypes: PostTypeInfo[];
  posts: PackagePost[];
  runs: PackageRun[];
  units: PackageUnit[];
  coreTeam: { function: string; name: string; phone: string; isCoordinator: boolean }[];
  emergencyNumbers: { label: string; number: string }[];
  /** Voor iedereen, ook deelnemers: "Bel EHBO" belt de EHBO-coördinator, anders de evenementcoördinator. Alleen het nummer. */
  ehboPhone: string | null;
  map: PackageMap | null;
}

/** GET /api/admin/map: de kaart ophalen loopt op de achtergrond. */
export interface MapStatus {
  state: 'idle' | 'running' | 'done' | 'error';
  done: number;
  total: number;
  message: string;
  current: { build: string; bbox: Bbox; tiles: number; bytes: number; preparedAt: string } | null;
}
