#!/usr/bin/env bun
// Bakes an ambient-occlusion atlas for the primitives of the raw campus GLB whose material matches
// --materials, into their TEXCOORD_1 layout (stages/buildings.mjs packs it). Each covered texel casts
// --rays cosine-weighted hemisphere rays (stratified, per-texel rotated) of length --distance metres
// against the --occluders meshes through a three-mesh-bvh BVH; the value is the unoccluded fraction.
// The result is smoothed by one 3x3 pass over covered texels, dilated 4 px into the chart gutters and
// written as an 8-bit grey PNG carrying the raw GLB's aoLayout hash in a tEXt chunk, so the next
// model:build attaches it only to the layout it was baked for. See README.md for the two-step loop.
//
//   bun scripts/campus-model/bake/bake-ao.mjs [raw.glb] [out.png] [size] [rays]
//       [--materials Facade_*,Roof_*] [--occluders BLD_*,CampusBuildings,Topography_*,OuterTerrain]
//       [--distance 3] [--workers N]
//   bun scripts/campus-model/bake/bake-ao.mjs --planar      ground AO (stages/ground.mjs planar TEXCOORD_1):
//       defaults to data/ao-ground.png, 1024^2, --materials Ground, --occluders BLD_*,CampusBuildings,Trees_*_crown,
//       --targets Topography_* (target node names; OuterTerrain's material is also named Ground),
//       --distance 6; checks asset.extras.aoGroundLayout instead of the building atlas layout.
import { availableParallelism } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";
import { deflateSync } from "node:zlib";
import { BufferAttribute, BufferGeometry, DoubleSide, Ray, Vector3 } from "three";
import { MeshBVH } from "three-mesh-bvh";
import { SCENE_UNITS_PER_METRE } from "../lib/frame.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GUTTER_FILL = 4;

// ---------------------------------------------------------------- raw GLB reading
// The raw generator output is uncompressed: float/uint accessors in one binary chunk.
function readGlb(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)));
  const binOffset = 20 + jsonLength + 8;
  const accessor = (index) => {
    const a = json.accessors[index];
    const bv = json.bufferViews[a.bufferView];
    const size = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
    const Type = { 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array, 5121: Uint8Array }[a.componentType];
    const start = bytes.byteOffset + binOffset + (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
    if (bv.byteStride && bv.byteStride !== size * Type.BYTES_PER_ELEMENT) throw new Error("interleaved accessors are not supported");
    return new Type(bytes.buffer.slice(start, start + a.count * size * Type.BYTES_PER_ELEMENT));
  };
  return { json, accessor };
}

const matcher = (list) => {
  const patterns = list.split(",").map((p) => new RegExp(`^${p.trim().replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`));
  return (name) => patterns.some((p) => p.test(name ?? ""));
};

// Nodes carry at most translation/scale here (the generator writes scene-space meshes); a child's
// transform is composed with its parent's: { s, t } maps p to p * s + t.
function composeTransform(parent, node) {
  if (node.matrix || node.rotation) throw new Error(`node ${node.name} has a rotation/matrix; bake-ao.mjs expects translation/scale only`);
  const t = node.translation ?? [0, 0, 0];
  const s = node.scale ?? [1, 1, 1];
  return { s: s.map((v, k) => v * parent.s[k]), t: t.map((v, k) => v * parent.s[k] + parent.t[k]) };
}

