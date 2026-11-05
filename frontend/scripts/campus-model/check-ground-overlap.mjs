#!/usr/bin/env bun
// Checks that the campus ground is one planar partition (lib/partition.mjs): inside EXTENT every point of the plan is
// covered by exactly one ground triangle (Topography_*, Ground_* surfaces, Road_Markings), seen from above.
// Reads the uncompressed .build/campus-v2.raw.glb. Samples a jittered 0.25-unit grid; a sample covered twice is an
// overlap, a sample covered by none is a gap (buildings stand on the ground, so their footprints are ground too).
// Exits 1 when the overlapping share or the gap share exceeds MAX_SHARE.
//   bun scripts/campus-model/check-ground-overlap.mjs [raw.glb]
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EXTENT } from "./lib/frame.mjs";
import { sceneToTm } from "../../src/geo/epsg5186.mjs";
import { D4_MATERIAL_SCOPE } from "./lib/landcover.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILE = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : path.join(HERE, ".build", "campus-v2.raw.glb");
// --all: the whole plan, the hill ring (OuterTerrain) and the context streets on it included, sampled every 1 unit
const ALL = process.argv.includes("--all");
const GROUND = ALL
  ? /^(Topography_\d+|Ground_(?!Hump_)|Road_Markings$|OuterTerrain$|Context_Far_Ground_)/
  : /^(Topography_\d+|Ground_(?!Context|Hump_)|Road_Markings$)/;
const STEP = ALL ? 1 : 0.25;
const CELL = 1;
// samples on a shared edge can land exactly on it; the jitter keeps that rare, this bounds what is left
const MAX_SHARE = 1e-4;

const file = readFileSync(FILE);
const json = JSON.parse(file.subarray(20, 20 + file.readUInt32LE(12)).toString("utf8"));
const binStart = 20 + file.readUInt32LE(12) + 8;
const read = (accessorIndex) => {
  const accessor = json.accessors[accessorIndex];
  const view = json.bufferViews[accessor.bufferView];
  const offset = binStart + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const width = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[accessor.type];
  const Type = { 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array, 5121: Uint8Array }[accessor.componentType];
  const stride = view.byteStride ? view.byteStride / Type.BYTES_PER_ELEMENT : width;
  const raw = new Type(file.buffer, file.byteOffset + offset, (accessor.count - 1) * stride + width);
  if (stride === width) return raw;
  const out = new Type(accessor.count * width);
  for (let i = 0; i < accessor.count; i += 1) for (let k = 0; k < width; k += 1) out[i * width + k] = raw[i * stride + k];
  return out;
};

const triangles = [];
const meshOf = [];
const byMesh = {};
for (const node of json.nodes) {
  if (node.mesh === undefined || !GROUND.test(node.name ?? "")) continue;
  if (node.translation || node.rotation || node.scale || node.matrix) throw new Error(`${node.name} has a transform`);
  for (const primitive of json.meshes[node.mesh].primitives) {
    const p = read(primitive.attributes.POSITION);
    const index = primitive.indices !== undefined ? read(primitive.indices) : Uint32Array.from({ length: p.length / 3 }, (_, i) => i);
    for (let t = 0; t < index.length; t += 3) {
      const [a, b, c] = [index[t], index[t + 1], index[t + 2]];
      const area2 = (p[b * 3] - p[a * 3]) * (p[c * 3 + 2] - p[a * 3 + 2]) - (p[b * 3 + 2] - p[a * 3 + 2]) * (p[c * 3] - p[a * 3]);
      if (Math.abs(area2) < 1e-12) continue; // zero-area triangles cover nothing
      triangles.push([p[a * 3], p[a * 3 + 2], p[b * 3], p[b * 3 + 2], p[c * 3], p[c * 3 + 2]]);
      meshOf.push(node.name.startsWith("Topography_") ? "Topography" : node.name);
    }
    const group = node.name.startsWith("Topography_") ? "Topography" : node.name;
    byMesh[group] = (byMesh[group] ?? 0) + index.length / 3;
  }
}

const atArg = process.argv.indexOf("--at");
if (atArg > 0) {
  const [qx, qz] = process.argv[atArg + 1].split(",").map(Number);
  triangles.forEach((t, k) => {
    const d1 = (qx - t[2]) * (t[1] - t[3]) - (t[0] - t[2]) * (qz - t[3]);
    const d2 = (qx - t[4]) * (t[3] - t[5]) - (t[2] - t[4]) * (qz - t[5]);
    const d3 = (qx - t[0]) * (t[5] - t[1]) - (t[4] - t[0]) * (qz - t[1]);
    if (!((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))) console.log(meshOf[k], t.map((v) => v.toFixed(4)).join(" "));
  });
  process.exit(0);
}
const BOUNDS = ALL
  ? triangles.reduce((b, t) => [Math.min(b[0], t[0], t[2], t[4]), Math.min(b[1], t[1], t[3], t[5]), Math.max(b[2], t[0], t[2], t[4]), Math.max(b[3], t[1], t[3], t[5])], [Infinity, Infinity, -Infinity, -Infinity])
  : [EXTENT.minX, EXTENT.minZ, EXTENT.maxX, EXTENT.maxZ];
