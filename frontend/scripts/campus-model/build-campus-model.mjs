#!/usr/bin/env bun
// Builds public/campus-v2.glb, the Legacy dashboard campus model, from:
//   - public/uni.glb               terrain heights, the original BLD_* ids and their footprints
//   - data/vworld-buildings.json   real footprints, floor counts and heights (fetch-sources.mjs)
//   - data/landcover.png           satellite-derived ground classes (fetch-sources.mjs)
//   - docs/assets/data/*.geojson   road zones, walkways and crosswalks
// Everything stays in uni.glb's scene frame (see lib/frame.mjs), so CityModel's recentering,
// the traffic simulation and the BLD_* selection contract keep working unchanged.
//
//   bun run model:build
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { EXTENT, geoToModel, metres } from "./lib/frame.mjs";
import { GlbBuilder } from "./lib/glb.mjs";
import { LANDCOVER } from "./lib/landcover.mjs";
import { MeshData } from "./lib/meshData.mjs";
import { decodePng, encodePng } from "./lib/png.mjs";
import { Raster, hashNoise, mulberry32, smoothNoise } from "./lib/raster.mjs";
import {
  FACADE_BAYS,
  FACADE_FLOORS,
  beigePunchedFacade,
  brickPunchedFacade,
  concreteRibbonFacade,
  glassCurtainFacade,
  greenhouseFacade,
  roofTexture,
} from "./lib/textures.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.resolve(HERE, "../..");
const REPO = path.resolve(FRONTEND, "..");
const OUTPUT = path.join(FRONTEND, "public", "campus-v2.glb");

const WIDTH = EXTENT.maxX - EXTENT.minX;
const DEPTH = EXTENT.maxZ - EXTENT.minZ;

// ---------------------------------------------------------------- geometry helpers
const ringArea = (ring) =>
  ring.reduce((sum, p, i) => {
    const q = ring[(i + 1) % ring.length];
    return sum + p[0] * q[1] - q[0] * p[1];
  }, 0) / 2;

const ringCentroid = (ring) => {
  let a = 0;
  let x = 0;
  let z = 0;
  ring.forEach((p, i) => {
    const q = ring[(i + 1) % ring.length];
    const c = p[0] * q[1] - q[0] * p[1];
    a += c;
    x += (p[0] + q[0]) * c;
    z += (p[1] + q[1]) * c;
  });
  return [x / (3 * a), z / (3 * a)];
};

const pointInRing = ([x, z], ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, zi] = ring[i];
    const [xj, zj] = ring[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
};

const segmentDistance = ([px, pz], [ax, az], [bx, bz]) => {
  const dx = bx - ax;
  const dz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
};

// Drops the closing duplicate and near-duplicate/collinear vertices.
function cleanRing(ring) {
  const out = [];
  for (const p of ring) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 0.05) out.push(p);
  }
  if (out.length > 1 && Math.hypot(out[0][0] - out.at(-1)[0], out[0][1] - out.at(-1)[1]) <= 0.05) out.pop();
  for (let i = 0; i < out.length && out.length > 3; ) {
    const a = out[(i - 1 + out.length) % out.length];
    const b = out[i];
    const c = out[(i + 1) % out.length];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cross) < 0.004) out.splice(i, 1);
    else i += 1;
  }
  return out;
}

// ---------------------------------------------------------------- source model
async function loadSourceModel() {
  const bytes = await Bun.file(path.join(FRONTEND, "public", "uni.glb")).arrayBuffer();
  const view = new DataView(bytes);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, view.getUint32(12, true))));
  const gltf = await new Promise((resolve, reject) => new GLTFLoader().parse(bytes, "", resolve, reject));
  gltf.scene.updateMatrixWorld(true);
  const rawNames = json.scenes[0].nodes.map((index) => json.nodes[index].name);
  return { scene: gltf.scene, rawNames };
}

