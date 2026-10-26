import assert from "node:assert/strict";
import test from "node:test";

import { areaPerimeterWidth, buildSidewalks, centrelineOutside, chainLines, fillPlaceholders } from "./sidewalks.mjs";

const closed = (pts) => [...pts, pts[0]];
const rect = (x0, y0, x1, y1) => closed([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
const walkway = (ufid, lines, extra = {}) => ({ ufid, widt: 0, qual: "SWQ003", scls: "A0033324", lines, ...extra });
const quiet = () => {};
const length = (pts) => pts.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);

test("a 3 x 40 m ring gives one strip on its long axis, width from area and perimeter", () => {
  const r = buildSidewalks({ walkways: [walkway("U1", [rect(0, 0, 40, 3)])], warn: quiet });
  assert.equal(r.strips.length, 1);
  assert.equal(r.strips[0].width_source, "area_perimeter");
  assert.ok(Math.abs(r.strips[0].width_m - 3) <= 0.1, `width ${r.strips[0].width_m}`);
  const own = r.edges.filter((e) => !e.link);
  assert.equal(own.length, 1);
  for (const p of own[0].points) assert.ok(Math.abs(p[1] - 1.5) <= 0.1, `off axis ${p}`);
  const len = length(own[0].points);
  assert.ok(len >= 37 && len <= 40, `length ${len}`);
  assert.equal(own[0].kind, "sidewalk");
  assert.equal(own[0].source, "NGII-A003");
  assert.equal(own[0].source_ref, "U1");
  assert.equal(own[0].authoritative, true);
  assert.equal(own[0].derived, false);
  assert.equal(own[0].estimated, false);
  assert.deepEqual(centrelineOutside(r), []);
  // vertices densified to <= 10 m
  for (let i = 0; i + 1 < own[0].points.length; i += 1) assert.ok(Math.hypot(own[0].points[i + 1][0] - own[0].points[i][0], own[0].points[i + 1][1] - own[0].points[i][1]) <= 10 + 1e-9);
});

test("an L-shaped ring: one junction-free corner, no spur shorter than 2 x width", () => {
  const r = buildSidewalks({ walkways: [walkway("U2", [closed([[0, 0], [30, 0], [30, 3], [3, 3], [3, 20], [0, 20]])])], warn: quiet });
  const own = r.edges.filter((e) => !e.link);
  for (const e of own) assert.ok(length(e.points) >= 6, `spur ${length(e.points)}`);
  assert.deepEqual(centrelineOutside(r), []);
});

test("a branchy ring without widt is measured along its skeleton", () => {
  const T = closed([[0, 0], [26, 0], [26, -30], [34, -30], [34, 0], [60, 0], [60, 8], [0, 8]]);
  const r = buildSidewalks({ walkways: [walkway("U3", [T], { widt: null })], warn: quiet });
  assert.equal(r.strips[0].width_source, "skeleton_median");
  assert.ok(Math.abs(r.strips[0].width_m - 8) < 0.5, `width ${r.strips[0].width_m}`);
});

test("widt wins when it is given", () => {
  const r = buildSidewalks({ walkways: [walkway("U4", [rect(0, 0, 40, 3)], { widt: 4.5 })], warn: quiet });
  assert.equal(r.strips[0].width_source, "widt");
  assert.equal(r.strips[0].width_m, 4.5);
});

test("two parallel open lines 2.0 m apart pair into one strip", () => {
  const r = buildSidewalks({
    walkways: [walkway("U5", [[[0, 0], [30, 0]]]), walkway("U6", [[[2, 2], [32, 2]]]), walkway("U9", [[[-50, -50], [-40, -40], [-60, -30]]])],
    warn: quiet,
  });
  const paired = r.strips.filter((s) => s.outline === "paired");
  assert.equal(paired.length, 1);
  assert.equal(paired[0].width_source, "paired_lines");
  assert.ok(Math.abs(paired[0].width_m - 2) <= 0.05, `width ${paired[0].width_m}`);
  assert.deepEqual(paired[0].ufids, ["U5", "U6"]);
});

test("a lone open line is listed as unpaired and gets no strip", () => {
  const warnings = [];
  const r = buildSidewalks({ walkways: [walkway("U7", [[[0, 0], [30, 0], [30, 30]]])], warn: (m) => warnings.push(m) });
  assert.equal(r.strips.length, 0);
  assert.equal(r.unpaired.length, 1);
  assert.ok(warnings.some((m) => m.startsWith("unpaired A003 line ufid=U7")));
});

test("open outline pieces that meet end to end are chained into one strip", () => {
  // a 3 x 40 outline cut into a long U and a short closing piece (two features)
  const r = buildSidewalks({ walkways: [walkway("U10", [[[40, 0], [0, 0], [0, 3], [40, 3]]]), walkway("U11", [[[40, 3], [40, 0]]])], warn: quiet });
  assert.equal(r.strips.length, 1);
  assert.equal(r.strips[0].outline, "chained");
  assert.deepEqual(r.strips[0].ufids, ["U10", "U11"]);
  const c = chainLines([{ ufid: "a", points: [[0, 0], [10, 0]] }, { ufid: "b", points: [[10, 0], [10, 2], [0, 2], [0, 0.1]] }], [0, 0, 10, 2]);
  assert.equal(c.closed.length, 1);
});

test("ids are identical across runs and input order, coverage reaches 1 m", () => {
  const ws = [walkway("U30", [rect(0, 0, 40, 3)]), walkway("U10", [rect(0, 10, 40, 13)]), walkway("U20", [rect(0, 20, 40, 23)])];
  const placeholders = [{ element_id: "SW_001", ufid: "U10" }, { element_id: "SW_002", ufid: "U20" }, { element_id: "SW_003", ufid: "U30" }];
  const a = buildSidewalks({ walkways: ws, placeholders, warn: quiet });
  const b = buildSidewalks({ walkways: [ws[2], ws[0], ws[1]], placeholders, warn: quiet });
  assert.deepEqual(a.strips.map((s) => [s.id, s.ufids[0]]), [["SW_001", "U10"], ["SW_002", "U20"], ["SW_003", "U30"]]);
  assert.deepEqual(b.strips.map((s) => s.id), a.strips.map((s) => s.id));
  assert.deepEqual(b.edges.map((e) => [e.id, e.sidewalk_id]), a.edges.map((e) => [e.id, e.sidewalk_id]));
  assert.equal(a.coverage(20, 3.9), true);
  assert.equal(a.coverage(20, 4.1), false);
});

test("a strip beside a road segment gets its side suffix", () => {
  const roadSegments = { features: [{ type: "Feature", geometry: { type: "LineString", coordinates: [[0, -5], [40, -5]] }, properties: { id: "RD_001", kind: "interior" } }] };
  const r = buildSidewalks({ walkways: [walkway("U1", [rect(0, 0, 40, 3)])], roadSegments, placeholders: [{ element_id: "SW_007", ufid: "U1" }], warn: quiet });
  assert.equal(r.strips[0].id, "SW_007_L");
  assert.equal(r.strips[0].road_id, "RD_001");
});

test("a ring with 3 points is skipped with a warning and the build continues", () => {
  const warnings = [];
  const r = buildSidewalks({ walkways: [walkway("BAD", [[[0, 0], [1, 0], [0, 0]]]), walkway("OK", [rect(0, 0, 40, 3)])], warn: (m) => warnings.push(m) });
  assert.ok(warnings.includes("A003 ufid=BAD: ring with 3 points skipped"));
  assert.equal(r.strips.length, 1);
});

test("touching strips are joined into one component", () => {
  const r = buildSidewalks({ walkways: [walkway("U1", [rect(0, 0, 40, 3)]), walkway("U2", [rect(40, 0, 80, 3)])], warn: quiet });
  assert.equal(r.stats.components, 1);
});

test("rectangle width solve", () => {
  assert.ok(Math.abs(areaPerimeterWidth(120, 86) - 3) < 1e-9);
});

test("placeholders are filled add-only", () => {
  const text = `${JSON.stringify({ metadata: {}, elements: [{ element_id: "RD_001" }], sidewalk_placeholders: [{ element_id: "SW_001", ufid: "U1", geometry: null }] }, null, 2)}\n`;
  const out = JSON.parse(fillPlaceholders(text, { strips: [{ id: "SW_001", ufids: ["U1"], width_m: 3, width_source: "widt" }] }));
  assert.deepEqual(out.sidewalk_placeholders[0], { element_id: "SW_001", ufid: "U1", geometry: null, width_m: 3, width_source: "widt", strip_ids: ["SW_001"] });
  assert.equal(out.elements.length, 1);
});
