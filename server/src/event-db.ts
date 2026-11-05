// Eén SQLite-bestand per evenement (data/events/<naam>.sqlite).
// Alles over het evenement staat hier; de rest van de server praat alleen met dit EventDb-object.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { recomputePassages } from './gpx.ts';
import { DEFAULT_CORE_TEAM, DEFAULT_HELP_REQUEST_TYPES, DEFAULT_FUNCTION_TYPES, PLAIN_HELP_REQUEST_COLORS, normalizeEmergencyNumber, type HelpRequestType, type LocationContactRole, type PushSubscriptionData, type TeamKind, type TeamMobility } from '@ehbo/shared';

// Elke stap draait één keer; PRAGMA user_version onthoudt tot waar het bestand is bijgewerkt.
// Een stap is SQL, of een functie als de gegevens zelf omgezet moeten worden.
export const MIGRATIONS: (string | ((db: DatabaseSync) => void))[] = [
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
  // 8: "lopen" heet voortaan "hardlopen"; lopen en wandelen zijn in gewone taal hetzelfde.
  `
  UPDATE runs SET discipline = 'hard' || discipline WHERE discipline LIKE 'lopen%';
  `,
  // 9: noodnummers in dezelfde vorm als de andere nummers (+31…, of kort/0900). Wat niet lukt, blijft staan.
  (db) => {
    const update = db.prepare('UPDATE emergency_numbers SET number = ? WHERE id = ?');
    for (const row of db.prepare('SELECT id, number FROM emergency_numbers').all() as { id: number; number: string }[]) {
      const number = normalizeEmergencyNumber(row.number);
      if (number && number !== row.number) update.run(number, row.id);
    }
  },
  // 10: info & voorwaarden hoeven niet meer bevestigd te worden.
  `
  ALTER TABLE people DROP COLUMN info_accepted_at;
  `,
  // 11: availability replaced ehbo_units.status in migration 5; the old column was never read again.
  `
  ALTER TABLE ehbo_units DROP COLUMN status;
  `,
  // 12: km points come from the GPX: every pass of every run. posts.km is now calculated, and hand-entered values are replaced.
  (db) => {
    db.exec(`
      CREATE TABLE post_passages (
        post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        run_id  INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        seq     INTEGER NOT NULL,
        km      REAL NOT NULL,
        PRIMARY KEY (post_id, run_id, seq)
      );
    `);
    // The km points themselves are calculated at the end of migration 25, on the table names of today.
  },
  // 13: km points to the metre, so posts close together keep their order. They're shown with one decimal. Calculated in 25.
  () => {},
  // 14: changes from a phone's queue that have been carried out: sending one again after a lost answer does nothing.
  `
  CREATE TABLE client_actions (
    id TEXT PRIMARY KEY,
    at TEXT NOT NULL
  );
  `,
  // 15: teams get a planned shift like posts. Closing by time: keep_until = "keep open" was pressed, closes_at = the warning went out.
  `
  ALTER TABLE ehbo_units ADD COLUMN time_from TEXT;
  ALTER TABLE ehbo_units ADD COLUMN time_to TEXT;
  ALTER TABLE ehbo_units ADD COLUMN keep_until TEXT;
  ALTER TABLE ehbo_units ADD COLUMN closes_at TEXT;
  ALTER TABLE posts ADD COLUMN keep_until TEXT;
  ALTER TABLE posts ADD COLUMN closes_at TEXT;
  ALTER TABLE posts ADD COLUMN auto_closed_at TEXT;
  `,
  // 16: an EHBO team can start an incident itself. Away from a post it keeps where that was; post_id is then the nearest post, for the report.
  `
  ALTER TABLE incidents ADD COLUMN self_started INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE incidents ADD COLUMN place_name TEXT;
  ALTER TABLE incidents ADD COLUMN place_lat REAL;
  ALTER TABLE incidents ADD COLUMN place_lng REAL;
  `,
  // 17: anyone on staff can ask for help from where they are (#102). The place is kept like a self-started incident, with its accuracy.
  `
  ALTER TABLE incidents ADD COLUMN place_accuracy_m REAL;
  `,
  // 18: how close counts as at a post (#63): a mobile team at its standplaats, a self-started incident, a help request from GPS.
  // 30 m, the same as a post's distance to a route in the GPX.
  `
  ALTER TABLE event ADD COLUMN at_post_m INTEGER NOT NULL DEFAULT 30;
  `,
  // 19: a location has one or more functions (#83). posts.type_id stays as the main function, kept by the server.
  // One lead per location: where there were more, the first stays and the others become members.
  `
  CREATE TABLE post_functions (
    post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    type_id INTEGER NOT NULL REFERENCES post_types(id),
    sort    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (post_id, type_id)
  );
  INSERT INTO post_functions (post_id, type_id) SELECT id, type_id FROM posts;
  UPDATE post_contacts SET role = 'lid'
    WHERE role = 'verantwoordelijke' AND id NOT IN (SELECT MIN(id) FROM post_contacts WHERE role = 'verantwoordelijke' GROUP BY post_id);
  `,
  // 20: AED, toilets and a turnaround, without people (#69). A turnaround belongs to a run. The checkpoint is the stamp post.
  // A new event gets its types after the migrations, so this only adds them to an event that has types already.
  (db) => {
    db.exec(`
      ALTER TABLE post_types ADD COLUMN manned INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE posts ADD COLUMN run_id INTEGER REFERENCES runs(id) ON DELETE SET NULL;
      UPDATE post_types SET name = 'Stempel-/controlepost' WHERE key = 'stempel' AND name = 'Stempelpost';
    `);
    if (!db.prepare('SELECT 1 FROM post_types').get()) return;
    const add = db.prepare(`INSERT INTO post_types (key, name, letter, color, manned, sort)
                            SELECT ?, ?, ?, ?, 0, (SELECT COALESCE(MAX(sort), 0) + 1 FROM post_types) WHERE NOT EXISTS (SELECT 1 FROM post_types WHERE key = ?)`);
    for (const t of DEFAULT_FUNCTION_TYPES.filter((t) => !t.staffed)) add.run(t.key, t.name, t.letter, t.color, t.key);
  },
  // 21: team and contact values in English (docs/begrippen.md). A CHECK can't be altered, so both tables are rebuilt.
  `
  CREATE TABLE ehbo_units_new (
    id           INTEGER PRIMARY KEY,
    name         TEXT NOT NULL,
    kind         TEXT NOT NULL CHECK (kind IN ('fixed', 'mobile')),
    mobility     TEXT CHECK (mobility IN ('on_foot', 'bike', 'car', 'other')),
    post_id      INTEGER REFERENCES posts(id) ON DELETE SET NULL,
    has_aed      INTEGER NOT NULL DEFAULT 0,
    sort         INTEGER NOT NULL DEFAULT 0,
    availability TEXT NOT NULL DEFAULT 'off_duty' CHECK (availability IN ('available', 'unavailable', 'off_duty')),
    stay_post_id INTEGER REFERENCES posts(id) ON DELETE SET NULL,
    time_from    TEXT,
    time_to      TEXT,
    keep_until   TEXT,
    closes_at    TEXT
  );
  INSERT INTO ehbo_units_new (id, name, kind, mobility, post_id, has_aed, sort, availability, stay_post_id, time_from, time_to, keep_until, closes_at)
    SELECT id, name, CASE kind WHEN 'vast' THEN 'fixed' ELSE 'mobile' END,
           CASE mobility WHEN 'te_voet' THEN 'on_foot' WHEN 'fiets' THEN 'bike' WHEN 'auto' THEN 'car' WHEN 'anders' THEN 'other' END,
           post_id, has_aed, sort, CASE availability WHEN 'vrij' THEN 'available' WHEN 'pauze' THEN 'unavailable' ELSE 'off_duty' END,
           stay_post_id, time_from, time_to, keep_until, closes_at
    FROM ehbo_units;
  DROP TABLE ehbo_units;
  ALTER TABLE ehbo_units_new RENAME TO ehbo_units;

  CREATE TABLE post_contacts_new (
    id        INTEGER PRIMARY KEY,
    post_id   INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    phone     TEXT NOT NULL REFERENCES people(phone) ON UPDATE CASCADE,
    role      TEXT NOT NULL CHECK (role IN ('lead', 'member', 'reserve')),
    time_from TEXT,
    time_to   TEXT
  );
  INSERT INTO post_contacts_new (id, post_id, phone, role, time_from, time_to)
    SELECT id, post_id, phone, CASE role WHEN 'verantwoordelijke' THEN 'lead' WHEN 'lid' THEN 'member' ELSE 'reserve' END, time_from, time_to
    FROM post_contacts;
  DROP TABLE post_contacts;
  ALTER TABLE post_contacts_new RENAME TO post_contacts;
  `,
  // 22: an EHBO unit is a team (docs/begrippen.md). SQLite moves the references in other tables along with the table.
  `
  ALTER TABLE ehbo_units RENAME TO teams;
  ALTER TABLE ehbo_unit_members RENAME TO team_members;
  ALTER TABLE team_members RENAME COLUMN unit_id TO team_id;
  ALTER TABLE incidents RENAME COLUMN unit_id TO team_id;
  ALTER TABLE incident_dispatches RENAME COLUMN unit_id TO team_id;
  ALTER TABLE incident_events RENAME COLUMN unit_id TO team_id;
  `,
  // 23: one help request with a type (#86). What a location asks for is a help request; its type says how it's handled:
  // dispatch (to a team: an incident) or queue (to the coordinator: water, traffic, volunteer). What only incidents have is in
  // dispatch_details. Values become English (docs/begrippen.md). Incidents keep their id; requests move up by 1,000,000, so a
  // phone can convert the ids it kept. The views incidents and queue_requests read them the way the code did.
  `
  CREATE TABLE help_request_types (
    id       INTEGER PRIMARY KEY,
    key      TEXT NOT NULL UNIQUE,
    name     TEXT NOT NULL,
    handling TEXT NOT NULL CHECK (handling IN ('dispatch', 'queue')),
    sort     INTEGER NOT NULL DEFAULT 0
  );
  INSERT INTO help_request_types (key, name, handling, sort) VALUES
    ('first_aid', 'EHBO', 'dispatch', 0), ('water', 'Water', 'queue', 1), ('traffic', 'Verkeer', 'queue', 2), ('volunteer', 'Vrijwilliger', 'queue', 3);

  CREATE TABLE help_requests (
    id               INTEGER PRIMARY KEY,
    client_id        TEXT NOT NULL UNIQUE,
    type_id          INTEGER NOT NULL REFERENCES help_request_types(id),
    post_id          INTEGER NOT NULL REFERENCES posts(id),
    reported_by      TEXT NOT NULL,
    status           TEXT NOT NULL CHECK (status IN ('sent', 'accepted', 'on_site', 'closed', 'withdrawn')),
    detail           TEXT,
    is_test          INTEGER NOT NULL DEFAULT 0,
    reported_at      TEXT NOT NULL,
    accepted_at      TEXT,
    accepted_by      TEXT,
    closed_at        TEXT,
    place_name       TEXT,
    place_lat        REAL,
    place_lng        REAL,
    place_accuracy_m REAL
  );
  CREATE TABLE dispatch_details (
    help_request_id INTEGER PRIMARY KEY REFERENCES help_requests(id) ON DELETE CASCADE,
    what            TEXT,
    persons         TEXT,
    responsive      TEXT,
    note            TEXT,
    aed             INTEGER NOT NULL DEFAULT 0,
    stage           TEXT NOT NULL CHECK (stage IN ('nearest', 'all')),
    sent_at         TEXT NOT NULL,
    escalates_at    TEXT,
    team_id         INTEGER REFERENCES teams(id) ON DELETE SET NULL,
    on_site_at      TEXT,
    outcome         TEXT,
    outcome_persons TEXT,
    outcome_note    TEXT,
    self_started    INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE dispatches (
    help_request_id INTEGER NOT NULL REFERENCES help_requests(id) ON DELETE CASCADE,
    team_id         INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    at              TEXT NOT NULL,
    reason          TEXT NOT NULL CHECK (reason IN ('nearest', 'aed', 'all', 'manual')),
    distance_km     REAL,
    declined_at     TEXT,
    accepted_at     TEXT,
    PRIMARY KEY (help_request_id, team_id)
  );
  CREATE TABLE help_request_events (
    id              INTEGER PRIMARY KEY,
    help_request_id INTEGER NOT NULL REFERENCES help_requests(id) ON DELETE CASCADE,
    at              TEXT NOT NULL,
    type            TEXT NOT NULL,
    team_id         INTEGER,
    text            TEXT NOT NULL
  );

  INSERT INTO help_requests (id, client_id, type_id, post_id, reported_by, status, is_test, reported_at, accepted_at, accepted_by, closed_at,
                             place_name, place_lat, place_lng, place_accuracy_m)
    SELECT id, client_id, (SELECT id FROM help_request_types WHERE key = 'first_aid'), post_id, reported_by,
           CASE status WHEN 'verstuurd' THEN 'sent' WHEN 'geaccepteerd' THEN 'accepted' WHEN 'ter_plaatse' THEN 'on_site' WHEN 'afgerond' THEN 'closed' ELSE 'withdrawn' END,
           is_test, reported_at, accepted_at, accepted_by, closed_at, place_name, place_lat, place_lng, place_accuracy_m
    FROM incidents;
  INSERT INTO dispatch_details (help_request_id, what, persons, responsive, note, aed, stage, sent_at, escalates_at, team_id, on_site_at,
                                outcome, outcome_persons, outcome_note, self_started)
    SELECT id,
           CASE what WHEN 'onwel' THEN 'unwell' WHEN 'letsel' THEN 'injury' WHEN 'kramp' THEN 'cramp' WHEN 'onbekend' THEN 'unknown' END,
           persons, CASE responsive WHEN 'ja' THEN 'yes' WHEN 'nee' THEN 'no' WHEN 'onbekend' THEN 'unknown' END,
           note, aed, CASE stage WHEN 'alle' THEN 'all' ELSE 'nearest' END, sent_at, escalates_at, team_id, on_site_at,
           CASE outcome WHEN 'geholpen' THEN 'treated' WHEN 'gestopt' THEN 'stopped' WHEN 'ambulance' THEN 'ambulance' WHEN 'doorverwezen' THEN 'referred'
                        WHEN 'geweigerd' THEN 'refused' WHEN 'loos' THEN 'false_alarm' END,
           outcome_persons, outcome_note, self_started
    FROM incidents;
  INSERT INTO dispatches (help_request_id, team_id, at, reason, distance_km, declined_at, accepted_at)
    SELECT incident_id, team_id, at, CASE reason WHEN 'dichtstbij' THEN 'nearest' WHEN 'alle' THEN 'all' WHEN 'handmatig' THEN 'manual' ELSE 'aed' END,
           distance_km, declined_at, accepted_at
    FROM incident_dispatches;
  INSERT INTO help_request_events (id, help_request_id, at, type, team_id, text)
    SELECT id, incident_id, at,
           CASE type WHEN 'gemeld' THEN 'reported' WHEN 'verstuurd' THEN 'sent' WHEN 'aangevuld' THEN 'added' WHEN 'geweigerd' THEN 'declined'
                     WHEN 'geescaleerd' THEN 'escalated' WHEN 'herhaald' THEN 'repeated' WHEN 'geaccepteerd' THEN 'accepted' WHEN 'toegewezen' THEN 'assigned'
                     WHEN 'ter_plaatse' THEN 'on_site' WHEN 'afgerond' THEN 'closed' WHEN 'ingetrokken' THEN 'withdrawn' ELSE type END,
           team_id, text
    FROM incident_events;
  INSERT INTO help_requests (id, client_id, type_id, post_id, reported_by, status, detail, is_test, reported_at, accepted_at, accepted_by, closed_at)
    SELECT r.id + 1000000, r.client_id, t.id, r.post_id, r.reported_by,
           CASE r.status WHEN 'aangevraagd' THEN 'sent' WHEN 'opgepakt' THEN 'accepted' WHEN 'afgehandeld' THEN 'closed' ELSE 'withdrawn' END,
           CASE r.detail WHEN 'beetje' THEN 'little' WHEN 'flink' THEN 'lots' WHEN 'bijna_op' THEN 'almost_empty' WHEN 'druk' THEN 'busy' WHEN 'onveilig' THEN 'unsafe'
                         WHEN 'afzetting' THEN 'closure' WHEN 'aflossing' THEN 'relief' WHEN 'uitval' THEN 'dropout' ELSE r.detail END,
           r.is_test, r.created_at, r.picked_at, r.picked_by, r.done_at
    FROM requests r JOIN help_request_types t ON t.key = CASE r.kind WHEN 'verkeer' THEN 'traffic' WHEN 'vrijwilliger' THEN 'volunteer' ELSE r.kind END;
  DROP TABLE incident_events;
  DROP TABLE incident_dispatches;
  DROP TABLE incidents;
  DROP TABLE requests;

  CREATE VIEW incidents AS
    SELECT h.id, h.client_id, h.post_id, h.reported_by, h.status, h.is_test, h.reported_at, h.accepted_at, h.accepted_by, h.closed_at,
           h.place_name, h.place_lat, h.place_lng, h.place_accuracy_m, d.what, d.persons, d.responsive, d.note, d.aed, d.stage, d.sent_at,
           d.escalates_at, d.team_id, d.on_site_at, d.outcome, d.outcome_persons, d.outcome_note, d.self_started
    FROM help_requests h JOIN dispatch_details d ON d.help_request_id = h.id;
  CREATE VIEW queue_requests AS
    SELECT h.id, h.client_id, h.post_id, t.key AS kind, h.detail, h.status, h.reported_by, h.reported_at AS created_at,
           h.accepted_at AS picked_at, h.accepted_by AS picked_by, h.closed_at AS done_at, h.is_test
    FROM help_requests h JOIN help_request_types t ON t.id = h.type_id
    WHERE t.handling = 'queue';
  `,
  // 24: a help request type says what it looks like too (#86): subtitle, question, choices, icon and colours. They were in the code.
  // The view of incidents gets the type, now that an incident can be of any dispatch type.
  (db) => {
    db.exec(`
      ALTER TABLE help_request_types ADD COLUMN sub TEXT;
      ALTER TABLE help_request_types ADD COLUMN ask TEXT;
      ALTER TABLE help_request_types ADD COLUMN choices_json TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE help_request_types ADD COLUMN icon TEXT NOT NULL DEFAULT 'more';
      ALTER TABLE help_request_types ADD COLUMN colors_json TEXT NOT NULL DEFAULT '{}';
      DROP VIEW incidents;
      CREATE VIEW incidents AS
        SELECT h.id, t.key AS type, h.client_id, h.post_id, h.reported_by, h.status, h.is_test, h.reported_at, h.accepted_at, h.accepted_by, h.closed_at,
               h.place_name, h.place_lat, h.place_lng, h.place_accuracy_m, d.what, d.persons, d.responsive, d.note, d.aed, d.stage, d.sent_at,
               d.escalates_at, d.team_id, d.on_site_at, d.outcome, d.outcome_persons, d.outcome_note, d.self_started
        FROM help_requests h JOIN dispatch_details d ON d.help_request_id = h.id JOIN help_request_types t ON t.id = h.type_id;
    `);
    const set = db.prepare('UPDATE help_request_types SET name = ?, sub = ?, ask = ?, choices_json = ?, icon = ?, colors_json = ? WHERE key = ?');
    for (const t of DEFAULT_HELP_REQUEST_TYPES) set.run(t.name, t.sub, t.ask, JSON.stringify(t.choices), t.icon, JSON.stringify(t.colors), t.key);
  },
  // 25: a post is a location, a post type a function type, a passage a km point, and manned is staffed (#84, docs/begrippen.md).
  // SQLite moves foreign keys and indexes along with a renamed table or column; the two views are made again on the new names.
  // The keys of the functions are English. The km points are calculated again, for a file from before migration 12.
  (db) => {
    db.exec(`
  DROP VIEW incidents;
  DROP VIEW queue_requests;
  ALTER TABLE posts RENAME TO locations;
  ALTER TABLE post_types RENAME TO function_types;
  ALTER TABLE function_types RENAME COLUMN manned TO staffed;
  ALTER TABLE post_functions RENAME TO location_functions;
  ALTER TABLE location_functions RENAME COLUMN post_id TO location_id;
  ALTER TABLE post_contacts RENAME TO location_contacts;
  ALTER TABLE location_contacts RENAME COLUMN post_id TO location_id;
  ALTER TABLE post_passages RENAME TO km_points;
  ALTER TABLE km_points RENAME COLUMN post_id TO location_id;
  ALTER TABLE teams RENAME COLUMN post_id TO location_id;
  ALTER TABLE teams RENAME COLUMN stay_post_id TO stay_location_id;
  ALTER TABLE help_requests RENAME COLUMN post_id TO location_id;
  ALTER TABLE event RENAME COLUMN at_post_m TO at_location_m;
  UPDATE function_types SET key = CASE key
    WHEN 'stempel' THEN 'stamp' WHEN 'verkeer' THEN 'traffic' WHEN 'keerpunt' THEN 'turnaround' WHEN 'anders' THEN 'other' WHEN 'ehbo' THEN 'first_aid' ELSE key END;
  CREATE VIEW incidents AS
    SELECT h.id, t.key AS type, h.client_id, h.location_id, h.reported_by, h.status, h.is_test, h.reported_at, h.accepted_at, h.accepted_by, h.closed_at,
           h.place_name, h.place_lat, h.place_lng, h.place_accuracy_m, d.what, d.persons, d.responsive, d.note, d.aed, d.stage, d.sent_at,
           d.escalates_at, d.team_id, d.on_site_at, d.outcome, d.outcome_persons, d.outcome_note, d.self_started
    FROM help_requests h JOIN dispatch_details d ON d.help_request_id = h.id JOIN help_request_types t ON t.id = h.type_id;
  CREATE VIEW queue_requests AS
    SELECT h.id, h.client_id, h.location_id, t.key AS kind, h.detail, h.status, h.reported_by, h.reported_at AS created_at,
           h.accepted_at AS picked_at, h.accepted_by AS picked_by, h.closed_at AS done_at, h.is_test
    FROM help_requests h JOIN help_request_types t ON t.id = h.type_id
    WHERE t.handling = 'queue';
    `);
    recomputePassages(db);
  },
  // 26: the status a team picked during a call, carried out once the call is over.
  `ALTER TABLE teams ADD COLUMN next_availability TEXT CHECK (next_availability IN ('unavailable', 'off_duty'));`,
  // 27: a waiting call goes to a team other than its own (the nearest) only after this many minutes.
  `ALTER TABLE event ADD COLUMN share_after_min INTEGER NOT NULL DEFAULT 5;`,
  // 28: zones on the map for parking and food (#172); the points as JSON [[lng, lat], …].
  `CREATE TABLE zones (
    id          INTEGER PRIMARY KEY,
    kind        TEXT NOT NULL CHECK (kind IN ('parking', 'food')),
    shape       TEXT NOT NULL CHECK (shape IN ('strip', 'area')),
    name        TEXT NOT NULL,
    note        TEXT,
    points_json TEXT NOT NULL,
    sort        INTEGER NOT NULL DEFAULT 0
  );`,
  // 29: the code of the briefing for logging in; NULL is the day of the event, '' is none.
  `ALTER TABLE event ADD COLUMN login_code TEXT;`,
  // 30: a zone is always an area: a strip becomes a narrow area along the same road, as wide as it was drawn close by.
  (db: DatabaseSync) => {
    const strips = db.prepare("SELECT id, points_json FROM zones WHERE shape = 'strip'").all() as { id: number; points_json: string }[];
    const save = db.prepare('UPDATE zones SET points_json = ? WHERE id = ?');
    for (const z of strips) save.run(JSON.stringify(stripToArea(JSON.parse(z.points_json) as [number, number][], STRIP_WIDTH_M)), z.id);
    db.exec('ALTER TABLE zones DROP COLUMN shape');
  },
];

