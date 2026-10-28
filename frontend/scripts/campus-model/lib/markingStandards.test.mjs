import assert from "node:assert/strict";
import test from "node:test";

import { DOCUMENTS, TEMPLATES, crosswalkLength } from "./markingStandards.mjs";
import { rowGeometry } from "./parkingRows.mjs";
import { roadTextBlock } from "./roadText.mjs";
import { modelToGeo, SCENE_UNITS_PER_METRE as U } from "./frame.mjs";

test("every template names its colour, kind and a source page in a listed document", () => {
  for (const [id, t] of Object.entries(TEMPLATES)) {
    assert.ok(["white", "yellow", "blue", "light_blue"].includes(t.colour), `${id} colour`);
    assert.ok(t.kind, `${id} kind`);
    assert.ok(DOCUMENTS[t.source.doc], `${id} source document`);
    assert.ok(t.source.page.length > 0, `${id} source page`);
  }
});

test("crosswalk 532: 0.45 m bars and gaps, widths of 4 m and 2 m steps, 3 m only below 3.5 m", () => {
  assert.equal(TEMPLATES.crosswalk.barM, 0.45);
  assert.equal(TEMPLATES.crosswalk.gapM, 0.45);
  assert.equal(crosswalkLength(3.6), 4);
  assert.equal(crosswalkLength(4.9), 4);
  assert.equal(crosswalkLength(5.2), 6);
  assert.equal(crosswalkLength(7.9), 8);
  assert.equal(crosswalkLength(3.2), 3);
});

test("line templates: statute widths and the urban dash patterns of 표 2-1", () => {
  assert.equal(TEMPLATES.lane_dashed.dashM, 3);
  assert.equal(TEMPLATES.lane_dashed.gapM, 5);
  assert.equal(TEMPLATES.centre_dashed.gapM, 3);
  assert.equal(TEMPLATES.centre_double.widthM + TEMPLATES.centre_double.gapM, 0.3);
  for (const id of ["centre_solid", "lane_solid", "edge_line", "guide_line"]) assert.equal(TEMPLATES[id].widthM, 0.15);
});

// A synthetic row: 4 bays along +x from the origin, depth towards +z (bearing 180 deg, south).
function row(extra = {}) {
  const geo = (x, z) => modelToGeo(x * U, z * U);
  return { start: geo(0, 0), end: geo(10.4, 0), depthBearing: 180, photoBays: 4, photoPitchM: 2.6, accessible: [], ...extra };
}

test("a stall row is one straight run of template bays with lines that never overlap", () => {
  const g = rowGeometry(row());
  assert.equal(g.template, "stall_expanded");
  assert.deepEqual(g.widths, [2.6, 2.6, 2.6, 2.6]);
  assert.equal(g.rects.filter((r) => r.part === "divider").length, 5);
  // dividers end at the inner edges of the long lines
  const zs = (r) => r.ring.map((p) => p[1]);
  const front = g.rects.find((r) => r.part === "front");
  const divider = g.rects.find((r) => r.part === "divider");
  assert.ok(Math.abs(Math.max(...zs(front)) - Math.min(...zs(divider))) < 1e-6);
  const normal = rowGeometry(row({ photoPitchM: 2.5, end: modelToGeo(10 * U, 0) }));
  assert.equal(normal.template, "stall_normal");
  assert.equal(normal.depth, 5);
});

test("an accessible bay is 3.3 m wide with its symbol square inside it, and the row stays centred on the photo", () => {
  const g = rowGeometry(row({ accessible: [0] }));
  assert.deepEqual(g.widths, [3.3, 2.6, 2.6, 2.6]);
  assert.equal(g.symbols.length, 1);
  const total = g.widths.reduce((a, w) => a + w, 0);
  assert.ok(Math.abs(g.origin[0] - (10.4 - total) / 2) < 1e-3);
});

test("road text: one box per syllable at the template size times the scale", () => {
  const b = roadTextBlock(["천천히"], 1);
  assert.equal(b.charHeightM, TEMPLATES.road_text.charHeightM);
  assert.ok(Math.abs(b.widthM - (3 * 0.75 + 2 * 0.25 * 0.75)) < 1e-9);
  assert.ok(b.polys.length >= 3);
  const half = roadTextBlock(["서행"], 0.5);
  assert.equal(half.charHeightM, 1);
});
