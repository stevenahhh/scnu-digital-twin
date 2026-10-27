// Trees stage: the tree inventory (data/trees.json: crowns traced on the NGII 2025 orthophoto, species read on the
// SCNU 360 VR tour), the hedges along the shrub planters, species geometry and materials, and the instanced nodes.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { tmToScene } from "../../../src/geo/epsg5186.mjs";
import { EXTENT, metres } from "../lib/frame.mjs";
import { foliageCards, leafAtlas } from "../lib/foliage.mjs";
import { Raster, mulberry32 } from "../lib/raster.mjs";

const TREES = process.env.TREES_FILE ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "trees.json");
// Species types of data/trees.json, in its order, and the archetype each one is drawn with (see buildTrees).
const SPECIES = ["ginkgo", "broadleaf", "pine", "metasequoia", "conifer", "shrub"];
// Crowns are drawn with their surveyed diameter, clamped to this range (m); heights to TREE_HEIGHT_RANGE_M. A crown
// whose height is under CROWN_MIN_RATIO x its diameter is drawn that tall (a flat CHMv2 reading on a wide crown).
const CROWN_DIAMETER_RANGE_M = [1.6, 15];
const TREE_HEIGHT_RANGE_M = [3, 26];
const CROWN_MIN_RATIO = 0.6;
// Narrow species are drawn at least TALL_RATIO x their crown diameter tall (the inventory splits wide photo crowns into
// trees of their species' size, fetch/treeInventory.mjs). ASSUMED forms read on the VR tour.
const TALL_RATIO = { ginkgo: 1.7, metasequoia: 3.2, conifer: 2 };
// A trunk stands on open ground (surface class NATURAL of the ground stage's label raster), in a surveyed planter, in a
// street-tree pit (a footway cell, PAVING, within STREET_PIT_M of the carriageway, ASPHALT), or in a paved tree pit: a
// photo crown centred over plaza or footway paving with no open ground within PIT_CLEAR x its radius grows from the
// paving (the plaza rows of VR scene_c1 and scene_e1 stand in pits), while one that only overhangs the paving from a lawn
// beside it has its trunk on that lawn. Never on a car park, a court, a road or a building. A trunk elsewhere moves to
// the nearest such point.
const STREET_PIT_M = 1.5;
const PIT_CLEAR = 0.5;
// No crown comes within STATION_CLEAR_M of a SCNU 360 VR tour camera position (scripts/perf/vr-stations.json): the
// camera stood there, so no tree did (a crown there would fill the comparison view).
const STATION_CLEAR_M = 2;
// Continuous canopy: a photo crown (data/trees.json photoCrown) split into at least MASS_MIN broadleaf trees is drawn as
// clustered canopy masses (Trees_canopy: one irregular many-lobed mass, scaled per instance along and across the run of
// trees) instead of separate round crowns, one mass per stretch of at most MASS_LENGTH_M. A mass covers its members'
// spread plus MASS_EDGE x their mean crown radius; a mass that would come within STATION_CLEAR_M of a VR camera keeps
// its trees separate. ASSUMED forms read on VR scene_d3 b, scene_b1 b and scene_e3 f.
const MASS_MIN = 3;
const MASS_LENGTH_M = 14;
const MASS_EDGE = 0.85;
const STATIONS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../perf/vr-stations.json");
// Trunk search radius (m) for a crown centred on a blocked cell (ASSUMED: about one crown radius).
const NUDGE_M = 3;
// Hedges: clipped volumes on the shrub planters of the furniture survey (planter fill "shrub", or a note naming
// shrubs or a hedge) and on the planter walls along building fronts. Width, height above the planter top and the
// inset from the planter outline are estimates read on VR scenes e8 f, c1 f and d1 f (ASSUMED).
const HEDGE_WIDTH_M = 0.9;
const HEDGE_HEIGHT_M = 0.7;
const HEDGE_INSET_M = 0.25;
const HEDGE_MIN_SEGMENT_M = 0.6;

const WIDTH = EXTENT.maxX - EXTENT.minX;
const DEPTH = EXTENT.maxZ - EXTENT.minZ;

// smooth: normals averaged over coincident vertices (rounded crowns read as foliage masses, not facets).
function geometryPrimitive(geometry, material, { smooth = false } = {}) {
  let g;
  if (smooth) {
    const bare = new THREE.BufferGeometry();
    bare.setAttribute("position", geometry.attributes.position.clone());
    if (geometry.index) bare.setIndex(geometry.index.clone());
    const merged = mergeVertices(bare, 1e-4);
    merged.computeVertexNormals();
    g = merged.toNonIndexed();
  } else {
    g = geometry.index ? geometry.toNonIndexed() : geometry;
    g.computeVertexNormals();
  }
  return {
    positions: Float32Array.from(g.attributes.position.array),
    normals: Float32Array.from(g.attributes.normal.array),
    indices: Array.from({ length: g.attributes.position.count }, (_, i) => i),
    material,
  };
}

// Per-vertex ambient occlusion baked into COLOR_0 (U34). Each vertex casts AO_RAYS cosine-weighted
// hemisphere rays (ASSUMED) of up to AO_RAY_METRES (ASSUMED) against its isolated archetype (trunk +
// crown) and the ground plane y = 0, first hit only. The archetypes are a few hundred triangles, so an
// exact brute-force test is milliseconds and needs no BVH. Visibility v maps to AO_FLOOR + (1 - AO_FLOOR) v
// (AO_FLOOR ASSUMED, standing in for sky and bounce light). three r163 multiplies COLOR_0 by the
// per-instance _COLOR_0, so the species tint still applies. A shading estimate, not a measurement.
const AO_RAYS = 32;
const AO_RAY_METRES = 20;
const AO_FLOOR = 0.45;

