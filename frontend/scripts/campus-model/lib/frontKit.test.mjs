import assert from "node:assert/strict";
import test from "node:test";
import { frontKit, kitInstances, linearColour } from "./frontKit.mjs";

const metres = (m) => m; // 1 scene unit = 1 m for the test
const front = {
  fascia: { height: 1.4, overhang: 0.6, rise: 0.3, colour: "#ffffff" },
  columns: { every: 10, width: 0.6, depth: 0.45, colour: "#ffffff" },
  fins: { spacing: 0.5, width: 0.06, depth: 0.35, colour: "#a0a0a0" },
  entrance: { width: 8, storeys: 1 },
  block: { end: "south", share: 0.2, storeys: 2, depth: 1.5, colour: "#555555", window: { width: 1.2, colour: "#223344" } },
  roof: { width: 5, depth: 4, height: 3, setback: 3, colour: "#cccccc" },
};
// a 50 m edge running north (z decreasing) at x = 0: the outside (left of a -> b) is +x, the south end is a
const edge = { a: [0, 0], b: [0, -50], ground: 0, top: 13, storey: 4, front, metres };

test("frontKit: the fascia is a thin band at the top, standing proud of the wall and overhanging both ends", () => {
  const [fascia] = frontKit(edge);
  assert.deepEqual(fascia.size.map((v) => +v.toFixed(3)), [51.2, 1.7, 0.6]);
  assert.equal(+fascia.centre[1].toFixed(3), 13 - 1.4 + 1.7 / 2);
  assert.ok(fascia.centre[0] > 0, "on the outside of the wall");
});

test("frontKit: fins stop at the fascia, skip the side block and the columns, and clear the doors", () => {
  const boxes = frontKit(edge);
  const fins = boxes.filter((b) => Math.abs(b.size[0] - 0.06) < 1e-6);
  assert.ok(fins.length > 60, `${fins.length} fins`);
  for (const f of fins) {
    assert.ok(f.centre[2] < -10 + 1e-6, "not over the south block (z 0..-10)");
    assert.ok(Math.abs(f.centre[1] + f.size[1] / 2 - (13 - 1.4)) < 1e-6, "top at the fascia");
  }
  const doors = fins.filter((f) => Math.abs(f.centre[2] + 25) < 4);
  assert.ok(doors.length > 0 && doors.every((f) => f.centre[1] - f.size[1] / 2 >= 4 - 1e-6), "above the doors");
  const columns = boxes.filter((b) => Math.abs(b.size[0] - 0.6) < 1e-6 || (b.size[0] < 0.6 && b.size[2] === 0.45));
  assert.equal(columns.length, 5, "40 m of glazing at about 10 m: five columns, ends included");
});

test("frontKit: block window on the block face, rooftop block set back over the middle; instances turn to the wall", () => {
  const boxes = frontKit(edge);
  const window = boxes.find((b) => Math.abs(b.size[0] - 1.2) < 1e-6);
  assert.ok(window.centre[0] > 1.5 && Math.abs(window.centre[2] + 5) < 1e-6);
  const roof = boxes.at(-1);
  assert.ok(roof.centre[1] > 13 && roof.centre[0] < -3 && Math.abs(roof.centre[2] + 25) < 1e-6);
  const { rotations, colors } = kitInstances(boxes);
  // yaw turns local x onto the edge direction (0, -1): quaternion about y
  const [qy, qw] = [rotations[1], rotations[3]];
  const yaw = 2 * Math.atan2(qy, qw);
  assert.ok(Math.abs(Math.cos(yaw)) < 1e-6 && Math.abs(-Math.sin(yaw) - -1) < 1e-6);
  assert.ok(colors.every((c) => c >= 0 && c <= 1));
});

test("frontKit sign: strokes on the fascia face at its right end; roof offset; roll turns a stroke in the wall plane", async () => {
  const { strokeBoxes } = await import("./frontKit.mjs");
  const { glyph } = await import("./markingGlyphs.mjs");
  const signed = { ...edge, front: { ...front, roof: { ...front.roof, offset: -4 }, sign: { text: "C1 도서관", charWidth: 1, charHeight: 1.2, margin: 2, colour: "#2f7fc8" } } };
  const boxes = frontKit(signed);
  const blue = linearColour("#2f7fc8");
  const strokes = boxes.filter((b) => b.colour.every((c, k) => c === blue[k]));
  assert.ok(strokes.length > 20, `${strokes.length} strokes`);
  for (const s of strokes) {
    assert.ok(Math.abs(s.centre[0] - 0.615) < 1e-6, "3 cm proud of the fascia face");
    assert.ok(s.centre[1] > 13 - 1.4 && s.centre[1] < 13.3, "within the band");
    assert.ok(s.centre[2] > -48 - 0.01 && s.centre[2] < -48 + 6 * 1.15, "at the right end seen from outside (towards b)");
  }
  const roof = boxes.find((b) => b.size[1] === 3 && b.centre[1] > 13);
  assert.ok(Math.abs(roof.centre[2] - (-25 + 4)) < 1e-6, "offset 4 m to the viewer's left (towards a)");
  const ring = strokeBoxes(glyph("O", 1, 1.2));
  assert.ok(ring.length >= 20 && ring.every((p) => Math.hypot(p.x / 0.5, p.y / 0.6) < 1.1), "a ring glyph becomes a loop of bars");
  // roll 90 degrees: the box's local x (rotated by the quaternion) points up or down
  const [x, y, z, w] = kitInstances([{ centre: [0, 0, 0], size: [1, 1, 1], yaw: Math.PI / 2, roll: Math.PI / 2, colour: [0, 0, 0] }]).rotations;
  const localX = [1 - 2 * (y * y + z * z), 2 * (x * y + w * z), 2 * (x * z - w * y)];
  assert.ok(Math.abs(Math.abs(localX[1]) - 1) < 1e-6, `local x ${localX}`);
});
