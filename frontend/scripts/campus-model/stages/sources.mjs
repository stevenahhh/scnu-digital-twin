// Source inputs for the campus model: uni.glb (scene, building ids, terrain), building footprints
// (data/gis-buildings.json), land cover raster and the GeoJSON road/walkway/crosswalk layers.
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { EXTENT, geoToModel, metres } from "../lib/frame.mjs";
import { cleanRing, pointInRing, ringArea } from "../lib/geometry.mjs";
import { loadOrtho, photoCalibration } from "../lib/ortho.mjs";
import { decodePng } from "../lib/png.mjs";
import { readA003 } from "../lib/a003.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(HERE, "..");
const FRONTEND = path.resolve(SCRIPT, "../..");
const REPO = path.resolve(FRONTEND, "..");

const WIDTH = EXTENT.maxX - EXTENT.minX;
const DEPTH = EXTENT.maxZ - EXTENT.minZ;

// ---------------------------------------------------------------- source model
export async function loadSourceModel() {
  const bytes = await Bun.file(path.join(FRONTEND, "public", "uni.glb")).arrayBuffer();
  const view = new DataView(bytes);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, view.getUint32(12, true))));
  const gltf = await new Promise((resolve, reject) => new GLTFLoader().parse(bytes, "", resolve, reject));
  gltf.scene.updateMatrixWorld(true);
  const rawNames = json.scenes[0].nodes.map((index) => json.nodes[index].name);
  return { scene: gltf.scene, rawNames };
}

// Upward faces of a prism mesh -> outline rings of its highest roof level.
export function meshFootprint(mesh) {
  const geometry = (mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone()).applyMatrix4(mesh.matrixWorld);
  const p = geometry.attributes.position;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  let minY = Infinity;
  let topY = -Infinity;
  const tops = [];
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i);
    b.fromBufferAttribute(p, i + 1);
    c.fromBufferAttribute(p, i + 2);
    minY = Math.min(minY, a.y, b.y, c.y);
    const normal = ab.subVectors(b, a).cross(ac.subVectors(c, a)).normalize();
    if (Math.abs(normal.y) > 0.98) tops.push([[a.x, a.z, a.y], [b.x, b.z, b.y], [c.x, c.z, c.y]]);
  }
  for (const t of tops) topY = Math.max(topY, t[0][2]);
  const key = (q) => `${q[0].toFixed(3)},${q[1].toFixed(3)}`;
  const edges = new Map();
  for (const t of tops.filter((tri) => Math.abs(tri[0][2] - topY) < 0.2)) {
    for (let i = 0; i < 3; i += 1) {
      const p0 = t[i];
      const p1 = t[(i + 1) % 3];
      const id = [key(p0), key(p1)].sort().join("|");
      const entry = edges.get(id);
      if (entry) entry.count += 1;
      else edges.set(id, { count: 1, p0, p1 });
    }
  }
  const boundary = [...edges.values()].filter((e) => e.count === 1);
  const adjacency = new Map();
  for (const e of boundary) {
    for (const [u, v] of [[e.p0, e.p1], [e.p1, e.p0]]) {
      if (!adjacency.has(key(u))) adjacency.set(key(u), []);
      adjacency.get(key(u)).push(v);
    }
  }
  const used = new Set();
  const loops = [];
  for (const e of boundary) {
    const startId = `${key(e.p0)}>${key(e.p1)}`;
    if (used.has(startId) || used.has(`${key(e.p1)}>${key(e.p0)}`)) continue;
    used.add(startId);
    const loop = [e.p0];
    let prev = e.p0;
    let cur = e.p1;
    for (let guard = 0; key(cur) !== key(e.p0) && guard < 10000; guard += 1) {
      loop.push(cur);
      const next = (adjacency.get(key(cur)) ?? []).find(
        (v) => key(v) !== key(prev) && !used.has(`${key(cur)}>${key(v)}`) && !used.has(`${key(v)}>${key(cur)}`),
      );
      if (!next) break;
      used.add(`${key(cur)}>${key(next)}`);
      prev = cur;
      cur = next;
    }
    if (loop.length >= 3) loops.push(cleanRing(loop.map(([x, z]) => [x, z])));
  }
  loops.sort((l1, l2) => Math.abs(ringArea(l2)) - Math.abs(ringArea(l1)));
  return { minY, topY, outer: loops[0], holes: loops.slice(1).filter((l) => l.length >= 3 && pointInRing(l[0], loops[0])) };
}

