// 카메라가 지형(캠퍼스 Topography와 바깥 산 OuterTerrain) 밑으로 들어가지 않게 하는 순수 함수들.
// 높이 사이드카(terrain/heightfield.mjs)는 캠퍼스 격자만 덮으므로, 모델이 올라온 뒤 지형 메시의 삼각형으로
// 바깥 산까지 덮는 지면 격자를 한 번 만들고 프레임마다 그 격자에서 높이를 읽는다(레이캐스트 없음).

// 지면 격자를 만들 메시 이름. Topography*는 캠퍼스 지형, OuterTerrain은 둘레의 산이다.
export const GROUND_MESH_NAME = /^(Topography|OuterTerrain)/;
// 카메라(와 near 평면)가 지면 위에 남겨 둘 여유(m). near는 0.1이라 이 여유 안에 들어간다.
export const CAMERA_GROUND_CLEARANCE = 4;
export const GROUND_GRID_CELL = 4;

// sources: [{ positions, index }]. positions는 월드 좌표 [x, y, z, ...], index는 없으면 비색인 삼각형 목록.
// 격자점(cellSize 간격)마다 그 점을 덮는 삼각형의 평면 높이 중 가장 높은 값을 기록한다(겹친 메시는 위쪽).
// 어떤 삼각형도 덮지 않는 격자점은 -Infinity다.
export function buildGroundGrid(sources, { cellSize = GROUND_GRID_CELL } = {}) {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const { positions } of sources) {
    for (let k = 0; k < positions.length; k += 3) {
      const x = positions[k];
      const z = positions[k + 2];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
  }
  if (!(maxX > minX && maxZ > minZ)) return null;
  const width = Math.floor((maxX - minX) / cellSize) + 2;
  const height = Math.floor((maxZ - minZ) / cellSize) + 2;
  const heights = new Float32Array(width * height).fill(-Infinity);
  const grid = { originX: minX, originZ: minZ, step: cellSize, width, height, heights };

  for (const { positions, index } of sources) {
    const count = index ? index.length : positions.length / 3;
    for (let t = 0; t + 2 < count; t += 3) {
      const a = (index ? index[t] : t) * 3;
      const b = (index ? index[t + 1] : t + 1) * 3;
      const c = (index ? index[t + 2] : t + 2) * 3;
      rasterizeTriangle(grid, positions, a, b, c);
    }
  }
  return grid;
}

function rasterizeTriangle(grid, p, a, b, c) {
  const { originX, originZ, step, width, height, heights } = grid;
  const ax = p[a], ay = p[a + 1], az = p[a + 2];
  const bx = p[b], by = p[b + 1], bz = p[b + 2];
  const cx = p[c], cy = p[c + 1], cz = p[c + 2];
  const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
  if (Math.abs(det) < 1e-9) return; // 위에서 보면 선분인 삼각형(벽)은 지면이 아니다.
  const i0 = Math.max(0, Math.ceil((Math.min(ax, bx, cx) - originX) / step));
  const i1 = Math.min(width - 1, Math.floor((Math.max(ax, bx, cx) - originX) / step));
  const j0 = Math.max(0, Math.ceil((Math.min(az, bz, cz) - originZ) / step));
  const j1 = Math.min(height - 1, Math.floor((Math.max(az, bz, cz) - originZ) / step));
  const eps = -1e-6;
  for (let j = j0; j <= j1; j += 1) {
    const z = originZ + j * step;
    for (let i = i0; i <= i1; i += 1) {
      const x = originX + i * step;
      const wa = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / det;
      const wb = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / det;
      const wc = 1 - wa - wb;
      if (wa < eps || wb < eps || wc < eps) continue;
      const y = wa * ay + wb * by + wc * cy;
      const k = j * width + i;
      if (y > heights[k]) heights[k] = y;
    }
  }
}

// 격자 위 (x, z)의 지면 높이. 네 격자점을 쌍선형 보간하고(연속이라 카메라가 계단처럼 튀지 않는다),
// 덮이지 않은 격자점이 섞이면 덮인 점 중 최댓값을 쓴다. 격자 밖이거나 네 점 모두 비면 null.
export function sampleGroundGrid(grid, x, z) {
  if (!grid) return null;
  const { originX, originZ, step, width, height, heights } = grid;
  const gx = (x - originX) / step;
  const gz = (z - originZ) / step;
  if (!(gx >= 0 && gz >= 0 && gx <= width - 1 && gz <= height - 1)) return null;
  const i = Math.min(Math.floor(gx), width - 2);
  const j = Math.min(Math.floor(gz), height - 2);
  const fx = gx - i;
  const fz = gz - j;
  const a = heights[j * width + i];
  const b = heights[j * width + i + 1];
  const c = heights[(j + 1) * width + i];
  const d = heights[(j + 1) * width + i + 1];
  if (a > -Infinity && b > -Infinity && c > -Infinity && d > -Infinity) {
    return (a * (1 - fx) + b * fx) * (1 - fz) + (c * (1 - fx) + d * fx) * fz;
  }
  const top = Math.max(a, b, c, d);
  return top > -Infinity ? top : null;
}

// 궤도 카메라가 지면 + clearance보다 낮으면, 목표점을 중심으로 같은 거리·같은 방위를 지키며 극각만 줄여
// (위로 돌려) 지면 위로 올린 위치 [x, y, z]를 돌려준다. 이미 충분히 높으면 null.
// 올린 자리의 지면이 더 높을 수 있어 몇 번 되풀이한다. minPolarAngle보다 더 세울 수 없으면
// 그 극각 자리에서 높이만 올린다(거리가 늘어난다).
// position·target은 [x, y, z], groundAt(x, z)는 높이 또는 null(지면 없음)이다.
export function clampOrbitAboveGround(position, target, groundAt, {
  clearance = CAMERA_GROUND_CLEARANCE,
  minPolarAngle = 0,
  iterations = 6,
} = {}) {
  const ground = groundAt(position[0], position[2]);
  if (ground === null || position[1] >= ground + clearance) return null;
  const ox = position[0] - target[0];
  const oy = position[1] - target[1];
  const oz = position[2] - target[2];
  const radius = Math.hypot(ox, oy, oz);
  const horizontal = Math.hypot(ox, oz);
  if (horizontal < 1e-6 || radius < 1e-6) return [position[0], ground + clearance, position[2]];
  const ux = ox / horizontal;
  const uz = oz / horizontal;
  const maxCos = Math.cos(minPolarAngle);

  let required = ground + clearance;
  let next = [position[0], position[1], position[2]];
  for (let k = 0; k < iterations; k += 1) {
    const cos = Math.min(maxCos, (required - target[1]) / radius);
    const reach = radius * Math.sqrt(Math.max(0, 1 - cos * cos));
    next = [target[0] + ux * reach, target[1] + radius * cos, target[2] + uz * reach];
    const there = groundAt(next[0], next[2]);
    const need = there === null ? -Infinity : there + clearance;
    if (need <= next[1] + 1e-6) return next;
    required = Math.max(required, need);
    if (cos === maxCos) break;
  }
  const there = groundAt(next[0], next[2]);
  next[1] = Math.max(next[1], required, there === null ? -Infinity : there + clearance);
  return next;
}
