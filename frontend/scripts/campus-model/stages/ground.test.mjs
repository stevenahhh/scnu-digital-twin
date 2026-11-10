// node --test scripts/campus-model/stages/ground.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { sceneToTm, tmToScene } from "../../../src/geo/epsg5186.mjs";
import { loadParcels, retainPaint } from "../lib/parcels.mjs";
import { SURFACE_CLASS } from "../lib/surfaceClass.mjs";
import { validate } from "../lib/schemas.mjs";
import { planKerbs } from "./kerbs.mjs";
import { buildGround, parcelSurfaces } from "./ground.mjs";
import { parkingPlan, loadParking } from "./parking.mjs";
import { groundTile, planarTileUv, triangulate } from "./surfaces.mjs";
import { GlbBuilder } from "../lib/glb.mjs";
import { EXTENT } from "../lib/frame.mjs";
import { LANDCOVER, D4_MATERIAL_SCOPE } from "../lib/landcover.mjs";
import { assertBuildInvariants } from "../qa/invariants.mjs";
import { readFileSync } from "node:fs";
import { applyParcelCuration } from "../fit/parcelsSeed.mjs";

const tm = (ring) => ring.map(([x, z]) => sceneToTm(x, z));
const record = (over) => ({
  holes: [], label: SURFACE_CLASS.ASPHALT, source: "road-zone-measured", evidence: { tier: "T0", refs: ["x"] }, estimated: false, ...over,
});

test("natural terrain uses metric D4 tiles only inside its scope and splits landcover cells", async () => {
  const glb = new GlbBuilder();
  const output = [];
  const addMesh = glb.addMesh.bind(glb);
  glb.addMesh = (name, primitives) => {
    output.push(...primitives);
    return addMesh(name, primitives);
  };
  const landcoverAt = x => Math.floor(x - EXTENT.minX) % 2 === 0 ? LANDCOVER.SOIL : LANDCOVER.GRASS;
  const ground = await buildGround({
    glb, inputs: { heightAt: () => 0, landcoverAt },
    parcelsDoc: { parcels: [], kerbLines: [] },
  });
  ground.buildTopography(triangle => [triangle]);
  const [west, south, east, north] = D4_MATERIAL_SCOPE.bbox;
  const seen = new Set();
  for (const primitive of output) {
    const name = glb.json.materials[primitive.material].name;
    seen.add(name);
    const cls = name === "Ground_Soil_D4" ? "d4-soil" : name === "Ground_Grass_D4" ? "d4-grass" : null;
    for (let k = 0; k < primitive.indices.length; k += 3) {
      const vertices = Array.from(primitive.indices.slice(k, k + 3), i => [primitive.positions[i * 3], primitive.positions[i * 3 + 2]]);
      const centre = [0, 1].map(axis => vertices.reduce((sum, p) => sum + p[axis], 0) / 3);
      const [e, n] = sceneToTm(...centre);
      if (!cls) {
        assert.ok(e <= west + 1e-4 || e >= east - 1e-4 || n <= south + 1e-4 || n >= north - 1e-4,
          "the old colour map must not cover D4 natural ground");
        continue;
      }
      assert.equal(cls, landcoverAt(centre[0]) === LANDCOVER.SOIL ? "d4-soil" : "d4-grass");
      for (const point of vertices) {
        const [e, n] = sceneToTm(...point);
        assert.ok(e >= west - 1e-4 && e <= east + 1e-4 && n >= south - 1e-4 && n <= north + 1e-4,
          "D4 material must not reach outside the authorised box");
        const cell = Math.floor(centre[0] - EXTENT.minX) + EXTENT.minX;
        assert.ok(point[0] >= cell - 1e-4 && point[0] <= cell + 1 + 1e-4,
          "one triangle cannot interpolate across landcover classes");
      }
    }
    if (cls) for (let i = 0; i < primitive.positions.length / 3; i++) {
      const expected = planarTileUv(primitive.positions[i * 3], primitive.positions[i * 3 + 2], groundTile(cls).entry.physicalSizeM);
      expected.forEach((value, axis) => assert.ok(Math.abs(primitive.uvs[i * 2 + axis] - value) < 1e-4));
    }
  }
  assert.deepEqual([...seen].sort(), ["Ground", "Ground_Grass_D4", "Ground_Soil_D4"]);
});
// a road with a raised A003 sidewalk on it and one open kerb line
const SIDEWALK = [[100, -200], [120, -200], [120, -190], [100, -190]];
const doc = {
  parcels: [
    record({ id: "PARCEL_ASPHALT_ROAD", cls: "ASPHALT", class: "road", mesh: "Ground_Asphalt", precedence: 3, source_ref: "road zone 0", ring: tm([[80, -220], [140, -220], [140, -170], [80, -170]]), paintAllowed: true }),
    record({ id: "PARCEL_PAVING_U1", cls: "PAVING", class: "sidewalk", mesh: "Ground_Pavers", label: SURFACE_CLASS.PAVING, precedence: 5, source: "NGII-A003", source_ref: "U1; registration REG001", ring: tm(SIDEWALK), paintAllowed: false, render: { walkway: true, surface: "blockPaver" } }),
  ],
  kerbLines: [{ ufid: "U2", surface: "existing", line: tm([[125, -215], [125, -175]]) }],
  paintExcluded: [],
};

