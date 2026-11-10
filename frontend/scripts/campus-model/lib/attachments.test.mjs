// Schema checks for data/facade-attachments.json and the solids lib/attachments.mjs builds from it.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { addBalconies, addFins, addMast, addSolar, attachmentErrors, attachmentsByNode } from "./attachments.mjs";
import { SCENE_UNITS_PER_METRE } from "./frame.mjs";
import { MeshData } from "./meshData.mjs";

const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
const looks = new Set(JSON.parse(readFileSync(path.join(DATA, "scnu-facades.json"), "utf8")).looks.map((l) => l.id));
const file = JSON.parse(readFileSync(path.join(DATA, "facade-attachments.json"), "utf8"));

test("facade-attachments.json records are valid and name the W3 follow-up details", () => {
  const byNode = attachmentsByNode(file, looks);
  // D4's fourteen sourced records were added by l2-facade.md (D-43/44/63/70).
  assert.deepEqual([...byNode.keys()].sort(), ["BLD_B2", "BLD_D2", "BLD_D4", "BLD_Dormitory_Building.004", "BLD_E6", "BLD_E7", "BLD_E8", "BLD_SCNU_A3", "BLD_SCNU_E4", "BLD_SCNU_E8", "BLD_SCNU_F1", "BLD_Training Lab Building"]);
  assert.equal(byNode.get("BLD_D4").length, 14);
  assert.equal(byNode.get("BLD_D4").filter(a => a.kind === "balconies").length, 1);
  assert.equal(byNode.get("BLD_D4").filter(a => a.id.startsWith("D4-platform-condenser-")).length, 5);
  assert.deepEqual(byNode.get("BLD_SCNU_F1").map((a) => [a.kind, a.colour]), [["roof", "#94604a"], ["roof", "#94604a"], ["roof", "#94604a"]]);
  assert.deepEqual(byNode.get("BLD_SCNU_A3").map((a) => [a.kind, a.look ?? a.form]), [["block", "A3-orange"], ["block", "A3-orange"], ["solar", "gable"], ["solar", "gable"], ["solar", "gable"]]);
  assert.deepEqual(byNode.get("BLD_SCNU_E4").map((a) => [a.kind, a.look ?? a.form]), [["block", "E4-glass"], ["solar", "rows"], ["solar", "rows"], ["roof", undefined]]);
  assert.deepEqual(byNode.get("BLD_E8").map((a) => [a.kind, a.look ?? null]), [["balconies", null], ["balconies", null], ["block", "E8-glass"]]);
  // the porch roof recolours the raised entrance mass, which the Frame v2 footprint split gives to BLD_SCNU_E8
  assert.deepEqual(byNode.get("BLD_SCNU_E8").map((a) => [a.kind, a.colour]), [["roof", "#3e7a60"]]);
  assert.deepEqual(byNode.get("BLD_B2").map((a) => [a.kind, a.look ?? null]), [["fins", null], ["fins", null], ["block", "B2-blank"], ["block", "B2-blank"]]);
  assert.deepEqual(byNode.get("BLD_Training Lab Building").map((a) => [a.kind, a.look ?? null]), [["mast", null], ["block", "C3-glass"]]);
  assert.deepEqual(byNode.get("BLD_E7").map((a) => a.look), ["E7-glass", "E7-glass", "E7-glass", "E7-glass", "E7-frame", "E7-yellow"]);
  assert.deepEqual(byNode.get("BLD_Dormitory_Building.004").map((a) => [a.kind, a.look]), [["block", "A13-brick"], ["block", "A13-brick"], ["block", "A13-brick"]]);
});

