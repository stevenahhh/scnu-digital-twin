import assert from "node:assert/strict";
import test from "node:test";

import { tmToScene } from "../../../src/geo/epsg5186.mjs";
import { EXTENT } from "../lib/frame.mjs";
import { SURFACE_CLASS } from "../lib/surfaceClass.mjs";
import { PX, buildSurfaces, discRing, offsetRing } from "./surfaces.mjs";

// Model-unit rectangles (closed when `close`).
const rect = (x0, z0, x1, z1, close = false) => {
  const ring = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
  return close ? [...ring, ring[0]] : ring;
};
const fixture = (extraWalkways = []) => ({
  inputs: { roadZones: [[rect(100, -200, 160, -190)]] },
  walkways: [{ ufid: "A003-TEST-1", surface: "blockPaver", lines: [rect(120, -195, 140, -180, true)] }, ...extraWalkways],
  buildings: [{ name: "BLD_TEST", parts: [{ outer: rect(200, -200, 220, -180) }] }],
  warn: () => {},
});

const width = Math.round((EXTENT.maxX - EXTENT.minX) * PX);
const height = Math.round((EXTENT.maxZ - EXTENT.minZ) * PX);
const toPixel = ([E, N]) => {
  const [x, z] = tmToScene(E, N);
  return [(x - EXTENT.minX) * PX, (z - EXTENT.minZ) * PX];
};
const labelAt = (labels, [x, z]) => labels[Math.floor((z - EXTENT.minZ) * PX) * width + Math.floor((x - EXTENT.minX) * PX)];

test("road zone, A003 ring and building apron get precedence 3 < 5 < 6 and the A003 ufid as source_ref", () => {
  const { layers } = buildSurfaces(fixture());
  const zone = layers.find((l) => l.source === "road-zone-measured");
  const walk = layers.find((l) => l.source === "NGII-A003");
  const apron = layers.find((l) => l.mesh === "Ground_Apron");
  assert.equal(zone.precedence, 3);
  assert.equal(walk.precedence, 5);
  assert.equal(apron.precedence, 6);
  assert.ok(zone.precedence < walk.precedence && walk.precedence < apron.precedence);
  assert.equal(walk.source_ref, "A003-TEST-1");
  assert.equal(walk.mesh, "Ground_Pavers");
  assert.equal(walk.label, SURFACE_CLASS.PAVING);
});

test("labelRaster honours precedence: A003 over the road zone, the zone alone stays asphalt", () => {
  const surfaces = buildSurfaces(fixture());
  const labels = surfaces.labelRaster(width, height, toPixel);
  assert.equal(labelAt(labels, [130, -186]), SURFACE_CLASS.PAVING, "inside the A003 ring (over the zone)");
  assert.equal(labelAt(labels, [110, -195]), SURFACE_CLASS.ASPHALT, "only inside the road zone");
  assert.equal(labelAt(labels, [300, -100]), SURFACE_CLASS.NATURAL, "outside every layer");
  assert.equal(labelAt(labels, [210, -190]), SURFACE_CLASS.NATURAL, "inside the building (the apron is a band around it)");
  assert.equal(labelAt(labels, [199.6, -190]), SURFACE_CLASS.PAVING, "on the apron just outside the building");
});

test("every emitted ring is counter-clockwise in EPSG:5186 and has no consecutive duplicate points", () => {
  const { layers } = buildSurfaces(fixture());
  assert.ok(layers.length >= 3);
  for (const layer of layers) {
    for (const ring of layer.rings) {
      let area = 0;
      for (let i = 0; i < ring.length; i += 1) {
        const p = ring[i];
        const q = ring[(i + 1) % ring.length];
        area += p[0] * q[1] - q[0] * p[1];
        assert.ok(Math.hypot(q[0] - p[0], q[1] - p[1]) > 1e-6, `${layer.source_ref}: duplicate point`);
      }
      assert.ok(area > 0, `${layer.source_ref}: ring is clockwise`);
    }
  }
});

test("an A003 outline with fewer than 4 ring points is skipped with a warning naming its ufid", () => {
  const warnings = [];
  const surfaces = buildSurfaces({
    ...fixture([{ ufid: "A003-BAD", surface: "existing", lines: [[[300, -100], [310, -100], [300, -100]]] }]),
    warn: (message) => warnings.push(message),
  });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /A003-BAD/);
  assert.ok(surfaces.layers.some((l) => l.source_ref === "A003-TEST-1"), "the builder continues with the other walkways");
  assert.ok(!surfaces.layers.some((l) => l.source_ref === "A003-BAD"));
});

test("offsetRing moves a ring outward by the given distance whatever its orientation", () => {
  for (const ring of [rect(0, 0, 10, 10), rect(0, 0, 10, 10).reverse()]) {
    const out = offsetRing(ring, 1);
    const xs = out.map((p) => p[0]);
    assert.deepEqual([Math.min(...xs), Math.max(...xs)].map((v) => Math.round(v * 1e9) / 1e9), [-1, 11]);
  }
  assert.equal(discRing([0, 0], 2, 16).length, 16);
});
