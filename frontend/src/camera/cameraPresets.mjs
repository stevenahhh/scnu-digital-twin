// Main 캠퍼스 카메라 시점 목록. 장면 좌표계는 +x 동, +y 위, +z 남(0.6242 units/m)이고 CityModel이
// BLD_D4 라벨 앵커가 D4_LABEL_TARGET(-214.35, 24, -93.251, campusTrafficCoordinates.mjs)에 오도록 모델을 다시 중심화한 뒤의 좌표다.
//
// `focus`가 있는 시점은 비행 직전에 장면 안의 BLD_* 노드 경계 상자로 목표점을 다시 구한다(건물 중심 + offset).
// 이름은 GLTFLoader가 정리한 런타임 이름이다(BLD_C1.001 -> BLD_C1001, 공백 -> _).
// `fromGround`인 시점은 목표점 x/z의 지형 높이만큼 y를 올린다. 둘 다 구할 수 없으면(모델이 없거나 ?model=uni)
// 아래 고정 좌표를 그대로 쓴다. 고정 좌표는 campus-v2.glb를 띄운 장면에서 같은 규칙으로 재어 둔 값이고, 정문은 위성 영상에서
// 중앙로와 캠퍼스 중심축이 만나는 지점(약 127.4832 E, 34.9687 N)을 투영한 추정치다(지형 높이 약 16 units).
export const OVERVIEW_PRESET_ID = "overview";
export const D4_PRESET_ID = "d4";
export const D4_CAMERA_OFFSET = Object.freeze([60, 50, 60]);
export const FLY_DURATION_MS = 800;
export const TOUR_INTERVAL_MS = 6000;

const CLUSTER_OFFSET = Object.freeze([0, 150, 150]);

export const CAMERA_PRESETS = Object.freeze([
  {
    id: OVERVIEW_PRESET_ID,
    title: "전체",
    description: "캠퍼스 전체 조감",
    position: [0, 260, 260],
    target: [0, 0, 0],
  },
  {
    id: "gate",
    title: "정문",
    description: "정문에서 캠퍼스 안쪽을 바라보는 시점",
    fromGround: true,
    position: [240, 38, 15],
    // 목표점은 정문에서 도서관 쪽으로 약 150 units 들어간 중심축 위: 세로 폰 화면에서도 먼 도서관이 HUD 아래에 든다.
    target: [100, 4, -38],
  },
  {
    id: D4_PRESET_ID,
    title: "공대 3호관",
    description: "공과대학 3호관(D4) 가까이",
    focus: ["BLD_D4"],
    offset: D4_CAMERA_OFFSET,
    position: [-154.4, 96.4, -33.3],
    target: [-214.4, 46.4, -93.3],
  },
  {
    id: "engineering",
    title: "공과대",
    description: "공과대학 1~3호관과 창업보육센터",
    focus: ["BLD_D1", "BLD_D2", "BLD_D3", "BLD_D4"],
    offset: CLUSTER_OFFSET,
    position: [-152.9, 189.5, 51.6],
    target: [-152.9, 39.5, -98.4],
  },
  {
    id: "library",
    title: "도서관",
    description: "도서관과 실습관 일대",
    focus: ["BLD_C1", "BLD_C1001", "BLD_Training_Lab_Building"],
    offset: CLUSTER_OFFSET,
    position: [-50.5, 181.5, 55.5],
    target: [-50.5, 31.5, -94.5],
  },
  {
    id: "life-science",
    title: "생명대",
    description: "박물관, 70주년기념관, 생명산업과학대학",
    focus: ["BLD_B1", "BLD_B2", "BLD_B3", "BLD_B4", "BLD_B5_Greenhouse", "BLD_B7"],
    offset: CLUSTER_OFFSET,
    position: [104.5, 174.7, 67.7],
    target: [104.5, 24.7, -82.3],
  },
  {
    id: "headquarters",
    title: "본부",
    description: "대학본부와 학생생활관 일대",
    focus: ["BLD_A1", "BLD_A4", "BLD_A10", "BLD_Dormitory_Building", "BLD_Dormitory_Building001"],
    offset: CLUSTER_OFFSET,
    position: [13.4, 179.5, 238.2],
    target: [13.4, 29.5, 88.2],
  },
  {
    id: "humanities",
    title: "인문·사범",
    description: "학생회관, 사범대학, 인문예술대학, 사회과학대학",
    focus: ["BLD_E1", "BLD_E3", "BLD_E5", "BLD_E7", "BLD_E8"],
    offset: CLUSTER_OFFSET,
    position: [-92.8, 185.9, 175.3],
    target: [-92.8, 35.9, 25.3],
  },
]);

