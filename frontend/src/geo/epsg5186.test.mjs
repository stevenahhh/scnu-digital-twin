import assert from 'node:assert/strict';
import test from 'node:test';

import {
  D4_ANCHOR,
  D4_ANCHOR_TM,
  D4_SCENE_ANCHOR,
  FRAME_VERSION,
  GRID_CONVERGENCE_DEG,
  SCENE_UNITS_PER_METRE,
  SOURCE_MODEL_OFFSET,
  TFW_34702020,
  pixelToTm,
  sceneToTm,
  simulationToTm,
  simulationToWgs84,
  tmToPixel,
  tmToScene,
  tmToSimulation,
  tmToWgs84,
  wgs84ToSimulation,
  wgs84ToTm,
} from './epsg5186.mjs';

// Frame v1 anchor (before Frame v2): the old equirectangular fixture below is expressed in that frame.
const D4_SCENE_V1 = { x: 46.513, z: -266.574 };
// fetch/frameV2.mjs output: GIS record 133154 bbox centre (EPSG:5186) and uni.glb BLD_D4 bbox centre (scene).
const GIS_D4_CENTRE_TM = [243507.55, 263879.65];
const UNI_D4_CENTRE_SCENE = [46.721, -266.797];

// The pre-module frame (lib/frame.mjs before the EPSG:5186 switch), copied verbatim as a fixture.
const OLD_LAT0_RAD = (D4_ANCHOR.latitude * Math.PI) / 180;
const OLD_M_LAT = 111132.92 - 559.82 * Math.cos(2 * OLD_LAT0_RAD) + 1.175 * Math.cos(4 * OLD_LAT0_RAD);
const OLD_M_LON = 111412.84 * Math.cos(OLD_LAT0_RAD) - 93.5 * Math.cos(3 * OLD_LAT0_RAD);
function oldModelToGeo(x, z) {
  const east = (x + SOURCE_MODEL_OFFSET.x - D4_SCENE_V1.x) / SCENE_UNITS_PER_METRE;
  const north = -(z + SOURCE_MODEL_OFFSET.z - D4_SCENE_V1.z) / SCENE_UNITS_PER_METRE;
  return [D4_ANCHOR.longitude + east / OLD_M_LON, D4_ANCHOR.latitude + north / OLD_M_LAT];
}
const OLD_EXTENT = { minX: -2, maxX: 502, minZ: -376, maxZ: 2 };

test('(a) wgs84 -> tm -> wgs84 round trip below 1e-9 deg on a 3x3 grid', () => {
  for (const lon of [127.0, 127.5, 128.0]) {
    for (const lat of [34.5, 35.0, 35.5]) {
      const [rlon, rlat] = tmToWgs84(...wgs84ToTm(lon, lat));
      assert.ok(Math.abs(rlon - lon) < 1e-9, `lon ${lon},${lat}: ${rlon - lon}`);
      assert.ok(Math.abs(rlat - lat) < 1e-9, `lat ${lon},${lat}: ${rlat - lat}`);
      const [E, N] = wgs84ToTm(lon, lat);
      const [rE, rN] = wgs84ToTm(...tmToWgs84(E, N));
      assert.ok(Math.hypot(rE - E, rN - N) < 1e-6, `metres ${lon},${lat}`);
    }
  }
});

test('(b) the projection origin maps to the false easting/northing', () => {
  const [E, N] = wgs84ToTm(127.0, 38.0);
  assert.ok(Math.abs(E - 200000) < 1e-3, `E ${E}`);
  assert.ok(Math.abs(N - 600000) < 1e-3, `N ${N}`);
});

test('(c) pixel mapping uses the top-left pixel centre of the 34702020 world file', () => {
  assert.deepEqual(TFW_34702020, { a: 0.25, d: -0.25, c: 243324.125, f: 264485.875, width: 9588, height: 11544 });
  const [c0, r0] = tmToPixel(243324.125, 264485.875);
  assert.ok(c0 === 0 && r0 === 0, `${c0},${r0}`);
  const [col, row] = tmToPixel(243324.125 + 0.25 * 9587, 264485.875 - 0.25 * 11543);
  assert.ok(Math.abs(col - 9587) < 1e-9 && Math.abs(row - 11543) < 1e-9, `${col},${row}`);
  assert.deepEqual(pixelToTm(0, 0), [243324.125, 264485.875]);
  const [E, N] = pixelToTm(...tmToPixel(243500.3, 264000.7));
  assert.ok(Math.abs(E - 243500.3) < 1e-9 && Math.abs(N - 264000.7) < 1e-9);
});

