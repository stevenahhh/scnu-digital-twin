// Geometry checks for the pavilion builders of stages/furniture.mjs (pavilion_hip, pavilion_octagon) on flat ground.
import assert from "node:assert/strict";
import test from "node:test";
import { metres } from "../lib/frame.mjs";
import { B, makeContext, restDims } from "./furniture.mjs";

const flatContext = () => makeContext({ groundAt: () => 0, objects: [], roads: { arterials: [], connectors: [], zoneRings: [] }, sites: null, fieldCentre: null });

// Bounding box in metres of everything a builder drew (solid and glass), for an instance at the origin facing east.
function build(kind, props = {}) {
  const ctx = flatContext();
  B[kind](ctx, { id: "T1", kind, surveyKind: kind, point: [0, 0], p: { bearing_deg: 90, dims: {}, ...props } });
  const positions = [...ctx.solid.mesh.positions, ...ctx.glass.mesh.positions];
  const box = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k += 1) {
      box.min[k] = Math.min(box.min[k], positions[i + k] / metres(1));
      box.max[k] = Math.max(box.max[k], positions[i + k] / metres(1));
    }
  }
  return { ctx, box, triangles: ctx.solid.triangleCount };
}
const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-6, `${label}: ${actual} != ${expected}`);

test("pavilion_hip: plan + 2 x overhang wide, as high as the ridge", () => {
  const dims = { planWidthM: 4.6, planDepthM: 3.6, roofOverhangM: 0.7, ridgeHeightM: 3.6 };
  const { box } = build("pavilion_hip", { dims });
  near(box.max[0] - box.min[0], 4.6 + 2 * 0.7, "width along the axis");
  near(box.max[2] - box.min[2], 3.6 + 2 * 0.7, "depth across the axis");
  near(box.max[1], 3.6, "ridge height");
  const square = build("pavilion_hip").box;
  const d = restDims("pavilion_hip");
  near(square.max[0] - square.min[0], d.planWidthM + 2 * d.roofOverhangM, "catalogue default width");
  near(square.max[1], d.ridgeHeightM, "catalogue default ridge");
});

test("pavilion_octagon: the apex is apexHeightM, cantilever or posts", () => {
  for (const support of ["posts", "cantilever"]) {
    for (const tiers of [1, 2, 3]) {
      const { box } = build("pavilion_octagon", { support, tiers, dims: { apexHeightM: 4.2, eaveHeightM: 2.5 } });
      near(box.max[1], 4.2, `apex (${support}, tiers ${tiers})`);
    }
  }
});

test("pavilion_octagon cantilever: the hook crest tops the canopy, tiers step up, the deck carries a bench", () => {
  const props = { support: "cantilever", dims: { apexHeightM: 4.0, eaveHeightM: 2.4, circumscribedM: 4.7, floorHeightM: 0 } };
  const heights = (ctx) => ctx.solid.mesh.positions.filter((_, i) => i % 3 === 1).map((y) => y / metres(1));
  const one = build("pavilion_octagon", { ...props, tiers: 1 });
  const three = build("pavilion_octagon", { ...props, tiers: 3 });
  assert.ok(three.triangles > one.triangles, "three tiers draw more than one");
  const levels = new Set(heights(three.ctx).filter((y) => y > 2.4 && y < 3.6).map((y) => y.toFixed(3)));
  assert.ok(levels.size > new Set(heights(one.ctx).filter((y) => y > 2.4 && y < 3.6).map((y) => y.toFixed(3))).size, "tier steps add height levels");
  const decked = build("pavilion_octagon", { ...props, tiers: 3, deck: { lengthM: 3, widthM: 2, offsetM: [-1.6, 0.4], benchLengthM: 1.8 } });
  assert.ok(heights(decked.ctx).some((y) => Math.abs(y - 0.12) < 1e-6), "deck top at 0.12 m");
  assert.ok(heights(decked.ctx).some((y) => Math.abs(y - (0.12 + 0.46)) < 1e-6), "bench seat 0.46 m above the deck");
});

test("a floor height of 0 leaves the deck out", () => {
  const raised = build("pavilion_hip", { dims: { floorHeightM: 0.45 } });
  const flat = build("pavilion_octagon", { dims: { floorHeightM: 0 } });
  const raisedOct = build("pavilion_octagon", { dims: { floorHeightM: 0.45 } });
  assert.ok(raised.box.min[1] < 0, "the hip pavilion's plinth is sunk into the ground");
  assert.ok(raisedOct.triangles > flat.triangles, "a raised octagon draws its deck");
  // without a deck nothing of the octagon reaches below its sunk column feet, and nothing lies at deck level
  const deckTop = flat.ctx.solid.mesh.positions.filter((_, i) => i % 3 === 1).some((y) => Math.abs(y / metres(1) - 0.45) < 1e-6);
  assert.equal(deckTop, false, "no deck surface at 0.45 m");
});

test("dims outside the catalogue range are refused", () => {
  assert.throws(() => build("pavilion_hip", { dims: { eaveHeightM: 4.5 } }), /pavilion_hip\.eaveHeightM 4\.5 lies outside the catalogue range 2\.4-3/);
  assert.throws(() => build("pavilion_hip", { dims: { eave: 2.5 } }), /not a pavilion_hip dimension/);
});