// Upward faces of a prism mesh -> outline rings of its highest roof level.
function meshFootprint(mesh) {
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
function buildHeightfield(topography) {
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
const toModelRing = (ring) => cleanRing(ring.map(([lon, lat]) => geoToModel(lon, lat)));

const source = await loadSourceModel();
const topography = source.scene.getObjectByName("Topography");
const heightAt = buildHeightfield(topography);
const vworld = JSON.parse(await Bun.file(path.join(HERE, "data", "vworld-buildings.json")).text()).buildings;
const roadZones = (await readGeoJson("road_zones_wgs84.geojson")).features.flatMap((f) =>
  polygonsOf(f.geometry).map((polygon) => polygon.map(toModelRing)),
);
const walkways = (await readGeoJson("walkways_wgs84.geojson")).features.flatMap((f) =>
  (f.geometry.type === "LineString" ? [f.geometry.coordinates] : f.geometry.coordinates).map((line) =>
    line.map(([lon, lat]) => geoToModel(lon, lat)),
  ),
);
const crosswalks = (await readGeoJson("crosswalks_wgs84.geojson")).features.map((f) => toModelRing(f.geometry.coordinates[0]));
const landcoverPng = decodePng(await Bun.file(path.join(HERE, "data", "landcover.png")).arrayBuffer());
const landcoverAt = (x, z) => {
  const col = Math.max(0, Math.min(landcoverPng.width - 1, Math.floor(x - EXTENT.minX)));
  const row = Math.max(0, Math.min(landcoverPng.height - 1, Math.floor(z - EXTENT.minZ)));
  return landcoverPng.pixels[row * landcoverPng.width + col];
};

// ---------------------------------------------------------------- building selection
const STYLE = Object.freeze({ CONCRETE: "concrete", BRICK: "brick", BEIGE: "beige", GLASS: "glass", GREENHOUSE: "greenhouse" });
const UNIT_AREA = metres(1) ** 2;

const vworldParts = vworld.map((b, index) => {
  const [outer, ...holes] = b.polygons[0].map(toModelRing);
  return {
    index,
    name: b.name,
    floors: b.floors,
    heightMetres: b.heightMetres,
    outer,
    holes,
    centroid: ringCentroid(outer),
    areaMetres: Math.abs(ringArea(outer)) / UNIT_AREA,
  };
});

function heightOf(part) {
  const fromFloors = part.floors > 0 ? part.floors * 3.5 + 0.8 : 0;
  return Math.max(part.heightMetres || 0, fromFloors, 3.5);
}

function styleFor(name, fallback, seed) {
  if (/온실/.test(name)) return STYLE.GREENHOUSE;
  if (fallback) return fallback;
  if (/체육관|공급실|창고|공장/.test(name)) return STYLE.CONCRETE;
  return [STYLE.CONCRETE, STYLE.BEIGE, STYLE.BRICK, STYLE.GLASS, STYLE.CONCRETE][seed % 5];
}

const isGroundFeature = (part) => part.areaMetres > 8000 && part.floors <= 1;
const used = new Set();
const selectableBuildings = [];

source.scene.children.forEach((object, index) => {
  const rawName = source.rawNames[index];
  if (!object.isMesh || !rawName.startsWith("BLD_")) return;
  const footprint = meshFootprint(object);
  const materialName = [].concat(object.material)[0]?.name ?? "";
  const fallbackStyle = /Brick/.test(materialName) ? STYLE.BRICK : /Glass/.test(materialName) ? STYLE.GREENHOUSE : null;
  const matches = vworldParts.filter((part) => !isGroundFeature(part) && pointInRing(part.centroid, footprint.outer));
  matches.forEach((part) => used.add(part.index));
  const oldArea = Math.abs(ringArea(footprint.outer)) / UNIT_AREA;
  const matchedArea = matches.reduce((sum, part) => sum + part.areaMetres, 0);
  const sourceHeight = (footprint.topY - footprint.minY) / metres(1);
  const name = matches.map((part) => part.name).find(Boolean) ?? "";
  // BLD_D4 anchors the traffic frame through its bounding box, so it keeps the original outline.
  const keepOutline = rawName === "BLD_D4" || matches.length === 0 || matchedArea < oldArea * 0.8;
  const parts = keepOutline
    ? [{
      outer: footprint.outer,
      holes: footprint.holes,
      heightMetres: matches.length ? Math.max(...matches.map(heightOf)) : Math.max(sourceHeight, 3.5),
      floors: matches.length ? Math.max(...matches.map((m) => m.floors)) : Math.round(sourceHeight / 3.6),
    }]
    : matches.map((part) => ({ outer: part.outer, holes: part.holes, heightMetres: heightOf(part), floors: part.floors }));
  selectableBuildings.push({
    nodeName: rawName,
    displayName: name,
    style: styleFor(name, fallbackStyle, index),
    parts,
  });
});

// Campus area: inside the hull of known campus buildings and close to a campus road zone.
const campusPoints = [
  ...selectableBuildings.flatMap((b) => b.parts.map((p) => ringCentroid(p.outer))),
  ...vworldParts.filter((p) => /순천대/.test(p.name)).map((p) => p.centroid),
];
const campusHull = (() => {
  const pts = [...campusPoints].sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (const p of pts.reverse()) {
    while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
})();
const distanceToRoads = (point) => {
  let best = Infinity;
  for (const polygon of roadZones) {
    if (pointInRing(point, polygon[0])) return 0;
    const ring = polygon[0];
    for (let i = 0; i < ring.length; i += 1) best = Math.min(best, segmentDistance(point, ring[i], ring[(i + 1) % ring.length]));
  }
  return best;
};

const campusBuildings = [];
// Off-campus buildings are not modelled; their lots are painted as plain ground and kept free of trees.
const offCampusLots = [];
for (const part of vworldParts) {
  if (used.has(part.index) || isGroundFeature(part)) continue;
  const named = /순천대/.test(part.name);
  if (part.areaMetres < 12 || (!named && !(pointInRing(part.centroid, campusHull) && distanceToRoads(part.centroid) < metres(14)))) {
    offCampusLots.push(part.outer);
    continue;
  }
  campusBuildings.push({
    displayName: part.name,
    style: styleFor(part.name, null, part.index),
    parts: [{ outer: part.outer, holes: part.holes, heightMetres: heightOf(part), floors: part.floors }],
  });
}

// ---------------------------------------------------------------- materials
const glb = new GlbBuilder();
const jpeg = async (png, quality = 86) => new Bun.Image(png).jpeg({ quality }).toBuffer();

const facadeSources = {
  [STYLE.CONCRETE]: concreteRibbonFacade(),
  [STYLE.BRICK]: brickPunchedFacade(),
  [STYLE.BEIGE]: beigePunchedFacade(),
  [STYLE.GLASS]: glassCurtainFacade(),
  [STYLE.GREENHOUSE]: greenhouseFacade(),
};
const facadeMaterials = {};
for (const [style, textures] of Object.entries(facadeSources)) {
  const color = glb.addTexture(await jpeg(textures.color), "image/jpeg");
  const emissive = glb.addTexture(await jpeg(textures.emissive, 80), "image/jpeg");
  facadeMaterials[style] = glb.addMaterial({
    name: `Facade_${style}`,
    pbrMetallicRoughness: {
      baseColorTexture: { index: color },
      metallicFactor: style === STYLE.GLASS ? 0.25 : 0,
      roughnessFactor: style === STYLE.GLASS ? 0.45 : 0.85,
    },
    emissiveTexture: { index: emissive },
    emissiveFactor: [1, 1, 1],
  });
}
const roofMaterial = glb.addMaterial({
  name: "Roof_Membrane",
  pbrMetallicRoughness: { baseColorTexture: { index: glb.addTexture(await jpeg(roofTexture()), "image/jpeg") }, metallicFactor: 0, roughnessFactor: 0.95 },
});
const parapetMaterial = glb.addMaterial({
  name: "Roof_Parapet",
  pbrMetallicRoughness: { baseColorFactor: [0.78, 0.77, 0.74, 1], metallicFactor: 0, roughnessFactor: 0.9 },
  doubleSided: true,
});
const equipmentMaterial = glb.addMaterial({
  name: "Roof_Equipment",
  pbrMetallicRoughness: { baseColorFactor: [0.6, 0.63, 0.66, 1], metallicFactor: 0.4, roughnessFactor: 0.6 },
});
const markingMaterial = glb.addMaterial({
  name: "Road_Marking",
  pbrMetallicRoughness: { baseColorFactor: [0.93, 0.93, 0.9, 1], metallicFactor: 0, roughnessFactor: 0.7 },
});

// ---------------------------------------------------------------- building geometry
const BAY = metres(3.6);
const PARAPET = metres(0.9);

function addWalls(mesh, ring, outward, base, ground, top, floorHeight) {
  const area = ringArea(ring);
  // A ring that is counter-clockwise in (x, z) has its interior on the left; walls face right.
  const ordered = (area > 0) === outward ? [...ring].reverse() : ring;
  let distance = 0;
  const v = (y) => -(y - ground) / (floorHeight * FACADE_FLOORS);
  for (let i = 0; i < ordered.length; i += 1) {
    const a = ordered[i];
    const b = ordered[(i + 1) % ordered.length];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const u0 = distance / (BAY * FACADE_BAYS);
    const u1 = (distance + length) / (BAY * FACADE_BAYS);
    distance += length;
    mesh.quad(
      [a[0], base, a[1]],
      [b[0], base, b[1]],
      [b[0], top, b[1]],
      [a[0], top, a[1]],
      [[u0, v(base)], [u1, v(base)], [u1, v(top)], [u0, v(top)]],
    );
  }
}

function addBox(mesh, cx, cz, sx, sz, y0, y1, angle) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const corner = (dx, dz) => [cx + dx * cos - dz * sin, cz + dx * sin + dz * cos];
  const ring = [corner(-sx / 2, -sz / 2), corner(sx / 2, -sz / 2), corner(sx / 2, sz / 2), corner(-sx / 2, sz / 2)];
  addWalls(mesh, ring, true, y0, y0, y1, 1);
  mesh.horizontalPolygon(ring, [], y1);
}

function dominantAngle(ring) {
  let best = 0;
  let angle = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (length > best) {
      best = length;
      angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
    }
  }
  return angle;
}

function minEdgeDistance(point, rings) {
  let best = Infinity;
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i += 1) best = Math.min(best, segmentDistance(point, ring[i], ring[(i + 1) % ring.length]));
  }
  return best;
}