const cols = Math.ceil((BOUNDS[2] - BOUNDS[0]) / CELL);
const rows = Math.ceil((BOUNDS[3] - BOUNDS[1]) / CELL);
const cells = Array.from({ length: cols * rows }, () => []);
triangles.forEach(([ax, az, bx, bz, cx, cz], k) => {
  const i0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - BOUNDS[0]) / CELL));
  const i1 = Math.min(cols - 1, Math.floor((Math.max(ax, bx, cx) - BOUNDS[0]) / CELL));
  const j0 = Math.max(0, Math.floor((Math.min(az, bz, cz) - BOUNDS[1]) / CELL));
  const j1 = Math.min(rows - 1, Math.floor((Math.max(az, bz, cz) - BOUNDS[1]) / CELL));
  for (let j = j0; j <= j1; j += 1) for (let i = i0; i <= i1; i += 1) cells[j * cols + i].push(k);
});

const inside = ([ax, az, bx, bz, cx, cz], x, z) => {
  const d1 = (x - bx) * (az - bz) - (ax - bx) * (z - bz);
  const d2 = (x - cx) * (bz - cz) - (bx - cx) * (z - cz);
  const d3 = (x - ax) * (cz - az) - (cx - ax) * (z - az);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
};
let samples = 0;
let gaps = 0;
let overlaps = 0;
const d4 = { samples: 0, overlaps: 0, gaps: 0 };
const overlapAt = [];
const gapAt = [];
const pairs = {};
let seed = 12345;
const random = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
for (let z = BOUNDS[1] + STEP / 2; z < BOUNDS[3]; z += STEP) {
  for (let x = BOUNDS[0] + STEP / 2; x < BOUNDS[2]; x += STEP) {
    const sx = x + (random() - 0.5) * STEP * 0.8;
    const sz = z + (random() - 0.5) * STEP * 0.8;
    const cell = cells[Math.floor((sz - BOUNDS[1]) / CELL) * cols + Math.floor((sx - BOUNDS[0]) / CELL)] ?? [];
    let hits = 0;
    const owners = [];
    for (const k of cell) if (inside(triangles[k], sx, sz)) { hits += 1; owners.push(meshOf[k]); }
    samples += 1;
    const [east, north] = sceneToTm(sx, sz);
    const [west, south, eastMax, northMax] = D4_MATERIAL_SCOPE.bbox;
    if (east >= west && east <= eastMax && north >= south && north <= northMax) {
      d4.samples++;
      if (hits > 1) d4.overlaps++;
      if (hits === 0) d4.gaps++;
    }
    const inExtent = sx >= EXTENT.minX && sx <= EXTENT.maxX && sz >= EXTENT.minZ && sz <= EXTENT.maxZ;
    if (hits === 0 && (!ALL || inExtent)) {
      gaps += 1;
      if (gapAt.length < 10) gapAt.push([Number(sx.toFixed(2)), Number(sz.toFixed(2))]);
    }
    if (hits > 1) {
      const pair = owners.sort().join("+");
      pairs[pair] = (pairs[pair] ?? 0) + 1;
    }
    if (hits > 1) {
      overlaps += 1;
      if (overlapAt.length < 10) overlapAt.push([Number(sx.toFixed(2)), Number(sz.toFixed(2)), hits]);
    }
  }
}
const share = (n) => n / samples;
console.log(`ground triangles: ${triangles.length} (${Object.entries(byMesh).map(([k, v]) => `${k} ${v}`).join(", ")})`);
console.log(`samples ${samples}: overlap ${overlaps} (${(share(overlaps) * 100).toFixed(4)} %), gap ${gaps} (${(share(gaps) * 100).toFixed(4)} %)`);
console.log(`overlap pairs: ${JSON.stringify(Object.entries(pairs).sort((a, b) => b[1] - a[1]).slice(0, 12))}`);
if (gapAt.length) console.log(`first gaps [x, z]: ${JSON.stringify(gapAt)}`);
if (overlapAt.length) console.log(`first overlaps [x, z, triangles]: ${JSON.stringify(overlapAt)}`);
console.log(`D4 GROUND ${JSON.stringify(d4)}`);
const ok = share(overlaps) <= MAX_SHARE && share(gaps) <= MAX_SHARE &&
  d4.samples > 0 && d4.overlaps === 0 && d4.gaps === 0;
console.log(ok ? "GROUND PARTITION OK" : "GROUND PARTITION FAIL");
process.exit(ok ? 0 : 1);
