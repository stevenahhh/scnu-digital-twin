// Checks for the VR site-detail builders of stages/furniture.mjs (hedges and shrub masses, car-park stall rows, street furniture, hedge lettering, LED screens) on flat
// ground.
import assert from "node:assert/strict";
import test from "node:test";
import { metres } from "../lib/frame.mjs";
import { pointInRing } from "../lib/geometry.mjs";
import { offsetLine, rgb } from "../lib/solids.mjs";
import { B, hedgeTextStrokes, makeContext, moundAt, onRoof, parasolColour, stallRow } from "./furniture.mjs";

const M = metres;
const sites = { inArea: () => false, labelAt: () => null, classes: { PAVING: 1, ASPHALT: 2 } };
const flatContext = () => makeContext({ groundAt: () => 0, objects: [], roads: { arterials: [], connectors: [], zoneRings: [] }, sites, fieldCentre: null });
const line = (lengthM) => [[0, 0], [M(lengthM), 0]];
function build(kind, geometry, p) {
  const ctx = flatContext();
  B[kind](ctx, { id: "SD-T1", kind, surveyKind: kind, heightM: 0, ...geometry, p });
  return ctx;
}
const ys = (ctx) => ctx.solid.mesh.positions.filter((_, i) => i % 3 === 1).map((y) => y / M(1));
const near = (a, b, what) => assert.ok(Math.abs(a - b) < 1e-6, `${what}: ${a} vs ${b}`);

test("stall row geometry: one stall per 2.5 m, dividers on the chosen side or bearing, wheel stops 0.9 m in from the back; nothing drawn", () => {
  const row = stallRow(line(25), { side: "left" });
  assert.equal(row.n, 10);
  assert.equal(row.dividers.length, 11);
  near(row.dividers[0][1][1] / M(1), -5, "left of an eastward line is north (-z)");
  near(stallRow(line(25), { side: "right" }).dividers[0][1][1] / M(1), 5, "right is south");
  near(stallRow(line(25), { bearingDeg: 180, depthM: 4 }).dividers[0][1][1] / M(1), 4, "a bearing of 180 runs south");
  near(row.stops[0].centre[1] / M(1), -4.1, "stop");
  assert.equal(stallRow(line(25), { stalls: 9 }).n, 9);
  // the stall paint is the photo-read rows of stages/markingsStandard.mjs: the VR stall rows draw nothing here
  assert.equal(ys(build("stall_row", { line: line(25) }, { side: "left", wheel_stops: true })).length, 0, "no furniture stall paint");
});

test("hedges and shrub masses reach their height", () => {
  near(Math.max(...ys(build("hedge", { line: line(6) }, { height_m: 1.2 }))), 1.2, "hedge");
  near(Math.max(...ys(build("hedge", { point: [0, 0] }, { radius_m: 0.7, height_m: 0.9 }))), 0.9, "round shrub");
  const ring = [[0, 0], [M(3), 0], [M(3), M(2)], [0, M(2)]];
  near(Math.max(...ys(build("hedge", { ring }, {}))), 1.0, "clipped mass, default height");
});

test("street furniture reaches its standard height; bollards and stands repeat along their line", () => {
  near(Math.max(...ys(build("bollard", { line: line(6) }, { spacing_m: 1.5 }))), 0.9, "bollard");
  assert.equal(build("bollard", { line: line(6) }, { spacing_m: 1.5 }).solid.mesh.positions.length, 5 * build("bollard", { point: [0, 0] }, {}).solid.mesh.positions.length);
  near(Math.max(...ys(build("bike_stands", { line: line(4.5) }, {}))), 0.775, "stand top (0.75 m plus half the tube)");
  near(Math.max(...ys(build("bin", { point: [0, 0] }, { count: 2 }))), 0.95, "bin");
  near(Math.max(...ys(build("handrail", { line: line(6) }, {}))), 0.9 + 0.025, "rail top");
  const ring = [[0, 0], [M(4), 0], [M(4), M(3)], [0, M(3)]];
  const ctx = flatContext();
  B.entrance_canopy(ctx, { id: "SD-T2", kind: "entrance_canopy", heightM: 3.2, ring, p: { posts: [2, 3] } });
  near(Math.max(...ys(ctx)), 3.2, "canopy top");
  near(Math.min(...ys(ctx)), -0.05, "posts reach into the ground");
});