// Max height of uni.glb's Topography ground surfaces rasterised on a 1-unit grid. The Topography
// group also carries brick/concrete structures (stairs, walls, plinths); those are skipped and any
// remaining spike well above its neighbourhood median is replaced, then gaps are filled.
const GROUND_MATERIALS = /FrontColor|Blacktop|Water/;
export function buildHeightfield(topography) {
  const cols = WIDTH + 1;
  const rows = DEPTH + 1;
  const heights = new Float32Array(cols * rows).fill(NaN);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  topography.traverse((child) => {
    if (!child.isMesh || !GROUND_MATERIALS.test([].concat(child.material)[0]?.name ?? "")) return;
    const geometry = (child.geometry.index ? child.geometry.toNonIndexed() : child.geometry.clone()).applyMatrix4(child.matrixWorld);
    const p = geometry.attributes.position;
    for (let i = 0; i < p.count; i += 3) {
      a.fromBufferAttribute(p, i);
      b.fromBufferAttribute(p, i + 1);
      c.fromBufferAttribute(p, i + 2);
      const det = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
      if (Math.abs(det) < 1e-9) continue;
      const i0 = Math.max(0, Math.ceil(Math.min(a.x, b.x, c.x) - EXTENT.minX));
      const i1 = Math.min(cols - 1, Math.floor(Math.max(a.x, b.x, c.x) - EXTENT.minX));
      const j0 = Math.max(0, Math.ceil(Math.min(a.z, b.z, c.z) - EXTENT.minZ));
      const j1 = Math.min(rows - 1, Math.floor(Math.max(a.z, b.z, c.z) - EXTENT.minZ));
      for (let j = j0; j <= j1; j += 1) {
        const z = EXTENT.minZ + j;
        for (let ii = i0; ii <= i1; ii += 1) {
          const x = EXTENT.minX + ii;
          const l1 = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / det;
          const l2 = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / det;
          const l3 = 1 - l1 - l2;
          if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
          const y = l1 * a.y + l2 * b.y + l3 * c.y;
          const k = j * cols + ii;
          if (!(heights[k] >= y)) heights[k] = y;
        }
      }
    }
  });
  {
    const R = 5;
    const neighbourhood = [];
    const source = heights.slice();
    for (let j = 0; j < rows; j += 1) {
      for (let i = 0; i < cols; i += 1) {
        const k = j * cols + i;
        if (Number.isNaN(source[k])) continue;
        neighbourhood.length = 0;
        for (let dj = -R; dj <= R; dj += 1) {
          for (let di = -R; di <= R; di += 1) {
            const ni = i + di;
            const nj = j + dj;
            if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
            const v = source[nj * cols + ni];
            if (!Number.isNaN(v)) neighbourhood.push(v);
          }
        }
        neighbourhood.sort((x, y) => x - y);
        const median = neighbourhood[neighbourhood.length >> 1];
        if (source[k] - median > metres(2.5)) heights[k] = NaN;
      }
    }
  }
  {
    // Second, coarse pass (4-unit blocks, 68-unit window) for structures wider than the fine window.
    const B = 4;
    const bc = Math.ceil(cols / B);
    const br = Math.ceil(rows / B);
    const coarse = new Float32Array(bc * br).fill(NaN);
    for (let j = 0; j < rows; j += 1) {
      for (let i = 0; i < cols; i += 1) {
        const v = heights[j * cols + i];
        const k = Math.floor(j / B) * bc + Math.floor(i / B);
        if (!Number.isNaN(v) && !(coarse[k] <= v)) coarse[k] = v;
      }
    }
    const neighbourhood = [];
    const reject = new Uint8Array(bc * br);
    for (let j = 0; j < br; j += 1) {
      for (let i = 0; i < bc; i += 1) {
        const v = coarse[j * bc + i];
        if (Number.isNaN(v)) continue;
        neighbourhood.length = 0;
        for (let dj = -8; dj <= 8; dj += 1) {
          for (let di = -8; di <= 8; di += 1) {
            const w = coarse[(j + dj) * bc + (i + di)];
            if (j + dj >= 0 && i + di >= 0 && j + dj < br && i + di < bc && !Number.isNaN(w)) neighbourhood.push(w);
          }
        }
        neighbourhood.sort((x, y) => x - y);
        if (v - neighbourhood[neighbourhood.length >> 1] > metres(4)) reject[j * bc + i] = 1;
      }
    }
    for (let j = 0; j < rows; j += 1) {
      for (let i = 0; i < cols; i += 1) {
        if (reject[Math.floor(j / B) * bc + Math.floor(i / B)]) heights[j * cols + i] = NaN;
      }
    }
  }
  for (let pass = 0, missing = 1; missing && pass < 400; pass += 1) {
    missing = 0;
    const next = heights.slice();
    for (let j = 0; j < rows; j += 1) {
      for (let i = 0; i < cols; i += 1) {
        const k = j * cols + i;
        if (!Number.isNaN(heights[k])) continue;
        let sum = 0;
        let n = 0;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ni = i + di;
          const nj = j + dj;
          if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
          const v = heights[nj * cols + ni];
          if (!Number.isNaN(v)) {
            sum += v;
            n += 1;
          }
        }
        if (n) next[k] = sum / n;
        else missing += 1;
      }
    }
    heights.set(next);
  }
  const heightAt = (x, z) => {
    const fx = Math.max(0, Math.min(cols - 1.001, x - EXTENT.minX));
    const fz = Math.max(0, Math.min(rows - 1.001, z - EXTENT.minZ));
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const tx = fx - i;
    const tz = fz - j;
    const h = (ii, jj) => heights[jj * cols + ii];
    return (h(i, j) * (1 - tx) + h(i + 1, j) * tx) * (1 - tz) + (h(i, j + 1) * (1 - tx) + h(i + 1, j + 1) * tx) * tz;
  };
  return heightAt;
}

