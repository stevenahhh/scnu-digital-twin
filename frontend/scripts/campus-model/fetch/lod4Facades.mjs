#!/usr/bin/env bun
// Facade colours and heights of the SCNU buildings from VWorld's photo-textured LOD4 3D building models, stored
// under consent D1 (docs/data-licences.md). The public, keyless 3D Tiles tileset
// facility_LOD4/Jeollanam-do/Suncheon-si is walked to its finest b3dm tiles over the SCNU footprints of
// data/gis-buildings.json (cached in .cache/lod4/, gitignored). Each model is decoded (CESIUM_RTC centre plus
// WEB3D_quantized_attributes positions; the root node's z-up -> y-up matrix and Cesium's y-up -> z-up axis
// correction cancel, so positions are ECEF offsets from the centre). A triangle is a wall when its normal is
// within 15 degrees of horizontal; it belongs to the footprint whose outline lies within 3 m of its centroid.
// The texels under each footprint's wall triangles give its facade palette: the colour modes of a 32-level
// RGB histogram with their area shares (sRGB, estimates from photos with shade, trees and reflections in them).
// The models also give an independent height: the top of the wall triangles above their lowest point.
//
//   bun scripts/campus-model/fetch/lod4Facades.mjs [--debug <dir>]   -> data/lod4-facades.json
//     --debug writes one unrolled facade image per footprint (0.25 m/px, perimeter x height) for inspection.
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { decodePng, encodePng } from "../lib/png.mjs";
import { CACHE, DATA, TIMEOUT_MS, USER_AGENT } from "./common.mjs";

const TILESET = "https://xdworld.vworld.kr/TDServer/services/facility_LOD4/Jeollanam-do/Suncheon-si/";
export const LOD4_CACHE = path.join(CACHE, "lod4");
const OUTPUT = path.join(DATA, "lod4-facades.json");
const WALL_SLOPE = Math.sin((15 * Math.PI) / 180);
const ROOF_SLOPE = Math.cos((15 * Math.PI) / 180);
const MATCH_METRES = 3;
const DEBUG_METRES_PER_PIXEL = 0.25;

export async function cached(relative, binary) {
  const file = Bun.file(path.join(LOD4_CACHE, relative.replace(/[^A-Za-z0-9_.-]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)));
  if (!(await file.exists())) {
    const response = await fetch(TILESET + relative, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS * 4) });
    if (!response.ok) throw new Error(`LOD4 ${relative}: HTTP ${response.status}`);
    await Bun.write(file, new Uint8Array(await response.arrayBuffer()));
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  return binary ? bytes : JSON.parse(new TextDecoder().decode(bytes).replace(/^\uFEFF/, ""));
}

// ---------------------------------------------------------------- geodesy and footprints
const A = 6378137;
const E2 = (1 / 298.257223563) * (2 - 1 / 298.257223563);
function ecefToGeo(x, y, z) {
  const p = Math.hypot(x, y);
  let lat = Math.atan2(z, p * (1 - E2));
  let h = 0;
  for (let i = 0; i < 6; i += 1) {
    const n = A / Math.sqrt(1 - E2 * Math.sin(lat) ** 2);
    h = p / Math.cos(lat) - n;
    lat = Math.atan2(z, p * (1 - (E2 * n) / (n + h)));
  }
  return [(Math.atan2(y, x) * 180) / Math.PI, (lat * 180) / Math.PI, h];
}

// Local metres around the campus (equirectangular; < 1 cm error over the bbox).
export const LON0 = 127.48;
export const LAT0 = 34.969;
export const MX = 111320 * Math.cos((LAT0 * Math.PI) / 180);
export const MY = 110574;
const toLocal = (lon, lat) => [(lon - LON0) * MX, (lat - LAT0) * MY];

