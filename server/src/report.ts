// Rapport na afloop (functioneel ontwerp, "Incidentregistratie en rapport"): per incident de tijden en afloop, plus totalen.
// Proefoproepen en -aanvragen uit de testmodus tellen niet mee.
import { INCIDENT_WHAT, OUTCOMES, helpRequestType, type Outcome, type Report, type ReportIncident, type ReportLocationPassages, type RequestKind, formatKm, formatKmList } from '@ehbo/shared';
import type { EventDb } from './event-db.ts';

type Row = Record<string, string | number | null>;

const seconds = (from: string | number | null | undefined, to: string | number | null | undefined) =>
  from && to ? Math.max(0, (new Date(to as string).getTime() - new Date(from as string).getTime()) / 1000) : null;
const average = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);

export function buildReport(db: EventDb, now = new Date()): Report {
  const sql = db.raw;
  const all = (query: string) => sql.prepare(query).all() as Row[];
  const count = (query: string) => (sql.prepare(query).get() as { n: number }).n;
  const event = db.getEvent();

  const incidents: ReportIncident[] = all(`
    SELECT i.*, COALESCE(i.place_name, p.name) AS location_name, p.km, u.name AS team_name FROM incidents i
    JOIN locations p ON p.id = i.location_id LEFT JOIN teams u ON u.id = i.team_id
    WHERE i.is_test = 0 ORDER BY i.reported_at, i.id`).map((r, n) => ({
    number: n + 1,
    locationName: r.location_name as string,
    km: r.km as number | null,
    what: r.what as ReportIncident['what'],
    persons: r.persons as ReportIncident['persons'],
    aed: r.aed === 1,
    status: r.status as ReportIncident['status'],
    reportedAt: r.reported_at as string,
    acceptedAt: r.accepted_at as string | null,
    onSiteAt: r.on_site_at as string | null,
    closedAt: r.closed_at as string | null,
    // Started by the team that was there: nothing to measure, and a zero would flatter the averages.
    responseSeconds: r.self_started === 1 ? null : seconds(r.reported_at, r.accepted_at),
    travelSeconds: r.self_started === 1 ? null : seconds(r.accepted_at, r.on_site_at),
    teamName: r.team_name as string | null,
    escalated: r.stage === 'all',
    selfStarted: r.self_started === 1,
    outcome: r.outcome as Outcome | null,
    note: r.outcome_note as string | null,
  }));

  const responses = incidents.flatMap((i) => (i.responseSeconds === null ? [] : [i.responseSeconds]));
  const travels = incidents.flatMap((i) => (i.travelSeconds === null ? [] : [i.travelSeconds]));
  const byOutcome: Partial<Record<Outcome, number>> = {};
  for (const i of incidents) if (i.outcome) byOutcome[i.outcome] = (byOutcome[i.outcome] ?? 0) + 1;
  const byLocation = new Map<string, number>();
  for (const i of incidents) if (i.status !== 'withdrawn') byLocation.set(i.locationName, (byLocation.get(i.locationName) ?? 0) + 1);
  const requestsByKind: Partial<Record<RequestKind, number>> = {};
  for (const r of all("SELECT kind, COUNT(*) AS n FROM queue_requests WHERE is_test = 0 AND status <> 'withdrawn' GROUP BY kind")) {
    requestsByKind[r.kind as RequestKind] = r.n as number;
  }

  const passages = new Map<string, ReportLocationPassages>();
  for (const r of all(`SELECT p.name AS location_name, r.name AS run_name, pp.km FROM km_points pp
                       JOIN locations p ON p.id = pp.location_id JOIN runs r ON r.id = pp.run_id
                       ORDER BY p.km, p.sort, p.id, r.track_km DESC, r.id, pp.seq`)) {
    const location = passages.get(r.location_name as string) ?? { locationName: r.location_name as string, runs: [] };
    const run = location.runs.find((x) => x.runName === r.run_name);
    if (run) run.km.push(r.km as number);
    else location.runs.push({ runName: r.run_name as string, km: [r.km as number] });
    passages.set(location.locationName, location);
  }

  return {
    event: { name: event.name, startDate: event.start_date, endDate: event.end_date },
    generatedAt: now.toISOString(),
    helpRequestTypes: db.helpRequestTypes(),
    counts: {
      locations: count('SELECT COUNT(*) AS n FROM locations'),
      // Iedereen die ergens is ingepland: bij een post, een EHBO-eenheid of in het kernteam.
      staff: count(`SELECT COUNT(*) AS n FROM (SELECT phone FROM location_contacts UNION SELECT phone FROM team_members
                    UNION SELECT phone FROM core_team WHERE phone IS NOT NULL)`),
      teams: count('SELECT COUNT(*) AS n FROM teams'),
    },
    incidents,
    passages: [...passages.values()],
    totals: {
      incidents: incidents.filter((i) => i.status !== 'withdrawn').length,
      withdrawn: incidents.filter((i) => i.status === 'withdrawn').length,
      escalated: incidents.filter((i) => i.escalated).length,
      avgResponseSeconds: average(responses),
      maxResponseSeconds: responses.length ? Math.max(...responses) : null,
      avgTravelSeconds: average(travels),
      byOutcome,
      byLocation: [...byLocation].map(([locationName, n]) => ({ locationName, count: n })).sort((a, b) => b.count - a.count || a.locationName.localeCompare(b.locationName)),
      requestsByKind,
    },
    testItems: count('SELECT COUNT(*) AS n FROM help_requests WHERE is_test = 1'),
  };
}

