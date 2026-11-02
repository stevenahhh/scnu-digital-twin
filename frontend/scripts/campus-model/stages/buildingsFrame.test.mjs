import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as THREE from "three";
import { tmToScene, wgs84ToTm } from "../../../src/geo/epsg5186.mjs";
import { ringArea, ringCentroid } from "../lib/geometry.mjs";
import { buildBuildings, checkNodeMapInputs, nodeFootprints } from "./buildings.mjs";
import { toModelRing } from "./sources.mjs";
import { SCENE_UNITS_PER_METRE } from "../lib/frame.mjs";

const data = (name) => JSON.parse(readFileSync(new URL(`../data/${name}`, import.meta.url), "utf8"));
const gis = data("gis-buildings.json").buildings;
const vr = data("vr-buildings.json").buildings;
const nodeMap = data("bld-node-map.json");

// Footprint parts as buildBuildings makes them: one per polygon of every standing record.
const footprintParts = [...gis, ...vr].filter((b) => b.status !== "demolished" && b.status !== "removed").flatMap((b, index) => b.polygons.map((polygon) => {
  const [outer, ...holes] = polygon.map(toModelRing);
  return { index, name: b.name, nodeId: b.nodeId, footprintSource: b.footprintSource, footprintEstimated: b.estimated === true, outer, holes, centroid: ringCentroid(outer) };
}));
const recordOf = (source) => gis.find((b) => b.footprintSource === source);
const entryOf = (nodeId) => nodeMap.entries.find((e) => e.nodeId === nodeId);

// Area centroid in TM computed around a local origin (so the large E/N values keep their digits), then tmToScene.
const gisCentreScene = (ringLonLat) => {
  const tm = ringLonLat.map(([lon, lat]) => wgs84ToTm(lon, lat));
  const [e0, n0] = tm[0];
  const [ce, cn] = ringCentroid(tm.map(([e, n]) => [e - e0, n - n0]));
  return tmToScene(ce + e0, cn + n0);
};

// uni.glb outlines are not readable under node --test; the outline of each node is stood in for by its mapped GIS
// ring (or, for split and estimated nodes, by the map's uniCentreScene square), which is all the checks look at.
const square = ([x, z], r = 6) => [[x - r, z - r], [x + r, z - r], [x + r, z + r], [x - r, z + r]];
const bldNodes = nodeMap.entries.map((e) => {
  const record = e.gis && recordOf(e.gis.footprintSource);
  const outer = record ? toModelRing(record.polygons[0][0]) : square(e.uniCentreScene);
  return { rawName: e.nodeId, footprint: { outer, holes: [] } };
});

test("BLD_D4, BLD_E3 and the LOD4 form building BLD_E5 draw their GIS parts, centred on the GIS centroid within 1e-6", () => {
  const selection = nodeFootprints({ bldNodes, footprintParts, nodeMap });
  for (const nodeId of ["BLD_D4", "BLD_E3", "BLD_E5"]) {
    const record = recordOf(entryOf(nodeId).gis.footprintSource);
    const chosen = selection.get(nodeId);
    assert.equal(chosen.footprintEstimated, false, nodeId);
    assert.equal(chosen.footprintSource, record.footprintSource, nodeId);
    assert.equal(chosen.parts.length, record.polygons.length, nodeId);
    chosen.parts.forEach((part, k) => {
      const [x, z] = ringCentroid(part.outer);
      const [ex, ez] = gisCentreScene(record.polygons[k][0]);
      assert.ok(Math.abs(x - ex) < 1e-6 && Math.abs(z - ez) < 1e-6, `${nodeId} part ${k}: ${x},${z} vs ${ex},${ez}`);
    });
  }
});

// todo 5 (orchestrator decision 2026-11-02): every GIS-mapped BLD_* node draws its GIS footprint parts with the part
// centres on the GIS footprint centres within 0.05 m. The node's LOD4 mass bbox is not the measure (cores and canopies
// keep their LOD4 outline). Estimated nodes without a GIS record (BLD_A12.001, BLD_Dormitory_Building.004) and the
// C1/C1.001 split halves are checked by the next test.
test("every GIS-mapped BLD_* node draws its GIS footprint parts, each centred on the GIS centre within 0.05 m", () => {
  const selection = nodeFootprints({ bldNodes, footprintParts, nodeMap });
  const split = new Set(["BLD_C1", "BLD_C1.001"]);
  const mapped = nodeMap.entries.filter((e) => e.gis && !split.has(e.nodeId));
  assert.ok(mapped.length >= 25, `only ${mapped.length} GIS-mapped nodes`);
  for (const { nodeId, gis: { footprintSource } } of mapped) {
    const record = recordOf(footprintSource);
    const chosen = selection.get(nodeId);
    // the map names the record by its GIS footprintSource; the stage may carry an OSM record's own id form
    assert.ok(record, `${nodeId}: no record ${footprintSource}`);
    assert.equal(chosen.parts.length, record.polygons.length, nodeId);
    chosen.parts.forEach((part, k) => {
      const [x, z] = ringCentroid(part.outer);
      const [ex, ez] = gisCentreScene(record.polygons[k][0]);
      const error = Math.hypot(x - ex, z - ez) / SCENE_UNITS_PER_METRE;
      assert.ok(error < 0.05, `${nodeId} part ${k} is ${error.toFixed(3)} m from its GIS footprint centre`);
    });
  }
});

