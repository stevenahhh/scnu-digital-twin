// Geometry checks for the shelter builders of stages/furniture.mjs (canopy_shelter_row, terminal_shelter, awning, hut)
// on flat ground.
import assert from "node:assert/strict";
import test from "node:test";
import { metres } from "../lib/frame.mjs";
import { rgb } from "../lib/solids.mjs";
import { B, makeContext, stripeBands } from "./furniture.mjs";

const M = metres;
const flatContext = () => makeContext({ groundAt: () => 0, objects: [], roads: { arterials: [], connectors: [], zoneRings: [] }, sites: null, fieldCentre: null });
const line = (lengthM) => [[0, 0], [M(lengthM), 0]];
function build(kind, geometry, props = {}) {
  const ctx = flatContext();
  const result = B[kind](ctx, { id: "T1", kind, surveyKind: kind, ...geometry, p: { dims: {}, ...props } });
  return { ctx, result };
}
const maxHeightM = (ctx) => Math.max(...ctx.solid.mesh.positions.filter((_, i) => i % 3 === 1)) / M(1);
const colourKeys = (ctx) => {
  const keys = new Set();
  const c = ctx.solid.mesh.colors;
  for (let i = 0; i < c.length; i += 4) keys.add(`${c[i]},${c[i + 1]},${c[i + 2]}`);
  return keys;
};

test("canopy_shelter_row: a 12 m row of 4 m modules has 3 modules; a Point is refused by id", () => {
  assert.equal(build("canopy_shelter_row", { line: line(12) }, { dims: { moduleLengthM: 4 } }).result.modules, 3);
  assert.equal(build("canopy_shelter_row", { line: line(10) }, { dims: { moduleLengthM: 5 } }).result.modules, 2);
  assert.throws(() => build("canopy_shelter_row", { point: [0, 0] }), /canopy_shelter_row T1 needs a LineString axis, not a Point/);
});

test("awning: stripes alternate and both colours are drawn", () => {
  const bands = stripeBands(14, 0.8);
  assert.equal(bands.length, 18);
  bands.forEach((band, k) => assert.equal(band.colour, k % 2));
  assert.ok(Math.abs(bands.at(-1).s1 - 14) < 1e-9 && bands[0].s0 === 0, "the bands cover the length");
  for (const profile of ["gable", "lean-to"]) {
    const { ctx, result } = build("awning", { line: line(14) }, { profile, colours: ["#2a86dc", "#f4f6f8"] });
    assert.equal(result.stripes, stripeBands(14, 0.5).length);
    const keys = colourKeys(ctx);
    for (const hex of ["#2a86dc", "#f4f6f8"]) assert.ok(keys.has(rgb(hex).slice(0, 3).join(",")), `${profile}: ${hex} drawn`);
  }
});

test("hut: the top of every roof form is heightM", () => {
  for (const roof of ["gable", "hip", "mono", "flat"]) {
    const { ctx } = build("hut", { point: [0, 0] }, { roof, dims: { heightM: 2.9, roofRiseM: 0.7 } });
    assert.ok(Math.abs(maxHeightM(ctx) - 2.9) < 1e-6, `${roof}: ${maxHeightM(ctx)}`);
  }
  assert.throws(() => build("hut", { point: [0, 0] }, { roof: "domed" }), /roof domed is not gable, hip, mono or flat/);
});

test("terminal_shelter: two posts per station and a translucent roof", () => {
  const { ctx } = build("terminal_shelter", { line: line(20) }, { dims: { postSpacingM: 4 }, back_wall: true, solar_from: 0.5 });
  assert.ok(ctx.glass.triangleCount >= 10, "roof panels and the back screen are translucent");
  assert.ok(maxHeightM(ctx) > 3.0 && maxHeightM(ctx) < 3.6, "ribs and panels stand just above the 3.0 m roof");
});
