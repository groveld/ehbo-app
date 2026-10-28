// Server voor de end-to-end-test: een tijdelijk evenement met de testgegevens, en de gebouwde webapp (npm run build).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../server/src/app.ts';
import { seedDemo } from '../server/src/demo.ts';
import { openEventDb } from '../server/src/event-db.ts';
import { generateVapidKeys } from '../server/src/webpush.ts';

export const E2E_PORT = 3090;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ehbo-e2e-'));
const db = openEventDb(dir, 'e2e', { name: 'Silvesterloop 2026' });
seedDemo(db);

const app = buildApp({
  db,
  vapid: { ...generateVapidKeys(), subject: 'mailto:e2e@example.org' },
  build: { version: 'e2e', commit: 'e2e', builtAt: '' },
  webDir: path.join(root, 'web', 'dist'),
});
app.addHook('onClose', async () => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
await app.listen({ port: E2E_PORT, host: '127.0.0.1' });

for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => void app.close().then(() => process.exit(0)));