function buildingPrimitives(building, seed) {
  const walls = new MeshData();
  const roof = new MeshData();
  const parapet = new MeshData({ uvs: false });
  const equipment = new MeshData({ uvs: false });
  const rng = mulberry32(seed);
  for (const part of building.parts) {
    if (!part.outer || part.outer.length < 3) continue;
    const samples = [...part.outer, ringCentroid(part.outer)].map(([x, z]) => heightAt(x, z));
    const ground = Math.min(...samples);
    const base = ground - metres(1.5);
    const height = metres(part.heightMetres);
    const top = ground + height;
    const floors = Math.max(1, part.floors || Math.round(part.heightMetres / 3.6));
    const floorHeight = Math.min(metres(5), Math.max(metres(3), height / floors));
    addWalls(walls, part.outer, true, base, ground, top, floorHeight);
    part.holes.forEach((hole) => addWalls(walls, hole, false, base, ground, top, floorHeight));
    roof.horizontalPolygon(part.outer, part.holes, top, { uvScale: 1 / metres(10) });
    if (building.style !== STYLE.GREENHOUSE) {
      for (const ring of [part.outer, ...part.holes]) {
        addWalls(parapet, ring, true, top, top, top + PARAPET, 1);
        addWalls(parapet, ring, false, top, top, top + PARAPET, 1);
      }
      const areaMetres = Math.abs(ringArea(part.outer)) / UNIT_AREA;
      const units = areaMetres > 300 ? Math.min(6, 1 + Math.floor(areaMetres / 700)) : 0;
      const angle = dominantAngle(part.outer);
      const xs = part.outer.map((p) => p[0]);
      const zs = part.outer.map((p) => p[1]);
      for (let placed = 0, tries = 0; placed < units && tries < 80; tries += 1) {
        const sx = metres(2.5 + rng() * 4);
        const sz = metres(2 + rng() * 3);
        const cx = Math.min(...xs) + rng() * (Math.max(...xs) - Math.min(...xs));
        const cz = Math.min(...zs) + rng() * (Math.max(...zs) - Math.min(...zs));
        if (!pointInRing([cx, cz], part.outer) || part.holes.some((h) => pointInRing([cx, cz], h))) continue;
        if (minEdgeDistance([cx, cz], [part.outer, ...part.holes]) < Math.hypot(sx, sz) / 2 + metres(1.2)) continue;
        addBox(equipment, cx, cz, sx, sz, top, top + metres(1.4 + rng() * 1.6), angle);
        placed += 1;
      }
    }
  }
  return [
    walls.toPrimitive(facadeMaterials[building.style]),
    roof.toPrimitive(roofMaterial),
    parapet.toPrimitive(parapetMaterial),
    equipment.toPrimitive(equipmentMaterial),
  ];
}