/** "2026-12-31 11:02:13" in Nederlandse tijd. */
const localTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString('sv-SE', { timeZone: 'Europe/Amsterdam' }) : '');
const minutesSeconds = (s: number | null) => (s === null ? '' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`);

/** CSV voor Excel in het Nederlands: puntkomma's en een BOM, zodat é en ö goed overkomen. */
export function reportCsv(report: Report) {
  const cell = (value: string | number | null) => {
    const text = value === null ? '' : String(value);
    return /[;"\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  const STATUS = { sent: 'open', accepted: 'onderweg', on_site: 'ter plaatse', closed: 'afgerond', withdrawn: 'ingetrokken' } as const;
  const header = ['Nr', 'Locatie', 'Km', 'Melding', 'Personen', 'AED', 'Status', 'Gemeld', 'Geaccepteerd', 'Ter plaatse', 'Afgerond',
    'Reactietijd (m:ss)', 'Aanrijtijd (m:ss)', 'Eenheid', 'Naar alle eenheden', 'Zelf gestart', 'Afloop', 'Notitie'];
  const rows = report.incidents.map((i) => [
    i.number, i.locationName, i.km === null ? null : formatKm(i.km), i.what ? INCIDENT_WHAT[i.what] : null, i.persons,
    i.aed ? 'ja' : 'nee', STATUS[i.status], localTime(i.reportedAt), localTime(i.acceptedAt), localTime(i.onSiteAt), localTime(i.closedAt),
    minutesSeconds(i.responseSeconds), minutesSeconds(i.travelSeconds), i.teamName, i.escalated ? 'ja' : 'nee', i.selfStarted ? 'ja' : 'nee', i.outcome ? OUTCOMES[i.outcome] : null, i.note,
  ]);
  const requests = Object.entries(report.totals.requestsByKind).map(([kind, n]) => [`Aanvragen ${helpRequestType(report.helpRequestTypes, kind).name.toLowerCase()}`, n ?? 0]);
  const lines = [header, ...rows, [], ['Totaal'], ['Incidenten', report.totals.incidents], ['Ingetrokken', report.totals.withdrawn],
    ['Naar alle eenheden', report.totals.escalated], ...requests,
    [], ['Km-punten per locatie'], ['Locatie', 'Loop', 'Km-punten'],
    ...report.passages.flatMap((p) => p.runs.map((r) => [p.locationName, r.runName, formatKmList(r.km)])),
  ];
  return `﻿${lines.map((line) => line.map(cell).join(';')).join('\r\n')}\r\n`;
}