export function findCameraPreset(id, presets = CAMERA_PRESETS) {
  return presets.find((preset) => preset.id === id) ?? null;
}

// 투어 순서: 목록 순으로 돌되, 현재 시점 다음부터 시작한다. 목록에 없는 시점에서는 첫 시점으로 간다.
export function nextPresetId(currentId, presets = CAMERA_PRESETS) {
  if (presets.length === 0) return null;
  const index = presets.findIndex((preset) => preset.id === currentId);
  return presets[(index + 1) % presets.length].id;
}

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

function unionBounds(names, boundsOf) {
  let union = null;
  for (const name of names) {
    const box = boundsOf(name);
    if (!box) continue;
    union = union
      ? {
          min: box.min.map((value, axis) => Math.min(value, union.min[axis])),
          max: box.max.map((value, axis) => Math.max(value, union.max[axis])),
        }
      : { min: [...box.min], max: [...box.max] };
  }
  return union;
}

// 시점을 실제 카메라 좌표 { position, target }로 푼다.
// boundsOf(name) -> { min: [x,y,z], max: [x,y,z] } | null, groundAt(x, z) -> y | null. 둘 다 선택이다.
export function resolveCameraPreset(preset, { boundsOf = () => null, groundAt = () => null } = {}) {
  if (preset.focus) {
    const bounds = unionBounds(preset.focus, boundsOf);
    if (bounds) {
      const target = bounds.min.map((value, axis) => (value + bounds.max[axis]) / 2);
      return { position: add(target, preset.offset), target };
    }
  }
  if (preset.fromGround) {
    const ground = groundAt(preset.target[0], preset.target[2]);
    if (Number.isFinite(ground)) {
      const lift = [0, ground, 0];
      return { position: add(preset.position, lift), target: add(preset.target, lift) };
    }
  }
  return { position: [...preset.position], target: [...preset.target] };
}

// 건물·묶음을 골랐을 때의 시점: 목표점에서 offset(기본 D4 시점 거리)만큼 떨어진 자리. 방위는 지금 카메라가 있는 쪽을 따른다
// (고정 방위면 건물 반대편으로 최대 180도 돌아간다). 수평 거리와 높이는 offset 그대로다. 지금 카메라가 목표 바로 위면 offset 방위를 쓴다.
export function focusViewFrom(current, target, offset = D4_CAMERA_OFFSET) {
  const horizontal = Math.hypot(offset[0], offset[2]);
  const dx = (current?.position?.[0] ?? NaN) - target[0];
  const dz = (current?.position?.[2] ?? NaN) - target[2];
  const flat = Math.hypot(dx, dz);
  const [ux, uz] = Number.isFinite(flat) && flat > 1e-6 ? [dx / flat, dz / flat] : [offset[0] / horizontal, offset[2] / horizontal];
  return { position: [target[0] + ux * horizontal, target[1] + offset[1], target[2] + uz * horizontal], target: [...target] };
}

// 2차 가감속(quadratic in-out). 0..1 밖은 양 끝으로 고정한다.
export function easeInOutQuad(t) {
  const x = Math.min(1, Math.max(0, t));
  return x < 0.5 ? 2 * x * x : 1 - ((-2 * x + 2) ** 2) / 2;
}

export function lerpView(from, to, t) {
  const mix = (a, b) => a + (b - a) * t;
  return {
    position: from.position.map((value, axis) => mix(value, to.position[axis])),
    target: from.target.map((value, axis) => mix(value, to.target[axis])),
  };
}