function collect(glb, { occluders, materials, targetNodes }) {
  const { json, accessor } = glb;
  const occluderPositions = [];
  const targets = [];
  let occluderTriangles = 0;
  // Depth-first over the scene graph; a node is an occluder when it or an ancestor matches (the
  // Topography_* chunks sit under a Topography group). Instanced meshes (trees) are skipped.
  const visit = [...json.scenes[json.scene ?? 0].nodes].reverse().map((index) => ({ index, parent: { s: [1, 1, 1], t: [0, 0, 0] }, inherited: false }));
  while (visit.length) {
    const { index, parent, inherited } = visit.pop();
    const node = json.nodes[index];
    const { s, t } = composeTransform(parent, node);
    const isOccluder = inherited || occluders(node.name);
    for (const child of [...(node.children ?? [])].reverse()) visit.push({ index: child, parent: { s, t }, inherited: isOccluder });
    if (node.mesh === undefined) continue;
    const transform = (x, y, z) => [x * s[0] + t[0], y * s[1] + t[1], z * s[2] + t[2]];
    const instancing = node.extensions?.EXT_mesh_gpu_instancing;
    if (instancing) {
      // Instanced meshes (trees) can occlude but are never bake targets.
      if (!isOccluder) continue;
      const translations = accessor(instancing.attributes.TRANSLATION);
      const rotations = accessor(instancing.attributes.ROTATION);
      const scales = accessor(instancing.attributes.SCALE);
      const count = translations.length / 3;
      for (const primitive of json.meshes[node.mesh].primitives) {
        const local = accessor(primitive.attributes.POSITION);
        const indices = primitive.indices === undefined ? Uint32Array.from(local.length / 3, (_, k) => k) : accessor(primitive.indices);
        const tri = new Float32Array(indices.length * 3 * count);
        for (let n = 0; n < count; n += 1) {
          const [qx, qy, qz, qw] = rotations.subarray(n * 4, n * 4 + 4);
          const base = n * indices.length * 3;
          for (let k = 0; k < indices.length; k += 1) {
            const v = indices[k] * 3;
            const px = local[v] * scales[n * 3];
            const py = local[v + 1] * scales[n * 3 + 1];
            const pz = local[v + 2] * scales[n * 3 + 2];
            // p' = p + 2w(q x p) + 2 q x (q x p)
            const cx = qy * pz - qz * py;
            const cy = qz * px - qx * pz;
            const cz = qx * py - qy * px;
            tri.set(transform(
              px + 2 * (qw * cx + qy * cz - qz * cy) + translations[n * 3],
              py + 2 * (qw * cy + qz * cx - qx * cz) + translations[n * 3 + 1],
              pz + 2 * (qw * cz + qx * cy - qy * cx) + translations[n * 3 + 2],
            ), base + k * 3);
          }
        }
        occluderPositions.push(tri);
        occluderTriangles += (indices.length / 3) * count;
      }
      continue;
    }
    for (const primitive of json.meshes[node.mesh].primitives) {
      const material = json.materials?.[primitive.material]?.name;
      const isTarget = materials(material) && targetNodes(node.name);
      if (!isOccluder && !isTarget) continue;
      const local = accessor(primitive.attributes.POSITION);
      const positions = new Float32Array(local.length);
      for (let k = 0; k < local.length; k += 3) positions.set(transform(local[k], local[k + 1], local[k + 2]), k);
      const indices = primitive.indices === undefined ? Uint32Array.from(positions.length / 3, (_, k) => k) : accessor(primitive.indices);
      if (isOccluder) {
        const tri = new Float32Array(indices.length * 3);
        indices.forEach((v, k) => tri.set(positions.subarray(v * 3, v * 3 + 3), k * 3));
        occluderPositions.push(tri);
        occluderTriangles += indices.length / 3;
      }
      if (isTarget) {
        if (primitive.attributes.TEXCOORD_1 === undefined) throw new Error(`${node.name}/${material} has no TEXCOORD_1`);
        targets.push({ name: `${node.name}/${material}`, positions, normals: accessor(primitive.attributes.NORMAL), uv1: accessor(primitive.attributes.TEXCOORD_1), indices });
      }
    }
  }
  const soup = new Float32Array(new SharedArrayBuffer(occluderPositions.reduce((n, a) => n + a.length, 0) * 4));
  let offset = 0;
  for (const array of occluderPositions) {
    soup.set(array, offset);
    offset += array.length;
  }
  return { soup, targets, occluderTriangles };
}

// ---------------------------------------------------------------- rasterising charts into texels
// Texel centres inside a UV1 triangle get that triangle's interpolated position and flat normal.
function rasterise(targets, size) {
  const owner = new Int32Array(size * size).fill(-1);
  const points = [];
  const normals = [];
  const texels = [];
  for (const target of targets) {
    const { positions, uv1, indices } = target;
    for (let t = 0; t < indices.length; t += 3) {
      const [i0, i1, i2] = [indices[t], indices[t + 1], indices[t + 2]];
      const ax = uv1[i0 * 2] * size;
      const ay = uv1[i0 * 2 + 1] * size;
      const bx = uv1[i1 * 2] * size;
      const by = uv1[i1 * 2 + 1] * size;
      const cx = uv1[i2 * 2] * size;
      const cy = uv1[i2 * 2 + 1] * size;
      const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
      if (Math.abs(det) < 1e-12) continue;
      const p = (i) => [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]];
      const [pa, pb, pc] = [p(i0), p(i1), p(i2)];
      const e1 = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
      const e2 = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
      let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const length = Math.hypot(...n);
      if (length < 1e-12) continue;
      n = n.map((c) => c / length);
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
      const x1 = Math.min(size - 1, Math.ceil(Math.max(ax, bx, cx)));
      const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy)));
      const y1 = Math.min(size - 1, Math.ceil(Math.max(ay, by, cy)));
      for (let y = y0; y <= y1; y += 1) {
        for (let x = x0; x <= x1; x += 1) {
          const px = x + 0.5;
          const py = y + 0.5;
          const w0 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / det;
          const w1 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / det;
          const w2 = 1 - w0 - w1;
          if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
          const texel = y * size + x;
          if (owner[texel] >= 0) continue;
          owner[texel] = texels.length;
          texels.push(texel);
          for (let k = 0; k < 3; k += 1) points.push(pa[k] * w0 + pb[k] * w1 + pc[k] * w2);
          normals.push(...n);
        }
      }
    }
  }
  return { owner, texels: Int32Array.from(texels), points: Float32Array.from(points), normals: Float32Array.from(normals) };
}

