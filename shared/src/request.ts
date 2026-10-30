// Eenvoudige aanvragen van posten (water, verkeer, vrijwilliger): naar de wachtrij van de evenementcoördinator, zonder alarm.
// Functioneel ontwerp, "Modulair en opschalen": aangevraagd → opgepakt → afgehandeld.

export const REQUEST_KINDS = {
  water: { label: 'Water', sub: 'Bijvullen', details: { beetje: 'Beetje', flink: 'Flink', bijna_op: 'Bijna op' }, ask: 'Hoeveel?' },
  verkeer: { label: 'Verkeer', sub: 'Hulp bij regelen', details: { druk: 'Druk', onveilig: 'Onveilig', afzetting: 'Afzetting nodig' }, ask: 'Wat is er?' },
  vrijwilliger: { label: 'Vrijwilliger', sub: 'Aflossing, uitval', details: { aflossing: 'Aflossing nodig', uitval: 'Iemand valt uit', extra: 'Extra hulp' }, ask: 'Wat is er nodig?' },
} as const;
export type RequestKind = keyof typeof REQUEST_KINDS;

export type RequestStatus = 'aangevraagd' | 'opgepakt' | 'afgehandeld' | 'ingetrokken';

/** POST /api/requests */
export interface NewRequest {
  postId: number;
  kind: RequestKind;
  /** Een van de keuzes bij deze soort (REQUEST_KINDS[kind].details), of null. */
  detail: string | null;
  /** Door de telefoon gekozen id: twee keer versturen telt één keer. */
  clientId: string;
}

export interface LiveRequest {
  id: number;
  /** Gedaan in de testmodus. */
  isTest: boolean;
  postId: number;
  /** Shown before the new event package has arrived. */
  postName: string;
  kind: RequestKind;
  detail: string | null;
  status: RequestStatus;
  createdAt: string;
  pickedAt: string | null;
  pickedBy: { name: string; phone: string } | null;
  doneAt: string | null;
  /** Plek in de wachtrij (1 = eerstvolgende), zolang de aanvraag open is. */
  position: number | null;
}

export const requestDetailLabel = (kind: RequestKind, detail: string | null) =>
  detail ? (REQUEST_KINDS[kind].details as Record<string, string>)[detail] ?? null : null;
