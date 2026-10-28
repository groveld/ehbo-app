// EHBO Evenementen-app: server starten.
import { buildApp } from './app.ts';
import { config } from './config.ts';
import { openAppDb, type AppDb } from './db.ts';
import { openEventDb } from './event-db.ts';
import { generateVapidKeys, type VapidKeys } from './webpush.ts';

function loadVapid(db: AppDb): VapidKeys & { source: string } {
  let publicKey = process.env.VAPID_PUBLIC_KEY;
  let privateKey = process.env.VAPID_PRIVATE_KEY;
  if (publicKey && privateKey) return { publicKey, privateKey, source: 'omgevingsvariabelen' };
  publicKey = db.getSetting('vapid_public_key');
  privateKey = db.getSetting('vapid_private_key');
  if (publicKey && privateKey) return { publicKey, privateKey, source: 'database' };
  const keys = generateVapidKeys();
  db.setSetting('vapid_public_key', keys.publicKey);
  db.setSetting('vapid_private_key', keys.privateKey);
  return { ...keys, source: 'nieuw aangemaakt' };
}

const appDb = openAppDb(config.dataDir);
const keys = loadVapid(appDb);
const eventName = config.event.charAt(0).toUpperCase() + config.event.slice(1);
const db = openEventDb(config.dataDir, config.event, { name: eventName, adminPhone: config.adminPhone });

const app = buildApp({
  db,
  vapid: { publicKey: keys.publicKey, privateKey: keys.privateKey, subject: config.vapidSubject || 'mailto:beheer@example.org' },
  build: { version: config.version, commit: config.commit, builtAt: config.builtAt },
  webDir: config.webDir,
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
});
app.addHook('onClose', async () => {
  db.close();
  appDb.close();
});

if (!config.vapidSubject) app.log.warn('VAPID_SUBJECT is niet ingesteld (bijv. mailto:beheer@jouwdomein.nl). Apple weigert dan meldingen.');
if (!config.adminPhone) app.log.warn('ADMIN_PHONE is niet ingesteld. Zonder beheerder kan niemand het evenement inrichten.');

await app.listen({ port: config.port, host: config.host });
app.log.info(`EHBO-app ${config.version} (${config.commit.slice(0, 7)}); evenement ${config.event}; data in ${config.dataDir}; VAPID-sleutels: ${keys.source}`);

// Docker stuurt SIGTERM bij stoppen en bijwerken: netjes afsluiten, zodat de database dicht is.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    app.log.info(`${signal}: stoppen`);
    setTimeout(() => process.exit(0), 5000).unref();
    app.close().then(() => process.exit(0));
  });
}
