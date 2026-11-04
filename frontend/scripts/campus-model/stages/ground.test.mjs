// node --test scripts/campus-model/stages/ground.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { sceneToTm, tmToScene } from "../../../src/geo/epsg5186.mjs";
import { loadParcels, retainPaint } from "../lib/parcels.mjs";
import { SURFACE_CLASS } from "../lib/surfaceClass.mjs";
import { validate } from "../lib/schemas.mjs";
import { planKerbs } from "./kerbs.mjs";
import { parcelSurfaces } from "./ground.mjs";

const tm = (ring) => ring.map(([x, z]) => sceneToTm(x, z));
const record = (over) => ({
  holes: [], label: SURFACE_CLASS.ASPHALT, source: "road-zone-measured", evidence: { tier: "T0", refs: ["x"] }, estimated: false, ...over,
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
