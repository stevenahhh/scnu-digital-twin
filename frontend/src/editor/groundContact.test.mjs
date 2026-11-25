import assert from "node:assert/strict";
import test from "node:test";
import { Matrix4, Quaternion, Vector3 } from "three";
import { selectSupportPoints, settleOnGround } from "./groundContact.mjs";

const identity = [0, 0, 0, 1];
const pose = (position, quaternion = identity) => ({ position, quaternion, scale: [1, 1, 1] });
const worldOf = (transform, point) => new Vector3(...point).applyMatrix4(new Matrix4().compose(
  new Vector3(...transform.position), new Quaternion(...transform.quaternion), new Vector3(...transform.scale)));
const near = (actual, expected, tolerance, label) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} vs ${expected}`);

const flat = () => 0;
const slope = (x) => 0.1 * x; // 10 % grade rising to +x
// a fence: two legs at x = -1 and +1, rails between them 0.4..1.0 above the feet
const fence = [[-1, 0, 0], [1, 0, 0], [-1, 1, 0], [1, 1, 0], [0, 0.4, 0], [0, 1, 0], [-1, 0.02, 0.05], [1, 0.02, -0.05]];

test("the support points are the outline of the lowest band of the object", () => {
  const points = selectSupportPoints(fence);
  const xs = points.map(([x]) => x).sort((a, b) => a - b);
  assert.ok(points.every(([, y]) => y <= 0.1), "only the feet");
  assert.equal(xs[0], -1);
  assert.equal(xs.at(-1), 1);
  assert.ok(points.length <= 12);
  assert.deepEqual(selectSupportPoints([]), []);
});

test("an object above the surface keeps its pose: floating is allowed", () => {
  const raised = pose([0, 0.5, 0]);
  assert.deepEqual(settleOnGround({ transform: raised, points: selectSupportPoints(fence), groundAt: flat }), raised);
});

test("an object dragged below a flat surface rests on it without turning", () => {
  const settled = settleOnGround({ transform: pose([3, -0.3, 2]), points: selectSupportPoints(fence), groundAt: flat });
  assert.deepEqual(settled.quaternion.map((v) => Math.round(v * 1e9) / 1e9), identity);
  near(settled.position[1], 0, 1e-6, "feet on the ground");
  assert.deepEqual([settled.position[0], settled.position[2]], [3, 2]);
});

test("on a slope one leg lands first; dragging on tilts the fence until both legs stand on the surface", () => {
  const points = selectSupportPoints(fence);
  const footHeights = (transform) => [[-1, 0, 0], [1, 0, 0]].map((p) => worldOf(transform, p));
  // first contact: the +x leg touches, the -x leg hangs 0.2 above the surface
  const touching = settleOnGround({ transform: pose([0, 0.1, 0]), points, groundAt: slope });
  assert.deepEqual(touching.position, [0, 0.1, 0]);
  // half the remaining drag: partly tilted, nothing below the surface
  const half = settleOnGround({ transform: pose([0, 0, 0]), points, groundAt: slope });
  const [leftHalf, rightHalf] = footHeights(half);
  near(rightHalf.y, slope(rightHalf.x), 1e-6, "+x leg on the surface");
  assert.ok(leftHalf.y > slope(leftHalf.x) + 1e-4 && leftHalf.y < slope(leftHalf.x) + 0.2, "-x leg closer but still above");
  // the full drag: both legs on the surface
  const full = settleOnGround({ transform: pose([0, -0.1, 0]), points, groundAt: slope });
  for (const foot of footHeights(full)) near(foot.y, slope(foot.x), 1e-3, "leg on the surface");
  // dragging further keeps it standing there
  const deeper = settleOnGround({ transform: pose([0, -2, 0]), points, groundAt: slope });
  for (const foot of footHeights(deeper)) near(foot.y, slope(foot.x), 1e-3, "leg on the surface after more drag");
});

test("a four-footed object on a slope ends with every foot on the surface", () => {
  const table = [[-1, 0, -1], [1, 0, -1], [1, 0, 1], [-1, 0, 1], [0, 0.8, 0]];
  const ground = (x, z) => 0.1 * x - 0.05 * z;
  const settled = settleOnGround({ transform: pose([0, -1, 0]), points: selectSupportPoints(table), groundAt: ground });
  for (const foot of table.slice(0, 4)) {
    const world = worldOf(settled, foot);
    near(world.y, ground(world.x, world.z), 1e-3, `foot ${foot}`);
  }
});

test("lift-only mode never turns the object (rotate and scale drags)", () => {
  const settled = settleOnGround({ transform: pose([0, -1, 0]), points: selectSupportPoints(fence), groundAt: slope, tilt: false });
  assert.deepEqual(settled.quaternion, identity);
  const feet = [[-1, 0, 0], [1, 0, 0]].map((p) => worldOf(settled, p));
  assert.ok(feet.every((foot) => foot.y >= slope(foot.x) - 1e-6));
  near(Math.max(...feet.map((foot) => slope(foot.x) - foot.y)), 0, 1e-6, "deepest foot on the surface");
});

test("points with no surface under them are ignored", () => {
  const holey = (x) => (x > 0 ? null : 0);
  const settled = settleOnGround({ transform: pose([0, -0.5, 0]), points: selectSupportPoints(fence), groundAt: holey });
  near(worldOf(settled, [-1, 0, 0]).y, 0, 1e-6, "the leg over the surface rests on it");
  const nothing = settleOnGround({ transform: pose([0, -0.5, 0]), points: selectSupportPoints(fence), groundAt: () => null });
  assert.deepEqual(nothing.position, [0, -0.5, 0]);
});
