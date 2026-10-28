// Verzonnen gegevens om lokaal en in tests mee te werken. Alle nummers zijn nep (06-0000 xxxx bestaat niet).
import type { EventDb } from './event-db.ts';

export const DEMO = {
  admin: '+31600000001',
  coordinator: '+31600000002',
  ehbo: '+31600000003',
  postLead: '+31600000004',
  postMember: '+31600000005',
  mobileEhbo: '+31600000006',
} as const;

/** Vult een leeg evenement met een paar posten, twee EHBO-eenheden en het kernteam. */
export function seedDemo(db: EventDb) {
  const sql = db.raw;
  db.transaction(() => {
    sql.prepare(`UPDATE event SET name = 'Silvesterloop 2026', start_date = '2026-12-31', end_date = '2026-12-31',
      start_location = 'Eetcafé De Trilker, Poppenwier' WHERE id = 1`).run();

    const person = sql.prepare('INSERT INTO people (phone, name) VALUES (?, ?) ON CONFLICT(phone) DO UPDATE SET name = excluded.name');
    person.run(DEMO.admin, 'Bea Beheer');
    person.run(DEMO.coordinator, 'Cor Coördinator');
    person.run(DEMO.ehbo, 'Eva EHBO');
    person.run(DEMO.postLead, 'Wim Water');
    person.run(DEMO.postMember, 'Vera Verkeer');
    person.run(DEMO.mobileEhbo, 'Mo Mobiel');
    sql.prepare('INSERT INTO admins (phone) VALUES (?) ON CONFLICT(phone) DO NOTHING').run(DEMO.admin);
    sql.prepare('UPDATE core_team SET phone = ? WHERE is_coordinator = 1').run(DEMO.coordinator);

    const typeId = (key: string) => (sql.prepare('SELECT id FROM post_types WHERE key = ?').get(key) as { id: number }).id;
    const post = sql.prepare('INSERT INTO posts (type_id, name, km, lat, lng, time_from, time_to, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    const start = Number(post.run(typeId('start_finish'), 'Start/finish De Trilker', 0, 53.1406, 5.8107, '10:00', '15:00', 0).lastInsertRowid);
    const ehboPost = Number(post.run(typeId('ehbo'), 'EHBO-post 1 · start', 0, 53.1409, 5.8111, '10:00', '15:00', 1).lastInsertRowid);
    const water = Number(post.run(typeId('water'), 'Waterpost 3 · brug', 10.5, 53.1512, 5.8344, '10:15', '13:30', 2).lastInsertRowid);
    const traffic = Number(post.run(typeId('verkeer'), 'Kruising 4', 9.7, 53.1488, 5.8279, '11:30', '13:00', 3).lastInsertRowid);

    const contact = sql.prepare('INSERT INTO post_contacts (post_id, phone, role, time_from, time_to) VALUES (?, ?, ?, ?, ?)');
    contact.run(water, DEMO.postLead, 'verantwoordelijke', null, null);
    contact.run(traffic, DEMO.postLead, 'lid', '08:30', '10:00');
    contact.run(traffic, DEMO.postMember, 'lid', null, null);
    contact.run(start, DEMO.coordinator, 'lid', null, null);

    const unit = Number(sql.prepare("INSERT INTO ehbo_units (name, kind, post_id, has_aed) VALUES ('Team 1', 'vast', ?, 1)").run(ehboPost).lastInsertRowid);
    sql.prepare('INSERT INTO ehbo_unit_members (unit_id, phone) VALUES (?, ?)').run(unit, DEMO.ehbo);
    // Mobiel, zonder AED, met standplaats bij Kruising 4: dichter bij de waterpost dan Team 1.
    const mobile = Number(sql.prepare("INSERT INTO ehbo_units (name, kind, mobility, post_id, has_aed, sort) VALUES ('Team 2', 'mobiel', 'fiets', ?, 0, 1)").run(traffic).lastInsertRowid);
    sql.prepare('INSERT INTO ehbo_unit_members (unit_id, phone) VALUES (?, ?)').run(mobile, DEMO.mobileEhbo);

    const run = sql.prepare('INSERT INTO runs (name, distance_km, discipline, date, start_time, sort) VALUES (?, ?, ?, ?, ?, ?)');
    run.run('Kidsrun', 1, 'lopen', '2026-12-31', '12:00', 0);
    run.run('5 km', 5, 'lopen + wandelen', '2026-12-31', '12:00', 1);
    run.run('10 km', 10, 'lopen + wandelen', '2026-12-31', '12:00', 2);
    run.run('21 km', 21.1, 'lopen + wandelen', '2026-12-31', '12:00', 3);
  });
}
