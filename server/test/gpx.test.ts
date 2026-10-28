import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distanceKm, parseGpx } from '../src/gpx.ts';

const gpx = (points: string) => `<?xml version="1.0"?><gpx version="1.1"><trk><trkseg>${points}</trkseg></trk></gpx>`;

test('afstand tussen twee punten', () => {
  // Eén breedtegraad is ongeveer 111,2 km.
  assert.ok(Math.abs(distanceKm([5.8, 53], [5.8, 54]) - 111.2) < 0.1);
});

test('track uit GPX: punten, lengte en lijn als [lengte, breedte]', () => {
  const track = parseGpx(gpx(`
    <trkpt lat="53.0000" lon="5.8000"><ele>1</ele></trkpt>
    <trkpt lon="5.8000" lat="53.0090"></trkpt>
    <trkpt lat='53.0180' lon='5.8000'/>`));
  assert.equal(track.points, 3);
  assert.ok(Math.abs(track.km - 2.0) < 0.01, `km = ${track.km}`);
  assert.deepEqual(track.line[0], [5.8, 53]);
});

test('route (rtept) als er geen track is', () => {
  const track = parseGpx('<gpx><rte><rtept lat="53" lon="5"/><rtept lat="53.01" lon="5"/></rte></gpx>');
  assert.equal(track.points, 2);
});

test('grote bestanden worden uitgedund, begin en eind blijven', () => {
  const points = Array.from({ length: 10_001 }, (_, i) => `<trkpt lat="${53 + i / 100_000}" lon="5.8"/>`).join('');
  const track = parseGpx(gpx(points));
  assert.equal(track.points, 10_001);
  assert.ok(track.line.length <= 2001, `line = ${track.line.length}`);
  assert.deepEqual(track.line.at(-1), [5.8, 53.1]);
});

test('geen of ongeldige route wordt geweigerd', () => {
  assert.throws(() => parseGpx('<gpx></gpx>'), /Geen route/);
  assert.throws(() => parseGpx('geen xml'), /Geen route/);
  assert.throws(() => parseGpx(gpx('<trkpt lat="95" lon="5"/><trkpt lat="53" lon="5"/>')), /ongeldig punt/);
});
