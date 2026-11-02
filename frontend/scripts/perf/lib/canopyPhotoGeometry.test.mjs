import assert from 'node:assert/strict';
import test from 'node:test';

import { revertCrownLean } from '../../campus-model/fit/treePosition.mjs';
import { legacyLeanOffset, photoPositions } from './canopyPhotoGeometry.mjs';

test('a crown reverted by its lean and redisplaced lands on its photo blob', () => {
  const blob = [243900.4, 263700.8];
  const heightM = 12;
  const trunk = revertCrownLean(blob, 0.6 * heightM, [-0.0485, 0.026]);
  const photoLean = [blob[0] - trunk[0], blob[1] - trunk[1]];
  const [[e, n]] = photoPositions({ columns: ['east', 'north', 'crownDiameterM', 'heightM', 'photoLean'], trees: [[...trunk, 6, heightM, photoLean]] });
  assert.ok(Math.hypot(e - blob[0], n - blob[1]) < 1e-9);
});

test('a recorded photoLean wins over the legacy field, whatever the height became after the revert', () => {
  const [[e, n]] = photoPositions({ columns: ['east', 'north', 'crownDiameterM', 'heightM', 'photoLean'], trees: [[1000, 2000, 5, 25, [0.5, -0.25]]] });
  assert.equal(e, 1000.5);
  assert.equal(n, 1999.75);
});

test('an inventory without photoLean is redisplaced by the legacy field at 0.6 x height', () => {
  const [le, ln] = legacyLeanOffset(243835.0182316025, 263760.97123001737, 10);
  assert.ok(Math.abs(le - 6 * -0.02) < 1e-12 && Math.abs(ln - 6 * -0.0549) < 1e-12);
  const [[e, n]] = photoPositions({ columns: ['east', 'north', 'crownDiameterM', 'heightM'], trees: [[243835.0182316025, 263760.97123001737, 5, 10]] });
  assert.ok(Math.abs(e - (243835.0182316025 + le)) < 1e-9 && Math.abs(n - (263760.97123001737 + ln)) < 1e-9);
});