/** How wide a strip was on the map close by, about a road. */
const STRIP_WIDTH_M = 12;

/** A line as a band of this width: one side out, the other side back. In metres around the first point, which is precise enough for a street. */
export function stripToArea(line: [number, number][], widthM: number): [number, number][] {
  if (line.length < 2) return line;
  const lat0 = line[0]![1];
  const mx = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  const my = 110_540;
  const xy = line.map(([lng, lat]) => [lng * mx, lat * my] as const);
  const half = widthM / 2;
  const side = (sign: number) => xy.map(([x, y], i) => {
    // The direction at a point: from the point before to the point after.
    const [ax, ay] = xy[Math.max(0, i - 1)]!;
    const [bx, by] = xy[Math.min(xy.length - 1, i + 1)]!;
    const length = Math.hypot(bx - ax, by - ay) || 1;
    const nx = -(by - ay) / length;
    const ny = (bx - ax) / length;
    const round = (v: number) => Math.round(v * 1e6) / 1e6;
    return [round((x + sign * half * nx) / mx), round((y + sign * half * ny) / my)] as [number, number];
  });
  return [...side(1), ...side(-1).reverse()];
}

export interface EventRow {
  name: string;
  start_date: string | null;
  end_date: string | null;
  escalation_seconds: number;
  info_json: string | null;
  info_policy: string | null;
  info_contact: string | null;
  login_code: string | null;
}