function bakeVertexAo(parts) {
  const triangles = [];
  for (const { positions } of parts) {
    for (let i = 0; i < positions.length; i += 9) {
      triangles.push([0, 3, 6].map((o) => new THREE.Vector3(positions[i + o], positions[i + o + 1], positions[i + o + 2])));
    }
  }
  const rng = mulberry32(34);
  const samples = Array.from({ length: AO_RAYS }, () => {
    const r = Math.sqrt(rng());
    const phi = rng() * Math.PI * 2;
    return [r * Math.cos(phi), r * Math.sin(phi), Math.sqrt(Math.max(0, 1 - r * r))];
  });
  const ray = new THREE.Ray();
  const hit = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const bitangent = new THREE.Vector3();
  for (const part of parts) {
    const { positions, normals } = part;
    const count = positions.length / 3;
    const colors = new Uint8Array(count * 4);
    for (let v = 0; v < count; v += 1) {
      normal.fromArray(normals, v * 3).normalize();
      tangent.set(Math.abs(normal.y) < 0.9 ? 0 : 1, Math.abs(normal.y) < 0.9 ? 1 : 0, 0).cross(normal).normalize();
      bitangent.crossVectors(normal, tangent);
      let open = 0;
      for (const [a, b, c] of samples) {
        ray.origin.fromArray(positions, v * 3).addScaledVector(normal, 1e-3);
        ray.direction.set(0, 0, 0).addScaledVector(tangent, a).addScaledVector(bitangent, b).addScaledVector(normal, c).normalize();
        let blocked = ray.direction.y < 0 && ray.origin.y / -ray.direction.y <= AO_RAY_METRES;
        for (let t = 0; t < triangles.length && !blocked; t += 1) {
          const [p0, p1, p2] = triangles[t];
          if (ray.intersectTriangle(p0, p1, p2, false, hit) && hit.distanceTo(ray.origin) <= AO_RAY_METRES) blocked = true;
        }
        if (!blocked) open += 1;
      }
      const shade = Math.round(255 * (AO_FLOOR + (1 - AO_FLOOR) * (open / AO_RAYS)));
      colors.set([shade, shade, shade, 255], v * 4);
    }
    part.colors = colors;
  }
  return parts;
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

// Closed lathe (crown of revolution) with per-vertex radial jitter shared by coincident vertices, so the crown stays
// closed. profile: [[radius, y], ...] from the bottom pole to the top pole (metres).
function latheCrown(profile, segments, jitter, seed) {
  const g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), segments);
  const p = g.attributes.position;
  const rng = mulberry32(seed);
  const offsets = new Map();
  for (let i = 0; i < p.count; i += 1) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    if (!offsets.has(key)) offsets.set(key, 1 - jitter / 2 + rng() * jitter);
    const k = offsets.get(key);
    p.setXYZ(i, p.getX(i) * k, p.getY(i), p.getZ(i) * k);
  }
  return g;
}