test("hedge lettering: one stroke set per character, tops to the left of the baseline; LED screen panel", () => {
  const strokes = hedgeTextStrokes(line(20), "진리 정의", { heightM: 3, widthM: 3, gapM: 0.5 });
  assert.ok(strokes.length >= 10, `${strokes.length} strokes`);
  const zs = strokes.flatMap((s) => s.points.map((p) => p[1] / M(1)));
  assert.ok(Math.min(...zs) >= -3 - 1e-9 && Math.max(...zs) <= 1e-9, "letters lie north (left) of an eastward baseline");
  const ctx = flatContext();
  B.hedge_text(ctx, { id: "SD-T3", kind: "hedge_text", heightM: 0.6, line: line(20), p: { text: "창조", char_height_m: 3, stroke_m: 0.5 } });
  near(Math.max(...ys(ctx)), 0.6, "hedge text top");
  const sc = flatContext();
  B.led_screen(sc, { id: "SD-T4", kind: "led_screen", heightM: 0, line: line(8), p: { bottom_m: 1, top_m: 5, fields: ["#1d2f6b", "#55b8e8"] } });
  assert.equal(sc.screens.length, 1);
  near(Math.max(...sc.screens[0].corners.map((c) => c[1] / M(1))), 5, "screen top");
  near(sc.screens[0].corners[0][2] / M(1), 0.15, "screen stands 0.15 m in front of the wall (south of an eastward line)");
});

test("parasol colour: a hex or a colour word of the note, white otherwise; an instance colour wins", () => {
  assert.deepEqual(parasolColour("red cafe parasol"), rgb("#c0392b"));
  assert.deepEqual(parasolColour("blue parasol in the courtyard"), rgb("#3063a7"));
  assert.deepEqual(parasolColour("parasol #123456 striped"), rgb("#123456"));
  assert.deepEqual(parasolColour("white cafe parasol"), rgb("#efefeb"));
  assert.deepEqual(parasolColour("a bored parasol"), rgb("#efefeb"), "colour words match whole words only");
  const ring = [[0, 0], [M(2), 0], [M(2), M(2)], [0, M(2)]];
  const ctx = flatContext();
  B.plaza_structure(ctx, { id: "SD-T5", kind: "plaza_structure", subtype: "parasol", heightM: 2.4, ring, footprint: ring, p: { note: "parasol", colour: "#c0392b" } });
  assert.ok(ctx.solid.mesh.colors.some((_, i, a) => i % 4 === 0 && a[i] === rgb("#c0392b")[0] && a[i + 1] === rgb("#c0392b")[1]), "the canopy takes the instance colour");
});

test("hedge lettering in Latin capitals", () => {
  const strokes = hedgeTextStrokes(line(10), "SSC", { heightM: 2, widthM: 1.6, gapM: 0.3 });
  assert.equal(strokes.length, 3);
});

test("an object on a roof is built roof_m above the terrain into the same kits", () => {
  const ctx = flatContext();
  const ring = [[0, 0], [M(1), 0], [M(1), M(1)], [0, M(1)]];
  B.planter(onRoof(ctx, 13), { id: "SD-T6", kind: "planter", heightM: 0.5, ring, p: { dims: { kerbHeightM: 0.5 }, fill: "soil" } });
  near(Math.max(...ys(ctx)), 13.5, "box top on the roof");
  assert.ok(Math.min(...ys(ctx)) > 12.8, "nothing below the roof");
});

test("paving_path: every leg a slab height_m above the ground, width_m wide", () => {
  const ctx = flatContext();
  B.paving_path(ctx, { id: "SD-T7", kind: "paving_path", line: [[0, 0], [M(4), 0], [M(4), M(3)]], p: { width_m: 1, height_m: 0.15 } });
  near(Math.max(...ys(ctx)), 0.15, "slab top");
  const xs = ctx.solid.mesh.positions.filter((_, i) => i % 3 === 0).map((x) => x / M(1));
  near(Math.min(...xs), -0.5, "half a width past the first end");
  assert.throws(() => B.paving_path(ctx, { id: "SD-T8", kind: "paving_path", point: [0, 0], p: {} }), /needs a LineString/);
});