function segmentDistance([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

// Distance from a point to a ring and the arc length of its closest point.
function ringProjection(point, ring) {
  let best = { distance: Infinity, along: 0 };
  let along = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const distance = segmentDistance(point, a, b);
    if (distance < best.distance) {
      const t = length ? Math.max(0, Math.min(1, ((point[0] - a[0]) * (b[0] - a[0]) + (point[1] - a[1]) * (b[1] - a[1])) / length ** 2)) : 0;
      best = { distance, along: along + t * length };
    }
    along += length;
  }
  return { ...best, perimeter: along };
}

// ---------------------------------------------------------------- b3dm decoding
export function parseB3dm(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const json = (from, length) => {
    const text = new TextDecoder().decode(bytes.subarray(from, from + length)).replace(/^\uFEFF/, "").trim();
    return text ? JSON.parse(text) : {};
  };
  const [ftJson, ftBin, btJson, btBin] = [12, 16, 20, 24].map((o) => view.getUint32(o, true));
  const batchTable = json(28 + ftJson + ftBin, btJson);
  const glb = bytes.subarray(28 + ftJson + ftBin + btJson + btBin);
  const glbView = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  const chunkLength = glbView.getUint32(12, true);
  const gltf = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + chunkLength)).replace(/^\uFEFF/, ""));
  const binLength = glbView.getUint32(20 + chunkLength, true);
  const bin = glb.subarray(28 + chunkLength, 28 + chunkLength + binLength);
  return { batchTable, gltf, bin };
}

function accessor({ gltf, bin }, index) {
  const a = gltf.accessors[index];
  const bv = gltf.bufferViews[a.bufferView];
  const size = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
  const Type = { 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array, 5121: Uint8Array }[a.componentType];
  const start = bin.byteOffset + (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const values = new Type(bin.buffer.slice(start, start + a.count * size * Type.BYTES_PER_ELEMENT));
  const scale = a.normalized ? { 5123: 65535, 5121: 255 }[a.componentType] : 1;
  const decode = a.extensions?.WEB3D_quantized_attributes?.decodeMatrix;
  const out = new Float64Array(values.length);
  for (let i = 0; i < values.length; i += 1) {
    const k = i % size;
    const v = values[i] / scale;
    // decodeMatrix is column-major (size+1)^2: diagonal scale, last column offset
    out[i] = decode ? decode[k * (size + 2)] * v + decode[size * (size + 1) + k] : v;
  }
  return { values: out, size, count: a.count };
}

// Most models carry their texture only as Crunch (image/crn, DXT inside) behind a 1x1 PNG placeholder. crnlib
// (zlib licence) as compiled to asm.js for Cesium 1.80 (Source/ThirdParty/crunch.js) is fetched once into
// .cache/lod4/ and transcodes it to DXT; dxtToRgb below expands the DXT blocks. Nothing of it ships.
const CRUNCH = "https://unpkg.com/cesium@1.80.0/Source/ThirdParty/crunch.js";
let crunch = null;
async function crunchModule() {
  if (crunch) return crunch;
  const file = path.join(LOD4_CACHE, "crunch-cesium-1.80.0.mjs");
  if (!(await Bun.file(file).exists())) {
    const response = await fetch(CRUNCH, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) throw new Error(`crunch.js: HTTP ${response.status}`);
    await Bun.write(file, await response.text());
  }
  crunch = (await import(file)).default;
  return crunch;
}

const rgb565 = (c) => [((c >> 11) & 31) * 255 / 31, ((c >> 5) & 63) * 255 / 63, (c & 31) * 255 / 31];
// DXT1/3/5 level 0 -> RGB (alpha dropped).
function dxtToRgb(data, width, height, blockBytes) {
  const pixels = new Uint8Array(width * height * 3);
  const blocksX = Math.max(1, Math.ceil(width / 4));
  for (let by = 0; by < Math.ceil(height / 4); by += 1) {
    for (let bx = 0; bx < blocksX; bx += 1) {
      const o = (by * blocksX + bx) * blockBytes + (blockBytes === 16 ? 8 : 0);
      const c0 = data[o] | (data[o + 1] << 8);
      const c1 = data[o + 2] | (data[o + 3] << 8);
      const [a, b] = [rgb565(c0), rgb565(c1)];
      const four = blockBytes === 16 || c0 > c1;
      const colours = [a, b, four ? a.map((v, k) => (2 * v + b[k]) / 3) : a.map((v, k) => (v + b[k]) / 2), four ? a.map((v, k) => (v + 2 * b[k]) / 3) : [0, 0, 0]];
      const bits = data[o + 4] | (data[o + 5] << 8) | (data[o + 6] << 16) | (data[o + 7] << 24);
      for (let k = 0; k < 16; k += 1) {
        const x = bx * 4 + (k % 4);
        const y = by * 4 + Math.floor(k / 4);
        if (x >= width || y >= height) continue;
        const colour = colours[(bits >>> (2 * k)) & 3];
        pixels.set(colour.map(Math.round), (y * width + x) * 3);
      }
    }
  }
  return { width, height, channels: 3, pixels };
}

async function crunchToRgb(bytes) {
  const m = await crunchModule();
  const src = m._malloc(bytes.length);
  m.HEAPU8.set(bytes, src);
  const format = m._crn_get_dxt_format(src, bytes.length);
  const blockBytes = { 0: 8, 1: 16, 2: 16 }[format];
  if (!blockBytes) {
    m._free(src);
    return null;
  }
  const width = m._crn_get_width(src, bytes.length);
  const height = m._crn_get_height(src, bytes.length);
  const levels = m._crn_get_levels(src, bytes.length);
  let size = 0;
  for (let i = 0; i < levels; i += 1) size += Math.ceil(Math.max(1, width >> i) / 4) * Math.ceil(Math.max(1, height >> i) / 4) * blockBytes;
  const dst = m._malloc(size);
  m._crn_decompress(src, bytes.length, dst, size, 0, levels);
  const level0 = m.HEAPU8.slice(dst, dst + Math.ceil(width / 4) * Math.ceil(height / 4) * blockBytes);
  m._free(src);
  m._free(dst);
  return dxtToRgb(level0, width, height, blockBytes);
}

async function textureImage(tile, textureIndex) {
  const image = tile.gltf.images[tile.gltf.textures[textureIndex].source];
  const view = (index) => {
    const bv = tile.gltf.bufferViews[index];
    return tile.bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength);
  };
  if (image.bufferView !== undefined) return decodePng(await new Bun.Image(view(image.bufferView)).png().toBuffer());
  const crn = image.extras?.compressedImage3DTiles?.crunch;
  return crn ? crunchToRgb(view(crn.bufferView)) : null;
}