test("BLD_C1 and BLD_C1.001 split record 300791 so its area is drawn once; estimated nodes say so", () => {
  const selection = nodeFootprints({ bldNodes, footprintParts, nodeMap });
  const record = recordOf(entryOf("BLD_C1.001").gis.footprintSource);
  const area = (rings) => rings.reduce((s, p) => s + Math.abs(ringArea(p.outer)), 0);
  const whole = Math.abs(ringArea(toModelRing(record.polygons[0][0])));
  const [a, b] = [selection.get("BLD_C1"), selection.get("BLD_C1.001")];
  assert.ok(area(a.parts) > 0 && area(b.parts) > 0);
  assert.ok(Math.abs(area(a.parts) + area(b.parts) - whole) < whole * 1e-9, "the two halves tile the record");
  assert.equal(a.footprintSource, record.footprintSource);
  assert.equal(b.footprintSource, record.footprintSource);
  assert.ok(a.footprintPart && b.footprintPart);
  const a13 = selection.get("BLD_Dormitory_Building.004");
  assert.equal(a13.footprintEstimated, true);
  assert.match(a13.footprintSource, /VR scene_a13/);
  const a12 = selection.get("BLD_A12.001");
  assert.equal(a12.footprintEstimated, true);
  assert.equal(a12.footprintSource, "uni.glb outline");
  assert.equal(selection.get("BLD_B7").footprintSource, "osm:way/1486502962");
});

test("a map entry pointing at a wrong GIS record, or at an unknown node, throws bld-node-map naming the node", () => {
  const wrong = structuredClone(nodeMap);
  wrong.entries.find((e) => e.nodeId === "BLD_D4").gis = structuredClone(entryOf("BLD_E3").gis);
  wrong.entries.find((e) => e.nodeId === "BLD_E3").gis = null;
  wrong.entries.find((e) => e.nodeId === "BLD_E3").curated = true;
  assert.throws(() => nodeFootprints({ bldNodes, footprintParts, nodeMap: wrong }), /bld-node-map.*BLD_D4/);
  const unknown = structuredClone(nodeMap);
  unknown.entries.push({ ...structuredClone(entryOf("BLD_E3")), nodeId: "BLD_NOPE", gis: null, curated: true, reason: "fixture" });
  assert.throws(() => nodeFootprints({ bldNodes, footprintParts, nodeMap: unknown }), /bld-node-map.*BLD_NOPE/);
});

// buildBuildings itself (selectOnly, the selection fetch/buildingForms.mjs reads): a shift of the footprint parts
// reintroduced anywhere before the selection returns moves a part off its GIS centroid and fails here. uni.glb is
// stood in for by box meshes over each node's mapped outline.
test("buildBuildings draws every GIS-mapped BLD_* part on its GIS centroid within 1e-6", async () => {
  const scene = new THREE.Group();
  const rawNames = [];
  for (const { rawName, footprint } of bldNodes) {
    const xs = footprint.outer.map((p) => p[0]);
    const zs = footprint.outer.map((p) => p[1]);
    const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 10, z1 - z0));
    mesh.position.set((x0 + x1) / 2, 5, (z0 + z1) / 2);
    scene.add(mesh);
    rawNames.push(rawName);
  }
  scene.updateMatrixWorld(true);
  const inputs = { source: { scene, rawNames }, footprints: [...gis, ...vr], roadZones: [], heightAt: () => 0 };
  const silent = { log: console.log, warn: console.warn };
  console.log = () => {};
  console.warn = () => {};
  let selection;
  try {
    selection = await buildBuildings({ glb: null, inputs, selectOnly: true });
  } finally {
    Object.assign(console, silent);
  }
  let checked = 0;
  for (const entry of nodeMap.entries.filter((e) => e.gis)) {
    const record = recordOf(entry.gis.footprintSource);
    if (!record) continue;
    const building = selection.selectableBuildings.find((b) => b.nodeName === entry.nodeId);
    assert.ok(building, entry.nodeId);
    if (building.footprintPart) continue;
    assert.equal(building.parts.length, record.polygons.length, entry.nodeId);
    building.parts.forEach((part, k) => {
      const [x, z] = ringCentroid(part.outer);
      const [ex, ez] = ringCentroid(toModelRing(record.polygons[k][0]));
      assert.ok(Math.hypot(x - ex, z - ez) < 1e-6, `${entry.nodeId} part ${k}: ${x},${z} vs GIS ${ex},${ez}`);
    });
    checked += 1;
  }
  assert.ok(checked >= 20, `checked ${checked} nodes`);
});

test("checkNodeMapInputs throws on a stale input hash and passes on the recorded ones", () => {
  assert.doesNotThrow(() => checkNodeMapInputs(nodeMap, nodeMap.inputs));
  const stale = { ...nodeMap.inputs, "frontend/public/uni.glb": "0".repeat(64) };
  assert.throws(() => checkNodeMapInputs(nodeMap, stale), /bld-node-map.*stale.*uni\.glb/);
});
