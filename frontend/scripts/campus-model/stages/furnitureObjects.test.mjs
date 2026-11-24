import assert from "node:assert/strict";
import test from "node:test";
import { GlbBuilder } from "../lib/glb.mjs";
import { emitObjectNodes } from "../lib/objectNodes.mjs";
import { buildFurniture, loadFurniture } from "./furniture.mjs";
import { furnitureObjects } from "./furnitureObjects.mjs";

const SITES = { inArea: () => false, labelAt: () => null, classes: { PAVING: 1, ASPHALT: 2 } };

test("furnitureObjects splits the furniture build into one node per object, lamp, signal and wheel stop", () => {
  const furniture = loadFurniture();
  const lampObject = furniture.objects.find((o) => o.id === "OC0098");
  const signal = furniture.objects.find((o) => o.kind === "traffic_signal_pole");
  const bench = furniture.objects.find((o) => o.kind === "bench");
  const objectsIn = [bench, signal, lampObject];
  const lamps = [{ id: lampObject.id, type: "path", at: lampObject.point, dir: [1, 0], heightM: 4, pole: { verdict: "shadow-root" } }];
  const wheelStops = [
    { id: "LOT_TEST/R1/W0", record: "LOT_TEST/R1", centre: [0, 0], u: [1, 0], lengthM: 1.6, colour: "#d9b43a", estimated: true },
    { id: "LOT_TEST/R1/W1", record: "LOT_TEST/R1", centre: [50, 0], u: [1, 0], lengthM: 1.6, colour: "#d9b43a", estimated: true },
  ];
  const scratch = new GlbBuilder();
  const { glow } = buildFurniture({ glb: scratch, furniture: { ...furniture, objects: objectsIn }, lamps, wheelStops,
    lampStats: {}, inputs: { roadZones: [] }, groundAt: () => 0, sites: SITES });

  const glb = new GlbBuilder();
  const { objects, objectNumbers } = furnitureObjects({ glb, scratch, furniture: { ...furniture, objects: objectsIn }, lamps, wheelStops, glow });
  objects.setMaterial("glow", glb.addMaterial({ name: "Lamp_Head" }));
  const emitted = emitObjectNodes(glb, objects, { objectNumbers });

  assert.deepEqual(emitted.map((e) => [e.id, e.kind, e.category]), [
    [bench.id, "bench", "furniture"],
    [signal.id, "traffic_signal_pole", "signal"],
    ["WS_LOT_TEST_R1_W0", "wheel_stop", "wheel_stop"],
    ["WS_LOT_TEST_R1_W1", "wheel_stop", "wheel_stop"],
    [lampObject.id, "street_lamp/path", "lamp"],
  ]);
  const node = (id) => glb.json.nodes.find((n) => n.name === id);
  const materialsOf = (id) => glb.json.meshes[node(id).mesh].primitives.map((p) => glb.json.materials[p.material].name);
  // the signal's lenses are on its own node, in the Lamp_Head material
  assert.deepEqual(materialsOf(signal.id), ["Furniture", "Lamp_Head"]);
  assert.deepEqual(materialsOf("WS_LOT_TEST_R1_W1"), ["Furniture"]);
  // each wheel stop stands at its own centre (pivot = bbox centre x/z), the second 50 units along x
  const [x0, , z0] = node("WS_LOT_TEST_R1_W0").translation;
  const [x1] = node("WS_LOT_TEST_R1_W1").translation;
  assert.ok(Math.abs(x0) < 1e-6 && Math.abs(z0) < 1e-6, `${x0}, ${z0}`);
  assert.ok(Math.abs(x1 - 50) < 1e-6, `${x1}`);
  assert.deepEqual(node(signal.id).extras.editable, { id: signal.id, kind: "traffic_signal_pole", category: "signal" });
  assert.equal(node(signal.id).extras.estimated, true);

  // the mesh-less Furniture node keeps the survey extras for its consumers, with a number for every object node
  const furnitureNode = glb.json.nodes.find((n) => n.name === "Furniture");
  assert.equal(furnitureNode.mesh, undefined);
  assert.ok(furnitureNode.extras.poles.some((p) => p[0] === signal.id));
  const numbers = furnitureNode.extras.renderObjectIds;
  assert.equal(new Set(emitted.map((e) => numbers[e.id])).size, emitted.length);
  // no merged Furniture* mesh is left
  assert.deepEqual(glb.json.meshes.filter((m) => /^Furniture/.test(m.name)), []);
});
