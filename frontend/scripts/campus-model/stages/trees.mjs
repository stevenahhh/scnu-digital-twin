// Trees stage: the tree inventory (data/trees.json: crowns traced on the NGII 2025 orthophoto, species read on the
// SCNU 360 VR tour), the hedges along the shrub planters, species geometry and materials, and the instanced nodes.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { tmToScene } from "../../../src/geo/epsg5186.mjs";
import { EXTENT, metres } from "../lib/frame.mjs";
import { Raster, mulberry32 } from "../lib/raster.mjs";

const TREES = process.env.TREES_FILE ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "trees.json");
// Species types of data/trees.json, in its order, and the archetype each one is drawn with (see buildTrees).
const SPECIES = ["ginkgo", "broadleaf", "pine", "metasequoia", "conifer"];
// Crowns are drawn with their surveyed diameter, clamped to this range (m); heights to TREE_HEIGHT_RANGE_M. A crown
// whose height is under CROWN_MIN_RATIO x its diameter is drawn that tall (a flat CHMv2 reading on a wide crown).
const CROWN_DIAMETER_RANGE_M = [1.6, 15];
const TREE_HEIGHT_RANGE_M = [3, 26];
const CROWN_MIN_RATIO = 0.6;
// A photo crown wider than its species' single crown (MAX_CROWN: diameter as a share of the height, clamped) is a
// group, as in the VR rows and stands: it is drawn as round(area ratio) trees (at most GROUP_MAX) spread over the
// photo crown, each with an equal share of its area (GROUP_OVERLAP, at most 1.25 x the single crown). Narrow species are drawn at least TALL_RATIO x their diameter tall. ASSUMED forms.
const MAX_CROWN = {
  ginkgo: { share: 0.55, range: [3.5, 7] },
  broadleaf: { share: 1.0, range: [4, 8] },
  pine: { share: 1.0, range: [4, 8] },
  metasequoia: { share: 0.4, range: [3, 5.5] },
  conifer: { share: 0.45, range: [1.5, 3.5] },
};
const TALL_RATIO = { ginkgo: 1.7, metasequoia: 3.2, conifer: 2 };
const GROUP_MAX = 12;
// Crowns of a group overlap like a closed canopy: each takes GROUP_OVERLAP x its share of the photo crown's area.
const GROUP_OVERLAP = 1.15;
// Hedges: clipped volumes on the shrub planters of the furniture survey (planter fill "shrub", or a note naming
// shrubs or a hedge) and on the planter walls along building fronts. Width, height above the planter top and the
// inset from the planter outline are estimates read on VR scenes e8 f, c1 f and d1 f (ASSUMED).
const HEDGE_WIDTH_M = 0.9;
const HEDGE_HEIGHT_M = 0.7;
const HEDGE_INSET_M = 0.25;
const HEDGE_MIN_SEGMENT_M = 0.6;

