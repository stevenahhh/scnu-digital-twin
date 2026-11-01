// Terrain height lookup from the campus-v2 height sidecar (public/campus-v2-height.json + .bin), written by
// scripts/campus-model/build-campus-model.mjs: `width` x `height` little-endian u16 samples, row-major with x
// fastest, sample (i, j) at model-frame (originX + i * step, originZ + j * step), height minY + value * scale.
// The Topography mesh triangulates each grid cell as a,c,b / b,c,d (stages/ground.mjs, a = (i, j),
// b = (i + 1, j), c = (i, j + 1), d = (i + 1, j + 1)), so "triangle" sampling reproduces the rendered surface;
// "bilinear" is the smooth alternative. Heights are the generator's terrain model, not survey measurements.

export const CAMPUS_HEIGHTFIELD_URLS = Object.freeze({
  meta: "/campus-v2-height.json",
  data: "/campus-v2-height.bin",
});

export function parseHeightfield(meta, buffer) {
  const { width, height, originX, originZ, step, minY, scale } = meta ?? {};
  const numbers = [width, height, originX, originZ, step, minY, scale];
  if (!numbers.every(Number.isFinite) || width < 2 || height < 2 || !(step > 0)) {
    throw new Error("height sidecar metadata is incomplete");
  }
  const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  if (bytes.byteLength !== width * height * 2) {
    throw new Error(`height sidecar has ${bytes.byteLength} B, expected ${width * height * 2} B for ${width} x ${height}`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const heights = new Float32Array(width * height);
  for (let k = 0; k < heights.length; k += 1) heights[k] = minY + view.getUint16(k * 2, true) * scale;
  return { width, height, originX, originZ, step, heights };
}

// Model-frame height at (x, z), or null outside the grid.
export function sampleHeight(field, x, z, mode = "triangle") {
  const { width, height, originX, originZ, step, heights } = field;
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
  if (mode === "bilinear") return (a * (1 - fx) + b * fx) * (1 - fz) + (c * (1 - fx) + d * fx) * fz;
  // Diagonal b-c splits the cell at fx + fz = 1.
  if (fx + fz <= 1) return a + (b - a) * fx + (c - a) * fz;
  return d + (c - d) * (1 - fx) + (b - d) * (1 - fz);
}

// Fetches and parses the sidecar; resolves null when it is missing or unreadable so callers keep their fallback.
// Callers that ask for the same URLs with the same fetch share one request (the campus labels and the traffic
// simulation both load it on start). A null result is not kept, so a later caller can try again.
const pendingLoads = new WeakMap();

export function loadHeightfield(urls = CAMPUS_HEIGHTFIELD_URLS, fetchImpl = globalThis.fetch) {
  let byUrl = pendingLoads.get(fetchImpl);
  if (!byUrl) {
    byUrl = new Map();
    pendingLoads.set(fetchImpl, byUrl);
  }
  const key = `${urls.meta}\n${urls.data}`;
  const cached = byUrl.get(key);
  if (cached) return cached;
  const load = fetchHeightfield(urls, fetchImpl).then((field) => {
    if (!field) byUrl.delete(key);
    return field;
  });
  byUrl.set(key, load);
  return load;
}

async function fetchHeightfield(urls, fetchImpl) {
  try {
    const [metaResponse, dataResponse] = await Promise.all([fetchImpl(urls.meta), fetchImpl(urls.data)]);
    if (!metaResponse.ok || !dataResponse.ok) return null;
    const [meta, buffer] = await Promise.all([metaResponse.json(), dataResponse.arrayBuffer()]);
    return parseHeightfield(meta, buffer);
  } catch (error) {
    console.warn(`terrain height sidecar unavailable, traffic heights fall back to raycasts: ${error.message}`);
    return null;
  }
}