selectableBuildings.forEach((building, index) => {
  const mesh = glb.addMesh(building.nodeName, buildingPrimitives(building, 1000 + index));
  glb.addNode({ name: building.nodeName, mesh, extras: { displayName: building.displayName, source: "VWorld LT_C_BLDGINFO" } }, { root: true });
});

{
  const merged = new Map();
  campusBuildings.forEach((building, index) => {
    buildingPrimitives(building, 5000 + index).forEach((primitive) => {
      if (!merged.has(primitive.material)) merged.set(primitive.material, new MeshData({ uvs: Boolean(primitive.uvs) }));
      const target = merged.get(primitive.material);
      target.append({ positions: primitive.positions, normals: primitive.normals, uvs: primitive.uvs, indices: primitive.indices });
    });
  });
  const mesh = glb.addMesh("CampusBuildings", [...merged].map(([material, data]) => data.toPrimitive(material)));
  glb.addNode({ name: "CampusBuildings", mesh, extras: { buildings: campusBuildings.map((b) => b.displayName).filter(Boolean) } }, { root: true });
}

// ---------------------------------------------------------------- ground texture
const PX = 4; // texture pixels per scene unit
const ground = new Raster(WIDTH * PX, DEPTH * PX);
const toPixel = ([x, z]) => [(x - EXTENT.minX) * PX, (z - EXTENT.minZ) * PX];
const PALETTE = {
  [LANDCOVER.PAVED]: [158, 156, 148],
  [LANDCOVER.GRASS]: [112, 150, 74],
  [LANDCOVER.TREE]: [74, 106, 52],
  [LANDCOVER.SOIL]: [170, 140, 102],
  [LANDCOVER.TRACK]: [178, 84, 66],
  [LANDCOVER.COURT]: [62, 112, 168],
};
for (let y = 0; y < ground.height; y += 1) {
  for (let x = 0; x < ground.width; x += 1) {
    // bilinear blend of the four nearest class colours softens the 1-unit class grid
    const fx = x / PX - 0.5;
    const fy = y / PX - 0.5;
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const tx = fx - ix;
    const ty = fy - iy;
    const colourAt = (cx, cy) => PALETTE[landcoverAt(EXTENT.minX + cx + 0.5, EXTENT.minZ + cy + 0.5)];
    const c00 = colourAt(ix, iy);
    const c10 = colourAt(ix + 1, iy);
    const c01 = colourAt(ix, iy + 1);
    const c11 = colourAt(ix + 1, iy + 1);
    const k = 0.9 + smoothNoise(x, y, 14, 1) * 0.12 + hashNoise(x, y, 2) * 0.05;
    const i = (y * ground.width + x) * 3;
    for (let ch = 0; ch < 3; ch += 1) {
      const v = (c00[ch] * (1 - tx) + c10[ch] * tx) * (1 - ty) + (c01[ch] * (1 - tx) + c11[ch] * tx) * ty;
      ground.data[i + ch] = Math.max(0, Math.min(255, v * k));
    }
  }
}
const paving = (x, y) => {
  const joint = x % 6 === 0 || y % 6 === 0;
  const k = 0.95 + hashNoise(Math.floor(x / 6), Math.floor(y / 6), 3) * 0.08 - (joint ? 0.06 : 0);
  return [200 * k, 194 * k, 182 * k];
};
const asphalt = (x, y) => {
  const k = 0.9 + hashNoise(x, y, 4) * 0.12 + smoothNoise(x, y, 40, 5) * 0.06;
  return [70 * k, 73 * k, 77 * k];
};
for (const line of walkways) ground.strokePolyline(line.map(toPixel), metres(3) * PX, () => [164, 160, 150]);
for (const line of walkways) ground.strokePolyline(line.map(toPixel), metres(2.4) * PX, paving);
for (const polygon of roadZones) ground.fillPolygon(polygon.map((ring) => ring.map(toPixel)), asphalt);
for (const polygon of roadZones) {
  for (const ring of polygon) ground.strokePolyline([...ring, ring[0]].map(toPixel), metres(0.35) * PX, () => [176, 174, 166]);
}
for (const lot of offCampusLots) {
  ground.fillPolygon([lot.map(toPixel)], (x, y) => {
    const k = 0.94 + hashNoise(x, y, 6) * 0.08;
    return [150 * k, 148 * k, 141 * k];
  });
}
for (const building of [...selectableBuildings, ...campusBuildings]) {
  for (const part of building.parts) {
    ground.strokePolyline([...part.outer, part.outer[0]].map(toPixel), metres(2.2) * PX, () => [182, 178, 170]);
  }
}
const groundTexture = glb.addTexture(await jpeg(encodePng(ground.width, ground.height, 3, ground.data), 84), "image/jpeg", { repeat: false });
const groundMaterial = glb.addMaterial({
  name: "Ground",
  pbrMetallicRoughness: { baseColorTexture: { index: groundTexture }, metallicFactor: 0, roughnessFactor: 1 },
});

