// Rapport na afloop (functioneel ontwerp, "Incidentregistratie en rapport"): per incident de tijden en afloop, plus totalen.
// Proefoproepen en -aanvragen uit de testmodus tellen niet mee.
import { INCIDENT_WHAT, OUTCOMES, REQUEST_KINDS, type Outcome, type Report, type ReportIncident, type ReportPostPassages, type RequestKind, formatKm } from '@ehbo/shared';
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
    SELECT i.*, p.name AS post_name, p.km, u.name AS unit_name FROM incidents i
    JOIN posts p ON p.id = i.post_id LEFT JOIN ehbo_units u ON u.id = i.unit_id
    WHERE i.is_test = 0 ORDER BY i.reported_at, i.id`).map((r, n) => ({
    number: n + 1,
    postName: r.post_name as string,
    km: r.km as number | null,
    what: r.what as ReportIncident['what'],
    persons: r.persons as ReportIncident['persons'],
    aed: r.aed === 1,
    status: r.status as ReportIncident['status'],
    reportedAt: r.reported_at as string,
    acceptedAt: r.accepted_at as string | null,
    onSiteAt: r.on_site_at as string | null,
    closedAt: r.closed_at as string | null,
    responseSeconds: seconds(r.reported_at, r.accepted_at),
    travelSeconds: seconds(r.accepted_at, r.on_site_at),
    unitName: r.unit_name as string | null,
    escalated: r.stage === 'alle',
    outcome: r.outcome as Outcome | null,
    note: r.outcome_note as string | null,
  }));

  const responses = incidents.flatMap((i) => (i.responseSeconds === null ? [] : [i.responseSeconds]));
  const travels = incidents.flatMap((i) => (i.travelSeconds === null ? [] : [i.travelSeconds]));
  const byOutcome: Partial<Record<Outcome, number>> = {};
  for (const i of incidents) if (i.outcome) byOutcome[i.outcome] = (byOutcome[i.outcome] ?? 0) + 1;
  const byPost = new Map<string, number>();
  for (const i of incidents) if (i.status !== 'ingetrokken') byPost.set(i.postName, (byPost.get(i.postName) ?? 0) + 1);
  const requestsByKind: Partial<Record<RequestKind, number>> = {};
  for (const r of all("SELECT kind, COUNT(*) AS n FROM requests WHERE is_test = 0 AND status <> 'ingetrokken' GROUP BY kind")) {
    requestsByKind[r.kind as RequestKind] = r.n as number;
  }

  const passages = new Map<string, ReportPostPassages>();
  for (const r of all(`SELECT p.name AS post_name, r.name AS run_name, pp.km FROM post_passages pp
                       JOIN posts p ON p.id = pp.post_id JOIN runs r ON r.id = pp.run_id
                       ORDER BY p.km, p.sort, p.id, r.track_km DESC, r.id, pp.seq`)) {
    const post = passages.get(r.post_name as string) ?? { postName: r.post_name as string, runs: [] };
    const run = post.runs.find((x) => x.runName === r.run_name);
    if (run) run.km.push(r.km as number);
    else post.runs.push({ runName: r.run_name as string, km: [r.km as number] });
    passages.set(post.postName, post);
  }

  return {
    event: { name: event.name, startDate: event.start_date, endDate: event.end_date },
    generatedAt: now.toISOString(),
    counts: {
      posts: count('SELECT COUNT(*) AS n FROM posts'),
      // Iedereen die ergens is ingepland: bij een post, een EHBO-eenheid of in het kernteam.
      staff: count(`SELECT COUNT(*) AS n FROM (SELECT phone FROM post_contacts UNION SELECT phone FROM ehbo_unit_members
                    UNION SELECT phone FROM core_team WHERE phone IS NOT NULL)`),
      units: count('SELECT COUNT(*) AS n FROM ehbo_units'),
    },
    incidents,
    passages: [...passages.values()],
    totals: {
      incidents: incidents.filter((i) => i.status !== 'ingetrokken').length,
      withdrawn: incidents.filter((i) => i.status === 'ingetrokken').length,
      escalated: incidents.filter((i) => i.escalated).length,
      avgResponseSeconds: average(responses),
      maxResponseSeconds: responses.length ? Math.max(...responses) : null,
      avgTravelSeconds: average(travels),
      byOutcome,
      byPost: [...byPost].map(([postName, n]) => ({ postName, count: n })).sort((a, b) => b.count - a.count || a.postName.localeCompare(b.postName)),
      requestsByKind,
    },
    testItems: count('SELECT (SELECT COUNT(*) FROM incidents WHERE is_test = 1) + (SELECT COUNT(*) FROM requests WHERE is_test = 1) AS n'),
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
  const STATUS = { verstuurd: 'open', geaccepteerd: 'onderweg', ter_plaatse: 'ter plaatse', afgerond: 'afgerond', ingetrokken: 'ingetrokken' } as const;
  const header = ['Nr', 'Post', 'Km', 'Melding', 'Personen', 'AED', 'Status', 'Gemeld', 'Geaccepteerd', 'Ter plaatse', 'Afgerond',
    'Reactietijd (m:ss)', 'Aanrijtijd (m:ss)', 'Eenheid', 'Naar alle eenheden', 'Afloop', 'Notitie'];
  const rows = report.incidents.map((i) => [
    i.number, i.postName, i.km === null ? null : String(i.km).replace('.', ','), i.what ? INCIDENT_WHAT[i.what] : null, i.persons,
    i.aed ? 'ja' : 'nee', STATUS[i.status], localTime(i.reportedAt), localTime(i.acceptedAt), localTime(i.onSiteAt), localTime(i.closedAt),
    minutesSeconds(i.responseSeconds), minutesSeconds(i.travelSeconds), i.unitName, i.escalated ? 'ja' : 'nee', i.outcome ? OUTCOMES[i.outcome] : null, i.note,
  ]);
  const requests = Object.entries(report.totals.requestsByKind).map(([kind, n]) => [`Aanvragen ${REQUEST_KINDS[kind as RequestKind].label.toLowerCase()}`, n]);
  const lines = [header, ...rows, [], ['Totaal'], ['Incidenten', report.totals.incidents], ['Ingetrokken', report.totals.withdrawn],
    ['Naar alle eenheden', report.totals.escalated], ...requests,
    [], ['Km-punten per post'], ['Post', 'Loop', 'Km-punten'],
    ...report.passages.flatMap((p) => p.runs.map((r) => [p.postName, r.runName, r.km.map((km) => formatKm(km)).join(' en ')])),
  ];
  return `﻿${lines.map((line) => line.map(cell).join(';')).join('\r\n')}\r\n`;
}
