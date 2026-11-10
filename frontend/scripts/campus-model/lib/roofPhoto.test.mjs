import assert from 'node:assert/strict';
import test from 'node:test';

import { metres } from './frame.mjs';
import { LEAN_PRIOR_CAP, leanParts, roofLean, sampleRoofPhoto } from './roofPhoto.mjs';

// Synthetic mosaic: 0.1 m pixels over a 40 m x 40 m window starting at model (0, 0). A 12 m x 10 m flat roof of a
// 20 m building whose footprint is [10, 22] x [10, 20] m; the photo shows the roof displaced by height x lean
// (lean [east, north] m/m; model z points south). Roof pixels are grey, ground pixels red, so every sample can be
// told apart by the position it was read at.
const PX_M = 0.1;
const SIZE = 400;
const LEAN = [0.1, -0.15];
const HEIGHT_M = 20;
const FOOT = { x0: 10, x1: 22, z0: 10, z1: 20 };
const shiftM = [LEAN[0] * HEIGHT_M, -LEAN[1] * HEIGHT_M]; // [2, 3] m
const inPhotoRoof = (xm, zm) => xm >= FOOT.x0 + shiftM[0] && xm < FOOT.x1 + shiftM[0] && zm >= FOOT.z0 + shiftM[1] && zm < FOOT.z1 + shiftM[1];

function syntheticOrtho(reads) {
  const rgb = new Uint8Array(SIZE * SIZE * 3);
  for (let j = 0; j < SIZE; j += 1) {
    for (let i = 0; i < SIZE; i += 1) {
      const c = inPhotoRoof((i + 0.5) * PX_M, (j + 0.5) * PX_M) ? [150, 150, 150] : [190, 60, 50];
      rgb.set(c, (j * SIZE + i) * 3);
    }
  }
  let x = null;
  return {
    width: SIZE,
    height: SIZE,
    rgb,
    col: (value) => { x = value; return value / metres(PX_M); },
    row: (z) => { reads.push([x / metres(1), z / metres(1)]); return z / metres(PX_M); },
  };
}

const calibration = { calibrate: (c) => c };
const ring = [[FOOT.x0, FOOT.z0], [FOOT.x1, FOOT.z0], [FOOT.x1, FOOT.z1], [FOOT.x0, FOOT.z1]].map(([x, z]) => [metres(x), metres(z)]);
const part = { outer: ring, holes: [], heightMetres: HEIGHT_M, parapetMetres: 0 };
const groundReads = (reads) => reads.filter(([x, z]) => !inPhotoRoof(x, z)).length;

test('a leaned roof sampled on its footprint reads ground pixels', () => {
  const reads = [];
  sampleRoofPhoto(syntheticOrtho(reads), calibration, [part]);
  assert.ok(groundReads(reads) > 100, `expected ground samples, got ${groundReads(reads)}`);
});

test('a leaned roof samples zero ground pixels after lean correction', () => {
  const reads = [];
  const photo = sampleRoofPhoto(syntheticOrtho(reads), calibration, leanParts([part], LEAN));
  assert.ok(reads.length > 1000);
  assert.equal(groundReads(reads), 0);
  assert.equal(photo.status, 'photo');
  assert.deepEqual(photo.raw, [150, 150, 150]);
});

test('leanParts moves holes and adds the parapet to the height', () => {
  const hole = [[metres(14), metres(12)], [metres(16), metres(12)], [metres(16), metres(14)]];
  const [moved] = leanParts([{ ...part, holes: [hole], parapetMetres: 1 }], LEAN);
  assert.deepEqual(moved.outer[0].map((v) => +(v / metres(1)).toFixed(6)), [FOOT.x0 + 2.1, FOOT.z0 + 3.15]);
  assert.deepEqual(moved.holes[0][0].map((v) => +(v / metres(1)).toFixed(6)), [16.1, 15.15]);
  assert.deepEqual(leanParts([part], null), [part]);
});

test('roofLean keeps a roof-edge fit near its prior and falls back to the prior past the cap', () => {
  const prior = [0, -0.1];
  assert.deepEqual(roofLean({ lean: [0.05, -0.2], method: 'roof-edge' }, prior), { lean: [0.05, -0.2], method: 'roof-edge', deviation: 0.112 });
  const far = roofLean({ lean: [0.2, -0.1 - LEAN_PRIOR_CAP], method: 'roof-edge' }, prior);
  assert.equal(far.method, 'prior-capped');
  assert.deepEqual(far.lean, prior);
  assert.deepEqual(roofLean({ lean: [0.01, 0.02], method: 'prior' }, prior), { lean: [0.01, 0.02], method: 'prior', deviation: null });
  assert.deepEqual(roofLean(null, prior), { lean: prior, method: 'prior-no-record', deviation: null });
  assert.equal(roofLean(null, null), null);
});