// ---------------------------------------------------------------- terrain (chunked so raycasts stay cheap)
const STEP = 2;
const CHUNK = 42;
const topographyChildren = [];
for (let cz = EXTENT.minZ; cz < EXTENT.maxZ; cz += CHUNK) {
  for (let cx = EXTENT.minX; cx < EXTENT.maxX; cx += CHUNK) {
    const data = new MeshData();
    const xs = [];
    const zs = [];
    for (let x = cx; x < Math.min(cx + CHUNK, EXTENT.maxX) + 1e-6; x += STEP) xs.push(Math.min(x, EXTENT.maxX));
    for (let z = cz; z < Math.min(cz + CHUNK, EXTENT.maxZ) + 1e-6; z += STEP) zs.push(Math.min(z, EXTENT.maxZ));
    if (xs.at(-1) < Math.min(cx + CHUNK, EXTENT.maxX)) xs.push(Math.min(cx + CHUNK, EXTENT.maxX));
    if (zs.at(-1) < Math.min(cz + CHUNK, EXTENT.maxZ)) zs.push(Math.min(cz + CHUNK, EXTENT.maxZ));
    for (const z of zs) {
      for (const x of xs) {
        const nx = heightAt(x - 1, z) - heightAt(x + 1, z);
        const nz = heightAt(x, z - 1) - heightAt(x, z + 1);
        const length = Math.hypot(nx, 2, nz);
        data.vertex([x, heightAt(x, z), z], [nx / length, 2 / length, nz / length], [(x - EXTENT.minX) / WIDTH, (z - EXTENT.minZ) / DEPTH]);
      }
    }
    for (let j = 0; j + 1 < zs.length; j += 1) {
      for (let i = 0; i + 1 < xs.length; i += 1) {
        const a = j * xs.length + i;
        const b = a + 1;
        const c = a + xs.length;
        const d = c + 1;
        data.indices.push(a, c, b, b, c, d);
      }
    }
    const name = `Topography_${topographyChildren.length}`;
    const mesh = glb.addMesh(name, [data.toPrimitive(groundMaterial)]);
    topographyChildren.push(glb.addNode({ name, mesh }));
  }
}
glb.addNode({ name: "Topography", children: topographyChildren }, { root: true });