// Every model of a tile as { name, positions (local metres x, y and ellipsoid height), uvs, indices, texture }.
export async function tileModels(tile) {
  const centre = tile.gltf.extensions?.CESIUM_RTC?.center ?? [0, 0, 0];
  const models = [];
  for (const node of tile.gltf.nodes) {
    if (node.mesh === undefined) continue;
    for (const primitive of tile.gltf.meshes[node.mesh].primitives) {
      const position = accessor(tile, primitive.attributes.POSITION);
      const uv = accessor(tile, primitive.attributes.TEXCOORD_0);
      const batch = primitive.attributes._BATCHID === undefined ? 0 : accessor(tile, primitive.attributes._BATCHID).values[0];
      const local = new Float64Array(position.count * 3);
      const ecef = new Float64Array(position.count * 3);
      for (let i = 0; i < position.count; i += 1) {
        const x = centre[0] + position.values[i * 3];
        const y = centre[1] + position.values[i * 3 + 1];
        const z = centre[2] + position.values[i * 3 + 2];
        ecef.set([x, y, z], i * 3);
        const [lon, lat, h] = ecefToGeo(x, y, z);
        const [lx, ly] = toLocal(lon, lat);
        local.set([lx, ly, h], i * 3);
      }
      const textureIndex = tile.gltf.materials[primitive.material]?.extensions?.KHR_techniques_webgl?.values?.u_diffuse?.index;
      models.push({
        name: tile.batchTable.MODEL_NAME?.[batch] ?? `batch ${batch}`,
        local,
        ecef,
        uvs: uv.values,
        indices: accessor(tile, primitive.indices).values,
        texture: textureIndex === undefined ? null : await textureImage(tile, textureIndex),
      });
    }
  }
  return models;
}

