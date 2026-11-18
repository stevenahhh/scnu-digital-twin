// 도로 통행제한·건물 공사 알림(시뮬레이션 서버의 /api/simulation/restrictions)을 화면에 쓰는 순수 함수들.
const ROAD_CAUSE = Object.freeze({ construction: "공사", event: "행사", other: "통제" });
const BUILDING_STATUS = Object.freeze({ construction: "공사 중", event: "행사 중", other: "출입 주의" });
const ROAD_ACCESS = Object.freeze({ vehicles: "차량 통행 제한", all: "전면 통제" });

export const CAUSE_OPTIONS = Object.freeze([
  { value: "construction", label: "공사" },
  { value: "event", label: "행사" },
  { value: "other", label: "기타" },
]);
export const ACCESS_OPTIONS = Object.freeze([
  { value: "vehicles", label: "차량만 제한" },
  { value: "all", label: "전면 통제" },
]);

const isRestriction = (item) => typeof item?.id === "string" && typeof item.target_id === "string"
  && (item.target_type === "road" || item.target_type === "building") && Array.isArray(item.segments);

export const parseRestrictions = (body) => (Array.isArray(body?.restrictions) ? body.restrictions.filter(isRestriction) : []);

export function describeRestriction(item) {
  const status = item.target_type === "road"
    ? `${ROAD_CAUSE[item.cause] ?? ROAD_CAUSE.other} · ${ROAD_ACCESS[item.access] ?? ROAD_ACCESS.vehicles}`
    : BUILDING_STATUS[item.cause] ?? BUILDING_STATUS.other;
  return { title: item.target_name || item.target_id, status, detail: item.message || "" };
}

export const buildingNotice = (items, elementId) => items.find((item) => item.target_type === "building" && item.target_id === elementId) ?? null;

// 통제 구간의 줄무늬 띠. segments는 시뮬레이션 좌표 [x, z] 선들이고, toWorld([x, z])가 장면 좌표 [x, y, z]를 준다.
// 사각형마다 꼭짓점 넷을 따로 두어 줄무늬 색이 섞이지 않게 하고, 길이를 stripe 길이로 나눠 도로마다 다르게 계산한다.
export function restrictionRibbon(segments, toWorld, { halfWidth = 3, stripe = 3 } = {}) {
  const positions = [];
  const indices = [];
  const stripes = [];
  for (const line of segments) {
    let index = 0;
    for (let i = 0; i + 1 < line.length; i += 1) {
      const [ax, az] = line[i];
      const [bx, bz] = line[i + 1];
      const length = Math.hypot(bx - ax, bz - az);
      if (length < 1e-6) continue;
      const nx = -(bz - az) / length;
      const nz = (bx - ax) / length;
      const count = Math.max(1, Math.ceil(length / stripe));
      for (let k = 0; k < count; k += 1) {
        const base = positions.length / 3;
        for (const t of [k / count, (k + 1) / count]) {
          const x = ax + (bx - ax) * t;
          const z = az + (bz - az) * t;
          positions.push(...toWorld([x + nx * halfWidth, z + nz * halfWidth]), ...toWorld([x - nx * halfWidth, z - nz * halfWidth]));
        }
        indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
        stripes.push(index % 2);
        index += 1;
      }
    }
  }
  return { positions, indices, stripes };
}

// 도로 이름표를 놓을 자리: 통제 구간 전체 길이의 절반 지점.
export function roadLabelPoint(segments) {
  const pieces = segments.flatMap((line) => line.slice(1).map((point, i) => [line[i], point, Math.hypot(point[0] - line[i][0], point[1] - line[i][1])]));
  let remaining = pieces.reduce((sum, piece) => sum + piece[2], 0) / 2;
  for (const [a, b, length] of pieces) {
    if (length > 0 && remaining <= length) return [a[0] + ((b[0] - a[0]) * remaining) / length, a[1] + ((b[1] - a[1]) * remaining) / length];
    remaining -= length;
  }
  return null;
}