// ---------------------------------------------------------------- crosswalk stripes
{
  const stripes = new MeshData({ uvs: false });
  const lift = metres(0.08);
  for (const ring of crosswalks) {
    if (ring.length < 4) continue;
    const [p0, p1, p2] = ring;
    const e0 = [p1[0] - p0[0], p1[1] - p0[1]];
    const e1 = [p2[0] - p1[0], p2[1] - p1[1]];
    // stripes run along the short side (traffic direction) and repeat along the long side
    const [along, across, origin] = Math.hypot(...e0) >= Math.hypot(...e1) ? [e0, e1, p0] : [e1, [-e0[0], -e0[1]], p1];
    const length = Math.hypot(...along);
    const ux = along[0] / length;
    const uz = along[1] / length;
    const stripe = metres(0.5);
    for (let s = metres(0.25); s + stripe <= length; s += metres(1)) {
      const a = [origin[0] + ux * s, origin[1] + uz * s];
      const b = [a[0] + ux * stripe, a[1] + uz * stripe];
      const corners = [a, b, [b[0] + across[0], b[1] + across[1]], [a[0] + across[0], a[1] + across[1]]];
      const area = ringArea(corners);
      const ordered = area > 0 ? corners : [...corners].reverse();
      const base = stripes.vertexCount;
      ordered.forEach(([x, z]) => stripes.vertex([x, heightAt(x, z) + lift, z], [0, 1, 0]));
      stripes.indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }
  }
  const mesh = glb.addMesh("Crosswalks", [stripes.toPrimitive(markingMaterial)]);
  glb.addNode({ name: "Crosswalks", mesh }, { root: true });
}

