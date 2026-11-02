import assert from 'node:assert/strict';
import test from 'node:test';

import { localLeanRatio, campusLeanRatio, intersectBearings, revertCrownLean, treePositionFromViews } from './treePosition.mjs';

// Bearing (degrees clockwise from north, +z south) from a station to a point in the scene frame.
const bearingTo = ([sx, sz], [x, z]) => ((Math.atan2(x - sx, -(z - sz)) * 180) / Math.PI + 360) % 360;

test('two bearings to a known point recover it within 0.3 m', () => {
  const tree = [120.4, -233.7];
  const a = [80, -260];
  const b = [150, -200];
  const hit = intersectBearings([
    { x: a[0], z: a[1], bearingDeg: bearingTo(a, tree) },
    { x: b[0], z: b[1], bearingDeg: bearingTo(b, tree) },
  ]);
  assert.ok(hit);
  assert.ok(Math.hypot(hit.x - tree[0], hit.z - tree[1]) < 0.3);
});

test('a bearing error of 0.5 deg keeps the intersection within 0.3 m at 25 m range', () => {
  const tree = [0, 0];
  const a = [-25, 0];
  const b = [0, 25];
  const hit = intersectBearings([
    { x: a[0], z: a[1], bearingDeg: bearingTo(a, tree) + 0.5 },
    { x: b[0], z: b[1], bearingDeg: bearingTo(b, tree) },
  ]);
  assert.ok(Math.hypot(hit.x - tree[0], hit.z - tree[1]) < 0.3);
});

test('near-parallel bearings and points behind a station give no intersection', () => {
  const tree = [0, 0];
  const a = [-30, 0];
  const b = [-29, 0.5];
  assert.equal(intersectBearings([
    { x: a[0], z: a[1], bearingDeg: bearingTo(a, tree) },
    { x: b[0], z: b[1], bearingDeg: bearingTo(b, tree) },
  ]), null);
  // lines cross, but behind station a
  assert.equal(intersectBearings([
    { x: 10, z: 0, bearingDeg: 90 },
    { x: 0, z: 10, bearingDeg: 0 },
  ]), null);
});

test('one refined station only keeps the CHM position, estimated', () => {
  const chm = [10, 10];
  const out = treePositionFromViews(chm, [{ scene: 'scene_a1', x: 0, z: 0, bearingDeg: 135, refined: true }], { unitsPerMetre: 1 });
  assert.deepEqual(out, { x: 10, z: 10, method: 'photo-chm', estimated: true, scenes: [] });
});

test('unrefined stations and repeated scenes do not count as a second station', () => {
  const tree = [10, 10];
  const views = [
    { scene: 'scene_a1', x: 0, z: 0, bearingDeg: bearingTo([0, 0], tree), refined: true },
    { scene: 'scene_a1', x: 0, z: 0, bearingDeg: bearingTo([0, 0], tree), refined: true },
    { scene: 'scene_d4', x: 20, z: 0, bearingDeg: bearingTo([20, 0], tree), refined: false },
  ];
  assert.equal(treePositionFromViews([11, 11], views, { unitsPerMetre: 1 }).method, 'photo-chm');
});

test('two refined stations move the tree to their intersection', () => {
  const tree = [10.6, 9.2];
  const views = [
    { scene: 'scene_a1', x: 0, z: 0, bearingDeg: bearingTo([0, 0], tree), refined: true },
    { scene: 'scene_b2', x: 25, z: 0, bearingDeg: bearingTo([25, 0], tree), refined: true },
  ];
  const out = treePositionFromViews([11, 10], views, { unitsPerMetre: 1 });
  assert.equal(out.method, 'vr-intersection');
  assert.equal(out.estimated, false);
  assert.deepEqual(out.scenes, ['scene_a1', 'scene_b2']);
  assert.ok(Math.hypot(out.x - tree[0], out.z - tree[1]) < 0.3);
});

test('an intersection far from the CHM crown is a misread crown and is refused', () => {
  const tree = [10, 30];
  const views = [
    { scene: 'scene_a1', x: 0, z: 0, bearingDeg: bearingTo([0, 0], tree), refined: true },
    { scene: 'scene_b2', x: 25, z: 0, bearingDeg: bearingTo([25, 0], tree), refined: true },
  ];
  assert.equal(treePositionFromViews([10, 10], views, { unitsPerMetre: 1, maxShiftM: 4 }).method, 'photo-chm');
});

test('campus lean ratio is the median of roof-edge building leans; prior records are ignored', () => {
  const ratio = campusLeanRatio([
    { lean: [-0.1, 0.05], method: 'roof-edge' },
    { lean: [-0.04, 0.02], method: 'roof-edge' },
    { lean: [-0.06, 0.04], method: 'roof-edge' },
    { lean: [5, 5], method: 'prior' },
  ]);
  assert.deepEqual(ratio, [-0.06, 0.04]);
  assert.throws(() => campusLeanRatio([{ lean: [0, 0], method: 'prior' }]), /roof-edge/);
});

test('crown centre lean is reverted by height x ratio', () => {
  const [e, n] = revertCrownLean([1000, 2000], 10, [-0.05, 0.03]);
  assert.ok(Math.abs(e - 1000.5) < 1e-9);
  assert.ok(Math.abs(n - 1999.7) < 1e-9);
});

test('local lean ratio follows the nearest building and tends to the mean far away', () => {
  const pts = [[[0, 0], [-0.1, 0]], [[1000, 0], [0.1, 0.2]]];
  const near = localLeanRatio(pts, [0, 0], { softM: 10 });
  assert.ok(Math.abs(near[0] + 0.1) < 0.001 && Math.abs(near[1]) < 0.001);
  const far = localLeanRatio(pts, [500, 1e6], { softM: 10 });
  assert.ok(Math.abs(far[0]) < 1e-6 && Math.abs(far[1] - 0.1) < 1e-6);
  assert.throws(() => localLeanRatio([], [0, 0]), /roof-edge/);
});
