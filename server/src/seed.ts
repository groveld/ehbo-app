// npm run seed: vult het lokale evenement (data/events/<EVENT>.sqlite) met verzonnen gegevens.
import { config } from './config.ts';
import { DEMO, seedDemo } from './demo.ts';
import { openEventDb } from './event-db.ts';

const db = openEventDb(config.dataDir, config.event, { name: 'Silvesterloop 2026' });
if (db.raw.prepare('SELECT 1 FROM posts').get()) {
  console.log(`${config.event} heeft al posten; er is niets toegevoegd. Verwijder data/events/${config.event}.sqlite om opnieuw te beginnen.`);
} else {
  seedDemo(db);
  console.log(`Testgegevens toegevoegd aan ${config.event}. Aanmelden kan met:`);
  for (const [role, phone] of Object.entries(DEMO)) console.log(`  ${role.padEnd(12)} 0${phone.slice(3)}`);
}
db.close();