// ---------------------------------------------------------------- ray casting (worker side)
function hash(n) {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function occlusion({ soup, points, normals, from, to, rays, distance, epsilon }) {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(soup, 3));
  const bvh = new MeshBVH(geometry);
  const side = Math.round(Math.sqrt(rays));
  const strata = side * side;
  const ray = new Ray();
  const tangent = new Vector3();
  const bitangent = new Vector3();
  const normal = new Vector3();
  const values = new Float32Array(to - from);
  for (let i = from; i < to; i += 1) {
    normal.set(normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]);
    tangent.set(Math.abs(normal.y) < 0.9 ? 0 : 1, Math.abs(normal.y) < 0.9 ? 1 : 0, 0).cross(normal).normalize();
    bitangent.crossVectors(normal, tangent);
    const ox = points[i * 3] + normal.x * epsilon;
    const oy = points[i * 3 + 1] + normal.y * epsilon;
    const oz = points[i * 3 + 2] + normal.z * epsilon;
    // Cranley-Patterson rotation of a stratified grid, seeded by the texel, keeps the bake deterministic.
    const jitterU = hash(i * 2 + 1);
    const jitterV = hash(i * 2 + 2);
    let open = 0;
    for (let s = 0; s < strata; s += 1) {
      const u = ((s % side) + 0.5) / side + jitterU;
      const v = (Math.floor(s / side) + 0.5) / side + jitterV;
      const r = Math.sqrt(u - Math.floor(u));
      const phi = 2 * Math.PI * (v - Math.floor(v));
      const a = r * Math.cos(phi);
      const b = r * Math.sin(phi);
      const c = Math.sqrt(Math.max(0, 1 - a * a - b * b));
      ray.origin.set(ox, oy, oz);
      ray.direction.set(
        tangent.x * a + bitangent.x * b + normal.x * c,
        tangent.y * a + bitangent.y * b + normal.y * c,
        tangent.z * a + bitangent.z * b + normal.z * c,
      );
      if (!bvh.raycastFirst(ray, DoubleSide, 0, distance)) open += 1;
    }
    values[i - from] = open / strata;
  }
  return values;
}

