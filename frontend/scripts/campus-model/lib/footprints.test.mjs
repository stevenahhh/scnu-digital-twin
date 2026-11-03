import assert from "node:assert/strict";
import test from "node:test";
import { tmFootprints } from "./footprints.mjs";
import { wallsOf } from "./anchors.mjs";
import { tmToScene } from "../../../src/geo/epsg5186.mjs";

test("shared C1 record splits once and retains identical saved wall frames in TM", () => {
  const ring = [[243000,263000],[243000,263010],[243020,263010],[243020,263000]];
  const square = (e) => ({ outer: [[e,263002],[e,263008],[e+4,263008],[e+4,263002]].map(p => tmToScene(...p)), holes: [] });
  const nodeMap = { entries: [
    { nodeId: "BLD_C1", gis: { footprintSource: "fixture" } },
    { nodeId: "BLD_C1.001", gis: null },
  ] };
  const nodes = [{ rawName: "BLD_C1", footprint: square(243002) }, { rawName: "BLD_C1.001", footprint: square(243014) }];
  const records = [{ footprintSource: "fixture", nodeId: "BLD_SCNU_C1", polygonsTm: [[ring]] }];
  const first = tmFootprints({ nodes, records, nodeMap });
  assert.deepEqual(Object.keys(first).sort(), ["BLD_C1", "BLD_C1.001"]);
  for (const id of Object.keys(first)) {
    const xs = first[id].polygons[0][0].map(p => p[0]);
    assert.ok(Math.abs(Math.min(...xs) - (id === "BLD_C1" ? 243000 : 243010)) < 1e-6);
    assert.ok(Math.abs(Math.max(...xs) - (id === "BLD_C1" ? 243010 : 243020)) < 1e-6);
    nodeMap.entries.find(e => e.nodeId === id).walls = wallsOf(id, first[id]);
  }
  const saved = tmFootprints({ nodes, records, nodeMap });
  for (const id of Object.keys(saved)) assert.deepEqual(saved[id].walls, wallsOf(id, saved[id]));
});
