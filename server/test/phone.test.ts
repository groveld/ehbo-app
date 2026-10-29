import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatPhone, normalizeEmergencyNumber, normalizePhone } from '@ehbo/shared';

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

test('noodnummers mogen ook kort of 0800/0900 zijn', () => {
  assert.equal(normalizeEmergencyNumber('112'), '112');
  assert.equal(normalizeEmergencyNumber('144'), '144');
  assert.equal(normalizeEmergencyNumber('0900-8844'), '09008844');
  assert.equal(normalizeEmergencyNumber('0800 1234'), '08001234');
  assert.equal(normalizeEmergencyNumber('058-286 66 66'), '+31582866666');
  assert.equal(normalizeEmergencyNumber('+31 (0)58 286 6666'), '+31582866666');
  for (const input of ['', '12', '0900', 'abc', '06123']) assert.equal(normalizeEmergencyNumber(input), null, input);
});

test('leesbare schrijfwijze: altijd met landcode, zonder (0)', () => {
  assert.equal(formatPhone('+31612345678'), '+31 6 12 34 56 78');
  assert.equal(formatPhone('+31101234567'), '+31 10 123 45 67');
  assert.equal(formatPhone('+31582866666'), '+31 58 286 66 66');
  assert.equal(formatPhone('+31513123456'), '+31 513 12 34 56');
  assert.equal(formatPhone('+32470123456'), '+32 470 12 34 56');
  assert.equal(formatPhone('+4915112345678'), '+49 151 12 34 56 78');
  assert.equal(formatPhone('112'), '112');
  assert.equal(formatPhone('09008844'), '0900 8844');
  // Wat de weergave toont, moet weer hetzelfde nummer worden.
  for (const n of ['+31612345678', '+31101234567', '+31513123456', '+32470123456']) assert.equal(normalizePhone(formatPhone(n)), n);
});