// ---------------------------------------------------------------- post-processing and PNG
function smoothAndDilate(owner, values, size) {
  const value = new Float32Array(size * size).fill(-1);
  owner.forEach((o, texel) => {
    if (o >= 0) value[texel] = values[o];
  });
  // One 3x3 box pass over covered texels only (gutters separate charts, so this stays in a chart).
  const smooth = new Float32Array(value);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (value[y * size + x] < 0) continue;
      let sum = 0;
      let count = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
          const v = value[ny * size + nx];
          if (v >= 0) {
            sum += v;
            count += 1;
          }
        }
      }
      smooth[y * size + x] = sum / count;
    }
  }
  // Dilate into the gutters so bilinear filtering and the first mips never read the background.
  let current = smooth;
  for (let pass = 0; pass < GUTTER_FILL; pass += 1) {
    const next = new Float32Array(current);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        if (current[y * size + x] >= 0) continue;
        let sum = 0;
        let count = 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
          const v = current[ny * size + nx];
          if (v >= 0) {
            sum += v;
            count += 1;
          }
        }
        if (count) next[y * size + x] = sum / count;
      }
    }
    current = next;
  }
  return Uint8Array.from(current, (v) => (v < 0 ? 255 : Math.round(Math.min(1, v) * 255)));
}

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (bytes) => {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const pngChunk = (type, data) => {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
};

function greyPng(size, pixels, text) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 0;
  // Up filter on every row: the atlas is smooth vertically, which deflate rewards.
  const raw = Buffer.alloc((size + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (size + 1)] = 2;
    for (let x = 0; x < size; x += 1) {
      const above = y ? pixels[(y - 1) * size + x] : 0;
      raw[y * (size + 1) + 1 + x] = (pixels[y * size + x] - above) & 0xff;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    ...Object.entries(text).map(([key, value]) => pngChunk("tEXt", Buffer.from(`${key}\0${value}`, "latin1"))),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- main
async function main() {
  const positional = [];
  const planar = process.argv.includes("--planar");
  const options = planar
    ? { materials: "Ground", targets: "Topography_*", occluders: "BLD_*,CampusBuildings,Trees_*_crown", distance: "6" }
    : { materials: "Facade_*,Roof_*", targets: "*", occluders: "BLD_*,CampusBuildings,Topography_*,OuterTerrain", distance: "3" };
  options.workers = String(Math.max(1, availableParallelism() - 1));
  for (let k = 2; k < process.argv.length; k += 1) {
    const arg = process.argv[k];
    if (arg === "--planar") continue;
    if (arg.startsWith("--")) options[arg.slice(2)] = process.argv[++k];
    else positional.push(arg);
  }
  const [
    input = path.join(HERE, "..", ".build", "campus-v2.raw.glb"),
    output = path.join(HERE, "..", "data", planar ? "ao-ground.png" : "ao-buildings.png"),
    sizeArg = planar ? "1024" : "2048",
    raysArg = "64",
  ] = positional;
  const size = Number(sizeArg);
  const rays = Number(raysArg);
  const distance = Number(options.distance) * SCENE_UNITS_PER_METRE;
  const epsilon = 0.02 * SCENE_UNITS_PER_METRE;
  const workers = Number(options.workers);

  const started = performance.now();
  const file = Bun.file(input);
  if (!(await file.exists())) throw new Error(`${input} is missing; run bun run model:build first`);
  const glb = readGlb(new Uint8Array(await file.arrayBuffer()));
  const extras = glb.json.asset?.extras ?? {};
  const layout = planar ? extras.aoGroundLayout : extras.aoLayout;
  const layoutSize = planar ? extras.aoGroundSize : extras.aoAtlasSize;
  if (!layout) throw new Error(`${input} has no asset.extras.${planar ? "aoGroundLayout" : "aoLayout"}; it predates that AO layout`);
  if (layoutSize !== size) throw new Error(`layout ${layout} was made for ${layoutSize}^2, not ${size}^2`);
  const { soup, targets, occluderTriangles } = collect(glb, { occluders: matcher(options.occluders), materials: matcher(options.materials), targetNodes: matcher(options.targets) });
  const { owner, texels, points, normals } = rasterise(targets, size);
  const sharedPoints = new Float32Array(new SharedArrayBuffer(points.byteLength));
  sharedPoints.set(points);
  const sharedNormals = new Float32Array(new SharedArrayBuffer(normals.byteLength));
  sharedNormals.set(normals);
  const prepared = performance.now();
  console.log(
    `bake-ao: layout ${layout}, ${targets.length} target primitives, ${texels.length} texels (${((texels.length / size ** 2) * 100).toFixed(1)} %), ` +
    `${occluderTriangles} occluder triangles, ${rays} rays x ${options.distance} m on ${workers} workers`,
  );

  const chunk = Math.ceil(texels.length / workers);
  const parts = await Promise.all(Array.from({ length: workers }, (_, w) => new Promise((resolve, reject) => {
    const from = w * chunk;
    const to = Math.min(texels.length, from + chunk);
    if (from >= to) return resolve(new Float32Array(0));
    const worker = new Worker(fileURLToPath(import.meta.url), {
      workerData: { soup, points: sharedPoints, normals: sharedNormals, from, to, rays, distance, epsilon },
    });
    worker.once("message", resolve);
    worker.once("error", reject);
    worker.once("exit", (code) => {
      if (code !== 0) reject(new Error(`bake worker ${w} exited with ${code}`));
    });
  })));
  const values = new Float32Array(texels.length);
  parts.reduce((offset, part) => {
    values.set(part, offset);
    return offset + part.length;
  }, 0);
  const cast = performance.now();

  const pixels = smoothAndDilate(owner, values, size);
  let sum = 0;
  for (const texel of texels) sum += pixels[texel];
  const png = greyPng(size, pixels, { aoLayout: layout, Software: "scnu-digital-twin bake-ao.mjs (three-mesh-bvh)" });
  await Bun.write(output, png);
  console.log(
    `bake-ao: mean ${(sum / texels.length / 255).toFixed(3)} over covered texels; ${png.length} B -> ${path.relative(process.cwd(), output)}; ` +
    `prepare ${((prepared - started) / 1000).toFixed(1)} s, rays ${((cast - prepared) / 1000).toFixed(1)} s, total ${((performance.now() - started) / 1000).toFixed(1)} s`,
  );
}

// The same file is the worker: it casts rays for its texel range and posts the values back.
if (isMainThread) await main();
else parentPort.postMessage(occlusion(workerData));
