// Opslag in SQLite via de ingebouwde node:sqlite-module (geen externe pakketten).
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export function openDb(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'app.sqlite'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS subscriptions (
      endpoint     TEXT PRIMARY KEY,
      p256dh       TEXT NOT NULL,
      auth         TEXT NOT NULL,
      user_agent   TEXT,
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_push_at TEXT,
      last_status  INTEGER
    );
  `);

  const q = {
    getSetting: db.prepare('SELECT value FROM settings WHERE key = ?'),
    setSetting: db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),
    upsertSub: db.prepare(`
      INSERT INTO subscriptions (endpoint, p256dh, auth, user_agent) VALUES (?, ?, ?, ?)
      ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth,
        user_agent = excluded.user_agent, last_seen_at = datetime('now')`),
    getSub: db.prepare('SELECT * FROM subscriptions WHERE endpoint = ?'),
    deleteSub: db.prepare('DELETE FROM subscriptions WHERE endpoint = ?'),
    markPush: db.prepare("UPDATE subscriptions SET last_push_at = datetime('now'), last_status = ? WHERE endpoint = ?"),
    countSubs: db.prepare('SELECT COUNT(*) AS n FROM subscriptions'),
  };

  return {
    getSetting: (key) => q.getSetting.get(key)?.value,
    setSetting: (key, value) => q.setSetting.run(key, value),
    upsertSubscription: ({ endpoint, keys }, userAgent) => q.upsertSub.run(endpoint, keys.p256dh, keys.auth, userAgent ?? null),
    getSubscription: (endpoint) => {
      const row = q.getSub.get(endpoint);
      return row ? { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth }, row } : undefined;
    },
    deleteSubscription: (endpoint) => q.deleteSub.run(endpoint),
    markPush: (endpoint, status) => q.markPush.run(status, endpoint),
    countSubscriptions: () => q.countSubs.get().n,
    close: () => db.close(),
  };
}