// Tiered crown (metasequoia, columnar conifers): stacked skirts, each a cone from its rim to its apex with a notched,
// drooping rim (tips hang TIER_DROOP of the tier height below the notches, notches at `notch` x the radius) and a
// shallow underside, so the silhouette reads as layered foliage, not a solid cone. tiers: [[bottom, top, radius], ...].
const TIER_DROOP = 0.18;
function tieredCrown(tiers, points, notch, seed, droop = TIER_DROOP) {
  const rng = mulberry32(seed);
  const out = [];
  const twist = rng() * Math.PI;
  tiers.forEach(([y0, y1, radius], t) => {
    const n = points * 2;
    const rim = Array.from({ length: n }, (_, i) => {
      const a = twist + t * 0.7 + (i / n) * Math.PI * 2;
      const tip = i % 2 === 0;
      const r = radius * (tip ? 0.92 + rng() * 0.16 : notch * (0.9 + rng() * 0.2));
      const y = y0 + (tip ? 0 : droop * (y1 - y0));
      return [Math.cos(a) * r, y, Math.sin(a) * r];
    });
    const apex = [0, y1, 0];
    const under = [0, y0 + 0.35 * (y1 - y0), 0];
    for (let i = 0; i < n; i += 1) {
      const p = rim[i];
      const q = rim[(i + 1) % n];
      out.push(...p, ...apex, ...q, ...p, ...q, ...under);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(out, 3));
  return g;
}

// Darker lower tiers and undersides of a tiered crown: its baked AO times (0.8 + 0.2 x height share), undersides x 0.82.
function shadeTiers(part) {
  const { positions, normals, colors } = part;
  let top = 0;
  for (let i = 1; i < positions.length; i += 3) top = Math.max(top, positions[i]);
  for (let v = 0; v < positions.length / 3; v += 1) {
    const f = (0.8 + 0.2 * (positions[v * 3 + 1] / top)) * (normals[v * 3 + 1] < -0.2 ? 0.82 : 1);
    for (let c = 0; c < 3; c += 1) colors[v * 4 + c] = Math.round(colors[v * 4 + c] * f);
  }
}

// A small irregular lobe (icosahedron, detail 0) with per-vertex radial jitter.
function lobe(r, h, x, y, z, seed) {
  const g = new THREE.IcosahedronGeometry(1, 0);
  const p = g.attributes.position;
  const jitter = mulberry32(seed);
  const offsets = new Map();
  for (let i = 0; i < p.count; i += 1) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    if (!offsets.has(key)) offsets.set(key, 0.85 + jitter() * 0.3);
    const k = offsets.get(key);
    p.setXYZ(i, x + p.getX(i) * r * k, y + p.getY(i) * h * k, z + p.getZ(i) * r * k);
  }
  return g;
}

function mergeGeometries(parts) {
  const positions = [];
  for (const part of parts) positions.push(...(part.index ? part.toNonIndexed() : part).attributes.position.array);
  const merged = new THREE.BufferGeometry();
  merged.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return merged;
}

// Open-ended trunk (the ends are hidden in the ground and the crown).
const trunk = (r0, r1, height, segments = 5) => new THREE.CylinderGeometry(r0, r1, height, segments, 1, true).translate(0, height / 2, 0);

// Placement runs before the ground stage; buildTrees emits the instanced nodes from it later.
// blockedRings: plan rings (model units) of the street furniture trees must not grow through (stages/furniture.mjs);
// furnitureObjects: the furniture survey objects, whose shrub planters carry the hedges.
export function placeTrees({ inputs, selectableBuildings, campusBuildings, offCampusLots, blockedRings = [], furnitureObjects = [], groundInfo }) {
  const { heightAt, roadZones } = inputs;
  const inventory = JSON.parse(readFileSync(TREES, "utf8"));
  if (JSON.stringify(inventory.species) !== JSON.stringify(SPECIES)) throw new Error(`trees: ${TREES} species ${inventory.species} are not ${SPECIES}`);

  // ---- blocked mask: buildings (courtyards stay open), road zones, off-campus lots and the roofed furniture. Walkways
  // do not block: the photo shows the street trees standing in their tree pits on the footways.
  const blocked = new Uint8Array(WIDTH * DEPTH);
  {
    const mask = new Raster(WIDTH, DEPTH);
    const unit = (ring) => ring.map(([x, z]) => [x - EXTENT.minX, z - EXTENT.minZ]);
    for (const building of [...selectableBuildings, ...campusBuildings]) {
      for (const part of building.parts) mask.fillPolygon([unit(part.outer), ...part.holes.map(unit)], () => [255, 0, 0]);
    }
    for (const polygon of roadZones) mask.fillPolygon(polygon.map(unit), () => [255, 0, 0]);
    for (const lot of offCampusLots) mask.fillPolygon([unit(lot)], () => [255, 0, 0]);
    for (const ring of blockedRings) mask.fillPolygon([unit(ring)], () => [255, 0, 0]);
    for (let i = 0; i < blocked.length; i += 1) blocked[i] = mask.data[i * 3] > 0 ? 1 : 0;
  }
  const isBlocked = (x, z) => {
    const i = Math.floor(x - EXTENT.minX);
    const k = Math.floor(z - EXTENT.minZ);
    return i < 0 || k < 0 || i >= WIDTH || k >= DEPTH || blocked[k * WIDTH + i] === 1;
  };

  // ---- where a trunk may stand
  const { NATURAL, PAVING, ASPHALT } = groundInfo.classes;
  const labelAt = (x, z) => {
    const i = Math.floor((x - EXTENT.minX) * groundInfo.px);
    const j = Math.floor((z - EXTENT.minZ) * groundInfo.px);
    return i < 0 || j < 0 || i >= groundInfo.width || j >= groundInfo.height ? NATURAL : groundInfo.labels[j * groundInfo.width + i];
  };
  const pits = furnitureObjects
    .filter((o) => o.ring && (o.kind === "planter" || (o.kind === "plaza_structure" && o.subtype === "planter")))
    .map((o) => o.ring);
  const inPit = (x, z) => pits.some((ring) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const [xi, zi] = ring[i];
      const [xj, zj] = ring[j];
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    }
    return inside;
  });
  const streetPit = (x, z) => {
    for (const r of [STREET_PIT_M / 2, STREET_PIT_M]) {
      for (let a = 0; a < 8; a += 1) {
        if (labelAt(x + metres(r) * Math.cos((a * Math.PI) / 4), z + metres(r) * Math.sin((a * Math.PI) / 4)) === ASPHALT) return true;
      }
    }
    return false;
  };
  const standing = (x, z) => {
    if (isBlocked(x, z)) return null;
    const label = labelAt(x, z);
    if (label === NATURAL) return "ground";
    if (inPit(x, z)) return "pit";
    if (label === PAVING && streetPit(x, z)) return "street-pit";
    return null;
  };
  const openGroundWithin = (x, z, r) => {
    for (let d = 0.5; d <= r; d += 0.5) {
      for (let a = 0; a < 12; a += 1) {
        if (labelAt(x + metres(d) * Math.cos((a * Math.PI) / 6), z + metres(d) * Math.sin((a * Math.PI) / 6)) === NATURAL) return true;
      }
    }
    return false;
  };
  const stations = JSON.parse(readFileSync(STATIONS, "utf8")).map((st) => [st.station_refined_x ?? st.station_x, st.station_refined_z ?? st.station_z]);

  // ---- trees from the inventory
  const treeInstances = Object.fromEntries([...SPECIES, "canopy", "hedge"].map((kind) => [kind, []]));
  const skipped = { blocked: 0, outside: 0, nudged: 0, station: 0, stationMoved: 0 };
  const stands = { ground: 0, pit: 0, "street-pit": 0, "paved-pit": 0, roof: 0, vr: 0 };
  const rng = mulberry32(20261027);
  for (const [east, north, diameterM, heightM0, speciesIndex, heightFromChm, source, , , , photoCrown, fitViews, autumn] of inventory.trees) {
    let [x, z] = tmToScene(east, north);
    if (x < EXTENT.minX || x > EXTENT.maxX || z < EXTENT.minZ || z > EXTENT.maxZ) {
      skipped.outside += 1;
      continue;
    }
    const kind = SPECIES[speciesIndex];
    const crownM = Math.min(CROWN_DIAMETER_RANGE_M[1], Math.max(CROWN_DIAMETER_RANGE_M[0], diameterM));
    // A photo crown overhangs kerbs, paving and walls: its trunk goes to the nearest point it may stand on within
    // NUDGE_M (searched every 0.5 m); a crown with none is left out.
    let stand = standing(x, z);
    if (!stand && !isBlocked(x, z) && labelAt(x, z) === PAVING && !openGroundWithin(x, z, PIT_CLEAR * (crownM / 2))) stand = "paved-pit";
    if (!stand) {
      let found = null;
      for (let r = 0.5; r <= NUDGE_M && !found; r += 0.5) {
        for (let a = 0; a < 16 && !found; a += 1) {
          const nx = x + metres(r) * Math.cos((a * Math.PI) / 8);
          const nz = z + metres(r) * Math.sin((a * Math.PI) / 8);
          const st = standing(nx, nz);
          if (st) found = [nx, nz, st];
        }
      }
      if (!found) {
        skipped.blocked += 1;
        continue;
      }
      [x, z, stand] = found;
      skipped.nudged += 1;
    }
    // VR camera clearance: push the tree straight away from the camera, or leave it out
    const clear = metres(crownM / 2 + STATION_CLEAR_M);
    const near = stations.find(([sx, sz]) => Math.hypot(x - sx, z - sz) < clear);
    if (near) {
      const d = Math.hypot(x - near[0], z - near[1]) || 1e-6;
      const nx = near[0] + ((x - near[0]) / d) * clear;
      const nz = near[1] + ((z - near[1]) / d) * clear;
      const st = standing(nx, nz);
      if (!st || stations.some(([sx, sz]) => Math.hypot(nx - sx, nz - sz) < clear - 1e-6)) {
        skipped.station += 1;
        continue;
      }
      [x, z, stand] = [nx, nz, st];
      skipped.stationMoved += 1;
    }
    stands[stand] += 1;
    const heightPhoto = Math.min(TREE_HEIGHT_RANGE_M[1], Math.max(TREE_HEIGHT_RANGE_M[0], heightM0));
    // a height read on the VR (data/photo/tree-vr-fit.json) stands as measured; shrubs keep their low mound height
    const heightM = kind === "shrub" ? heightM0
      : fitViews > 0 ? Math.min(TREE_HEIGHT_RANGE_M[1], Math.max(heightPhoto, 0.5 * crownM))
        : Math.min(TREE_HEIGHT_RANGE_M[1], Math.max(heightPhoto, CROWN_MIN_RATIO * crownM, (TALL_RATIO[kind] ?? 0) * crownM));
    // per-instance tint: brightness for every species; the feathery conifers also drift in hue (yellow-green to ochre
    // in the VR tour), the rest a little
    const green = 0.86 + rng() * 0.28;
    const hue = kind === "metasequoia" || kind === "conifer" ? 0.3 : 0.12;
    treeInstances[kind].push({
      x, y: heightAt(x, z) - metres(0.2), z, crownM, heightMetres: heightM, heightFromChm: heightFromChm === 1, source, stand, autumn: autumn ?? null, fitted: fitViews > 0, photoCrown,
      angle: rng() * Math.PI * 2,
      tint: [green * (1 - hue / 2 + rng() * hue), green, green * (1 - hue / 2 + rng() * hue)],
    });
  }

  // ---- trees placed from the VR (site-detail site_tree: the A1 roof garden of VR scene_a5, whose crowns the photo
  // inventory blocks over the building, and the F1 forecourt island); the trunk stands roof_m (on a roof) plus box_m
  // (in a tree box or on a mound) above the terrain.
  const roofRng = mulberry32(107); // its own stream, so the hedges after it keep their tints
  for (const o of furnitureObjects) {
    if (o.kind !== "site_tree") continue;
    const kind = o.p.species;
    if (!SPECIES.includes(kind) || !o.point) throw new Error(`trees: site_tree ${o.id} needs a Point and a species of ${SPECIES}`);
    const [x, z] = o.point;
    if (o.p.roof_m) stands.roof += 1;
    else stands.vr += 1;
    const green = 0.86 + roofRng() * 0.28;
    treeInstances[kind].push({
      x, y: heightAt(x, z) + metres((o.p.roof_m ?? 0) + (o.p.box_m ?? 0) - 0.2), z, crownM: o.p.crown_m, heightMetres: o.heightM, heightFromChm: false,
      source: "site-detail", stand: o.p.roof_m ? "roof" : "vr", autumn: o.p.autumn ?? null, fitted: true, photoCrown: `roof:${o.id}`,
      angle: roofRng() * Math.PI * 2, tint: [green, green, green],
    });
  }

  // ---- continuous canopy: broadleaf runs of one photo crown become canopy masses
  const masses = { groups: 0, trees: 0, keptForCamera: 0 };
  {
    const byCrown = new Map();
    for (const t of treeInstances.broadleaf) {
      if (!byCrown.has(t.photoCrown)) byCrown.set(t.photoCrown, []);
      byCrown.get(t.photoCrown).push(t);
    }
    const merged = new Set();
    const ellipseClear = (cx, cz, a, hu, hv) => stations.every(([sx, sz]) => {
      const dx = sx - cx;
      const dz = sz - cz;
      const u = dx * Math.cos(a) + dz * Math.sin(a);
      const v = -dx * Math.sin(a) + dz * Math.cos(a);
      const c = metres(STATION_CLEAR_M);
      return (u / (hu + c)) ** 2 + (v / (hv + c)) ** 2 >= 1;
    });
    for (const members of byCrown.values()) {
      if (members.length < MASS_MIN) continue;
      // principal axis of the trunks
      const mx = members.reduce((acc, t) => acc + t.x, 0) / members.length;
      const mz = members.reduce((acc, t) => acc + t.z, 0) / members.length;
      let sxx = 0, szz = 0, sxz = 0;
      for (const t of members) { sxx += (t.x - mx) ** 2; szz += (t.z - mz) ** 2; sxz += (t.x - mx) * (t.z - mz); }
      const theta = 0.5 * Math.atan2(2 * sxz, sxx - szz);
      const along = (t) => (t.x - mx) * Math.cos(theta) + (t.z - mz) * Math.sin(theta);
      const sorted = [...members].sort((p, q) => along(p) - along(q));
      const span = along(sorted.at(-1)) - along(sorted[0]);
      const chunks = Math.max(1, Math.ceil(span / metres(MASS_LENGTH_M)));
      for (let c = 0; c < chunks; c += 1) {
        const part = sorted.slice(Math.floor((c * sorted.length) / chunks), Math.floor(((c + 1) * sorted.length) / chunks));
        if (part.length < 2) continue;
        const cx = part.reduce((acc, t) => acc + t.x, 0) / part.length;
        const cz = part.reduce((acc, t) => acc + t.z, 0) / part.length;
        const r = metres(part.reduce((acc, t) => acc + t.crownM / 2, 0) / part.length);
        let hu = 0;
        let hv = 0;
        for (const t of part) {
          const dx = t.x - cx;
          const dz = t.z - cz;
          hu = Math.max(hu, Math.abs(dx * Math.cos(theta) + dz * Math.sin(theta)));
          hv = Math.max(hv, Math.abs(-dx * Math.sin(theta) + dz * Math.cos(theta)));
        }
        hu += MASS_EDGE * r;
        hv += MASS_EDGE * r;
        if (!ellipseClear(cx, cz, theta, hu, hv)) {
          masses.keptForCamera += 1;
          continue;
        }
        const heights = part.map((t) => t.heightMetres).sort((p, q) => p - q);
        const heightM = 0.6 * heights.at(-1) + 0.4 * heights[Math.floor(heights.length / 2)];
        const autumned = part.find((t) => t.autumn);
        const tint = [0, 1, 2].map((ch) => part.reduce((acc, t) => acc + t.tint[ch], 0) / part.length);
        treeInstances.canopy.push({
          x: cx, z: cz, y: Math.min(...part.map((t) => t.y)), angle: -theta, halfUM: hu / metres(1), halfVM: hv / metres(1),
          crownM: (2 * Math.max(hu, hv)) / metres(1), heightMetres: heightM, heightFromChm: part.some((t) => t.heightFromChm),
          source: part[0].source, stand: part[0].stand, autumn: autumned ? autumned.autumn : null, fitted: part.some((t) => t.fitted), tint, members: part.length,
        });
        for (const t of part) merged.add(t);
        masses.groups += 1;
        masses.trees += part.length;
      }
    }
    treeInstances.broadleaf = treeInstances.broadleaf.filter((t) => !merged.has(t));
  }

  // ---- hedges along the shrub planters
  const hedgeSources = [];
  for (const o of furnitureObjects) {
    if (o.kind !== "planter") continue;
    const note = o.p.note ?? "";
    // hedge: false (VR scene_f1 f: the F1 island's shrubs stand loose on its mound, no clipped edge) keeps the ring bare
    const shrubBed = o.ring && o.p.hedge !== false && (o.p.fill === "shrub" || /shrub|hedge/.test(note));
    const frontWall = o.line && /planter wall along the building front/.test(note);
    if (!shrubBed && !frontWall) continue;
    hedgeSources.push(o.id);
    const topM = o.heightM ?? 0.5;
    let path0;
    if (shrubBed) {
      // inset ring (the hedge stands inside the bed's kerb)
      const ring = o.ring;
      const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length;
      const cz = ring.reduce((s, p) => s + p[1], 0) / ring.length;
      path0 = [...ring, ring[0]].map(([px, pz]) => {
        const d = Math.hypot(px - cx, pz - cz) || 1;
        const k = Math.max(0, d - metres(HEDGE_INSET_M + HEDGE_WIDTH_M / 2)) / d;
        return [cx + (px - cx) * k, cz + (pz - cz) * k];
      });
    } else {
      path0 = o.line;
    }
    for (let i = 0; i + 1 < path0.length; i += 1) {
      const [ax, az] = path0[i];
      const [bx, bz] = path0[i + 1];
      const length = Math.hypot(bx - ax, bz - az);
      if (length < metres(HEDGE_MIN_SEGMENT_M)) continue;
      const mx = (ax + bx) / 2;
      const mz = (az + bz) / 2;
      const green = 0.9 + rng() * 0.2;
      treeInstances.hedge.push({
        x: mx, y: Math.min(heightAt(ax, az), heightAt(bx, bz)) + metres(topM - 0.05), z: mz,
        lengthM: length / metres(1) + HEDGE_WIDTH_M * 0.5, widthM: HEDGE_WIDTH_M, heightMetres: HEDGE_HEIGHT_M,
        angle: Math.atan2(-(bz - az), bx - ax), planter: o.id,
        tint: [green * 0.97, green, green * 0.95],
      });
    }
  }
  return { treeInstances, inventory, skipped, stands, hedgeSources, masses };
}

