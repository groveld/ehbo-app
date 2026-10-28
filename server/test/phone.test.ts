import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatPhone, normalizePhone } from '@ehbo/shared';

test('Nederlandse schrijfwijzen worden hetzelfde nummer', () => {
  for (const input of ['0612345678', '06-12 34 56 78', '06 12345678', '612345678', '6 12 34 56 78', '+31612345678', '+31 6 1234 5678', '0031612345678', '+31 0612345678', '(06) 12-34-56-78']) {
    assert.equal(normalizePhone(input), '+31612345678', input);
  }
  assert.equal(normalizePhone('010-1234567'), '+31101234567');
});

test('buitenlandse nummers blijven, ongeldige worden geweigerd', () => {
  assert.equal(normalizePhone('+32 470 12 34 56'), '+32470123456');
  assert.equal(normalizePhone('0049 151 12345678'), '+4915112345678');
  for (const input of ['', '112', '06123', '061234567890', '+3161234567', 'abc', '06-1234567x', '+0612345678']) {
    assert.equal(normalizePhone(input), null, input);
  }
});

test('leesbare schrijfwijze', () => {
  assert.equal(formatPhone('+31612345678'), '06-12 34 56 78');
  assert.equal(formatPhone('+31101234567'), '010-123 45 67');
  assert.equal(formatPhone('+32470123456'), '+32470123456');
});