// ---------------------------------------------------------------- inputs
async function readGeoJson(name) {
  return JSON.parse(await Bun.file(path.join(REPO, "docs", "assets", "data", name)).text());
}

const polygonsOf = (geometry) => (geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates);
export const toModelRing = (ring) => cleanRing(ring.map(([lon, lat]) => geoToModel(lon, lat)));

// data/vr-buildings.json: buildings standing in the SCNU 360 VR tour that no GIS record covers, with footprints
// traced on the NGII 2025 orthophoto (every record estimated: true; see README "VR-only buildings"). The records
// follow the gis-buildings.json shape (polygons -> rings -> [lon, lat]); areaMetres is computed here from the
// first ring. VR_BUILDINGS_FILE points the loader (and its test) at another file.
export const VR_BUILDINGS_FILE = process.env.VR_BUILDINGS_FILE ?? path.join(SCRIPT, "data", "vr-buildings.json");
export async function loadVrBuildings(file = VR_BUILDINGS_FILE) {
  const vr = Bun.file(file);
  if (!(await vr.exists())) return [];
  return JSON.parse(await vr.text()).buildings.map((b) => ({
    ...b,
    areaMetres: Math.round(Math.abs(ringArea(toModelRing(b.polygons[0][0]))) / metres(1) ** 2),
  }));
}