// ---------------------------------------------------------------- trees
function geometryPrimitive(geometry, material) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  g.computeVertexNormals();
  return {
    positions: Float32Array.from(g.attributes.position.array),
    normals: Float32Array.from(g.attributes.normal.array),
    indices: Array.from({ length: g.attributes.position.count }, (_, i) => i),
    material,
  };
}

function lumpyCrown(radius, height, seed) {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.attributes.position;
  const offsets = new Map();
  const rng = mulberry32(seed);
  for (let i = 0; i < p.count; i += 1) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    if (!offsets.has(key)) offsets.set(key, 0.82 + rng() * 0.3);
    const k = offsets.get(key);
    p.setXYZ(i, p.getX(i) * radius * k, p.getY(i) * (height / 2) * k, p.getZ(i) * radius * k);
  }
  return g;
}

const crownMaterial = glb.addMaterial({ name: "Tree_Crown", pbrMetallicRoughness: { baseColorFactor: [0.3, 0.5, 0.22, 1], metallicFactor: 0, roughnessFactor: 0.9 } });
const pineMaterial = glb.addMaterial({ name: "Tree_Pine", pbrMetallicRoughness: { baseColorFactor: [0.16, 0.34, 0.2, 1], metallicFactor: 0, roughnessFactor: 0.9 } });
const trunkMaterial = glb.addMaterial({ name: "Tree_Trunk", pbrMetallicRoughness: { baseColorFactor: [0.36, 0.26, 0.18, 1], metallicFactor: 0, roughnessFactor: 0.95 } });

// Species geometry in metres; instances scale by metres(1) * size.
const species = {
  broadleaf: [
    geometryPrimitive(new THREE.CylinderGeometry(0.16, 0.24, 3.2, 6).translate(0, 1.6, 0), trunkMaterial),
    geometryPrimitive(lumpyCrown(2.6, 4.6, 7).translate(0, 4.8, 0), crownMaterial),
  ],
  roundleaf: [
    geometryPrimitive(new THREE.CylinderGeometry(0.14, 0.2, 2.2, 6).translate(0, 1.1, 0), trunkMaterial),
    geometryPrimitive(lumpyCrown(2.2, 3.4, 19).translate(0, 3.5, 0), crownMaterial),
  ],
  pine: [
    geometryPrimitive(new THREE.CylinderGeometry(0.14, 0.22, 3, 6).translate(0, 1.5, 0), trunkMaterial),
    geometryPrimitive(
      (() => {
        const lower = new THREE.ConeGeometry(2.1, 4.2, 7).translate(0, 4.2, 0).toNonIndexed();
        const upper = new THREE.ConeGeometry(1.5, 3.6, 7).translate(0, 6.6, 0).toNonIndexed();
        const merged = new THREE.BufferGeometry();
        merged.setAttribute("position", new THREE.Float32BufferAttribute([...lower.attributes.position.array, ...upper.attributes.position.array], 3));
        return merged;
      })(),
      pineMaterial,
    ),
  ],
};

const blocked = new Uint8Array(WIDTH * DEPTH);
const nearCampus = new Uint8Array(WIDTH * DEPTH);
{
  const mask = new Raster(WIDTH, DEPTH);
  const unit = (ring) => ring.map(([x, z]) => [x - EXTENT.minX, z - EXTENT.minZ]);
  for (const building of [...selectableBuildings, ...campusBuildings]) {
    for (const part of building.parts) mask.fillPolygon([unit(part.outer)], () => [255, 0, 0]);
  }
  for (const polygon of roadZones) mask.fillPolygon(polygon.map(unit), () => [255, 0, 0]);
  for (const lot of offCampusLots) mask.fillPolygon([unit(lot)], () => [128, 0, 0]);
  for (const line of walkways) mask.strokePolyline(unit(line), metres(2), () => [255, 0, 0]);
  for (let i = 0; i < blocked.length; i += 1) {
    blocked[i] = mask.data[i * 3] > 0 ? 1 : 0;
    nearCampus[i] = mask.data[i * 3] === 255 ? 1 : 0;
  }
  // campus = within ~30 m of a campus building or road
  for (let step = 0; step < Math.round(metres(30)); step += 1) {
    const next = nearCampus.slice();
    for (let z = 0; z < DEPTH; z += 1) {
      for (let x = 0; x < WIDTH; x += 1) {
        const k = z * WIDTH + x;
        if (nearCampus[k]) continue;
        if ((x > 0 && nearCampus[k - 1]) || (x + 1 < WIDTH && nearCampus[k + 1]) || (z > 0 && nearCampus[k - WIDTH]) || (z + 1 < DEPTH && nearCampus[k + WIDTH])) next[k] = 1;
      }
    }
    nearCampus.set(next);
  }
}

