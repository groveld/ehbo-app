import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_STYLE, looksLikeSignal, styleProblem } from '@ehbo/shared';

test('een hoofdkleur die op signaalrood of -groen lijkt, wordt geweigerd', () => {
  for (const red of ['#C8261E', '#E2412C', '#B00020']) assert.equal(looksLikeSignal(red), true, red);
  for (const green of ['#0A7D4F', '#11865A']) assert.equal(looksLikeSignal(green), true, green);
  for (const other of [DEFAULT_STYLE.primaryColor, '#1F4E9A', '#5B2A86', '#444444']) assert.equal(looksLikeSignal(other), false, other);
  assert.match(styleProblem({ primaryColor: '#B3261E', accentColor: DEFAULT_STYLE.accentColor }) ?? '', /rood of groen/);
  assert.equal(styleProblem(DEFAULT_STYLE), null);
});
