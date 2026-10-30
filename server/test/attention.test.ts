import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDueOpen, lacksPosition, type LiveUnit } from '@ehbo/shared';

const post = { timeFrom: '11:30', timeTo: '13:00' };
const event = { startDate: '2026-12-31', endDate: '2026-12-31' };
const at = (time: string, day = '2026-12-31') => new Date(`${day}T${time}:00+01:00`).getTime();

test('a post is due within its time slot, in Dutch time', () => {
  assert.equal(isDueOpen(post, event, at('11:29')), false);
  assert.equal(isDueOpen(post, event, at('11:30')), true);
  assert.equal(isDueOpen(post, event, at('12:59')), true);
  assert.equal(isDueOpen(post, event, at('13:00')), false);
});

test('a post is only due on a day of the event, and only with a time slot', () => {
  assert.equal(isDueOpen(post, event, at('12:00', '2026-12-30')), false);
  assert.equal(isDueOpen({ timeFrom: null, timeTo: null }, event, at('12:00')), false);
  assert.equal(isDueOpen(post, { startDate: null, endDate: null }, at('12:00')), false);
  assert.equal(isDueOpen({ timeFrom: '11:30', timeTo: null }, event, at('23:00')), true, 'no end time: due for the rest of the day');
});

test('only a mobile team on duty can lack a position', () => {
  const now = at('12:00');
  const live = (availability: LiveUnit['availability'], minutesAgo: number | null) => ({
    availability, position: minutesAgo === null ? null : { lat: 53, lng: 5, at: new Date(now - minutesAgo * 60_000).toISOString() },
  }) as LiveUnit;
  assert.equal(lacksPosition({ kind: 'mobiel' }, live('vrij', null), now), true);
  assert.equal(lacksPosition({ kind: 'mobiel' }, live('vrij', 4), now), true);
  assert.equal(lacksPosition({ kind: 'mobiel' }, live('vrij', 2), now), false);
  assert.equal(lacksPosition({ kind: 'mobiel' }, live('uit_dienst', null), now), false);
  assert.equal(lacksPosition({ kind: 'vast' }, live('vrij', null), now), false);
});