// ---------------------------------------------------------------- tileset walk
function regionOverlaps(region, bbox) {
  const [w, s, e, n] = region.slice(0, 4).map((r) => (r * 180) / Math.PI);
  return !(e < bbox.west || w > bbox.east || n < bbox.south || s > bbox.north);
}

export async function leafTiles(bbox) {
  const leaves = [];
  const walk = async (tile, base) => {
    const region = tile.boundingVolume?.region;
    if (region && !regionOverlaps(region, bbox)) return;
    const uri = tile.content?.uri ?? tile.content?.url;
    if (uri?.endsWith(".json")) {
      const sub = await cached(base + uri, false);
      await walk(sub.root, base + (uri.includes("/") ? uri.slice(0, uri.lastIndexOf("/") + 1) : ""));
    } else if (uri && tile.geometricError === 0) {
      leaves.push(base + uri);
    }
    for (const child of tile.children ?? []) await walk(child, base);
  };
  await walk((await cached("tileset.json", false)).root, "");
  return leaves;
}

// ---------------------------------------------------------------- palette
// Colour modes of a 32-level RGB histogram: the fullest bin and every bin within 3 levels of it form a cluster,
// which is removed before the next one is taken; up to `count` clusters with at least 3 % of the texels.
function palette(texels, count = 5) {
  const bins = new Map();
  for (let i = 0; i < texels.length; i += 3) {
    const key = ((texels[i] >> 3) << 10) | ((texels[i + 1] >> 3) << 5) | (texels[i + 2] >> 3);
    const bin = bins.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    bin.n += 1;
    bin.r += texels[i];
    bin.g += texels[i + 1];
    bin.b += texels[i + 2];
    bins.set(key, bin);
  }
  const total = texels.length / 3;
  const clusters = [];
  while (clusters.length < count && bins.size) {
    let peak = null;
    for (const [key, bin] of bins) if (!peak || bin.n > peak[1].n) peak = [key, bin];
    const [pr, pg, pb] = [peak[0] >> 10, (peak[0] >> 5) & 31, peak[0] & 31];
    const cluster = { n: 0, r: 0, g: 0, b: 0 };
    for (const [key, bin] of [...bins]) {
      if (Math.max(Math.abs((key >> 10) - pr), Math.abs(((key >> 5) & 31) - pg), Math.abs((key & 31) - pb)) > 3) continue;
      cluster.n += bin.n;
      cluster.r += bin.r;
      cluster.g += bin.g;
      cluster.b += bin.b;
      bins.delete(key);
    }
    if (cluster.n / total < 0.03) break;
    const rgb = [cluster.r, cluster.g, cluster.b].map((c) => Math.round(c / cluster.n));
    clusters.push({ rgb: `#${rgb.map((c) => c.toString(16).padStart(2, "0")).join("")}`, share: Number((cluster.n / total).toFixed(3)) });
  }
  return clusters;
}

// Roof levels inside a footprint: roof triangle area by height above the lowest wall vertex, in 1 m bins merged
// with their neighbours into levels; the levels holding at least 5 % of the roof area, highest first, each with the
// convex hull (lon/lat) of its roof triangles.
function roofLevels(roofs, ground) {
  const bins = new Map();
  let total = 0;
  for (const roof of roofs) {
    const bin = Math.round(roof.height - ground);
    if (!bins.has(bin)) bins.set(bin, { area: 0, points: [] });
    bins.get(bin).area += roof.area;
    bins.get(bin).points.push(...roof.points);
    total += roof.area;
  }
  const levels = [];
  for (const bin of [...bins.keys()].sort((a, b) => bins.get(b).area - bins.get(a).area)) {
    const level = levels.find((l) => Math.abs(l.bin - bin) <= 2);
    if (level) {
      level.area += bins.get(bin).area;
      level.points.push(...bins.get(bin).points);
    } else {
      levels.push({ bin, area: bins.get(bin).area, points: [...bins.get(bin).points] });
    }
  }
  return levels.filter((l) => l.area / total >= 0.05).sort((a, b) => b.bin - a.bin).map((l) => ({
    heightMetres: l.bin,
    areaSquareMetres: Math.round(l.area),
    share: Number((l.area / total).toFixed(2)),
    hull: convexHull(l.points).map(([x, y]) => [Number((x / MX + LON0).toFixed(7)), Number((y / MY + LAT0).toFixed(7))]),
  }));
}

