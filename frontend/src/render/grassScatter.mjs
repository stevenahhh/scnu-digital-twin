// 잔디 덤불 배치(CampusGrass.jsx가 그린다). 잔디 지면 삼각형 위에 면적 비례로 점을 흩뿌린다.
// 지면 삼각형을 정사각 덩어리로 먼저 나눠 두고(buildGrassField), 덩어리 하나의 덤불은 카메라가 다가왔을 때 만든다(scatterChunk).
// 같은 지면이면 같은 배치가 나온다. 씨앗을 삼각형 번호가 아닌 위치로 정하므로 모델을 다시 인코딩해 삼각형 순서가 바뀌어도 같다.
// 배치는 보기 위한 연출이며 실제 식생 조사가 아니다.

// lib/landcover.mjs LANDCOVER.GRASS
export const GRASS_CLASS = 1;
// landcover.png 왼쪽 위 칸의 모델 좌표(생성기 lib/frame.mjs EXTENT.minX, minZ)
export const LANDCOVER_ORIGIN = Object.freeze({ minX: -2, minZ: -376 });
// 이보다 가파른 비탈(법선과 수직축 사이 각)에는 심지 않는다.
const DEFAULT_MAX_SLOPE_DEG = 40;
// 덤불 하나: x, y, z, 방위각(rad), 크기 배율, 출처(sources의 번호)
export const TUFT_STRIDE = 6;

// 생성기 stages/sources.mjs의 landcoverAt과 같은 규칙: 장면 단위 한 칸에 한 바이트, 범위 밖은 가장자리 칸으로 자른다.
export function landcoverSampler({ pixels, width, height, channels = 1, minX, minZ }) {
  return (x, z) => {
    const col = Math.max(0, Math.min(width - 1, Math.floor(x - minX)));
    const row = Math.max(0, Math.min(height - 1, Math.floor(z - minZ)));
    return pixels[(row * width + col) * channels];
  };
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function transformed(positions, matrix) {
  if (!matrix) return positions;
  const m = matrix;
  const out = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2];
    out[i] = m[0] * x + m[4] * y + m[8] * z + m[12];
    out[i + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
    out[i + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
  }
  return out;
}

const vertexOffset = (index, t, corner) => (index ? index[t * 3 + corner] : t * 3 + corner) * 3;

// sources: [{ positions, index, matrix, accept }]. positions는 정점 xyz, index는 삼각형 정점 번호(없으면 세 정점씩),
// matrix는 정점에 먼저 곱할 4x4(열 우선, three의 Matrix4.elements), accept(x, z)는 그 점에 심어도 되는지(없으면 어디든).
// 반환: { sources, chunks }. chunks는 "ix,iz" -> { center, parts: [{ source, triangles }] }이고 삼각형은 무게중심이 든 덩어리에 속한다.
export function buildGrassField({ sources, chunkSize }) {
  const prepared = [];
  const buckets = new Map();
  sources.forEach((source, sourceIndex) => {
    const p = transformed(source.positions, source.matrix ?? null);
    const index = source.index ?? null;
    prepared.push({ positions: p, index, accept: source.accept ?? null });
    const triangles = index ? index.length / 3 : p.length / 9;
    for (let t = 0; t < triangles; t += 1) {
      const a = vertexOffset(index, t, 0);
      const b = vertexOffset(index, t, 1);
      const c = vertexOffset(index, t, 2);
      const ix = Math.floor((p[a] + p[b] + p[c]) / 3 / chunkSize);
      const iz = Math.floor((p[a + 2] + p[b + 2] + p[c + 2]) / 3 / chunkSize);
      const key = `${ix},${iz}`;
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { ix, iz, ySum: 0, count: 0, parts: new Map() };
        buckets.set(key, bucket);
      }
      let part = bucket.parts.get(sourceIndex);
      if (!part) {
        part = [];
        bucket.parts.set(sourceIndex, part);
      }
      part.push(t);
      bucket.ySum += (p[a + 1] + p[b + 1] + p[c + 1]) / 3;
      bucket.count += 1;
    }
  });
  const chunks = new Map();
  for (const [key, bucket] of buckets) {
    chunks.set(key, {
      center: [(bucket.ix + 0.5) * chunkSize, bucket.ySum / bucket.count, (bucket.iz + 0.5) * chunkSize],
      parts: [...bucket.parts].map(([source, triangles]) => ({ source, triangles })),
    });
  }
  return { sources: prepared, chunks };
}

// 덩어리 하나의 덤불. density는 평면 면적 1 단위²당 덤불 수. 반환: Float32Array(TUFT_STRIDE개씩).
export function scatterChunk(field, key, { density, maxSlopeDeg = DEFAULT_MAX_SLOPE_DEG, seed = 1 }) {
  const chunk = field.chunks.get(key);
  if (!chunk) return new Float32Array(0);
  const minCos = Math.cos((maxSlopeDeg * Math.PI) / 180);
  const out = [];
  for (const part of chunk.parts) {
    const { positions: p, index, accept } = field.sources[part.source];
    // x, z, y 순으로 작은 정점부터: 삼각형의 정점 순서가 달라져도 같은 점을 뽑는다.
    const before = (i, j) => p[i] - p[j] || p[i + 2] - p[j + 2] || p[i + 1] - p[j + 1];
    for (const t of part.triangles) {
      const [a, b, c] = [vertexOffset(index, t, 0), vertexOffset(index, t, 1), vertexOffset(index, t, 2)].sort(before);
      const e1x = p[b] - p[a], e1y = p[b + 1] - p[a + 1], e1z = p[b + 2] - p[a + 2];
      const e2x = p[c] - p[a], e2y = p[c + 1] - p[a + 1], e2z = p[c + 2] - p[a + 2];
      const nx = e1y * e2z - e1z * e2y;
      const ny = e1z * e2x - e1x * e2z;
      const nz = e1x * e2y - e1y * e2x;
      const length = Math.hypot(nx, ny, nz);
      if (length === 0 || Math.abs(ny) / length < minCos) continue;
      const cx = (p[a] + p[b] + p[c]) / 3;
      const cz = (p[a + 2] + p[b + 2] + p[c + 2]) / 3;
      const random = mulberry32(Math.imul(Math.round(cx * 16), 73856093) ^ Math.imul(Math.round(cz * 16), 19349663) ^ seed);
      const count = Math.floor((Math.abs(ny) / 2) * density + random());
      for (let k = 0; k < count; k += 1) {
        let u = random();
        let v = random();
        if (u + v > 1) {
          u = 1 - u;
          v = 1 - v;
        }
        const x = p[a] + e1x * u + e2x * v;
        const y = p[a + 1] + e1y * u + e2y * v;
        const z = p[a + 2] + e1z * u + e2z * v;
        const yaw = random() * Math.PI * 2;
        const scale = 0.7 + random() * 0.6;
        if (accept && !accept(x, z)) continue;
        out.push(x, y, z, Math.min(yaw, Math.PI * 2 - 1e-6), scale, part.source);
      }
    }
  }
  return new Float32Array(out);
}

// 점에서 중심까지 거리가 distance 이하인 덩어리의 키.
export function chunksInRange(chunks, point, distance) {
  const limit = distance * distance;
  const keys = new Set();
  for (const [key, chunk] of chunks) {
    const dx = chunk.center[0] - point[0];
    const dy = chunk.center[1] - point[1];
    const dz = chunk.center[2] - point[2];
    if (dx * dx + dy * dy + dz * dz <= limit) keys.add(key);
  }
  return keys;
}
