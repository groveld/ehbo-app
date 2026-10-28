// Rapport na afloop (6.1): per incident de tijden en afloop, plus totalen. Proefoproepen uit de testmodus tellen niet mee.
import type { IncidentPersons, IncidentStatus, IncidentWhat, Outcome } from './incident.ts';
import type { RequestKind } from './request.ts';

export interface ReportIncident {
  /** Volgnummer in het rapport (1 = eerste melding). */
  number: number;
  postName: string;
  km: number | null;
  what: IncidentWhat | null;
  persons: IncidentPersons | null;
  aed: boolean;
  status: IncidentStatus;
  reportedAt: string;
  acceptedAt: string | null;
  onSiteAt: string | null;
  closedAt: string | null;
  /** Van melding tot geaccepteerd, in seconden. */
  responseSeconds: number | null;
  /** Van geaccepteerd tot ter plaatse (aanrijtijd), in seconden. */
  travelSeconds: number | null;
  unitName: string | null;
  /** Ging naar alle eenheden. */
  escalated: boolean;
  outcome: Outcome | null;
  note: string | null;
}

export interface Report {
  event: { name: string; startDate: string | null; endDate: string | null };
  generatedAt: string;
  counts: { posts: number; staff: number; units: number };
  incidents: ReportIncident[];
  totals: {
    incidents: number;
    withdrawn: number;
    escalated: number;
    avgResponseSeconds: number | null;
    maxResponseSeconds: number | null;
    avgTravelSeconds: number | null;
    byOutcome: Partial<Record<Outcome, number>>;
    byPost: { postName: string; count: number }[];
    requestsByKind: Partial<Record<RequestKind, number>>;
  };
  /** Proefoproepen en -aanvragen die zijn weggelaten. */
  testItems: number;
}

/** "0:41" of "1:05:12" uit seconden. */
export function formatDuration(seconds: number | null) {
  if (seconds === null) return '–';
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${rest}` : `${m}:${rest}`;
}