test("reviewed paint suppression excludes only the named pieces without excluding their ground parcel", () => {
  const suppressed = { id: "row/back", reason: "edge hidden by canopy", refs: ["review/row"] };
  const s = parcelSurfaces({ ...doc, paintExcluded: ["old"], paintSuppressed: [suppressed] });
  const ring = [[[0, 0], [1, 0], [0, 1]]];
  const pieces = [
    { partId: "row/back", kind: "line", rings: ring },
    { partId: "row/front", kind: "line", rings: ring },
    { id: "legacy", partId: "row/back", kind: "line", rings: ring },
  ];
  assert.deepEqual(retainPaint(pieces, s, p => p), pieces.slice(1));
  assert.deepEqual(s.paintExcludedDetail, []);
  assert.deepEqual(s.parcels, doc.parcels);
});

test("parcelSurfaces: layers in file order, the walkway parcel ring closed as a kerb line, open kerbLines kept", () => {
  const s = parcelSurfaces(doc);
  assert.deepEqual(s.layers.map((l) => [l.parcel, l.mesh, l.walkway ?? false]), [["PARCEL_ASPHALT_ROAD", "Ground_Asphalt", false], ["PARCEL_PAVING_U1", "Ground_Pavers", true]]);
  assert.deepEqual(s.outlines.map((o) => [o.ufid, o.closed]), [["U1", true], ["U2", false]]);
  assert.equal(s.strokes.length, 2);
  assert.ok(s.strokes.every((k) => k.label === SURFACE_CLASS.KERB));
});

test("the label raster keeps labelRaster semantics: walkway PAVING over road ASPHALT, kerb stones on the outline", () => {
  const s = parcelSurfaces(doc);
  // 10 px per scene unit, so the 0.3 m edge stone covers whole pixels
  const K = 10;
  const W = 100 * K;
  const H = 80 * K;
  const toPixel = ([E, N]) => {
    const [x, z] = tmToScene(E, N);
    return [(x - 70) * K, (z + 230) * K];
  };
  const labels = s.labelRaster(W, H, toPixel);
  const at = (x, z) => labels[Math.floor((z + 230) * K) * W + Math.floor((x - 70) * K)];
  assert.equal(at(110, -195), SURFACE_CLASS.PAVING);
  assert.equal(at(90, -210), SURFACE_CLASS.ASPHALT);
  assert.equal(at(75, -225), SURFACE_CLASS.NATURAL);
  assert.equal(at(100.02, -195), SURFACE_CLASS.KERB);
  assert.equal(at(125.02, -195), SURFACE_CLASS.KERB, "the open kerb line is stroked too");
});

test("kerbs derive from the parcel boundary: every edge of the sidewalk parcel facing the road gets a kerb", () => {
  const s = parcelSurfaces(doc);
  const plan = planKerbs({
    walkways: s.layers.filter((l) => l.walkway).map((l) => l.rings),
    outlines: s.outlines.filter((o) => o.closed),
    crossings: [],
    labelAt: () => SURFACE_CLASS.ASPHALT,
    terrainAt: () => 0,
    warn: () => {},
  });
  assert.ok(plan.pieces.length > 0);
  assert.equal(plan.pieces.length, plan.lines[0].pieces.length, "the whole parcel ring is kerbed");
});

