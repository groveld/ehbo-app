// Eén SQLite-bestand per evenement (data/events/<naam>.sqlite).
// Alles over het evenement staat hier; de rest van de server praat alleen met dit EventDb-object.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_CORE_TEAM, DEFAULT_POST_TYPES, type PostContactRole, type PushSubscriptionData, type UnitKind, type UnitMobility } from '@ehbo/shared';

// Elke stap draait één keer; PRAGMA user_version onthoudt tot waar het bestand is bijgewerkt.
const MIGRATIONS = [
  `
  CREATE TABLE event (
    id                 INTEGER PRIMARY KEY CHECK (id = 1),
    name               TEXT NOT NULL,
    start_location     TEXT,
    start_date         TEXT,
    end_date           TEXT,
    escalation_seconds INTEGER NOT NULL DEFAULT 30,
    info_json          TEXT,
    info_policy        TEXT,
    info_contact       TEXT,
    style_json         TEXT,
    version            INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE people (
    phone            TEXT PRIMARY KEY,
    name             TEXT NOT NULL DEFAULT '',
    info_accepted_at TEXT
  );
  CREATE TABLE admins (
    phone TEXT PRIMARY KEY REFERENCES people(phone) ON UPDATE CASCADE
  );
  CREATE TABLE runs (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    distance_km REAL,
    discipline  TEXT,
    date        TEXT,
    start_time  TEXT,
    gpx         TEXT,
    sort        INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE post_types (
    id           INTEGER PRIMARY KEY,
    key          TEXT UNIQUE,
    name         TEXT NOT NULL,
    letter       TEXT NOT NULL,
    color        TEXT NOT NULL,
    person_label TEXT,
    sort         INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE posts (
    id           INTEGER PRIMARY KEY,
    type_id      INTEGER NOT NULL REFERENCES post_types(id),
    name         TEXT NOT NULL,
    km           REAL,
    lat          REAL,
    lng          REAL,
    accuracy_m   REAL,
    address      TEXT,
    access_route TEXT,
    time_from    TEXT,
    time_to      TEXT,
    is_open      INTEGER NOT NULL DEFAULT 0,
    sort         INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE post_contacts (
    id        INTEGER PRIMARY KEY,
    post_id   INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    phone     TEXT NOT NULL REFERENCES people(phone) ON UPDATE CASCADE,
    role      TEXT NOT NULL CHECK (role IN ('verantwoordelijke', 'lid', 'reserve')),
    time_from TEXT,
    time_to   TEXT
  );
  CREATE TABLE core_team (
    id             INTEGER PRIMARY KEY,
    function       TEXT NOT NULL,
    phone          TEXT REFERENCES people(phone) ON UPDATE CASCADE,
    is_coordinator INTEGER NOT NULL DEFAULT 0,
    sort           INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE ehbo_units (
    id       INTEGER PRIMARY KEY,
    name     TEXT NOT NULL,
    kind     TEXT NOT NULL CHECK (kind IN ('vast', 'mobiel')),
    mobility TEXT CHECK (mobility IN ('te_voet', 'fiets', 'auto', 'anders')),
    post_id  INTEGER REFERENCES posts(id) ON DELETE SET NULL,
    has_aed  INTEGER NOT NULL DEFAULT 0,
    status   TEXT NOT NULL DEFAULT 'uit_dienst' CHECK (status IN ('vrij', 'bezet', 'uit_dienst')),
    sort     INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE ehbo_unit_members (
    unit_id INTEGER NOT NULL REFERENCES ehbo_units(id) ON DELETE CASCADE,
    phone   TEXT NOT NULL REFERENCES people(phone) ON UPDATE CASCADE,
    PRIMARY KEY (unit_id, phone)
  );
  CREATE TABLE emergency_numbers (
    id     INTEGER PRIMARY KEY,
    label  TEXT NOT NULL,
    number TEXT NOT NULL,
    sort   INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE sessions (
    token_hash   TEXT PRIMARY KEY,
    phone        TEXT NOT NULL,
    user_agent   TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at   TEXT NOT NULL
  );
  CREATE TABLE login_log (
    id         INTEGER PRIMARY KEY,
    at         TEXT NOT NULL DEFAULT (datetime('now')),
    phone      TEXT NOT NULL,
    user_agent TEXT,
    result     TEXT NOT NULL
  );
  CREATE TABLE subscriptions (
    endpoint     TEXT PRIMARY KEY,
    phone        TEXT,
    p256dh       TEXT NOT NULL,
    auth         TEXT NOT NULL,
    user_agent   TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_push_at TEXT,
    last_status  INTEGER
  );
  `,
  // 2: het parcours uit GPX, vereenvoudigd tot een lijn voor de kaart.
  `
  ALTER TABLE runs ADD COLUMN gpx_filename TEXT;
  ALTER TABLE runs ADD COLUMN track_json TEXT;
  ALTER TABLE runs ADD COLUMN track_points INTEGER;
  ALTER TABLE runs ADD COLUMN track_km REAL;
  `,
  // 3: kaart voor offline gebruik (tegels en lettertypen/iconen uit Protomaps), en de letters uit het schermontwerp.
  `
  UPDATE post_types SET letter = 'S/F' WHERE key = 'start_finish' AND letter = 'F';
  UPDATE post_types SET letter = 'St' WHERE key = 'stempel' AND letter = 'S';
  ALTER TABLE event ADD COLUMN map_version INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE event ADD COLUMN map_json TEXT;
  CREATE TABLE map_tiles (
    z    INTEGER NOT NULL,
    x    INTEGER NOT NULL,
    y    INTEGER NOT NULL,
    data BLOB NOT NULL,
    PRIMARY KEY (z, x, y)
  ) WITHOUT ROWID;
  CREATE TABLE map_assets (
    path         TEXT PRIMARY KEY,
    content_type TEXT NOT NULL,
    data         BLOB NOT NULL
  );
  `,
  // 4: eigen logo's (groot logo en het vierkante logo in alle icoonmaten, als PNG); kleuren en korte naam staan in style_json.
  `
  ALTER TABLE event ADD COLUMN brand_version INTEGER NOT NULL DEFAULT 0;
  CREATE TABLE brand_images (
    name TEXT PRIMARY KEY,
    data BLOB NOT NULL
  );
  `,
  // 5: EHBO-oproepen. De beschikbaarheid van een eenheid vervangt ehbo_units.status ("bezet" volgt uit een lopende oproep).
  // Posities van eenheden staan alleen in het geheugen van de server, nooit in de database.
  `
  ALTER TABLE ehbo_units ADD COLUMN availability TEXT NOT NULL DEFAULT 'uit_dienst' CHECK (availability IN ('vrij', 'pauze', 'uit_dienst'));
  ALTER TABLE ehbo_units ADD COLUMN stay_post_id INTEGER REFERENCES posts(id) ON DELETE SET NULL;
  CREATE TABLE incidents (
    id              INTEGER PRIMARY KEY,
    client_id       TEXT NOT NULL UNIQUE,
    post_id         INTEGER NOT NULL REFERENCES posts(id),
    reported_by     TEXT NOT NULL,
    what            TEXT,
    persons         TEXT,
    responsive      TEXT,
    note            TEXT,
    aed             INTEGER NOT NULL DEFAULT 0,
    status          TEXT NOT NULL CHECK (status IN ('verstuurd', 'geaccepteerd', 'ter_plaatse', 'afgerond', 'ingetrokken')),
    stage           TEXT NOT NULL CHECK (stage IN ('dichtstbij', 'alle')),
    reported_at     TEXT NOT NULL,
    sent_at         TEXT NOT NULL,
    escalates_at    TEXT,
    unit_id         INTEGER REFERENCES ehbo_units(id) ON DELETE SET NULL,
    accepted_by     TEXT,
    accepted_at     TEXT,
    on_site_at      TEXT,
    closed_at       TEXT,
    outcome         TEXT,
    outcome_persons TEXT,
    outcome_note    TEXT
  );
  CREATE TABLE incident_dispatches (
    incident_id INTEGER NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
    unit_id     INTEGER NOT NULL REFERENCES ehbo_units(id) ON DELETE CASCADE,
    at          TEXT NOT NULL,
    reason      TEXT NOT NULL CHECK (reason IN ('dichtstbij', 'aed', 'alle', 'handmatig')),
    distance_km REAL,
    declined_at TEXT,
    accepted_at TEXT,
    PRIMARY KEY (incident_id, unit_id)
  );
  CREATE TABLE incident_events (
    id          INTEGER PRIMARY KEY,
    incident_id INTEGER NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
    at          TEXT NOT NULL,
    type        TEXT NOT NULL,
    unit_id     INTEGER,
    text        TEXT NOT NULL
  );
  `,
  // 6: eenvoudige aanvragen (water, verkeer, vrijwilliger) in de wachtrij van de evenementcoördinator.
  `
  CREATE TABLE requests (
    id          INTEGER PRIMARY KEY,
    client_id   TEXT NOT NULL UNIQUE,
    post_id     INTEGER NOT NULL REFERENCES posts(id),
    kind        TEXT NOT NULL CHECK (kind IN ('water', 'verkeer', 'vrijwilliger')),
    detail      TEXT,
    status      TEXT NOT NULL CHECK (status IN ('aangevraagd', 'opgepakt', 'afgehandeld', 'ingetrokken')),
    reported_by TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    picked_at   TEXT,
    picked_by   TEXT,
    done_at     TEXT
  );
  `,
  // 7: testmodus. Wat in de testmodus wordt gemeld of aangevraagd, is proef en komt niet in het rapport.
  `
  ALTER TABLE event ADD COLUMN test_mode INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE incidents ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE requests ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0;
  `,
];

