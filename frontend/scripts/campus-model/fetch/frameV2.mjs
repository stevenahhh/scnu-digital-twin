// One-off Frame v2 calculation: prints the GIS BLD_D4 footprint bbox centre (EPSG:5186), the uni.glb BLD_D4 bbox
// centre (scene units), their residual under the v1 frame and the D4_SCENE_ANCHOR that removes it:
//   D4_SCENE_ANCHOR = D4_SCENE_v1 + (uniD4CentreScene - tmToScene_v1(gisD4CentreTm)).
// Inputs come from data/bld-node-map.json. The printed constant is copied by hand into src/geo/epsg5186.mjs.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SCENE_UNITS_PER_METRE, SOURCE_MODEL_OFFSET, tmToSimulation } from "../../../src/geo/epsg5186.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const D4_SCENE_V1 = { x: 46.513, z: -266.574 };

const map = JSON.parse(await readFile(path.join(HERE, "../data/bld-node-map.json"), "utf8"));
const rows = Array.isArray(map) ? map : (map.entries ?? map.buildings ?? Object.values(map).find(Array.isArray));
const d4 = rows.find((row) => row.nodeId === "BLD_D4");
if (!d4?.gisCentreTm || !d4?.uniCentreScene) throw new Error("bld-node-map.json has no BLD_D4 gisCentreTm/uniCentreScene");

// tmToSimulation is anchor-independent (metres east/north of D4_ANCHOR), so the v1 scene position is rebuilt from it.
const local = tmToSimulation(...d4.gisCentreTm);
const v1 = [
  D4_SCENE_V1.x + local.x * SCENE_UNITS_PER_METRE - SOURCE_MODEL_OFFSET.x,
  D4_SCENE_V1.z - local.z * SCENE_UNITS_PER_METRE - SOURCE_MODEL_OFFSET.z,
];
const delta = [d4.uniCentreScene[0] - v1[0], d4.uniCentreScene[1] - v1[1]];
console.log(JSON.stringify({
  gisRecord: d4.gis?.footprintSource,
  gisD4CentreTm: d4.gisCentreTm,
  uniD4CentreScene: d4.uniCentreScene,
  tmToSceneV1: v1.map((v) => +v.toFixed(4)),
  residualScene: delta.map((v) => +v.toFixed(4)),
  residualM: +(Math.hypot(...delta) / SCENE_UNITS_PER_METRE).toFixed(3),
  D4_SCENE_ANCHOR: { x: +(D4_SCENE_V1.x + delta[0]).toFixed(3), z: +(D4_SCENE_V1.z + delta[1]).toFixed(3) },
}, null, 2));
