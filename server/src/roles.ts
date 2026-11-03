// Wie is iemand vandaag? Rollen volgen uit het telefoonnummer: post, EHBO-eenheid, kernteam of beheerderslijst.
import { LOCATION_CONTACT_ROLE_LABEL, mobilityLabel, type Assignment, type HomeScreen, type Me } from '@ehbo/shared';
import type { EventDb } from './event-db.ts';

const EHBO_COLOR = '#0A7D4F';
const INK = '#16181D';

const km = (value: number | null) => (value === null ? '' : ` · km ${value.toLocaleString('nl-NL', { maximumFractionDigits: 1 })}`);
const times = (from: string | null, to: string | null) => (from && to ? `${from} – ${to}` : from ? `vanaf ${from}` : to ? `tot ${to}` : undefined);

/** De medewerker bij dit nummer, of undefined als het nummer nergens is ingepland. */
export function resolveMe(db: EventDb, phone: string): Me | undefined {
  const isAdmin = db.isAdmin(phone);
  const assignments: Assignment[] = [];

  for (const r of db.coreTeamAssignments(phone)) {
    assignments.push({ kind: 'core_team', title: r.function, letter: r.function.charAt(0).toUpperCase(), color: INK });
  }
  for (const r of db.teamAssignments(phone)) {
    const detail = r.kind === 'fixed'
      ? (r.location_name ?? 'Vaste EHBO-post')
      : `${mobilityLabel(r.mobility).replace('m', 'M')}${r.location_name ? ` · Standplaats ${r.location_name}` : ''}`;
    assignments.push({ kind: 'team', title: `EHBO ${r.team_name}`, detail, times: times(r.time_from, r.time_to), letter: '+', color: EHBO_COLOR, functionKey: 'first_aid', teamId: r.team_id });
  }
  for (const r of db.locationAssignments(phone)) {
    assignments.push({
      kind: 'location',
      title: r.role === 'lead' ? LOCATION_CONTACT_ROLE_LABEL.lead : (r.person_label ?? LOCATION_CONTACT_ROLE_LABEL[r.role]),
      detail: `${r.location_name}${km(r.km)}`,
      times: times(r.time_from, r.time_to),
      letter: r.type_letter,
      color: r.type_color,
      functionKey: r.type_key,
      locationId: r.location_id,
      role: r.role,
    });
  }
  if (isAdmin) assignments.push({ kind: 'admin', title: 'Beheerder', detail: 'Evenement, locaties en mensen beheren', letter: 'B', color: '#3E434B' });

  if (assignments.length === 0) return undefined;

  // Het startscherm is je functie: EHBO als je EHBO'er bent, anders je post; alleen wie geen van beide heeft, begint op de kaart.
  let home: HomeScreen = 'map';
  if (assignments.some((a) => a.kind === 'team')) home = 'first_aid';
  else if (assignments.some((a) => a.kind === 'location')) home = 'location';

  return { phone, name: db.getPerson(phone)?.name ?? '', isAdmin, assignments, home };
}