test("planter tones: one smooth shared-vertex grid over the fill (no cell edges), worn beside a named paving_path, refused for another kind", () => {
  const ring = [[0, 0], [M(6), 0], [M(6), M(6)], [0, M(6)]];
  const bed = (objects, p) => { const ctx = flatContext(); ctx.objects = objects; B.planter(ctx, { id: "SD-T9", kind: "planter", heightM: 0.15, ring, p: { dims: { kerbHeightM: 0.15 }, fill: "lawn", ...p } }); return ctx.solid.mesh; };
  const plain = bed([], {});
  const path = { id: "SD-TP", kind: "paving_path", line: [[0, M(3)], [M(6), M(3)]] };
  const turf = bed([path], { tones: ["#706b3f", "#a9a579"], wear_paths: ["SD-TP"], wear_tone: "#8a7d5e", tone_cell_m: 1 });
  const quads = (turf.indices.length - plain.indices.length) / 6;
  const corners = turf.vertexCount - plain.vertexCount;
  assert.ok(quads >= 9, `${quads} grid quads`);
  assert.ok(corners < 2 * quads, `${corners} vertices for ${quads} quads: neighbouring quads share their corners`);
  assert.throws(() => bed([{ ...path, kind: "hedge" }], { tones: ["#706b3f"], wear_paths: ["SD-TP"], wear_tone: "#8a7d5e" }), /is not a paving_path/);
});

test("planter mound: mound_m from mound_ramp_m in from the bed's edge, nothing at the edge", () => {
  const inner = [[0, 0], [M(10), 0], [M(10), M(10)], [0, M(10)]];
  const o = { p: { mound_m: 0.45, mound_ramp_m: 2 } };
  near(moundAt(o, inner, [M(5), M(5)]) / M(1), 0.45, "centre");
  near(moundAt(o, inner, [0, M(5)]) / M(1), 0, "edge");
  near(moundAt({ p: {} }, inner, [M(5), M(5)]), 0, "no mound");
});

test("planter on a ridge between its corners: kerb and bed follow the ground (no paving rising through the fill)", () => {
  // ground: a 0.5 m ridge along x = 3 m, nothing at the ring's corners (x = 0 and 6 m)
  const ctx = makeContext({ groundAt: (x) => M(0.5 * Math.max(0, 1 - Math.abs(x / M(1) - 3) / 3)), objects: [], roads: { arterials: [], connectors: [], zoneRings: [] }, sites, fieldCentre: null });
  const ring = [[0, 0], [M(6), 0], [M(6), M(6)], [0, M(6)]];
  B.planter(ctx, { id: "SD-T10", kind: "planter", heightM: 0.15, ring, p: { dims: { kerbHeightM: 0.15 }, fill: "soil" } });
  // the fill stands 0.1 m over the ground everywhere, so on the ridge it reaches 0.6 m (the old fill spanned the corners)
  assert.ok(Math.max(...ys(ctx)) >= 0.6 - 1e-6, `highest vertex ${Math.max(...ys(ctx))} m, the ridge's fill is 0.6 m`);
});

test("planter with a concave (U-shaped) ring: every kerb wall faces out of the kerb, none into it", () => {
  const ctx = flatContext();
  const ring = [[0, 0], [6, 0], [6, 6], [0, 6], [0, 4], [4, 4], [4, 2], [0, 2]].map(([x, z]) => [M(x), M(z)]);
  B.planter(ctx, { id: "SD-T11", kind: "planter", heightM: 0.15, ring, p: { dims: { kerbHeightM: 0.15 }, fill: "soil" } });
  const inset = (s) => offsetLine([...ring, ring[0]], s * M(0.2)).slice(0, -1);
  const inner = pointInRing(inset(1)[0], ring) ? inset(1) : inset(-1); // the kerb's inner edge
  const { positions, normals, indices } = ctx.solid.mesh;
  let walls = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const [a, b, c] = [indices[t] * 3, indices[t + 1] * 3, indices[t + 2] * 3];
    if (Math.abs(normals[a + 1]) > 0.1) continue;
    walls += 1;
    // from the wall triangle's centre (on its own edge, away from the corners) a step along its normal leaves the kerb
    const centre = [(positions[a] + positions[b] + positions[c]) / 3, (positions[a + 2] + positions[b + 2] + positions[c + 2]) / 3];
    const probe = [centre[0] + normals[a] * M(0.05), centre[1] + normals[a + 2] * M(0.05)];
    assert.ok(!(pointInRing(probe, ring) && !pointInRing(probe, inner)), `a wall at ${centre[0] / M(1)}, ${centre[1] / M(1)} faces into the kerb`);
  }
  assert.ok(walls > 0);
});
