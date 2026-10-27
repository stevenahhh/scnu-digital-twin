import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import commonElements from "../../../common/data/common_elemetns.json" with { type: "json" };
import { CAMERA_PRESETS } from "../camera/cameraPresets.mjs";
import { CAMPUS_GLTF_OVERLAY_CONFIG } from "./campusGltfOverlay.mjs";
import { buildVWorldLabelEntries, glbLabelAnchors, readGlbJson } from "./labelAnchors.mjs";

const glb = readFileSync(new URL("../../public/campus-buildings.glb", import.meta.url));
const json = readGlbJson(glb);
const elementNames = new Map(commonElements.elements.map(({ element_id: id, name }) => [id, name]));

test("reads one anchor per building element from campus-buildings.glb, named like the Legacy labels", () => {
  const anchors = glbLabelAnchors(json, { elementNames });
  const ids = anchors.map((anchor) => anchor.elementId);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(anchors.length >= 25, `only ${anchors.length} anchors`);
  const library = anchors.find((anchor) => anchor.elementId === "BLD_C1");
  assert.equal(library.displayName, "도서관");
  // BLD_C1.001 is blocked by the shared map (CAMPUS_BLOCKED_ELEMENT_IDS), BLD_A12 nodes resolve to A17 like Legacy.
  assert.ok(!ids.includes("BLD_C1001"));
  assert.ok(ids.includes("BLD_A17"));
});

test("the D4 box is the one the overlay config is anchored to (glTF z, x, yMin = east, north, up)", () => {
  const d4 = glbLabelAnchors(json, { elementNames }).find((anchor) => anchor.elementId === "BLD_D4");
  const [min, max] = d4.box;
  const { east, north, up } = CAMPUS_GLTF_OVERLAY_CONFIG.d4LocalAnchorMeters;
  assert.ok(Math.abs((min[2] + max[2]) / 2 - east) < 0.01);
  assert.ok(Math.abs((min[0] + max[0]) / 2 - north) < 0.01);
  assert.ok(Math.abs(min[1] - up) < 0.01);
  // The anchor sits 6 units above the roof, at the box centre (CityModel's rule).
  assert.deepEqual(d4.position.map((v) => Math.round(v * 100) / 100), [46.51, Math.round((max[1] + 6) * 100) / 100, -266.57]);
});

test("entries carry tiers, zones and data flags; the gate zone moves back by the D4-derived centre", () => {
  const entries = buildVWorldLabelEntries({ json, elements: commonElements.elements, presets: CAMERA_PRESETS });
  const byId = new Map(entries.map((entry) => [entry.elementId, entry]));
  assert.equal(byId.get("BLD_C1").tier, 1);
  assert.equal(byId.get("BLD_C1").hasData, true);
  assert.equal(byId.get("BLD_C1").code, "C1");
  const gate = byId.get("ZONE_gate");
  const target = CAMERA_PRESETS.find((preset) => preset.id === "gate").target;
  assert.notDeepEqual(gate.position, [...target]);
  assert.ok(entries.every((entry) => entry.displayName && entry.position.every(Number.isFinite)));
});

test("rejects a file that is not a GLB", () => {
  assert.throws(() => readGlbJson(new Uint8Array(32)), /not a GLB/);
});
