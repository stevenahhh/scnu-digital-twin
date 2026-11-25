import {
  CAMPUS_BLOCKED_ELEMENT_IDS,
  CAMPUS_BUILDING_MAP,
  resolveBuildingMeta,
} from "../utils/buildingLabels.mjs";
import { ZONES, buildLabelRegistry } from "../labels/labelRegistry.mjs";
import { campusModelCenter } from "../simulation/utils/campusTrafficCoordinates.mjs";

// VWorld 지도에 올린 campus-buildings.glb에서 건물 라벨 앵커를 만든다. Main CityModel의 buildLabelAnchors와 같은 규칙이다:
// 건물(BLD_*) 노드마다 장면 좌표의 경계 상자를 구해, 상자 위 가운데 6 단위 위에 앵커를 둔다. 같은 요소 id는 처음 것만 쓴다.
// three 없이 GLB의 JSON 덩어리만 읽는다. 상자는 POSITION 접근자의 min/max 꼭짓점 8개를 노드 변환으로 옮겨 잡는다.

const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;
const ANCHOR_LIFT = 6;

export function readGlbJson(buffer) {
  // buffer: ArrayBuffer (fetch) or a typed-array view (Node Buffer).
  const view = ArrayBuffer.isView(buffer) ? new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength) : new DataView(buffer);
  if (view.getUint32(0, true) !== GLB_MAGIC) throw new Error("not a GLB file");
  const length = view.getUint32(12, true);
  if (view.getUint32(16, true) !== JSON_CHUNK) throw new Error("GLB has no JSON chunk first");
  const bytes = new Uint8Array(view.buffer, view.byteOffset + 20, length);
  return JSON.parse(new TextDecoder().decode(bytes));
}

// 열 우선 4x4 행렬(glTF와 같은 배치).
const IDENTITY = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

function multiply(a, b) {
  const out = new Array(16);
  for (let col = 0; col < 4; col += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) sum += a[k * 4 + row] * b[col * 4 + k];
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

function localMatrix(node) {
  if (node.matrix) return node.matrix;
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

function transformPoint(m, [x, y, z]) {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

function meshBox(json, mesh, matrix) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const primitive of json.meshes[mesh]?.primitives ?? []) {
    const accessor = json.accessors[primitive.attributes?.POSITION];
    if (!accessor?.min || !accessor?.max) continue;
    for (const cx of [accessor.min[0], accessor.max[0]]) {
      for (const cy of [accessor.min[1], accessor.max[1]]) {
        for (const cz of [accessor.min[2], accessor.max[2]]) {
          const p = transformPoint(matrix, [cx, cy, cz]);
          for (let i = 0; i < 3; i += 1) {
            min[i] = Math.min(min[i], p[i]);
            max[i] = Math.max(max[i], p[i]);
          }
        }
      }
    }
  }
  return min[0] === Infinity ? null : [min, max];
}

function excluded(name) {
  const lower = name.toLowerCase();
  return lower.includes("학교") || lower.includes("topography") || lower.includes("terrain") || lower.includes("ground");
}

// 메시가 있는 모든 노드의 경계 상자(모델 좌표), 키는 GLTFLoader의 런타임 이름(공백 -> _, [ ] . : / 뺌). 카메라 시점의 focus가 쓴다.
export function glbNodeBoxes(json) {
  const boxes = new Map();
  const visit = (index, parentMatrix) => {
    const node = json.nodes[index];
    const matrix = multiply(parentMatrix, localMatrix(node));
    if (node.mesh !== undefined && typeof node.name === "string") {
      const box = meshBox(json, node.mesh, matrix);
      const key = node.name.replace(/\s/g, "_").replace(/[[\].:/]/g, "");
      if (box && !boxes.has(key)) boxes.set(key, box);
    }
    for (const child of node.children ?? []) visit(child, matrix);
  };
  for (const root of json.scenes[json.scene ?? 0].nodes) visit(root, IDENTITY);
  return boxes;
}

// elementNames: 요소 id -> 이름(common_elemetns.json). 돌려주는 앵커는 buildLabelRegistry가 받는 모양이다.
export function glbLabelAnchors(json, { elementNames }) {
  const anchors = new Map();
  const visit = (index, parentMatrix) => {
    const node = json.nodes[index];
    const matrix = multiply(parentMatrix, localMatrix(node));
    const name = node.name;
    if (node.mesh !== undefined && typeof name === "string" && !excluded(name)) {
      const meta = resolveBuildingMeta(name, {
        elementNames,
        buildingMap: CAMPUS_BUILDING_MAP,
        blockedIds: CAMPUS_BLOCKED_ELEMENT_IDS,
      });
      const box = meta && !anchors.has(meta.elementId) ? meshBox(json, node.mesh, matrix) : null;
      if (box) {
        const [min, max] = box;
        anchors.set(meta.elementId, {
          name,
          displayName: meta.label,
          elementId: meta.elementId,
          dataElementId: meta.elementId,
          proxy: false,
          position: [(min[0] + max[0]) / 2, max[1] + ANCHOR_LIFT, (min[2] + max[2]) / 2],
          box: [min, max],
        });
      }
    }
    for (const child of node.children ?? []) visit(child, matrix);
  };
  for (const root of json.scenes[json.scene ?? 0].nodes) visit(root, IDENTITY);
  return [...anchors.values()];
}

const SYNTHETIC_ZONE_IDS = new Set(ZONES.filter((zone) => zone.synthetic).map((zone) => zone.id));

// CampusLabelLayer가 받는 항목: Main CityModel의 labelEntries와 같다. campus-buildings.glb는 uni.glb와 같은 장면 좌표라
// 정문 구역(시점 목표점, 재중심화 뒤 좌표)은 D4 앵커로 구한 중심만큼 되돌린다.
export function buildVWorldLabelEntries({ json, elements, presets }) {
  const elementNames = new Map(elements.map(({ element_id: id, name }) => [id, name]));
  const anchors = glbLabelAnchors(json, { elementNames });
  const frameVersion = json.asset?.extras?.frameVersion;
  const center = campusCenterOf(anchors, frameVersion);
  const registry = buildLabelRegistry({ elements, anchors, presets });
  return [...registry.values()]
    .filter((entry) => entry.displayName && entry.position)
    .map((entry) => ({
      ...entry,
      hasData: elementNames.has(entry.dataElementId),
      frameVersion,
      position: SYNTHETIC_ZONE_IDS.has(entry.elementId)
        ? [entry.position[0] + center.x, entry.position[1], entry.position[2] + center.z]
        : entry.position,
    }));
}

// Main CityModel의 재중심화 값: D4 앵커가 교통 좌표 원점에 오게 하는 x, z. frameVersion은 GLB asset.extras 값이다.
export function campusCenterOf(anchors, frameVersion) {
  const d4 = anchors.find((anchor) => anchor.elementId === "BLD_D4");
  return d4 ? campusModelCenter(d4.position, { frameVersion }) : { x: 0, z: 0 };
}

// 라벨 항목의 앵커를 Main 장면 좌표(재중심화 뒤)로 되돌린다: 정문 거리·방위(gateDistance.mjs)처럼 장면 좌표를 쓰는 값에 쓴다.
// 항목이 없거나 위치가 없으면 null.
export function gateScenePositionOf(entries, elementId) {
  const entry = entries?.find((item) => item.elementId === elementId);
  if (!entry?.position) return null;
  const center = campusCenterOf(entries, entry.frameVersion);
  return [entry.position[0] - center.x, entry.position[1], entry.position[2] - center.z];
}
