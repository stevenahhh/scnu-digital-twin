import assert from "node:assert/strict";
import test from "node:test";

import { tmToScene } from "../../../src/geo/epsg5186.mjs";
import { EXTENT } from "../lib/frame.mjs";
import { SURFACE_CLASS } from "../lib/surfaceClass.mjs";
import { PRECEDENCE, PX, buildSurfaces, discRing, offsetRing } from "./surfaces.mjs";

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

test("a reclass to clay paints an OSM tennis pitch as a clay court; clay on a non-pitch area is an error", () => {
  const pitch = { id: "way/1", kind: "pitch", tags: { leisure: "pitch", sport: "tennis" }, rings: [rect(300, -100, 330, -80)] };
  const ground = (supplements, osm = [pitch]) => ({ osm, lines: [], facilities: [], supplements, unlabelledLabels: [] });
  const plain = buildSurfaces({ ...fixture(), groundFeatures: ground([]) }).layers.find((l) => l.source_ref === "way/1");
  assert.equal(plain.paint.surface, undefined);
  const clay = buildSurfaces({ ...fixture(), groundFeatures: ground([{ kind: "reclass", osm: "way/1", surface: "clay" }]) }).layers.find((l) => l.source_ref === "way/1");
  assert.deepEqual([clay.paint.kind, clay.paint.sport, clay.paint.surface, clay.estimated], ["pitch", "tennis", "clay", true]);
  const water = { id: "way/2", kind: "water", rings: [rect(300, -60, 330, -40)] };
  assert.throws(() => buildSurfaces({ ...fixture(), groundFeatures: ground([{ kind: "reclass", osm: "way/2", surface: "clay" }], [pitch, water]) }), /reclass clay applies to an OSM pitch/);
});

test("a tiles paving supplement is a PAVING layer between the walkways and the aprons, outside the network plaza set", () => {
  const groundFeatures = { osm: [], lines: [], facilities: [], unlabelledLabels: [], supplements: [{ kind: "paving", note: "test courtyard", pattern: "tiles", ring: rect(170, -200, 190, -180), axis: [[170, -200], [190, -200]] }] };
  const { layers } = buildSurfaces({ ...fixture(), groundFeatures });
  const tiles = layers.find((l) => l.paint?.kind === "tiles");
  assert.equal(tiles.cls, "PAVING");
  assert.equal(tiles.mesh, "Ground_Sports");
  assert.equal(tiles.label, SURFACE_CLASS.PAVING);
  assert.ok(tiles.precedence > 5.5 && tiles.precedence < 6);
  assert.equal(tiles.paint.axis.length, 2);
  const plain = buildSurfaces({ ...fixture(), groundFeatures: { ...groundFeatures, supplements: [{ kind: "paving", note: "walk", pattern: "plain", ring: rect(170, -200, 190, -180) }] } }).layers.find((l) => l.source_ref === "paving: walk");
  assert.deepEqual([plain.mesh, plain.label, plain.precedence], ["Ground_Pavers", SURFACE_CLASS.PAVING, tiles.precedence]);
  // red non-slip road surfacing: the red asphalt tile, still road for the label raster (lamps, humps)
  const red = buildSurfaces({ ...fixture(), groundFeatures: { ...groundFeatures, supplements: [{ kind: "paving", note: "red junction", pattern: "red", ring: rect(170, -200, 190, -180) }] } }).layers.find((l) => l.source_ref === "paving: red junction");
  assert.deepEqual([red.mesh, red.cls, red.label, red.precedence, red.estimated], ["Ground_Bicycle", "ASPHALT", SURFACE_CLASS.ASPHALT, tiles.precedence, true]);
  assert.throws(() => buildSurfaces({ ...fixture(), groundFeatures: { ...groundFeatures, supplements: [{ kind: "paving", note: "bad", ring: rect(0, 0, 1, 1) }] } }), /needs a ring and pattern/);
});

