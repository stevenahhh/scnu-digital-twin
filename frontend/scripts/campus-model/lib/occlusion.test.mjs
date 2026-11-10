import assert from 'node:assert/strict';
import test from 'node:test';

import { occlusionMask, pixelCentre } from './occlusion.mjs';

const WINDOW = { w: 80, h: 80, origin: [1000, 2000], gsdM: 0.25 };
const count = (m) => m.reduce((n, v) => n + v, 0);
const square = (e, n, s) => [[e, n], [e + s, n], [e + s, n + s], [e, n + s]];

test('a crown masks exactly its disc (pixel centres within the crown radius) and nothing else', () => {
  const tree = { east: 1010, north: 1990, crownDiameterM: 6, heightM: 0 };
  const { crowns, roofs } = occlusionMask(WINDOW, { trees: [tree], shadows: false });
  assert.equal(count(roofs), 0);
  for (let j = 0; j < WINDOW.h; j += 1) {
    for (let i = 0; i < WINDOW.w; i += 1) {
      const [E, N] = pixelCentre(WINDOW, i, j);
      const inside = Math.hypot(E - 1010, N - 1990) <= 3;
      assert.equal(crowns[j * WINDOW.w + i], inside ? 1 : 0, `pixel ${i},${j}`);
    }
  }
});

test('a leaned building masks the sweep from its footprint to its displaced roof', () => {
  const building = { rings: [square(1004, 1984, 4)], heightM: 10, lean: [0.2, 0] };
  const { roofs } = occlusionMask(WINDOW, { buildings: [building], shadows: false });
  const at = (E, N) => roofs[Math.round((2000 - N) / 0.25) * WINDOW.w + Math.round((E - 1000) / 0.25)];
  assert.equal(at(1006, 1986), 1, 'footprint');
  assert.equal(at(1008.5, 1986), 1, 'facade between footprint and roof');
  assert.equal(at(1009.6, 1986), 1, 'roof moved 2 m east (1006..1010)');
  assert.equal(at(1010.6, 1986), 0, 'past the roof');
  assert.equal(at(1003, 1986), 0, 'west of the footprint');
  // area: 4 x 4 footprint swept 2 m east = 4 x 6 m = 384 px of 0.0625 m2
  assert.ok(Math.abs(count(roofs) - 384) <= 16, `area ${count(roofs)}`);
});

test('cast shadows fall away from the sun with length h / tan(elevation)', () => {
  const building = { rings: [square(1008, 1984, 2)], heightM: 4, lean: [0, 0] };
  const sun = { azimuthDeg: 90, elevationDeg: 45 }; // sun in the east: shadow 4 m to the west
  const { shadows, any } = occlusionMask(WINDOW, { buildings: [building], sun });
  const at = (m, E, N) => m[Math.round((2000 - N) / 0.25) * WINDOW.w + Math.round((E - 1000) / 0.25)];
  assert.equal(at(shadows, 1005, 1985), 1, '3 m west of the footprint');
  assert.equal(at(shadows, 1003.5, 1985), 0, 'beyond 4 m');
  assert.equal(at(shadows, 1011, 1985), 0, 'sun side');
  assert.equal(at(any, 1009, 1985), 1, 'any includes the footprint');
});

test('empty inputs give empty masks of window size', () => {
  const m = occlusionMask(WINDOW, {});
  for (const k of ['roofs', 'crowns', 'shadows', 'any']) {
    assert.equal(m[k].length, WINDOW.w * WINDOW.h);
    assert.equal(count(m[k]), 0);
  }
});