const treeInstances = { broadleaf: [], roundleaf: [], pine: [] };
{
  const rng = mulberry32(20261024);
  const minSpacing = metres(4.2);
  const cell = minSpacing / Math.SQRT2;
  const gridW = Math.ceil(WIDTH / cell);
  const gridH = Math.ceil(DEPTH / cell);
  const grid = new Int32Array(gridW * gridH).fill(-1);
  const points = [];
  const candidates = [];
  for (let z = 0; z < DEPTH; z += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      if (landcoverPng.pixels[z * WIDTH + x] === LANDCOVER.TREE && !blocked[z * WIDTH + x]) candidates.push([x, z]);
    }
  }
  for (let i = candidates.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  for (const [cxCell, czCell] of candidates) {
    const x = EXTENT.minX + cxCell + rng();
    const z = EXTENT.minZ + czCell + rng();
    const gx = Math.floor((x - EXTENT.minX) / cell);
    const gz = Math.floor((z - EXTENT.minZ) / cell);
    let ok = true;
    for (let dz = -2; dz <= 2 && ok; dz += 1) {
      for (let dx = -2; dx <= 2 && ok; dx += 1) {
        const nx = gx + dx;
        const nz = gz + dz;
        if (nx < 0 || nz < 0 || nx >= gridW || nz >= gridH) continue;
        const other = grid[nz * gridW + nx];
        if (other >= 0 && Math.hypot(points[other][0] - x, points[other][1] - z) < minSpacing) ok = false;
      }
    }
    if (!ok) continue;
    grid[gz * gridW + gx] = points.length;
    points.push([x, z, nearCampus[czCell * WIDTH + cxCell] === 1]);
  }
  for (const [x, z, campus] of points) {
    const roll = rng();
    const kind = campus ? (roll < 0.55 ? "broadleaf" : roll < 0.85 ? "roundleaf" : "pine") : roll < 0.45 ? "pine" : "broadleaf";
    const size = metres(0.75 + rng() * 0.55);
    const angle = rng() * Math.PI * 2;
    const green = 0.82 + rng() * 0.36;
    treeInstances[kind].push({ x, y: heightAt(x, z) - metres(0.2), z, size, angle, tint: [green * (0.92 + rng() * 0.16), green, green * (0.9 + rng() * 0.2)] });
  }
}
for (const [kind, instances] of Object.entries(treeInstances)) {
  if (instances.length === 0) continue;
  const translations = new Float32Array(instances.length * 3);
  const rotations = new Float32Array(instances.length * 4);
  const scales = new Float32Array(instances.length * 3);
  const colors = new Float32Array(instances.length * 3);
  instances.forEach((t, i) => {
    translations.set([t.x, t.y, t.z], i * 3);
    rotations.set([0, Math.sin(t.angle / 2), 0, Math.cos(t.angle / 2)], i * 4);
    scales.set([t.size, t.size * (0.9 + hashNoise(i, 3, 9) * 0.25), t.size], i * 3);
    colors.set(t.tint, i * 3);
  });
  const children = species[kind].map((primitive, partIndex) => {
    const name = `Trees_${kind}_${partIndex === 0 ? "trunk" : "crown"}`;
    const mesh = glb.addMesh(name, [primitive]);
    const extensions = glb.instancingExtension({
      translations,
      rotations,
      scales,
      colors: partIndex === 0 ? undefined : colors,
    });
    return glb.addNode({ name, mesh, extensions });
  });
  glb.addNode({ name: `Trees_${kind}`, children }, { root: true });
}

// ---------------------------------------------------------------- write
const bytes = glb.toBuffer();
await Bun.write(OUTPUT, bytes);
const treeCount = Object.values(treeInstances).reduce((sum, list) => sum + list.length, 0);
console.log(
  `campus-v2.glb: ${(bytes.length / 1048576).toFixed(2)} MiB, ${selectableBuildings.length} BLD nodes, ` +
  `${campusBuildings.length} other campus buildings, ${treeCount} trees ` +
  `(${Object.entries(treeInstances).map(([k, v]) => `${k} ${v.length}`).join(", ")}), ${crosswalks.length} crosswalks`,
);
