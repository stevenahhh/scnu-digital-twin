// Geometry checks for the court builders of stages/furniture.mjs on flat ground: the portable basketball stand
// (sports_hoop) and the ball-stop court fence (fence / ball_stop_net).
import assert from "node:assert/strict";
import test from "node:test";
import { metres } from "../lib/frame.mjs";
import { rgb } from "../lib/solids.mjs";
import { B, HOOP, diamondLattice, makeContext } from "./furniture.mjs";

const M = metres;
const flatContext = () => makeContext({ groundAt: () => 0, objects: [], roads: { arterials: [], connectors: [], zoneRings: [] }, sites: null, fieldCentre: null });
function build(kind, geometry, { subtype = null, heightM = 3.05, ...props } = {}) {
  const ctx = flatContext();
  B[kind](ctx, { id: "T1", kind, surveyKind: kind, subtype, heightM, ...geometry, p: props });
  return ctx;
}
// [x, y, z] in metres of the vertices of a kit, optionally only those of one sRGB colour
function vertices(mesh, hex = null) {
  const want = hex ? rgb(hex) : null;
  const out = [];
  for (let k = 0; k < mesh.vertexCount; k += 1) {
    if (want && [0, 1, 2].some((j) => mesh.colors[4 * k + j] !== want[j])) continue;
    out.push([mesh.positions[3 * k] / M(1), mesh.positions[3 * k + 1] / M(1), mesh.positions[3 * k + 2] / M(1)]);
  }
  return out;
}
const span = (values) => [Math.min(...values), Math.max(...values)];
const near = (actual, expected, tolerance, label) => assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} vs ${expected}`);

test("sports_hoop: board and ring face the court at the far end of the traced stand", () => {
  // stand traced from the rear of its base (x 0) to the board face (x 2.5 m); +x points into the court
  const ctx = build("sports_hoop", { line: [[0, 0], [M(2.5), 0]] });
  const board = vertices(ctx.glass.mesh, HOOP.colours.glass);
  assert.ok(board.length >= 4, "a translucent board");
  const [bx0, bx1] = span(board.map((v) => v[0]));
  assert.ok(bx0 >= 2.5 - HOOP.board.thicknessM - 1e-6 && bx1 <= 2.5 + 1e-6, `board face at the end of the stand: ${bx0}..${bx1}`);
  const [by0, by1] = span(board.map((v) => v[1]));
  near(by0, HOOP.board.bottomM, 1e-6, "board bottom");
  near(by1 - by0, HOOP.board.heightM, 1e-6, "board height");
  const [bz0, bz1] = span(board.map((v) => v[2]));
  near(bz1 - bz0, HOOP.board.widthM, 1e-6, "board width");
  const ring = vertices(ctx.solid.mesh, HOOP.colours.ring);
  for (const [, y] of ring) assert.ok(y >= HOOP.ringTopM - 0.06 && y <= HOOP.ringTopM + 1e-6, `ring and bracket at the ring height: ${y}`);
  const [, rx1] = span(ring.map((v) => v[0]));
  near(rx1, 2.5 + HOOP.ringGapM + 2 * HOOP.ringInnerRadiusM + HOOP.tubeM, 0.01, "far side of the ring, in front of the board");
  const solid = vertices(ctx.solid.mesh);
  const [sx0] = span(solid.map((v) => v[0]));
  near(sx0, 0, 0.05, "the base reaches the traced rear");
  assert.ok(Math.max(...solid.map((v) => v[1])) <= HOOP.board.bottomM + HOOP.board.heightM + 0.03, "nothing above the board");
  assert.ok(Math.min(...solid.map((v) => v[1])) >= -0.06, "nothing sunk below the base");
});

test("sports_hoop: a Point stand is refused", () => {
  assert.throws(() => build("sports_hoop", { point: [0, 0] }), /sports_hoop T1 needs a LineString from the base to the board/);
});

test("diamondLattice: wires at 45 degrees, pitch apart, clipped to the panel", () => {
  const wires = diamondLattice(2.5, 0.2, 4, 0.4);
  const intercepts = { up: [], down: [] };
  for (const [[s0, h0], [s1, h1]] of wires) {
    for (const [s, h] of [[s0, h0], [s1, h1]]) assert.ok(s >= -1e-9 && s <= 2.5 + 1e-9 && h >= 0.2 - 1e-9 && h <= 4 + 1e-9, `inside: ${s}, ${h}`);
    const slope = (h1 - h0) / (s1 - s0);
    near(Math.abs(slope), 1, 1e-9, "45 degrees");
    if (slope > 0) intercepts.up.push(h0 - s0);
    else intercepts.down.push(h0 + s0);
  }
  for (const list of Object.values(intercepts)) {
    list.sort((a, b) => a - b);
    assert.ok(list.length >= 10, `${list.length} wires in one direction`);
    for (let i = 1; i < list.length; i += 1) near(list[i] - list[i - 1], 0.4, 1e-9, "pitch");
  }
});

test("ball-stop fence: posts, rails, a windscreen band and a wire lattice, no translucent sheet", () => {
  const square = [[0, 0], [M(10), 0], [M(10), M(10)], [0, M(10)], [0, 0]];
  const ctx = build("fence", { line: square }, { subtype: "ball_stop_net", heightM: 4, windscreen_m: 2, windscreen_colour: "#1b8b7f", mesh_colour: "#9ea4a8", post_colour: "#9ea4a8" });
  assert.equal(ctx.glass.triangleCount, 0, "no translucent panel");
  const screen = vertices(ctx.solid.mesh, "#1b8b7f");
  assert.ok(screen.length > 0, "a windscreen band");
  near(Math.max(...screen.map((v) => v[1])), 2, 1e-6, "windscreen top");
  const all = vertices(ctx.solid.mesh);
  near(Math.max(...all.map((v) => v[1])), 4, 0.06, "fence top");
  // every vertex stays within 0.1 m of the fence line (posts, rails, fabric and wires are all on it)
  for (const [x, , z] of all) {
    const d = Math.min(Math.abs(x), Math.abs(x - 10), Math.abs(z), Math.abs(z - 10));
    assert.ok(d <= 0.1, `on the line: ${x}, ${z}`);
  }
  const plain = build("fence", { line: square }, { subtype: "ball_stop_net", heightM: 4 });
  assert.equal(plain.glass.triangleCount, 0, "no translucent panel without a windscreen either");
  assert.ok(plain.solid.triangleCount > 1000, "the lattice is drawn");
});
