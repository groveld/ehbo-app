// Wie is iemand vandaag? Rollen volgen uit het telefoonnummer: post, EHBO-eenheid, kernteam of beheerderslijst.
import { POST_CONTACT_ROLE_LABEL, type Assignment, type HomeScreen, type Me } from '@ehbo/shared';
import type { EventDb } from './event-db.ts';

const MOBILITY_LABEL = { te_voet: 'te voet', fiets: 'fiets', auto: 'auto', anders: 'mobiel' } as const;
const EHBO_COLOR = '#0A7D4F';
const INK = '#16181D';

const km = (value: number | null) => (value === null ? '' : ` · km ${value.toLocaleString('nl-NL', { maximumFractionDigits: 1 })}`);
const times = (from: string | null, to: string | null) => (from && to ? `${from} – ${to}` : from ? `vanaf ${from}` : to ? `tot ${to}` : undefined);

/** De medewerker bij dit nummer, of undefined als het nummer nergens is ingepland. */
export function resolveMe(db: EventDb, phone: string): Me | undefined {
  const isAdmin = db.isAdmin(phone);
  const assignments: Assignment[] = [];

  for (const r of db.coreTeamAssignments(phone)) {
    assignments.push({ kind: 'kernteam', title: r.function, letter: r.function.charAt(0).toUpperCase(), color: INK });
  }
  for (const r of db.unitAssignments(phone)) {
    const detail = r.kind === 'vast'
      ? (r.post_name ?? 'Vaste EHBO-post')
      : `Mobiel, ${MOBILITY_LABEL[r.mobility ?? 'anders']}${r.post_name ? ` · standplaats ${r.post_name}` : ''}`;
    assignments.push({ kind: 'ehbo', title: `EHBO ${r.unit_name}`, detail, letter: '+', color: EHBO_COLOR, unitId: r.unit_id });
  }
  for (const r of db.postAssignments(phone)) {
    assignments.push({
      kind: 'post',
      title: r.role === 'verantwoordelijke' ? POST_CONTACT_ROLE_LABEL.verantwoordelijke : (r.person_label ?? POST_CONTACT_ROLE_LABEL[r.role]),
      detail: `${r.post_name}${km(r.km)}`,
      times: times(r.time_from, r.time_to),
      letter: r.type_letter,
      color: r.type_color,
      postId: r.post_id,
      role: r.role,
    });
  }
  if (isAdmin) assignments.push({ kind: 'beheerder', title: 'Beheerder', detail: 'Evenement, posten en mensen beheren', letter: 'B', color: '#3E434B' });

  if (assignments.length === 0) return undefined;

  // Het startscherm volgt de belangrijkste rol (functioneel ontwerp, "Installatie en aanmelden").
  let home: HomeScreen = 'overzicht';
  if (!isAdmin && !assignments.some((a) => a.kind === 'kernteam')) {
    if (assignments.some((a) => a.kind === 'ehbo')) home = 'ehbo';
    else if (assignments.some((a) => a.role === 'verantwoordelijke')) home = 'post';
  }

  const person = db.getPerson(phone);
  return { phone, name: person?.name ?? '', isAdmin, assignments, home, infoAccepted: Boolean(person?.info_accepted_at) };
}