test('(d) the D4 anchor lands on D4_SCENE_ANCHOR - SOURCE_MODEL_OFFSET', () => {
  const [x, z] = tmToScene(...D4_ANCHOR_TM);
  assert.ok(Math.abs(x - (D4_SCENE_ANCHOR.x - SOURCE_MODEL_OFFSET.x)) < 1e-9, `x ${x}`);
  assert.ok(Math.abs(z - (D4_SCENE_ANCHOR.z - SOURCE_MODEL_OFFSET.z)) < 1e-9, `z ${z}`);
  const [E, N] = sceneToTm(x, z);
  assert.ok(Math.abs(E - D4_ANCHOR_TM[0]) < 1e-9 && Math.abs(N - D4_ANCHOR_TM[1]) < 1e-9);
});

test('(e) the D4 anchor is the simulation origin', () => {
  const p = tmToSimulation(...D4_ANCHOR_TM);
  assert.ok(Math.abs(p.x) < 1e-12 && Math.abs(p.z) < 1e-12, JSON.stringify(p));
  const [E, N] = simulationToTm({ x: 120, z: -45 });
  const back = tmToSimulation(E, N);
  assert.ok(Math.abs(back.x - 120) < 1e-9 && Math.abs(back.z + 45) < 1e-9);
  const [lon, lat] = simulationToWgs84(wgs84ToSimulation(127.478, 34.968));
  assert.ok(Math.abs(lon - 127.478) < 1e-9 && Math.abs(lat - 34.968) < 1e-9);
});

// The old frame used the v1 anchor; Frame v2 moves the whole scene by the anchor shift, so compare after removing it.
const FRAME_SHIFT = { x: D4_SCENE_ANCHOR.x - D4_SCENE_V1.x, z: D4_SCENE_ANCHOR.z - D4_SCENE_V1.z };

test('(f) EXTENT corners move < 0.05 m against the old equirectangular frame', () => {
  const corners = [
    [OLD_EXTENT.minX, OLD_EXTENT.minZ],
    [OLD_EXTENT.maxX, OLD_EXTENT.minZ],
    [OLD_EXTENT.minX, OLD_EXTENT.maxZ],
    [OLD_EXTENT.maxX, OLD_EXTENT.maxZ],
  ];
  for (const [x, z] of corners) {
    const [nx, nz] = tmToScene(...wgs84ToTm(...oldModelToGeo(x, z)));
    const residualM = Math.hypot(nx - FRAME_SHIFT.x - x, nz - FRAME_SHIFT.z - z) / SCENE_UNITS_PER_METRE;
    assert.ok(residualM < 0.05, `corner ${x},${z}: ${residualM.toFixed(4)} m`);
  }
});

test('scene axes follow true north: grid convergence at D4 is about -0.27 deg', () => {
  assert.ok(Math.abs(GRID_CONVERGENCE_DEG + 0.273) < 0.005, `${GRID_CONVERGENCE_DEG}`);
});

test('frame v2 (a) the GIS D4 footprint centre lands on the uni.glb BLD_D4 bbox centre', () => {
  assert.equal(FRAME_VERSION, 2);
  const [x, z] = tmToScene(...GIS_D4_CENTRE_TM);
  assert.ok(Math.abs(x - UNI_D4_CENTRE_SCENE[0]) < 1e-3, `x ${x}`);
  assert.ok(Math.abs(z - UNI_D4_CENTRE_SCENE[1]) < 1e-3, `z ${z}`);
});

test('frame v2 (b) tmToScene(D4_ANCHOR_TM) equals D4_SCENE_ANCHOR - SOURCE_MODEL_OFFSET', () => {
  const [x, z] = tmToScene(...D4_ANCHOR_TM);
  assert.ok(Math.abs(x - (D4_SCENE_ANCHOR.x - SOURCE_MODEL_OFFSET.x)) < 1e-9);
  assert.ok(Math.abs(z - (D4_SCENE_ANCHOR.z - SOURCE_MODEL_OFFSET.z)) < 1e-9);
});

test('frame v2 (c) sceneToTm(tmToScene(p)) round-trips below 1e-9 m', () => {
  for (const p of [GIS_D4_CENTRE_TM, D4_ANCHOR_TM, [243300, 263600], [243900, 264100]]) {
    const [E, N] = sceneToTm(...tmToScene(...p));
    assert.ok(Math.hypot(E - p[0], N - p[1]) < 1e-9, `${p}: ${E},${N}`);
  }
});
