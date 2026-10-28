// Instellingen van de server zelf (data/app.sqlite), los van de evenementen. Nu alleen de VAPID-sleutels.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export interface AppDb {
  getSetting(key: string): string | undefined;
  setSetting(key: string, value: string): void;
  close(): void;
}

export function openAppDb(dataDir: string): AppDb {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'app.sqlite'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    -- Push-abonnementen staan sinds fase 2 in het evenementbestand, gekoppeld aan een medewerker.
    DROP TABLE IF EXISTS subscriptions;
  `);

  const q = {
    getSetting: db.prepare('SELECT value FROM settings WHERE key = ?'),
    setSetting: db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),
  };

  return {
    getSetting: (key) => (q.getSetting.get(key) as { value: string } | undefined)?.value,
    setSetting: (key, value) => { q.setSetting.run(key, value); },
    close: () => db.close(),
  };
}