export interface EventRow {
  name: string;
  start_date: string | null;
  end_date: string | null;
  escalation_seconds: number;
  info_json: string | null;
  info_policy: string | null;
  info_contact: string | null;
}

export interface PersonRow {
  phone: string;
  name: string;
  info_accepted_at: string | null;
}

export interface PostAssignmentRow {
  post_id: number;
  post_name: string;
  km: number | null;
  role: PostContactRole;
  time_from: string | null;
  time_to: string | null;
  type_letter: string;
  type_color: string;
  person_label: string | null;
}

export interface UnitAssignmentRow {
  unit_id: number;
  unit_name: string;
  kind: UnitKind;
  mobility: UnitMobility | null;
  post_name: string | null;
}

export interface CoreTeamAssignmentRow {
  function: string;
  is_coordinator: number;
}

export interface SessionRow {
  phone: string;
  expires_at: string;
}

export type EventDb = ReturnType<typeof openEventDb>;

export function openEventDb(dataDir: string, slug: string, { name, adminPhone }: { name: string; adminPhone?: string | null }) {
  if (!/^[a-z0-9-]+$/.test(slug)) throw new Error(`Ongeldige evenementnaam: ${slug}`);
  const dir = path.join(dataDir, 'events');
  fs.mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(path.join(dir, `${slug}.sqlite`));
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');

  const transaction = <T>(fn: () => T): T => {
    db.exec('BEGIN');
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  };

  const version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  for (let i = version; i < MIGRATIONS.length; i++) {
    transaction(() => {
      db.exec(MIGRATIONS[i]!);
      db.exec(`PRAGMA user_version = ${i + 1}`);
    });
  }

  // Nieuw evenement: standaardsoorten posten en het voorgestelde kernteam.
  if (!db.prepare('SELECT 1 FROM event').get()) {
    transaction(() => {
      db.prepare('INSERT INTO event (id, name) VALUES (1, ?)').run(name);
      const type = db.prepare('INSERT INTO post_types (key, name, letter, color, person_label, sort) VALUES (?, ?, ?, ?, ?, ?)');
      DEFAULT_POST_TYPES.forEach((t, i) => type.run(t.key, t.name, t.letter, t.color, 'personLabel' in t ? t.personLabel : null, i));
      const core = db.prepare('INSERT INTO core_team (function, is_coordinator, sort) VALUES (?, ?, ?)');
      DEFAULT_CORE_TEAM.forEach((f, i) => core.run(f, i === 0 ? 1 : 0, i));
    });
  }

  // De eerste beheerder komt uit de serverinstellingen, alleen zolang er nog geen beheerder is.
  const q = {
    countAdmins: db.prepare('SELECT COUNT(*) AS n FROM admins'),
    ensurePerson: db.prepare('INSERT INTO people (phone) VALUES (?) ON CONFLICT(phone) DO NOTHING'),
    addAdmin: db.prepare('INSERT INTO admins (phone) VALUES (?) ON CONFLICT(phone) DO NOTHING'),
    getEvent: db.prepare('SELECT name, start_date, end_date, escalation_seconds, info_json, info_policy, info_contact FROM event WHERE id = 1'),
    getPerson: db.prepare('SELECT phone, name, info_accepted_at FROM people WHERE phone = ?'),
    isAdmin: db.prepare('SELECT 1 FROM admins WHERE phone = ?'),
    postAssignments: db.prepare(`
      SELECT p.id AS post_id, p.name AS post_name, p.km, c.role,
             COALESCE(c.time_from, p.time_from) AS time_from, COALESCE(c.time_to, p.time_to) AS time_to,
             t.letter AS type_letter, t.color AS type_color, t.person_label
      FROM post_contacts c JOIN posts p ON p.id = c.post_id JOIN post_types t ON t.id = p.type_id
      WHERE c.phone = ? ORDER BY COALESCE(c.time_from, p.time_from), p.sort, p.id`),
    unitAssignments: db.prepare(`
      SELECT u.id AS unit_id, u.name AS unit_name, u.kind, u.mobility, p.name AS post_name
      FROM ehbo_unit_members m JOIN ehbo_units u ON u.id = m.unit_id LEFT JOIN posts p ON p.id = u.post_id
      WHERE m.phone = ? ORDER BY u.sort, u.id`),
    coreTeamAssignments: db.prepare('SELECT function, is_coordinator FROM core_team WHERE phone = ? ORDER BY sort, id'),
    coordinatorPhone: db.prepare('SELECT phone FROM core_team WHERE is_coordinator = 1 AND phone IS NOT NULL ORDER BY sort, id LIMIT 1'),
    acceptInfo: db.prepare("UPDATE people SET info_accepted_at = datetime('now') WHERE phone = ? AND info_accepted_at IS NULL"),
    createSession: db.prepare('INSERT INTO sessions (token_hash, phone, user_agent, expires_at) VALUES (?, ?, ?, ?)'),
    getSession: db.prepare("SELECT phone, expires_at FROM sessions WHERE token_hash = ? AND expires_at > datetime('now')"),
    touchSession: db.prepare("UPDATE sessions SET last_seen_at = datetime('now') WHERE token_hash = ?"),
    deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    deleteExpiredSessions: db.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')"),
    logLogin: db.prepare('INSERT INTO login_log (phone, user_agent, result) VALUES (?, ?, ?)'),
    upsertSub: db.prepare(`
      INSERT INTO subscriptions (endpoint, phone, p256dh, auth, user_agent) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(endpoint) DO UPDATE SET phone = excluded.phone, p256dh = excluded.p256dh, auth = excluded.auth,
        user_agent = excluded.user_agent, last_seen_at = datetime('now')`),
    getSub: db.prepare('SELECT endpoint, phone, p256dh, auth FROM subscriptions WHERE endpoint = ?'),
    subsForPhone: db.prepare('SELECT endpoint, phone, p256dh, auth FROM subscriptions WHERE phone = ?'),
    deleteSub: db.prepare('DELETE FROM subscriptions WHERE endpoint = ?'),
    markPush: db.prepare("UPDATE subscriptions SET last_push_at = datetime('now'), last_status = ? WHERE endpoint = ?"),
    countSubs: db.prepare('SELECT COUNT(*) AS n FROM subscriptions'),
    bumpVersion: db.prepare('UPDATE event SET version = version + 1 WHERE id = 1'),
    testMode: db.prepare('SELECT test_mode FROM event WHERE id = 1'),
  };

  if (adminPhone && (q.countAdmins.get() as { n: number }).n === 0) {
    transaction(() => {
      q.ensurePerson.run(adminPhone);
      q.addAdmin.run(adminPhone);
    });
  }
  q.deleteExpiredSessions.run();

  return {
    /** Voor gegevens die nog geen eigen functie hebben (testgegevens, latere fases). */
    raw: db,
    transaction,

    getEvent: () => q.getEvent.get() as unknown as EventRow,
    getPerson: (phone: string) => q.getPerson.get(phone) as PersonRow | undefined,
    isAdmin: (phone: string) => q.isAdmin.get(phone) !== undefined,
    postAssignments: (phone: string) => q.postAssignments.all(phone) as unknown as PostAssignmentRow[],
    unitAssignments: (phone: string) => q.unitAssignments.all(phone) as unknown as UnitAssignmentRow[],
    coreTeamAssignments: (phone: string) => q.coreTeamAssignments.all(phone) as unknown as CoreTeamAssignmentRow[],
    coordinatorPhone: () => (q.coordinatorPhone.get() as { phone: string } | undefined)?.phone ?? null,
    acceptInfo: (phone: string) => { q.acceptInfo.run(phone); },

    createSession: (tokenHash: string, phone: string, userAgent: string | undefined, expiresAt: string) => {
      q.createSession.run(tokenHash, phone, userAgent ?? null, expiresAt);
    },
    getSession: (tokenHash: string) => q.getSession.get(tokenHash) as SessionRow | undefined,
    touchSession: (tokenHash: string) => { q.touchSession.run(tokenHash); },
    deleteSession: (tokenHash: string) => { q.deleteSession.run(tokenHash); },
    logLogin: (phone: string, userAgent: string | undefined, result: 'ok' | 'onbekend') => { q.logLogin.run(phone, userAgent ?? null, result); },

    upsertSubscription: ({ endpoint, keys }: PushSubscriptionData, phone: string, userAgent?: string) => {
      q.upsertSub.run(endpoint, phone, keys.p256dh, keys.auth, userAgent ?? null);
    },
    getSubscription: (endpoint: string) => {
      const row = q.getSub.get(endpoint) as { endpoint: string; phone: string | null; p256dh: string; auth: string } | undefined;
      return row ? { endpoint: row.endpoint, phone: row.phone, keys: { p256dh: row.p256dh, auth: row.auth } } : undefined;
    },
    /** Alle toestellen van één persoon. */
    subscriptionsFor: (phone: string) => (q.subsForPhone.all(phone) as { endpoint: string; p256dh: string; auth: string }[])
      .map((row) => ({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } })),
    deleteSubscription: (endpoint: string) => { q.deleteSub.run(endpoint); },
    markPush: (endpoint: string, status: number) => { q.markPush.run(status, endpoint); },
    countSubscriptions: () => (q.countSubs.get() as { n: number }).n,

    /** Na elke wijziging door een beheerder: telefoons halen dan het nieuwe evenementpakket op. */
    bumpVersion: () => { q.bumpVersion.run(); },

    /** Testmodus: oproepen en aanvragen zijn proef (melding met "Test" ervoor) en komen niet in het rapport. */
    testMode: () => (q.testMode.get() as { test_mode: number }).test_mode === 1,

    close: () => db.close(),
  };
}