// data/vr-context-buildings.json: off-campus buildings the VR tour shows that GIS lacks or gives no storeys (see README
// "VR context buildings"). `floors` sets floors, floorsSource, usability (and heightMetres when given) on the footprint record whose footprintSource
// is the entry's (or starts with it plus a space); every entry must match exactly one record. `buildings` are traced
// footprints in the gis-buildings.json shape, appended last. All estimated (추정); off campus, so they become context
// masses. VR_CONTEXT_FILE points the loader (and its test) at another file.
export const VR_CONTEXT_FILE = process.env.VR_CONTEXT_FILE ?? path.join(SCRIPT, "data", "vr-context-buildings.json");
export function applyVrContext(records, context) {
  const out = records.map((r) => r);
  for (const entry of context.floors ?? []) {
    const hits = out.flatMap((r, i) => (r.footprintSource === entry.footprintSource || r.footprintSource.startsWith(`${entry.footprintSource} `) ? [i] : []));
    if (hits.length !== 1) throw new Error(`vr-context-buildings.json: ${entry.footprintSource} matches ${hits.length} footprint records (expected 1)`);
    out[hits[0]] = { ...out[hits[0]], floors: entry.floors, floorsSource: entry.floorsSource, usability: entry.usability, estimated: true, ...(entry.heightMetres ? { heightMetres: entry.heightMetres } : {}) };
  }
  for (const b of context.buildings ?? []) {
    out.push({ ...b, areaMetres: Math.round(Math.abs(ringArea(toModelRing(b.polygons[0][0]))) / metres(1) ** 2) });
  }
  return out;
}
async function loadVrContext(records, file = VR_CONTEXT_FILE) {
  const context = Bun.file(file);
  return (await context.exists()) ? applyVrContext(records, JSON.parse(await context.text())) : records;
}

// data/gis-buildings.json is the shipped footprint file, followed by the VR-only records. A local checkout that
// still has the old data/vworld-buildings.json (never committed again) may build from it until the new file is
// fetched.
async function loadBuildingFootprints() {
  const gis = Bun.file(path.join(SCRIPT, "data", "gis-buildings.json"));
  if (await gis.exists()) return loadVrContext([...JSON.parse(await gis.text()).buildings, ...(await loadVrBuildings())]);
  const legacy = Bun.file(path.join(SCRIPT, "data", "vworld-buildings.json"));
  if (!(await legacy.exists())) throw new Error("data/gis-buildings.json is missing; run bun run model:fetch");
  console.warn("data/gis-buildings.json is missing; using the local-only data/vworld-buildings.json (do not commit it)");
  return JSON.parse(await legacy.text()).buildings.map((b) => ({ ...b, undergroundFloors: b.basementFloors ?? 0, footprintSource: "VWorld LT_C_BLDGINFO (local dev only)", floorsSource: "VWorld LT_C_BLDGINFO" }));
}

export async function loadInputs() {
  const source = await loadSourceModel();
  const topography = source.scene.getObjectByName("Topography");
  const heightAt = buildHeightfield(topography);
  const footprints = await loadBuildingFootprints();
  const roadZones = (await readGeoJson("road_zones_wgs84.geojson")).features.flatMap((f) =>
    polygonsOf(f.geometry).map((polygon) => polygon.map(toModelRing)),
  );
  const walkways = readA003().features.flatMap((f) =>
    (f.geometry.type === "LineString" ? [f.geometry.coordinates] : f.geometry.coordinates).map((line) =>
      line.map(([lon, lat]) => geoToModel(lon, lat)),
    ),
  );
  const crosswalks = (await readGeoJson("crosswalks_wgs84.geojson")).features.map((f) => toModelRing(f.geometry.coordinates[0]));
  const landcoverPng = decodePng(await Bun.file(path.join(SCRIPT, "data", "landcover.png")).arrayBuffer());
  const landcoverAt = (x, z) => {
    const col = Math.max(0, Math.min(landcoverPng.width - 1, Math.floor(x - EXTENT.minX)));
    const row = Math.max(0, Math.min(landcoverPng.height - 1, Math.floor(z - EXTENT.minZ)));
    return landcoverPng.pixels[row * landcoverPng.width + col];
  };
  // VWorld z19 orthophoto (data/ortho/, stored under consent D1) for the roof colours and the road-marking photo checks
  // (never baked into the ground).
  const ortho = await loadOrtho();
  const orthoCalibration = photoCalibration(ortho);
  return { source, heightAt, footprints, roadZones, walkways, crosswalks, landcoverPng, landcoverAt, ortho, orthoCalibration };
}
