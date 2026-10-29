// 라벨 레지스트리를 campus-v2.glb의 BLD_* 노드로 실제와 같게 만들어 표로 찍고 개수 규칙을 확인한다.
// 사용: bun frontend/scripts/qa/print-registry.mjs  (규칙이 깨지면 종료 코드 1)
// GLB의 JSON 덩어리만 읽는다(메시 압축 해제 없이). 노드 이름은 GLTFLoader처럼 정리한다(BLD_C1.001 -> BLD_C1001, 공백 -> _).
import { readFile } from "node:fs/promises";
import commonElements from "../../../common/data/common_elemetns.json" with { type: "json" };
import { CAMERA_PRESETS } from "../../src/camera/cameraPresets.mjs";
import { buildLabelRegistry } from "../../src/labels/labelRegistry.mjs";
import { resolveBuildingMeta, resolveProxyDataElementId } from "../../src/utils/buildingLabels.mjs";

// CityModel.jsx의 BLOCKED_ELEMENT_IDS와 같은 값이다.
const BLOCKED_ELEMENT_IDS = new Set(["BLD_C1001"]);
const NORMALIZE = { 5120: (v) => Math.max(v / 127, -1), 5121: (v) => v / 255, 5122: (v) => Math.max(v / 32767, -1), 5123: (v) => v / 65535 };

const sanitize = (name) => name.replace(/\s/g, "_").replace(/[[\]\.:/]/g, "");

function meshTop(json, node) {
  if (node.mesh === undefined) return null;
  const t = node.translation ?? [0, 0, 0];
  const s = node.scale ?? [1, 1, 1];
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const primitive of json.meshes[node.mesh].primitives) {
    const accessor = json.accessors[primitive.attributes.POSITION];
    const decode = accessor.normalized ? NORMALIZE[accessor.componentType] : (v) => v;
    for (const corner of [accessor.min, accessor.max]) {
      corner.forEach((value, axis) => {
        const world = decode(value) * s[axis] + t[axis];
        min[axis] = Math.min(min[axis], world);
        max[axis] = Math.max(max[axis], world);
      });
    }
  }
  return [(min[0] + max[0]) / 2, max[1] + 6, (min[2] + max[2]) / 2];
}

const file = await readFile(new URL("../../public/campus-v2.glb", import.meta.url));
const json = JSON.parse(file.subarray(20, 20 + file.readUInt32LE(12)).toString("utf8"));
const elementNames = new Map(commonElements.elements.map(({ element_id: id, name }) => [id, name]));

// Top-level objects: the scene roots, with the generator's collection nodes (extras.collection, lib/glb.mjs groupRoots)
// expanded into their children.
function topLevelNodes(gltf) {
  const out = [];
  const visit = (index) => {
    const node = gltf.nodes[index];
    if (node.extras?.collection) (node.children ?? []).forEach(visit);
    else out.push(node);
  };
  gltf.scenes[0].nodes.forEach(visit);
  return out;
}

const anchors = new Map();
for (const node of topLevelNodes(json)) {
  if (!node.name?.startsWith("BLD_")) continue;
  const name = sanitize(node.name);
  const meta = resolveBuildingMeta(name, { elementNames, blockedIds: BLOCKED_ELEMENT_IDS });
  if (!meta || anchors.has(meta.elementId)) continue;
  const proxy = Boolean(node.extras?.pickProxy);
  anchors.set(meta.elementId, {
    name,
    elementId: meta.elementId,
    displayName: meta.label ?? (proxy ? node.extras.label ?? null : null),
    dataElementId: (proxy ? resolveProxyDataElementId(name, node.extras, elementNames) : null) ?? meta.elementId,
    proxy,
    position: meshTop(json, node),
  });
}

const registry = buildLabelRegistry({ elements: commonElements.elements, anchors: [...anchors.values()], presets: CAMERA_PRESETS });
const rows = [...registry.values()].sort((a, b) => a.tier - b.tier || a.elementId.localeCompare(b.elementId));
console.log(["tier", "elementId", "code", "displayName", "shortName", "group", "zone", "estimatedName", "aliases"].join("\t"));
for (const r of rows) {
  console.log([r.tier, r.elementId, r.code ?? "-", r.displayName ?? "-", r.shortName ?? "-", r.group ?? "-", r.zone ?? "-", r.estimatedName, r.aliases.join(",")].join("\t"));
}

const count = (tier) => rows.filter((r) => r.tier === tier).length;
const names = new Map();
for (const r of rows) if (r.displayName && !r.group) names.set(r.displayName, [...(names.get(r.displayName) ?? []), r.elementId]);
const duplicates = [...names].filter(([, ids]) => ids.length > 1);
const checks = [
  ["tier 1 landmarks = 8", count(1) === 8, count(1)],
  ["tier 0 zones = 7", count(0) === 7, count(0)],
  ["no duplicate displayName outside groups", duplicates.length === 0, JSON.stringify(duplicates)],
];
console.log(`\nentries=${rows.length} tier0=${count(0)} tier1=${count(1)} tier2=${count(2)} tier3=${count(3)}`);
for (const [label, ok, measured] of checks) console.log(`${ok ? "PASS" : "FAIL"} ${label} (measured ${measured})`);
if (checks.some(([, ok]) => !ok)) process.exitCode = 1;