function convexHull(points) {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list) => {
    const out = [];
    for (const p of list) {
      while (out.length >= 2 && cross(out.at(-2), out.at(-1), p) <= 0) out.pop();
      out.push(p);
    }
    return out.slice(0, -1);
  };
  return [...half(sorted), ...half([...sorted].reverse())];
}

function pointInRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// ---------------------------------------------------------------- main
export async function writeLod4Facades({ debug = null, output = OUTPUT } = {}) {
  const source = JSON.parse(await Bun.file(path.join(DATA, "gis-buildings.json")).text());
  const records = source.buildings.filter((b) => b.status === "standing").map((b) => ({
    record: b,
    rings: b.polygons.map((polygon) => polygon[0].map(([lon, lat]) => toLocal(lon, lat))),
  }));
  const lons = records.flatMap((r) => r.record.polygons.flatMap((p) => p[0].map((c) => c[0])));
  const lats = records.flatMap((r) => r.record.polygons.flatMap((p) => p[0].map((c) => c[1])));
  const bbox = { west: Math.min(...lons), east: Math.max(...lons), south: Math.min(...lats), north: Math.max(...lats) };
  await mkdir(LOD4_CACHE, { recursive: true });
  const tiles = await leafTiles(bbox);
  console.log(`lod4: ${tiles.length} finest b3dm tiles over the ${records.length} standing SCNU footprints`);

  const found = new Map(records.map((r) => [r, { models: new Set(), texels: [], tops: [], bottoms: [], area: 0, roofs: [], debug: [] }]));
  let modelCount = 0;
  for (const uri of tiles) {
    const tile = parseB3dm(await cached(uri, true));
    for (const model of await tileModels(tile)) {
      modelCount += 1;
      const { local, ecef, uvs, indices, texture } = model;
      for (let t = 0; t < indices.length; t += 3) {
        const [i0, i1, i2] = [indices[t], indices[t + 1], indices[t + 2]];
        const p = [i0, i1, i2].map((i) => [local[i * 3], local[i * 3 + 1], local[i * 3 + 2]]);
        const e = [i0, i1, i2].map((i) => [ecef[i * 3], ecef[i * 3 + 1], ecef[i * 3 + 2]]);
        const u = [e[1][0] - e[0][0], e[1][1] - e[0][1], e[1][2] - e[0][2]];
        const v = [e[2][0] - e[0][0], e[2][1] - e[0][1], e[2][2] - e[0][2]];
        const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        const area2 = Math.hypot(...n);
        if (area2 < 1e-6) continue;
        const length = Math.hypot(e[0][0], e[0][1], e[0][2]);
        const up = (n[0] * e[0][0] + n[1] * e[0][1] + n[2] * e[0][2]) / (area2 * length);
        const centroid = [(p[0][0] + p[1][0] + p[2][0]) / 3, (p[0][1] + p[1][1] + p[2][1]) / 3];
        if (up > ROOF_SLOPE) {
          // roof triangle: kept with its footprint when its centroid lies inside one of the footprint's outlines
          const owner = records.find((r) => r.rings.some((ring) => pointInRing(centroid, ring)));
          if (owner) found.get(owner).roofs.push({ height: (p[0][2] + p[1][2] + p[2][2]) / 3, area: area2 / 2, points: p.map((q) => [q[0], q[1]]) });
          continue;
        }
        if (Math.abs(up) > WALL_SLOPE) continue;
        let owner = null;
        for (const r of records) {
          for (const ring of r.rings) {
            const projection = ringProjection(centroid, ring);
            if (projection.distance < MATCH_METRES && (!owner || projection.distance < owner.projection.distance)) owner = { r, ring, projection };
          }
        }
        if (!owner) continue;
        const entry = found.get(owner.r);
        entry.models.add(model.name);
        entry.area += area2 / 2;
        for (const q of p) {
          entry.tops.push(q[2]);
          entry.bottoms.push(q[2]);
        }
        if (!texture) continue;
        // texels under the triangle (texture space rasterisation)
        const W = texture.width;
        const H = texture.height;
        const tx = [i0, i1, i2].map((i) => [uvs[i * 2] * W, uvs[i * 2 + 1] * H]);
        const det = (tx[1][1] - tx[2][1]) * (tx[0][0] - tx[2][0]) + (tx[2][0] - tx[1][0]) * (tx[0][1] - tx[2][1]);
        if (Math.abs(det) < 1e-9) continue;
        const x0 = Math.max(0, Math.floor(Math.min(...tx.map((q) => q[0]))));
        const x1 = Math.min(W - 1, Math.ceil(Math.max(...tx.map((q) => q[0]))));
        const y0 = Math.max(0, Math.floor(Math.min(...tx.map((q) => q[1]))));
        const y1 = Math.min(H - 1, Math.ceil(Math.max(...tx.map((q) => q[1]))));
        for (let y = y0; y <= y1; y += 1) {
          for (let x = x0; x <= x1; x += 1) {
            const w0 = ((tx[1][1] - tx[2][1]) * (x + 0.5 - tx[2][0]) + (tx[2][0] - tx[1][0]) * (y + 0.5 - tx[2][1])) / det;
            const w1 = ((tx[2][1] - tx[0][1]) * (x + 0.5 - tx[2][0]) + (tx[0][0] - tx[2][0]) * (y + 0.5 - tx[2][1])) / det;
            if (w0 < 0 || w1 < 0 || w0 + w1 > 1) continue;
            const o = (y * W + x) * texture.channels;
            const [r, g, b] = [texture.pixels[o], texture.pixels[o + 1], texture.pixels[o + 2]];
            if (r + g + b < 12) continue; // atlas padding
            entry.texels.push(r, g, b);
          }
        }
        if (debug) entry.debug.push({ p, tx, texture, ring: owner.ring });
      }
    }
  }

  const out = [];
  for (const [r, entry] of found) {
    if (!entry.models.size) continue;
    const bottoms = entry.bottoms.sort((a, b) => a - b);
    const tops = entry.tops.sort((a, b) => a - b);
    // Robust ends: the 2nd and 98th percentiles of the wall vertex heights.
    const ground = bottoms[Math.floor(bottoms.length * 0.02)];
    const top = tops[Math.min(tops.length - 1, Math.floor(tops.length * 0.98))];
    const record = r.record;
    out.push({
      footprintSource: record.footprintSource,
      label: record.label ?? null,
      nodeId: record.nodeId ?? null,
      lod4Models: [...entry.models].sort(),
      wallAreaSquareMetres: Math.round(entry.area),
      wallHeightMetres: Number((top - ground).toFixed(1)),
      roofLevels: roofLevels(entry.roofs, ground),
      facadeTexels: entry.texels.length / 3,
      palette: entry.texels.length ? palette(entry.texels) : [],
    });
    if (debug && entry.debug.length) await writeDebug(debug, record, entry.debug, ground, top);
  }
  out.sort((a, b) => (a.label ?? "~").localeCompare(b.label ?? "~") || a.footprintSource.localeCompare(b.footprintSource));
  const file = {
    description: "Facade palettes and wall heights of the standing SCNU footprints in gis-buildings.json, sampled from VWorld LOD4 photo-textured building models (3D Tiles facility_LOD4/Jeollanam-do/Suncheon-si, keyless). palette: colour modes of the wall texels (sRGB, share of texels); estimated from photos with shade, trees and reflections. wallHeightMetres: wall top above the lowest wall vertex (estimated).",
    source: `${TILESET}tileset.json (VWorld; stored under consent D1 of 2026-10-24, attribution 출처: 브이월드)`,
    tiles: tiles.length,
    models: modelCount,
    buildings: out,
  };
  await Bun.write(output, `${JSON.stringify(file, null, 1)}\n`);
  console.log(`lod4: ${modelCount} models; ${out.length} footprints matched (${out.filter((b) => b.facadeTexels).length} with facade texels) -> ${path.relative(process.cwd(), output)}`);
  return file;
}