test("data/ground/parcels.json is valid, every parcel has a design class and paint only on road and lot", () => {
  const committed = loadParcels();
  const { ok, errors } = validate("parcels", committed);
  assert.ok(ok, errors.slice(0, 10).join("\n"));
  for (const p of committed.parcels) {
    assert.ok(p.class, `${p.id} has no class`);
    assert.equal(p.paintAllowed, p.class === "road" || p.class === "lot", p.id);
  }
  // no lawn, court or track parcel allows paint (the paint-on-grass invariant's data side)
  assert.equal(committed.parcels.filter((p) => ["lawn", "court", "track", "water"].includes(p.class) && p.paintAllowed).length, 0);
});

test("D4 west accessible bay and north roadside ticks have paintable ground under their entire area", () => {
  const ids = new Set([
    "LOT_E243476_N263851/R5/S0/fill",
    "LOT_D4_NORTH_ROADSIDE/R1/D0",
    "LOT_D4_NORTH_ROADSIDE/R1/D2",
    "LOT_D4_NORTH_ROADSIDE/R1/D3",
  ]);
  const pieces = parkingPlan(loadParking()).pieces.filter(p => ids.has(p.id));
  assert.equal(pieces.length, ids.size);
  const paintPieces = pieces.map(p => ({
    id: p.id,
    triangles: triangulate(p.rings.map(r => r.map(([x, z]) => sceneToTm(x, z))))
      .map(t => t.map(([x, z]) => sceneToTm(x, z))),
  }));
  assert.doesNotThrow(() => assertBuildInvariants({
    groundFootprints: [], anchors: [], footprints: [], evidenceRecords: [],
    parcels: loadParcels().parcels, paintPieces, packApplications: [],
    determinism: { id: "fixture", firstHash: "same", secondHash: "same" },
  }));
});

test("D4 north roadside emitted paint has allowed ground under every candidate triangle", () => {
  const fixture = JSON.parse(readFileSync(new URL("./ground.paint-d4.fixture.json", import.meta.url), "utf8"));
  assert.doesNotThrow(() => assertBuildInvariants({
    groundFootprints: [], anchors: [], footprints: [], evidenceRecords: [],
    parcels: loadParcels().parcels, paintPieces: fixture.pieces, packApplications: [],
    determinism: { id: "fixture", firstHash: "same", secondHash: "same" },
  }));
});

test("D4 paint ground repairs are reproduced from parcel curation with the building hole retained", () => {
  const curation = JSON.parse(readFileSync(new URL("../data/ground/parcel-curation.json", import.meta.url), "utf8"));
  const snapshot = loadParcels().parcels;
  const apron = snapshot.find(p => p.id === "PARCEL_PAVING_BUILDING_149");
  const support = snapshot.find(p => p.id === "PARCEL_D4_WEST_ACCESSIBLE_R5");
  const road = snapshot.find(p => p.id === "PARCEL_ASPHALT_ROAD_ZONE_11");
  const seeded = {
    ...apron,
    ring: [[243525.3271, 263922.0831], [243527.0312, 263928.7408],
      [243514.3668, 263931.9751], [243512.6619, 263925.3296]],
  };
  const seededRoad = { ...road, ring: road.ring.map((p, i) =>
    i === road.ring.length - 1 ? [243507.364, 263933.4398] : p) };
  const replay = applyParcelCuration([seeded, seededRoad], {
    replace: curation.replace.filter(p => p.id === apron.id || p.id === road.id),
    add: curation.add.filter(p => p.id === support.id),
    remove: [], notAsphalt: [], unreachable: [],
  });
  assert.deepEqual(replay.kept[0].ring, apron.ring);
  assert.deepEqual(replay.kept[0].holes, seeded.holes);
  assert.deepEqual(replay.kept[1].ring, road.ring);
  assert.deepEqual(replay.kept[1].evidence, road.evidence);
  assert.deepEqual(replay.added.map(p => [p.id, p.ring, p.paintAllowed, p.evidence]),
    [[support.id, support.ring, true, support.evidence]]);
});
