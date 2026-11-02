import assert from 'node:assert/strict';
import test from 'node:test';

import { D4_ANCHOR, D4_SCENE_ANCHOR, EXTENT, FRAME_VERSION, SOURCE_MODEL_OFFSET, campusModelAsset, geoToModel, modelToGeo } from './frame.mjs';

// A longitude near 127 deg has a double-precision ulp of 2.8e-14 deg (~2.6e-9 m, ~1.6e-9 scene units), so the
// round trip is bounded at 1e-8 scene units (16 nm): the floating-point floor, not a projection error.
test('geoToModel/modelToGeo round trip below 1e-8 scene units over EXTENT', () => {
  for (const x of [EXTENT.minX, (EXTENT.minX + EXTENT.maxX) / 2, EXTENT.maxX]) {
    for (const z of [EXTENT.minZ, (EXTENT.minZ + EXTENT.maxZ) / 2, EXTENT.maxZ]) {
      const [rx, rz] = geoToModel(...modelToGeo(x, z));
      assert.ok(Math.abs(rx - x) < 1e-8 && Math.abs(rz - z) < 1e-8, `${x},${z} -> ${rx},${rz}`);
    }
  }
});

test('BLD_D4 anchor lands on D4_SCENE_ANCHOR - SOURCE_MODEL_OFFSET', () => {
  const [x, z] = geoToModel(D4_ANCHOR.longitude, D4_ANCHOR.latitude);
  assert.ok(Math.abs(x - (D4_SCENE_ANCHOR.x - SOURCE_MODEL_OFFSET.x)) < 1e-9);
  assert.ok(Math.abs(z - (D4_SCENE_ANCHOR.z - SOURCE_MODEL_OFFSET.z)) < 1e-9);
});

test('campusModelAsset accepts a frame v2 asset and rejects a raw GLB without extras', () => {
  const asset = { version: '2.0', extras: { aoLayout: 'h', frameVersion: FRAME_VERSION, anchor: { epsg5186: [1, 2], scene: [3, 4] } } };
  assert.deepEqual(campusModelAsset({ asset }), { frameVersion: 2, anchor: { epsg5186: [1, 2], scene: [3, 4] } });
  assert.throws(() => campusModelAsset({ asset: { version: '2.0' } }), /frameVersion missing/);
  assert.throws(() => campusModelAsset({ asset: { version: '2.0', extras: { frameVersion: 1 } } }), /frameVersion 1/);
});