// Unrolled facade (perimeter distance x height) of one footprint, painted from the LOD4 textures.
async function writeDebug(dir, record, triangles, ground, top) {
  const perimeter = Math.max(...triangles.map((t) => ringProjection([t.p[0][0], t.p[0][1]], t.ring).perimeter));
  const width = Math.min(4000, Math.ceil(perimeter / DEBUG_METRES_PER_PIXEL) + 1);
  const height = Math.max(8, Math.ceil((top - ground + 2) / DEBUG_METRES_PER_PIXEL));
  const pixels = new Uint8Array(width * height * 3).fill(40);
  for (const { p, tx, texture, ring } of triangles) {
    const s = p.map((q) => ringProjection([q[0], q[1]], ring).along / DEBUG_METRES_PER_PIXEL);
    if (Math.max(...s) - Math.min(...s) > 40 / DEBUG_METRES_PER_PIXEL) continue; // wraps around the ring start
    const h = p.map((q) => (top + 1 - q[2]) / DEBUG_METRES_PER_PIXEL);
    const det = (s[1] - s[2]) * (h[0] - h[2]) + (h[2] - h[1]) * (s[0] - s[2]);
    if (Math.abs(det) < 1e-9) continue;
    for (let y = Math.max(0, Math.floor(Math.min(...h))); y <= Math.min(height - 1, Math.ceil(Math.max(...h))); y += 1) {
      for (let x = Math.max(0, Math.floor(Math.min(...s))); x <= Math.min(width - 1, Math.ceil(Math.max(...s))); x += 1) {
        const w0 = ((h[1] - h[2]) * (x + 0.5 - s[2]) + (s[2] - s[1]) * (y + 0.5 - h[2])) / ((h[1] - h[2]) * (s[0] - s[2]) + (s[2] - s[1]) * (h[0] - h[2]));
        const w1 = ((h[2] - h[0]) * (x + 0.5 - s[2]) + (s[0] - s[2]) * (y + 0.5 - h[2])) / ((h[1] - h[2]) * (s[0] - s[2]) + (s[2] - s[1]) * (h[0] - h[2]));
        const w2 = 1 - w0 - w1;
        if (w0 < -0.01 || w1 < -0.01 || w2 < -0.01) continue;
        const u = Math.min(texture.width - 1, Math.max(0, Math.floor(w0 * tx[0][0] + w1 * tx[1][0] + w2 * tx[2][0])));
        const v = Math.min(texture.height - 1, Math.max(0, Math.floor(w0 * tx[0][1] + w1 * tx[1][1] + w2 * tx[2][1])));
        const o = (v * texture.width + u) * texture.channels;
        pixels.set([texture.pixels[o], texture.pixels[o + 1], texture.pixels[o + 2]], (y * width + x) * 3);
      }
    }
  }
  await mkdir(dir, { recursive: true });
  const name = `${(record.label ?? "unnamed").replace(/[^\p{L}\p{N}]+/gu, "_")}_${record.footprintSource.match(/(\d+)\D*$/)?.[1] ?? "x"}`;
  await Bun.write(path.join(dir, `${name}.png`), encodePng(width, height, 3, pixels));
  let alongM = 0;
  const ring = triangles[0].ring;
  const edges = ring.slice(0, -1).map((a, i) => {
    const b = ring[i + 1];
    const lengthM = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const edge = { index: i, x0: alongM / DEBUG_METRES_PER_PIXEL, x1: (alongM + lengthM) / DEBUG_METRES_PER_PIXEL,
      a: [LON0 + a[0] / MX, LAT0 + a[1] / MY], b: [LON0 + b[0] / MX, LAT0 + b[1] / MY] };
    alongM += lengthM;
    return edge;
  });
  await Bun.write(path.join(dir, `${name}.json`), `${JSON.stringify({ footprintSource: record.footprintSource, width, height,
    metresPerPixel: DEBUG_METRES_PER_PIXEL, ground, top, edges }, null, 2)}\n`);
}

if (import.meta.main) {
  const index = process.argv.indexOf("--debug");
  await writeLod4Facades({ debug: index > 0 ? path.resolve(process.argv[index + 1]) : null });
}