export interface PersonRow {
  phone: string;
  name: string;
}

export interface LocationAssignmentRow {
  location_id: number;
  location_name: string;
  km: number | null;
  role: LocationContactRole;
  time_from: string | null;
  time_to: string | null;
  type_key: string | null;
  type_letter: string;
  type_color: string;
  person_label: string | null;
}

export interface TeamAssignmentRow {
  team_id: number;
  team_name: string;
  kind: TeamKind;
  mobility: TeamMobility | null;
  time_from: string | null;
  time_to: string | null;
  location_name: string | null;
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

  // Nests: only the outermost one commits, and an error anywhere rolls all of it back (an import is all or nothing).
  let depth = 0;
  const transaction = <T>(fn: () => T): T => {
    if (depth > 0) {
      depth++;
      try {
        return fn();
      } finally {
        depth--;
      }
    }
    db.exec('BEGIN');
    depth = 1;
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    } finally {
      depth = 0;
    }
  };

  const version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  if (version < MIGRATIONS.length) db.exec('PRAGMA foreign_keys = OFF');
  for (let i = version; i < MIGRATIONS.length; i++) {
    transaction(() => {
      const step = MIGRATIONS[i]!;
      if (typeof step === 'string') db.exec(step);
      else step(db);
      db.exec(`PRAGMA user_version = ${i + 1}`);
    });
  }
  if (version < MIGRATIONS.length) {
    const broken = db.prepare('PRAGMA foreign_key_check').all();
    if (broken.length) throw new Error(`Migratie laat verwijzingen achter die niet kloppen: ${JSON.stringify(broken.slice(0, 5))}`);
    db.exec('PRAGMA foreign_keys = ON');
  }

  // Nieuw evenement: standaardsoorten posten en het voorgestelde kernteam.
  if (!db.prepare('SELECT 1 FROM event').get()) {
    transaction(() => {
      db.prepare('INSERT INTO event (id, name) VALUES (1, ?)').run(name);
      const type = db.prepare('INSERT INTO function_types (key, name, letter, color, person_label, staffed, sort) VALUES (?, ?, ?, ?, ?, ?, ?)');
      DEFAULT_FUNCTION_TYPES.forEach((t, i) => type.run(t.key, t.name, t.letter, t.color, 'personLabel' in t ? t.personLabel : null, t.staffed ? 1 : 0, i));
      const core = db.prepare('INSERT INTO core_team (function, is_coordinator, sort) VALUES (?, ?, ?)');
      DEFAULT_CORE_TEAM.forEach((f, i) => core.run(f, i === 0 ? 1 : 0, i));
    });
  }

  // De eerste beheerder komt uit de serverinstellingen, alleen zolang er nog geen beheerder is.
  const q = {
    countAdmins: db.prepare('SELECT COUNT(*) AS n FROM admins'),
    ensurePerson: db.prepare('INSERT INTO people (phone) VALUES (?) ON CONFLICT(phone) DO NOTHING'),
    addAdmin: db.prepare('INSERT INTO admins (phone) VALUES (?) ON CONFLICT(phone) DO NOTHING'),
    getEvent: db.prepare('SELECT name, start_date, end_date, escalation_seconds, info_json, info_policy, info_contact, login_code FROM event WHERE id = 1'),
    getPerson: db.prepare('SELECT phone, name FROM people WHERE phone = ?'),
    isAdmin: db.prepare('SELECT 1 FROM admins WHERE phone = ?'),
    locationAssignments: db.prepare(`
      SELECT p.id AS location_id, p.name AS location_name, p.km, c.role,
             COALESCE(c.time_from, p.time_from) AS time_from, COALESCE(c.time_to, p.time_to) AS time_to,
             t.key AS type_key, t.letter AS type_letter, t.color AS type_color, t.person_label
      FROM location_contacts c JOIN locations p ON p.id = c.location_id JOIN function_types t ON t.id = p.type_id
      WHERE c.phone = ? ORDER BY COALESCE(c.time_from, p.time_from), p.sort, p.id`),
    teamAssignments: db.prepare(`
      SELECT u.id AS team_id, u.name AS team_name, u.kind, u.mobility, u.time_from, u.time_to, p.name AS location_name
      FROM team_members m JOIN teams u ON u.id = m.team_id LEFT JOIN locations p ON p.id = u.location_id
      WHERE m.phone = ? ORDER BY u.sort, u.id`),
    coreTeamAssignments: db.prepare('SELECT function, is_coordinator FROM core_team WHERE phone = ? ORDER BY sort, id'),
    coordinatorPhone: db.prepare('SELECT phone FROM core_team WHERE is_coordinator = 1 AND phone IS NOT NULL ORDER BY sort, id LIMIT 1'),
    createSession: db.prepare('INSERT INTO sessions (token_hash, phone, user_agent, expires_at) VALUES (?, ?, ?, ?)'),
    getSession: db.prepare("SELECT phone, expires_at FROM sessions WHERE token_hash = ? AND expires_at > datetime('now')"),
    touchSession: db.prepare("UPDATE sessions SET last_seen_at = datetime('now') WHERE token_hash = ?"),
    deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    deleteExpiredSessions: db.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now') RETURNING phone"),
    deleteOtherSessions: db.prepare('DELETE FROM sessions WHERE token_hash IS NOT ? RETURNING phone'),
    deleteSessionsFor: db.prepare('DELETE FROM sessions WHERE phone = ?'),
    shortenSessions: db.prepare('UPDATE sessions SET expires_at = ? WHERE expires_at > ?'),
    hasSession: db.prepare("SELECT 1 FROM sessions WHERE phone = ? AND expires_at > datetime('now')"),
    loggedIn: db.prepare("SELECT DISTINCT phone FROM sessions WHERE expires_at > datetime('now')"),
    countSessions: db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE expires_at > datetime('now')"),
    logLogin: db.prepare('INSERT INTO login_log (phone, user_agent, result) VALUES (?, ?, ?)'),
    upsertSub: db.prepare(`
      INSERT INTO subscriptions (endpoint, phone, p256dh, auth, user_agent) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(endpoint) DO UPDATE SET phone = excluded.phone, p256dh = excluded.p256dh, auth = excluded.auth,
        user_agent = excluded.user_agent, last_seen_at = datetime('now')`),
    getSub: db.prepare('SELECT endpoint, phone, p256dh, auth FROM subscriptions WHERE endpoint = ?'),
    subsForPhone: db.prepare('SELECT endpoint, phone, p256dh, auth FROM subscriptions WHERE phone = ?'),
    deleteSub: db.prepare('DELETE FROM subscriptions WHERE endpoint = ?'),
    deleteSubsForPhone: db.prepare('DELETE FROM subscriptions WHERE phone = ?'),
    markPush: db.prepare("UPDATE subscriptions SET last_push_at = datetime('now'), last_status = ? WHERE endpoint = ?"),
    countSubs: db.prepare('SELECT COUNT(*) AS n FROM subscriptions'),
    bumpVersion: db.prepare('UPDATE event SET version = version + 1 WHERE id = 1'),
    dataVersion: db.prepare('SELECT version, map_version FROM event WHERE id = 1'),
    testMode: db.prepare('SELECT test_mode FROM event WHERE id = 1'),
    helpRequestTypes: db.prepare('SELECT key, name, handling, sub, ask, choices_json, icon, colors_json FROM help_request_types ORDER BY sort, id'),
  };

  if (adminPhone && (q.countAdmins.get() as { n: number }).n === 0) {
    transaction(() => {
      q.ensurePerson.run(adminPhone);
      q.addAdmin.run(adminPhone);
    });
  }

  return {
    /** Voor gegevens die nog geen eigen functie hebben (testgegevens, latere fases). */
    raw: db,
    transaction,

    getEvent: () => q.getEvent.get() as unknown as EventRow,
    getPerson: (phone: string) => q.getPerson.get(phone) as PersonRow | undefined,
    isAdmin: (phone: string) => q.isAdmin.get(phone) !== undefined,
    locationAssignments: (phone: string) => q.locationAssignments.all(phone) as unknown as LocationAssignmentRow[],
    teamAssignments: (phone: string) => q.teamAssignments.all(phone) as unknown as TeamAssignmentRow[],
    coreTeamAssignments: (phone: string) => q.coreTeamAssignments.all(phone) as unknown as CoreTeamAssignmentRow[],
    coordinatorPhone: () => (q.coordinatorPhone.get() as { phone: string } | undefined)?.phone ?? null,

    createSession: (tokenHash: string, phone: string, userAgent: string | undefined, expiresAt: string) => {
      q.createSession.run(tokenHash, phone, userAgent ?? null, expiresAt);
    },
    getSession: (tokenHash: string) => q.getSession.get(tokenHash) as SessionRow | undefined,
    touchSession: (tokenHash: string) => { q.touchSession.run(tokenHash); },
    deleteSession: (tokenHash: string) => { q.deleteSession.run(tokenHash); },
    logLogin: (phone: string, userAgent: string | undefined, result: 'ok' | 'onbekend') => { q.logLogin.run(phone, userAgent ?? null, result); },
    /** Removes the sessions that ran out and gives their numbers; the server then closes what nobody is logged in for. */
    deleteExpiredSessions: () => (q.deleteExpiredSessions.all() as { phone: string }[]).map((r) => r.phone),
    /** Iedereen afmelden: every session except this one. Gives the numbers that were logged out. */
    deleteOtherSessions: (keepHash: string | null) => (q.deleteOtherSessions.all(keepHash) as { phone: string }[]).map((r) => r.phone),
    /** Logging out: every device of this number, so a forgotten session can't keep a location open. */
    deleteSessionsFor: (phone: string) => { q.deleteSessionsFor.run(phone); },
    /** No session lasts beyond this time (test mode: midnight). */
    shortenSessions: (expiresAt: string) => { q.shortenSessions.run(expiresAt, expiresAt); },
    hasSession: (phone: string) => q.hasSession.get(phone) !== undefined,
    /** Numbers with at least one device logged in. */
    loggedIn: () => new Set((q.loggedIn.all() as { phone: string }[]).map((r) => r.phone)),
    countSessions: () => (q.countSessions.get() as { n: number }).n,

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
    deleteSubscriptionsFor: (phone: string) => { q.deleteSubsForPhone.run(phone); },
    markPush: (endpoint: string, status: number) => { q.markPush.run(status, endpoint); },
    countSubscriptions: () => (q.countSubs.get() as { n: number }).n,

    /** Na elke wijziging door een beheerder: telefoons halen dan het nieuwe evenementpakket op. */
    bumpVersion: () => { q.bumpVersion.run(); },
    /** Version of everything in the event package; also the start of the package version. */
    dataVersion: () => {
      const { version, map_version } = q.dataVersion.get() as { version: number; map_version: number };
      return `${version}.${map_version}`;
    },

    /** Testmodus: oproepen en aanvragen zijn proef (melding met "Test" ervoor) en komen niet in het rapport. */
    testMode: () => (q.testMode.get() as { test_mode: number }).test_mode === 1,

    /** What a location can ask for (#86): the rows of help_request_types. */
    helpRequestTypes: (): HelpRequestType[] => (q.helpRequestTypes.all() as Record<string, string>[]).map((t) => ({
      key: t.key!, name: t.name!, handling: t.handling as HelpRequestType['handling'], sub: t.sub ?? null, ask: t.ask ?? null,
      choices: JSON.parse(t.choices_json!), icon: t.icon!, colors: { ...PLAIN_HELP_REQUEST_COLORS, ...JSON.parse(t.colors_json!) },
    })),

    close: () => db.close(),
  };
}