test("a bad attachment record stops the build instead of being skipped", () => {
  assert.match(attachmentErrors({ kind: "dome" }, looks)[0], /unknown kind/);
  assert.ok(attachmentErrors({ kind: "block", plan: [[0, 0], [1, 0], [1, 1], [0, 1]], look: "nope", source: "estimated" }, looks).some((e) => /unknown look/.test(e)));
  assert.ok(attachmentErrors({ kind: "mast", at: [0, 0], baseMetres: 3, heightMetres: 9, colour: "#aabbcc", source: "by eye" }, looks).some((e) => /estimated/.test(e)));
  assert.ok(attachmentErrors({ kind: "roof", at: [0], colour: "#3e7a60", source: "estimated" }, looks).some((e) => /lon\/lat point/.test(e)));
  assert.ok(attachmentErrors({ kind: "roof", at: [0, 0], colour: "green", source: "estimated" }, looks).some((e) => /#rrggbb/.test(e)));
  assert.throws(() => attachmentsByNode({ buildings: [{ node: "BLD_X", attachments: [{ kind: "fins" }] }] }, looks), /BLD_X attachment 0 \(fins\)/);
});

// Every quad of a solid must face away from the solid (single-sided materials): the normal of each face points out of
// the box the solid's vertices span, checked on the face centre.
function charts() {
  const list = [];
  return { list, open: () => list.push({}) - 1, close: (k, w, h) => Object.assign(list[k], { w, h }) };
}
const meshOf = () => Object.assign(new MeshData({ colors: true }), { ao: [] });

test("attachment solids are closed boxes facing outwards with one AO chart each", () => {
  const plan = [[0, 0], [4, 0], [4, 3], [0, 3]];
  const colour = [200, 30, 40, 255];
  const mesh = meshOf();
  const c = charts();
  addBalconies(mesh, { plan, open: [1, 2], column: 2, storeyMetres: 3.8, fromStorey: 2, toStorey: 4, roofMetres: 15.2 }, 0, c, { colour, slabColour: colour });
  // 3 slabs + 6 panels + roof frame + column, six quads each
  assert.equal(mesh.indices.length / 6, 11 * 6);
  assert.equal(c.list.length, 11);
  assert.equal(mesh.ao.length / 3, mesh.vertexCount);
  for (let q = 0; q < mesh.vertexCount; q += 24) {
    const pts = Array.from({ length: 24 }, (_, k) => mesh.positions.slice((q + k) * 3, (q + k) * 3 + 3));
    const centre = [0, 1, 2].map((i) => pts.reduce((s, p) => s + p[i], 0) / 24);
    for (let f = 0; f < 6; f += 1) {
      const n = mesh.normals.slice((q + f * 4) * 3, (q + f * 4) * 3 + 3);
      const face = [0, 1, 2].map((i) => pts.slice(f * 4, f * 4 + 4).reduce((s, p) => s + p[i], 0) / 4);
      assert.ok(n[0] * (face[0] - centre[0]) + n[1] * (face[1] - centre[1]) + n[2] * (face[2] - centre[2]) > 0, `solid ${q / 24} face ${f} faces inwards`);
    }
  }
});

test("solar arrays: a gable frame reaches its ridge, rows rise by their tilt, bad records are refused", () => {
  const plan = [[0, 0], [10, 0], [10, 6], [0, 6]].map(([x, z]) => [x * SCENE_UNITS_PER_METRE, z * SCENE_UNITS_PER_METRE]);
  const ysOf = (mesh) => Array.from({ length: mesh.vertexCount }, (_, k) => mesh.positions[k * 3 + 1] / SCENE_UNITS_PER_METRE);
  const gable = meshOf();
  addSolar(gable, { plan, baseMetres: 20, form: "gable", eaveMetres: 1.4, ridgeMetres: 3.6 }, 0, charts(), { colour: [1, 2, 3, 255], frameColour: [4, 5, 6, 255] });
  assert.ok(Math.abs(Math.max(...ysOf(gable)) - (20 + 3.6 + 0.08)) < 1e-6 && Math.abs(Math.min(...ysOf(gable)) - 20) < 1e-6);
  const rows = meshOf();
  addSolar(rows, { plan, baseMetres: 16, form: "rows", rows: 3, tiltDeg: 12 }, 0, charts(), { colour: [1, 2, 3, 255], frameColour: [4, 5, 6, 255] });
  const rise = (6 / 3) * 0.8 * Math.tan((12 * Math.PI) / 180);
  assert.ok(Math.abs(Math.max(...ysOf(rows)) - (16 + 0.3 + rise + 0.08)) < 1e-6);
  assert.ok(attachmentErrors({ kind: "solar", plan: [[0, 0], [1, 0], [1, 1], [0, 1]], baseMetres: 3, form: "gable", eaveMetres: 2, ridgeMetres: 1, colour: "#112233", source: "estimated" }, looks).some((e) => /eaveMetres < ridgeMetres/.test(e)));
  assert.ok(attachmentErrors({ kind: "solar", plan: [[0, 0], [1, 0], [1, 1], [0, 1]], baseMetres: 3, form: "dome", colour: "#112233", source: "estimated" }, looks).some((e) => /gable or rows/.test(e)));
});

test("fins stand on the outside of the wall and the mast reaches its height", () => {
  const fins = meshOf();
  // Building to the north (z < 0) of the wall along x: fins must go to +z.
  addFins(fins, { wall: [[0, 0], [10, 0]], offsets: [1, 4], width: 1, depth: 0.5, bottomMetres: 2, topMetres: 9 }, 0, charts(), { colour: [1, 2, 3, 255], outside: ([, z]) => z > 0 });
  const zs = Array.from({ length: fins.vertexCount }, (_, k) => fins.positions[k * 3 + 2]);
  assert.ok(Math.max(...zs) > 0.2 && Math.min(...zs) > -0.1, "fins are not on the outside of the wall");
  const mast = meshOf();
  addMast(mast, { at: [0, 0], baseMetres: 10, heightMetres: 9 }, 0, charts(), { colour: [1, 2, 3, 255] });
  const ys = Array.from({ length: mast.vertexCount }, (_, k) => mast.positions[k * 3 + 1]);
  assert.ok(Math.abs(Math.min(...ys) - 10 * SCENE_UNITS_PER_METRE) < 1e-6 && Math.abs(Math.max(...ys) - 19 * SCENE_UNITS_PER_METRE) < 1e-3);
});