test("a catalogue paving supplement is a Ground_Plaza layer along its axis with inner border bands; water sits above it", () => {
  const ring = rect(170, -200, 190, -180);
  const supplements = [
    { kind: "paving", note: "plaza", pattern: "catalogue", tile: "plaza-mottled", ring, axis: [[170, -200], [190, -200]], borders: [{ widthM: 0.6, tile: "slate-band" }] },
    { kind: "water", note: "pool", ring: rect(175, -195, 185, -185), rim: { widthM: 0.6, tile: "slate-band" } },
  ];
  const { layers } = buildSurfaces({ ...fixture(), groundFeatures: { osm: [], lines: [], facilities: [], unlabelledLabels: [], supplements } });
  const plaza = layers.find((l) => l.source_ref === "paving: plaza");
  assert.deepEqual([plaza.mesh, plaza.pattern, plaza.label, plaza.precedence], ["Ground_Plaza", "plaza-mottled", null, PRECEDENCE.TILES], "a restyle leaves the label raster alone");
  const without = buildSurfaces({ ...fixture(), groundFeatures: { osm: [], lines: [], facilities: [], unlabelledLabels: [], supplements: [] } });
  const withPlaza = buildSurfaces({ ...fixture(), groundFeatures: { osm: [], lines: [], facilities: [], unlabelledLabels: [], supplements: [supplements[0]] } });
  assert.deepEqual(withPlaza.labelRaster(width, height, toPixel), without.labelRaster(width, height, toPixel));
  const addedLayers = buildSurfaces({ ...fixture(), groundFeatures: { osm: [], lines: [], facilities: [], unlabelledLabels: [], supplements: [{ ...supplements[0], walkable: true }] } }).layers;
  const added = addedLayers.find((l) => l.source_ref === "paving: plaza");
  assert.deepEqual([added.label, added.walkableAdded, added.labelPrecedence], [SURFACE_CLASS.PAVING, true, PRECEDENCE.PAVING], "an added plaza claims natural ground only");
  assert.equal(added.walkablePlaza, true, "a walkable catalogue plaza joins the pedestrian polygons");
  assert.deepEqual(addedLayers.filter((l) => l.walkablePlaza).map((l) => l.source_ref), ["paving: plaza"], "its border bands do not");
  assert.equal(plaza.walkablePlaza, undefined);
  assert.deepEqual(plaza.uvFrame.u, [1, 0]);
  assert.equal(plaza.uvFrame.sizeM, 6);
  const band = layers.find((l) => l.source_ref.startsWith("paving band slate-band"));
  assert.equal(band.rings.length, 2, "a band is the outline with the inset as its hole");
  assert.ok(band.precedence > plaza.precedence);
  const water = layers.find((l) => l.source_ref === "water: pool");
  assert.deepEqual([water.mesh, water.paint.kind, water.label], ["Ground_Sports", "water", SURFACE_CLASS.PAINTED]);
  assert.ok(water.precedence > band.precedence && water.precedence < PRECEDENCE.APRON);
  assert.ok(layers.some((l) => l.source_ref.startsWith("water rim slate-band")));
  assert.throws(() => buildSurfaces({ ...fixture(), groundFeatures: { osm: [], lines: [], facilities: [], unlabelledLabels: [], supplements: [{ kind: "paving", note: "x", pattern: "catalogue", tile: "moss", ring }] } }), /no pattern moss/);
});

test("estimated walkway strips become estimated Ground_Walkway paving under the road layers", () => {
  const strip = { id: "WALKWAY_T", source_ref: "EDGE_FB_T", rings: [[[243600, 263800], [243610, 263800], [243610, 263801.5], [243600, 263801.5]]] };
  const { layers } = buildSurfaces({ ...fixture(), estimatedWalkways: [strip] });
  const walkway = layers.filter((l) => l.mesh === "Ground_Walkway");
  assert.equal(walkway.length, 1);
  assert.equal(walkway[0].estimated, true);
  assert.equal(walkway[0].source_ref, "EDGE_FB_T");
  assert.ok(walkway[0].precedence < Math.min(...layers.filter((l) => l.cls === "ASPHALT").map((l) => l.precedence)));
});
