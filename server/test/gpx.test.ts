import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distanceKm, parseGpx, passages } from '../src/gpx.ts';

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

// North along one longitude: 0.009 degrees is about 1 km.
const LNG = 5.8;
const north = (km: number): [number, number] => [LNG, 53 + (km * 0.009) / 1.0008];
const rounded = (list: number[]) => list.map((km) => Math.round(km * 10) / 10);

test('a post along the route is passed once, at its km', () => {
  assert.deepEqual(rounded(passages([north(0), north(4)], north(2.5))), [2.5]);
});

test('out and back: two passes, a post at the turning point only one', () => {
  const line = [north(0), north(3), north(0)];
  assert.deepEqual(rounded(passages(line, north(1))), [1, 5]);
  assert.deepEqual(rounded(passages(line, north(3))), [3]);
});

test('a lap run twice passes every post twice', () => {
  const square: [number, number][] = [[5.8, 53], [5.8, 53.009], [5.815, 53.009], [5.815, 53], [5.8, 53]];
  const line = [...square, ...square.slice(1)];
  const found = passages(line, [5.8, 53.0045]);
  assert.equal(found.length, 2);
  assert.ok(found[1]! > found[0]! + 1, 'one lap apart');
});

test('a post beside the route: within 30 m it counts, further away it does not', () => {
  const line = [north(0), north(2)];
  const beside = (metres: number): [number, number] => [LNG + metres / 67_000, north(1)[1]];
  assert.equal(passages(line, beside(20)).length, 1);
  assert.equal(passages(line, beside(50)).length, 0);
});

test('a line wobbling around a post is one pass', () => {
  const wobble = (metres: number, km: number): [number, number] => [LNG + metres / 67_000, north(km)[1]];
  const line = [north(0), wobble(0, 1), wobble(50, 1.02), wobble(0, 1.04), north(2)];
  assert.equal(passages(line, north(1.02)).length, 1);
});

test('posts close together keep their order, even at the same rounded km', () => {
  const line = [north(0), north(22)];
  const [traffic] = passages(line, north(21.08));
  const [finish] = passages(line, north(21.13));
  assert.deepEqual(rounded([traffic!, finish!]), [21.1, 21.1]);
  assert.ok(traffic! < finish!);
});

test('a thinned-out line still gives the km of the real route', () => {
  assert.deepEqual(rounded(passages([north(0), north(2)], north(1), 2.2)), [1.1]);
});