const WIDTH = EXTENT.maxX - EXTENT.minX;
const DEPTH = EXTENT.maxZ - EXTENT.minZ;

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
export function placeTrees({ inputs, selectableBuildings, campusBuildings, offCampusLots, blockedRings = [], furnitureObjects = [] }) {
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

  // ---- trees from the inventory
  const treeInstances = Object.fromEntries([...SPECIES, "hedge"].map((kind) => [kind, []]));
  const skipped = { blocked: 0, outside: 0 };
  let groups = 0;
  const rng = mulberry32(20261027);
  for (const [east, north, diameterM, heightM0, speciesIndex, heightFromChm, source] of inventory.crowns) {
    const [x, z] = tmToScene(east, north);
    if (x < EXTENT.minX || x > EXTENT.maxX || z < EXTENT.minZ || z > EXTENT.maxZ) {
      skipped.outside += 1;
      continue;
    }
    if (isBlocked(x, z)) {
      skipped.blocked += 1;
      continue;
    }
    const kind = SPECIES[speciesIndex];
    const photoCrownM = Math.min(CROWN_DIAMETER_RANGE_M[1], Math.max(CROWN_DIAMETER_RANGE_M[0], diameterM));
    const heightPhoto = Math.min(TREE_HEIGHT_RANGE_M[1], Math.max(TREE_HEIGHT_RANGE_M[0], heightM0));
    const { share, range } = MAX_CROWN[kind];
    const singleM = Math.min(range[1], Math.max(range[0], share * heightPhoto));
    const count = photoCrownM > singleM ? Math.min(GROUP_MAX, Math.max(1, Math.round((photoCrownM / singleM) ** 2))) : 1;
    const crownM = count > 1 ? Math.min(singleM * 1.25, (GROUP_OVERLAP * photoCrownM) / Math.sqrt(count)) : photoCrownM;
    const heightM = Math.min(TREE_HEIGHT_RANGE_M[1], Math.max(heightPhoto, CROWN_MIN_RATIO * crownM, (TALL_RATIO[kind] ?? 0) * crownM));
    if (count > 1) groups += 1;
    const spread = metres(Math.max(0, photoCrownM - crownM) / 2);
    const turn = rng() * Math.PI * 2;
    for (let k = 0; k < count; k += 1) {
      // one tree in the middle, the rest on a ring (sunflower spacing keeps them apart)
      const r = count === 1 ? 0 : spread * Math.sqrt((k + 0.5) / count);
      const a = turn + k * 2.39996;
      const tx = x + r * Math.cos(a);
      const tz = z + r * Math.sin(a);
      if (k > 0 && isBlocked(tx, tz)) continue;
      const green = 0.86 + rng() * 0.28;
      const variation = count > 1 ? 0.85 + rng() * 0.3 : 1;
      treeInstances[kind].push({
        x: tx, y: heightAt(tx, tz) - metres(0.2), z: tz, crownM: crownM * (count > 1 ? 0.9 + rng() * 0.2 : 1),
        heightMetres: Math.min(TREE_HEIGHT_RANGE_M[1], heightM * variation), heightFromChm: heightFromChm === 1, source,
        angle: rng() * Math.PI * 2,
        tint: [green * (0.94 + rng() * 0.12), green, green * (0.92 + rng() * 0.16)],
      });
    }
  }

  // ---- hedges along the shrub planters
  const hedgeSources = [];
  for (const o of furnitureObjects) {
    if (o.kind !== "planter") continue;
    const note = o.p.note ?? "";
    const shrubBed = o.ring && (o.p.fill === "shrub" || /shrub|hedge/.test(note));
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
  return { treeInstances, inventory, skipped, hedgeSources, groups };
}

export function buildTrees({ glb, placement }) {
  const { treeInstances, inventory, skipped, hedgeSources, groups } = placement;

  // ---- materials (base colours: summer foliage, estimated against the VR tour and the NGII photo; the dashboard
  // calibrates crowns at load and tints the deciduous ones in autumn, src/lighting/foliage.mjs and season.mjs)
  const mat = (name, rgb, roughness = 0.9) => glb.addMaterial({ name, pbrMetallicRoughness: { baseColorFactor: [...rgb, 1], metallicFactor: 0, roughnessFactor: roughness } });
  const materials = {
    broadleaf: mat("Tree_Crown", [0.3, 0.5, 0.22]),
    ginkgo: mat("Tree_Ginkgo", [0.36, 0.52, 0.17]),
    pine: mat("Tree_Pine", [0.15, 0.32, 0.17]),
    metasequoia: mat("Tree_Metasequoia", [0.3, 0.47, 0.18]),
    conifer: mat("Tree_Conifer", [0.11, 0.28, 0.15]),
    hedge: mat("Tree_Hedge", [0.17, 0.38, 0.15], 0.85),
    trunk: mat("Tree_Trunk", [0.34, 0.27, 0.2], 0.95),
    pineTrunk: mat("Tree_Trunk_Pine", [0.45, 0.24, 0.15], 0.95),
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
    return mergeGeometries([pad(2.2, 0.75, 0.3, 5.4, -0.2, 3), pad(1.8, 0.7, -0.5, 6.5, 0.4, 5), pad(1.2, 0.65, 0.2, 7.5, 0.1, 7)]);
  })();
  const species = {
    ginkgo: [
      geometryPrimitive(trunk(0.17, 0.25, 3.4), materials.trunk),
      geometryPrimitive(latheCrown([[0, 2.4], [1.5, 3.0], [2.0, 4.3], [2.0, 5.8], [1.6, 7.3], [0.9, 8.5], [0, 9.2]], 6, 0.18, 11), materials.ginkgo),
    ],
    broadleaf: [
      geometryPrimitive(trunk(0.18, 0.27, 3.0), materials.trunk),
      geometryPrimitive(lumpyCrown(2.7, 4.2, 7).translate(0, 4.7, 0), materials.broadleaf),
    ],
    pine: [
      geometryPrimitive(trunk(0.14, 0.24, 6.6), materials.pineTrunk),
      geometryPrimitive(pinePads, materials.pine),
    ],
    metasequoia: [
      geometryPrimitive(trunk(0.2, 0.32, 3.0), materials.trunk),
      geometryPrimitive(latheCrown([[0, 1.4], [1.6, 2.1], [1.5, 4.6], [1.15, 7.4], [0.6, 10.2], [0, 12.4]], 6, 0.14, 13), materials.metasequoia),
    ],
    conifer: [
      geometryPrimitive(latheCrown([[0, 0], [0.95, 0.35], [1.1, 1.5], [0.95, 3.0], [0.6, 4.5], [0, 5.6]], 6, 0.12, 17), materials.conifer),
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
      for (let i = 0; i < p.length; i += 3) {
        top = Math.max(top, p[i + 1]);
        radius = Math.max(radius, Math.hypot(p[i], p[i + 2]));
      }
      return [kind, { top, radius }];
    }),
  );
  const triangles = Object.fromEntries(Object.entries(species).map(([kind, parts]) => [kind, parts.reduce((s, p) => s + p.positions.length / 9, 0)]));

  const all = SPECIES.flatMap((kind) => treeInstances[kind]);
  const median = (values) => (values.length ? [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] : 0);
  console.log(`trees: ${inventory.crowns.length} inventory crowns (data/trees.json), ${skipped.blocked} on buildings, roads, off-campus lots or roofed furniture and ${skipped.outside} outside EXTENT left out; ${groups} crowns wider than one tree of their species drawn as groups; ${all.length} trees drawn`);
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
    const { top, radius } = archetype[kind];
    instances.forEach((t, i) => {
      translations.set([t.x, t.y, t.z], i * 3);
      rotations.set([0, Math.sin(t.angle / 2), 0, Math.cos(t.angle / 2)], i * 4);
      if (kind === "hedge") scales.set([metres(t.lengthM), metres(t.heightMetres), metres(t.widthM)], i * 3);
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
      return glb.addNode({ name, mesh, extensions });
    });
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