export function buildTrees({ glb, placement }) {
  const { treeInstances, inventory, skipped, stands, hedgeSources, masses } = placement;

  // ---- materials (base colours: summer foliage, estimated against the VR tour and the NGII photo; the dashboard
  // calibrates crowns at load and tints the deciduous ones in autumn, src/lighting/foliage.mjs and season.mjs)
  const mat = (name, rgb, roughness = 0.9) => glb.addMaterial({ name, pbrMetallicRoughness: { baseColorFactor: [...rgb, 1], metallicFactor: 0, roughnessFactor: roughness } });
  const materials = {
    broadleaf: mat("Tree_Crown", [0.3, 0.5, 0.22]),
    ginkgo: mat("Tree_Ginkgo", [0.36, 0.52, 0.17]),
    pine: mat("Tree_Pine", [0.15, 0.32, 0.17]),
    metasequoia: mat("Tree_Metasequoia", [0.3, 0.47, 0.18]),
    conifer: mat("Tree_Conifer", [0.11, 0.28, 0.15]),
    shrub: mat("Tree_Shrub", [0.2, 0.36, 0.16], 0.9),
    hedge: mat("Tree_Hedge", [0.17, 0.38, 0.15], 0.85),
    trunk: mat("Tree_Trunk", [0.34, 0.27, 0.2], 0.95),
    pineTrunk: mat("Tree_Trunk_Pine", [0.5, 0.22, 0.13], 0.95),
  };

  // ---- species geometry in metres (instances scale it; see archetype sizes below). Shapes read on the VR tour:
  // ginkgo: straight stem, conical-oval crown widest in its lower third (scene_e1 b, scene_a3 r, scene_c5 r);
  // broadleaf (zelkova, cherry): short stem, broad rounded crown (scene_a9 f, scene_b2 f);
  // pine (Korean red pine): tall red-brown bole, irregular flat layered pads (scene_a3 l, scene_d1 r, scene_d3 f);
  // metasequoia: narrow conical crown down to a short visible stem (scene_c1 r, scene_c2 l, scene_d1 l);
  // conifer: clipped columnar evergreens without a visible stem (scene_a1 r, scene_a2 f);
  // hedge: a clipped box (scene_e8 f, scene_c1 f).
  const pinePads = (() => {
    const pad = (r, h, x, y, z, seed) => {
      const g = new THREE.IcosahedronGeometry(1, 0);
      const p = g.attributes.position;
      const jitter = mulberry32(seed);
      const offsets = new Map();
      for (let i = 0; i < p.count; i += 1) {
        const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
        if (!offsets.has(key)) offsets.set(key, 0.85 + jitter() * 0.3);
        const k = offsets.get(key);
        p.setXYZ(i, x + p.getX(i) * r * k, y + p.getY(i) * h * k, z + p.getZ(i) * r * k);
      }
      return g;
    };
    // six thick irregular pads stepping up and out along the lean of the bole (Korean red pine, VR scene_c1 f, scene_d3 f)
    return mergeGeometries([pad(2.6, 1.05, -0.3, 5.3, 0.4, 3), pad(2.2, 0.95, 1.1, 6.1, -0.8, 5), pad(2.0, 0.9, -1.6, 6.6, 0.7, 7), pad(1.6, 0.85, 0.4, 7.2, 1.0, 13), pad(1.5, 0.8, -0.7, 7.7, -0.5, 9), pad(1.0, 0.7, -1.0, 8.4, 0.2, 11)]);
  })();
  const species = {
    ginkgo: [
      geometryPrimitive(trunk(0.17, 0.25, 3.4), materials.trunk),
      geometryPrimitive(latheCrown([[0, 2.4], [1.5, 3.0], [2.0, 4.3], [2.05, 5.8], [1.65, 7.3], [0.9, 8.5], [0, 9.2]], 8, 0.22, 11), materials.ginkgo, { smooth: true }),
    ],
    broadleaf: [
      geometryPrimitive(trunk(0.18, 0.27, 3.0), materials.trunk),
      // a rounded main mass and two smaller lobes, smooth-shaded (zelkova, cherry: VR scene_a9 f, scene_b2 f)
      geometryPrimitive(mergeGeometries([
        lumpyCrown(2.45, 3.9, 7).translate(0, 4.6, 0),
        lobe(1.6, 1.5, 1.7, 5.3, 0.7, 21),
        lobe(1.45, 1.35, -1.4, 5.7, -1.1, 23),
      ]), materials.broadleaf, { smooth: true }),
    ],
    pine: [
      // a red-brown bole leaning about 7 degrees, as the campus red pines do
      geometryPrimitive(trunk(0.14, 0.26, 6.9).rotateZ(0.12), materials.pineTrunk),
      geometryPrimitive(pinePads, materials.pine),
    ],
    metasequoia: [
      geometryPrimitive(trunk(0.18, 0.32, 5.0), materials.pineTrunk),
      // eleven overlapping, drooping tiers on a full, broad-based cone (VR scene_c1 l and r, scene_e1 r, scene_c2 l): each tier
      // 2.4 m deep stepped 0.95 m, radius 2.3 m at the base easing to the tip, smooth-shaded so the foliage reads soft
      geometryPrimitive(tieredCrown(Array.from({ length: 11 }, (_, i) => [2.2 + i * 0.95, 2.2 + i * 0.95 + 2.4, 2.3 * (1 - i / 11) ** 0.8 + 0.3]), 7, 0.72, 13, 0.3), materials.metasequoia, { smooth: true }),
    ],
    conifer: [
      geometryPrimitive(tieredCrown([[0.2, 1.9, 1.1], [1.3, 3.1, 1.0], [2.5, 4.3, 0.8], [3.7, 5.6, 0.5]], 5, 0.85, 17), materials.conifer),
    ],
    canopy: [
      // three thin stems and a broad, irregular canopy mass of overlapping lobes, about 12 x 8 m and 2.5-10 m high at scale 1
      geometryPrimitive(mergeGeometries([trunk(0.16, 0.22, 4.2).translate(-3, 0, 0.4), trunk(0.17, 0.24, 4.6).translate(0.5, 0, -0.6), trunk(0.15, 0.21, 4.0).translate(3.4, 0, 0.5)]), materials.trunk),
      geometryPrimitive(mergeGeometries([
        lumpyCrown(3.1, 3.4, 41).translate(-3.2, 5.6, 0.6),
        lumpyCrown(3.5, 3.9, 43).translate(0.2, 6.3, -0.7),
        lumpyCrown(3.0, 3.3, 47).translate(3.4, 5.8, 0.8),
        lumpyCrown(2.4, 2.6, 53).translate(-1.4, 7.8, 1.3),
        lumpyCrown(2.2, 2.4, 59).translate(2.0, 8.1, -1.4),
        lobe(2.6, 1.2, -4.6, 4.6, -1.6, 61),
        lobe(2.5, 1.2, 4.7, 4.5, -1.2, 67),
      ]), materials.broadleaf, { smooth: true }),
    ],
    shrub: [
      // low scrub mound (D4 west slope, data/photo/tree-species.json SG01): its height comes from the instance
      geometryPrimitive(lumpyCrown(1, 0.9, 31).translate(0, 0.3, 0), materials.shrub, { smooth: true }),
    ],
    hedge: [
      // unit box on y = 0..1 without its bottom face (x along the hedge, z across)
      geometryPrimitive((() => {
        const g = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0).toNonIndexed();
        const p = g.attributes.position.array;
        const keep = [];
        for (let t = 0; t < p.length; t += 9) if (!(p[t + 1] === 0 && p[t + 4] === 0 && p[t + 7] === 0)) keep.push(...p.slice(t, t + 9));
        const out = new THREE.BufferGeometry();
        out.setAttribute("position", new THREE.Float32BufferAttribute(keep, 3));
        return out;
      })(), materials.hedge),
    ],
  };

  for (const parts of Object.values(species)) bakeVertexAo(parts);
  for (const kind of ["metasequoia", "conifer"]) shadeTiers(species[kind].at(-1));

  // ---- foliage: alpha-tested leaf-cluster cards over each crown (lib/foliage.mjs), one instanced child per species
  // (Trees_<kind>_foliage) with the crown's instancing, so its tint, season colour and the fitted size apply. The leaf
  // atlas is drawn by the generator (no photo pixels, no external asset). The dashboard draws the cards near the camera
  // and the solid crown alone beyond FOLIAGE_LOD in src/lighting/foliage.mjs; the cards cast the crowns' shadows.
  const leafTexture = glb.addTexture(leafAtlas(), "image/png");
  const FOLIAGE = {
    ginkgo: { count: 100, size: [1.5, 1.25], tile: "ginkgo", inner: 0.3, kind: "outward", seed: 201, crown: materials.ginkgo },
    broadleaf: { count: 125, size: [1.7, 1.5], tile: "broadleaf", inner: 0.3, kind: "outward", seed: 203, crown: materials.broadleaf },
    pine: { count: 110, size: [1.85, 1.4], tile: "pine", inner: 0.3, kind: "flat", seed: 205, crown: materials.pine },
    metasequoia: { count: 210, size: [1.7, 0.95], tile: "spray", kind: "droop", inner: 0.25, crossCard: 0.7, seed: 207, crown: materials.metasequoia },
    conifer: { count: 56, size: [1.05, 0.8], tile: "spray", inner: 0.3, kind: "outward", seed: 209, crown: materials.conifer },
    canopy: { count: 360, size: [2.3, 1.95], tile: "broadleaf", inner: 0.3, kind: "outward", seed: 211, elliptic: true, crown: materials.broadleaf },
  };
  const foliage = {};
  for (const [kind, f] of Object.entries(FOLIAGE)) {
    const crownMaterial = glb.json.materials[f.crown];
    const material = glb.addMaterial({
      name: `Tree_Foliage_${kind}`,
      pbrMetallicRoughness: { baseColorFactor: crownMaterial.pbrMetallicRoughness.baseColorFactor, baseColorTexture: { index: leafTexture }, metallicFactor: 0, roughnessFactor: 0.85 },
      alphaMode: "MASK",
      alphaCutoff: 0.5,
      doubleSided: true,
      extras: { foliage: true, crownMaterial: crownMaterial.name, texture: "self-generated leaf atlas (lib/foliage.mjs), no external source" },
    });
    foliage[kind] = { ...foliageCards(species[kind].at(-1).positions, f), material };
  }
  console.log(`trees: foliage cards ${Object.entries(FOLIAGE).map(([k, f]) => `${k} ${f.count}`).join(", ")} per tree (leaf atlas 1024 px, self-generated)`);
  {
    const mean = (c) => c.reduce((sum, value, i) => (i % 4 === 0 ? sum + value : sum), 0) / (c.length / 4) / 255;
    console.log(`trees: vertex AO (${AO_RAYS} rays, ${AO_RAY_METRES} m, floor ${AO_FLOOR}) mean shade ${Object.entries(species).map(([k, parts]) => `${k} ${parts.map((p) => mean(p.colors).toFixed(2)).join("/")}`).join(", ")}`);
  }

  // Archetype crown radius and top (m at scale 1), from each species geometry (DERIVED).
  const archetype = Object.fromEntries(
    Object.entries(species).map(([kind, parts]) => {
      const p = parts.at(-1).positions;
      let top = 0;
      let radius = 0;
      let reachX = 0;
      let reachZ = 0;
      for (let i = 0; i < p.length; i += 3) {
        top = Math.max(top, p[i + 1]);
        radius = Math.max(radius, Math.hypot(p[i], p[i + 2]));
        reachX = Math.max(reachX, Math.abs(p[i]));
        reachZ = Math.max(reachZ, Math.abs(p[i + 2]));
      }
      return [kind, { top, radius, reachX, reachZ }];
    }),
  );
  const triangles = Object.fromEntries(Object.entries(species).map(([kind, parts]) => [kind, parts.reduce((s, p) => s + p.positions.length / 9, 0)]));

  const all = [...SPECIES, "canopy"].flatMap((kind) => treeInstances[kind]);
  const median = (values) => (values.length ? [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] : 0);
  console.log(`trees: continuous canopy: ${masses.trees} broadleaf trees of ${masses.groups} runs drawn as canopy masses (median ${median(treeInstances.canopy.map((t) => t.halfUM * 2)).toFixed(1)} x ${median(treeInstances.canopy.map((t) => t.halfVM * 2)).toFixed(1)} m); ${masses.keptForCamera} runs kept as separate trees for the VR camera clearance`);
  console.log(`trees: ${inventory.trees.length} inventory trees from ${inventory.crowns} photo crowns (data/trees.json); ${skipped.nudged} trunks moved off paving, kerbs, roads or walls (at most ${NUDGE_M} m), ${skipped.stationMoved} moved and ${skipped.station} left out to keep ${STATION_CLEAR_M} m from the VR cameras, ${skipped.blocked} with no ground within ${NUDGE_M} m and ${skipped.outside} outside EXTENT left out; ${all.length} trees drawn (on open ground ${stands.ground}, in planters or tree pits ${stands.pit}, in street-tree pits ${stands["street-pit"]}, in paved tree pits ${stands["paved-pit"]})`);
  console.log(`trees: species ${SPECIES.map((kind) => `${kind} ${treeInstances[kind].length} (median ${median(treeInstances[kind].map((t) => t.heightMetres)).toFixed(1)} m tall, crown ${median(treeInstances[kind].map((t) => t.crownM)).toFixed(1)} m)`).join(", ")}; hedges ${treeInstances.hedge.length} segments on ${hedgeSources.length} planters (${hedgeSources.join(", ")})`);
  console.log(`trees: heights from CHMv2 ${all.filter((t) => t.heightFromChm).length}, from crown size ${all.filter((t) => !t.heightFromChm).length}; species sources ${JSON.stringify(Object.fromEntries(Object.entries(all.reduce((m, t) => ({ ...m, [t.source.split(":")[0]]: (m[t.source.split(":")[0]] ?? 0) + 1 }), {}))))}`);
  console.log(`trees: archetype triangles ${Object.entries(triangles).map(([k, v]) => `${k} ${v}`).join(", ")}; instanced triangles ${Object.entries(treeInstances).reduce((s, [k, list]) => s + list.length * triangles[k], 0)}`);

  // ---- instanced nodes: one node per species (trunk and crown children), so the draw calls do not grow with the trees
  for (const [kind, instances] of Object.entries(treeInstances)) {
    if (instances.length === 0) continue;
    const translations = new Float32Array(instances.length * 3);
    const rotations = new Float32Array(instances.length * 4);
    const scales = new Float32Array(instances.length * 3);
    const colors = new Float32Array(instances.length * 3);
    const { top, radius, reachX, reachZ } = archetype[kind];
    instances.forEach((t, i) => {
      translations.set([t.x, t.y, t.z], i * 3);
      rotations.set([0, Math.sin(t.angle / 2), 0, Math.cos(t.angle / 2)], i * 4);
      if (kind === "hedge") scales.set([metres(t.lengthM), metres(t.heightMetres), metres(t.widthM)], i * 3);
      else if (kind === "canopy") scales.set([metres(t.halfUM / reachX), metres(t.heightMetres / top), metres(t.halfVM / reachZ)], i * 3);
      else {
        const s = metres(t.crownM / 2 / radius);
        scales.set([s, metres(t.heightMetres / top), s], i * 3);
      }
      colors.set(t.tint, i * 3);
    });
    const parts = species[kind];
    const children = parts.map((primitive, partIndex) => {
      const name = `Trees_${kind}_${partIndex === parts.length - 1 ? "crown" : "trunk"}`;
      const mesh = glb.addMesh(name, [primitive]);
      const extensions = glb.instancingExtension({ translations, rotations, scales, colors: partIndex === parts.length - 1 ? colors : undefined });
      // autumn colour read on the VR per instance ([palette group, shade, mix], data/photo/tree-vr-fit.json; 0 = none)
      const isCrown = partIndex === parts.length - 1;
      const autumn = isCrown && instances.some((t) => t.autumn) ? instances.map((t) => (t.autumn ? t.autumn.map((v) => Math.round(v * 100) / 100) : 0)) : null;
      return glb.addNode({ name, mesh, extensions, ...(autumn ? { extras: { autumn } } : {}) });
    });
    if (foliage[kind]) {
      const name = `Trees_${kind}_foliage`;
      const mesh = glb.addMesh(name, [foliage[kind]]);
      const extensions = glb.instancingExtension({ translations, rotations, scales, colors });
      const autumn = instances.some((t) => t.autumn) ? instances.map((t) => (t.autumn ? t.autumn.map((v) => Math.round(v * 100) / 100) : 0)) : null;
      children.push(glb.addNode({ name, mesh, extensions, extras: { foliage: true, ...(autumn ? { autumn } : {}) } }));
    }
    glb.addNode({
      name: `Trees_${kind}`,
      children,
      extras: {
        treeSpecies: kind,
        instances: instances.length,
        estimated: true,
        source: kind === "hedge"
          ? `clipped hedges on the shrub planters of the furniture survey (${hedgeSources.join(", ")}); width ${HEDGE_WIDTH_M} m, ${HEDGE_HEIGHT_M} m above the planter (estimated)`
          : "data/trees.json: crowns traced on the NGII 2025 orthophoto, heights from CHMv2, species from the SCNU 360 VR tour (estimated)",
      },
    }, { root: true });
  }

  return treeInstances;
}
