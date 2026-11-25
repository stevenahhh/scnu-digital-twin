// 편집 중인 객체가 바닥(지형, 포장, 노면 표시, 밑에 있는 다른 객체)을 뚫고 내려가지 않게 한다.
// 공중에 떠 있는 것은 허용한다. 지지점이 바닥보다 아래로 내려가면 객체를 올려 바닥에 얹는다.
// 이동 드래그에서는 한 지지점이 먼저 닿은 뒤 계속 끌어내리면 그만큼 기울여, 끝까지 끌면 모든 지지점(펜스의 두 다리)이
// 바닥에 닿는다. 좌표는 모두 객체 부모의 좌표계다. three.js 수학 객체만 쓰고 장면은 건드리지 않는다.
import { Matrix4, Quaternion, Vector3 } from "three";

const SUPPORT_BAND_RATIO = 0.08;
const SUPPORT_BAND_MIN = 0.03;
const SUPPORT_POINTS_MAX = 12;
// 지지점이 거의 한 줄(펜스, 난간)이면 면 대신 선으로 기울인다: 좁은 쪽 분산 / 넓은 쪽 분산이 이보다 작을 때.
const LINE_RATIO = 0.01;
const EPSILON = 1e-9;

// 2D 볼록 껍질(단조 사슬). 점은 [x, y, z]이고 x, z로 본다.
function hullXZ(points) {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[2] - b[2]);
  if (sorted.length < 3) return sorted;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[2] - o[2]) - (a[2] - o[2]) * (b[0] - o[0]);
  const chain = (list) => {
    const out = [];
    for (const p of list) {
      while (out.length >= 2 && cross(out.at(-2), out.at(-1), p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...chain(sorted), ...chain([...sorted].reverse())];
}

// 객체 정점(객체 좌표) 중 가장 낮은 띠에 드는 점들의 바깥 윤곽: 바닥에 닿는 발이다.
export function selectSupportPoints(vertices, { bandRatio = SUPPORT_BAND_RATIO, bandMin = SUPPORT_BAND_MIN, max = SUPPORT_POINTS_MAX } = {}) {
  if (vertices.length === 0) return [];
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [, y] of vertices) {
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const band = Math.max(bandMin, (maxY - minY) * bandRatio);
  const hull = hullXZ(vertices.filter(([, y]) => y <= minY + band));
  if (hull.length <= max) return hull;
  return Array.from({ length: max }, (_, i) => hull[Math.floor((i * hull.length) / max)]);
}

const composeMatrix = (t) =>
  new Matrix4().compose(new Vector3(...t.position), new Quaternion(...t.quaternion), new Vector3(...t.scale));

function contacts(transform, points, groundAt) {
  const matrix = composeMatrix(transform);
  const out = [];
  for (const point of points) {
    const world = new Vector3(...point).applyMatrix4(matrix);
    const ground = groundAt(world.x, world.z, world.y);
    if (ground !== null && Number.isFinite(ground)) out.push({ world, ground, depth: ground - world.y });
  }
  return out;
}

// y = a x + b z + c 최소제곱. 높이 heights는 xz 점마다 하나. 법선은 (-a, 1, -b).
function planeNormal(xz, heights) {
  let sx = 0; let sz = 0; let sy = 0;
  const n = xz.length;
  for (let i = 0; i < n; i += 1) { sx += xz[i][0]; sz += xz[i][1]; sy += heights[i]; }
  const [mx, mz, my] = [sx / n, sz / n, sy / n];
  let xx = 0; let xz2 = 0; let zz = 0; let xy = 0; let zy = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = xz[i][0] - mx; const dz = xz[i][1] - mz; const dy = heights[i] - my;
    xx += dx * dx; xz2 += dx * dz; zz += dz * dz; xy += dx * dy; zy += dz * dy;
  }
  const det = xx * zz - xz2 * xz2;
  const a = (xy * zz - zy * xz2) / det;
  const b = (zy * xx - xy * xz2) / det;
  return new Vector3(-a, 1, -b).normalize();
}

// 지지점 배치의 주축과 퍼짐: 거의 한 줄이면 line 모드.
function layout(xz) {
  const n = xz.length;
  const mx = xz.reduce((s, p) => s + p[0], 0) / n;
  const mz = xz.reduce((s, p) => s + p[1], 0) / n;
  let xx = 0; let xzc = 0; let zz = 0;
  for (const [x, z] of xz) { xx += (x - mx) ** 2; xzc += (x - mx) * (z - mz); zz += (z - mz) ** 2; }
  const trace = xx + zz;
  const root = Math.sqrt(Math.max(0, ((xx - zz) / 2) ** 2 + xzc ** 2));
  const major = trace / 2 + root;
  const minor = trace / 2 - root;
  const axis = Math.abs(xzc) > EPSILON || xx >= zz ? [major - zz, xzc] : [xzc, major - xx];
  const length = Math.hypot(axis[0], axis[1]) || 1;
  return { line: major <= EPSILON || minor / major < LINE_RATIO, axis: [axis[0] / length, axis[1] / length], major };
}

// 깊이(바닥 - 지지점)를 주축(선) 또는 xz(면)에 대한 최소제곱으로 맞춘 값의 범위: 나머지 지지점까지 닿는 데 더 끌어야 하는 깊이다.
// 발 옆의 조금 높은 점(발판 모서리) 때문에 범위가 부풀지 않도록 최솟값과 최댓값 대신 맞춘 값을 쓴다.
function fittedDepthRange(list) {
  if (list.length < 2) return 0;
  const xz = list.map(({ world }) => [world.x, world.z]);
  const shape = layout(xz);
  if (shape.major <= EPSILON) return 0;
  const depths = list.map((c) => c.depth);
  const my = depths.reduce((s, v) => s + v, 0) / depths.length;
  let fitted;
  if (shape.line) {
    const along = xz.map(([x, z]) => x * shape.axis[0] + z * shape.axis[1]);
    const mean = along.reduce((s, v) => s + v, 0) / along.length;
    let num = 0; let den = 0;
    along.forEach((s, i) => { num += (s - mean) * (depths[i] - my); den += (s - mean) ** 2; });
    fitted = along.map((s) => (num / den) * (s - mean));
  } else {
    const normal = planeNormal(xz, depths);
    fitted = xz.map(([x, z]) => -(normal.x * x + normal.z * z) / normal.y);
  }
  return Math.max(...fitted) - Math.min(...fitted);
}

// 지지점을 바닥에 맞추는 전체 기울임(현재 자세에서 더 돌릴 양).
function fullTilt(list) {
  if (list.length < 2) return new Quaternion();
  const xz = list.map(({ world }) => [world.x, world.z]);
  const shape = layout(xz);
  if (shape.major <= EPSILON) return new Quaternion();
  if (shape.line) {
    // 주축을 따라 잔 높이의 기울기(최소제곱)를 객체와 바닥에서 각각 구해 그 차이만큼 돌린다.
    const along = list.map(({ world }) => world.x * shape.axis[0] + world.z * shape.axis[1]);
    const mean = along.reduce((s, v) => s + v, 0) / along.length;
    const slopeOf = (heights) => {
      const my = heights.reduce((s, v) => s + v, 0) / heights.length;
      let num = 0; let den = 0;
      along.forEach((s, i) => { num += (s - mean) * (heights[i] - my); den += (s - mean) ** 2; });
      return num / den;
    };
    const direction = (slope) => new Vector3(shape.axis[0], slope, shape.axis[1]).normalize();
    return new Quaternion().setFromUnitVectors(
      direction(slopeOf(list.map(({ world }) => world.y))), direction(slopeOf(list.map(({ ground }) => ground))));
  }
  const objectNormal = planeNormal(xz, list.map(({ world }) => world.y));
  const groundNormal = planeNormal(xz, list.map(({ ground }) => ground));
  return new Quaternion().setFromUnitVectors(objectNormal, groundNormal);
}

// transform(사용자가 끈 자세)을 바닥 규칙에 맞춘 자세로 바꾼다. groundAt(x, z, y)는 그 아래 바닥 높이 또는 null.
// tilt가 false이면(회전·크기 드래그) 기울이지 않고 올리기만 한다.
export function settleOnGround({ transform, points, groundAt, tilt = true }) {
  const first = contacts(transform, points, groundAt);
  if (first.length === 0) return transform;
  const deepest = Math.max(...first.map((c) => c.depth));
  if (deepest <= 0) return transform;
  let quaternion = new Quaternion(...transform.quaternion);
  if (tilt) {
    // 처음 닿은 뒤 더 끌어내린 깊이를, 나머지 지지점이 닿는 데 필요한 깊이(spread)로 나눈 비율만큼 기울인다.
    const spread = fittedDepthRange(first);
    const progress = spread <= EPSILON ? 1 : Math.min(1, deepest / spread);
    const turn = new Quaternion().slerp(fullTilt(first), progress);
    quaternion = turn.multiply(quaternion);
  }
  const turned = { ...transform, quaternion: quaternion.toArray() };
  const after = contacts(turned, points, groundAt);
  const lift = after.length ? Math.max(0, ...after.map((c) => c.depth)) : 0;
  return { ...turned, position: [transform.position[0], transform.position[1] + lift, transform.position[2]] };
}
