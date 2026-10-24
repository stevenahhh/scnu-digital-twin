// Trees stage: species geometry and materials, the blocked/near-campus masks, CHMv2-driven Poisson
// placement and the instanced tree nodes.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { EXTENT, SCENE_UNITS_PER_METRE, geoToModel, metres, modelToGeo } from "../lib/frame.mjs";
import { CANOPY_TREE_METRES, CHM_GEOREF } from "../lib/landcover.mjs";
import { decodePng } from "../lib/png.mjs";
import { Raster, mulberry32 } from "../lib/raster.mjs";

const CHM_PNG = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "chm.png");
const WALKWAYS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..", "docs", "assets", "data", "walkways_wgs84.geojson");
// walkways_wgs84.geojson `widt` is the paved width in metres (MEASURED); null/zero falls back to 2.4 m (as ground.mjs).
const WALKWAY_FALLBACK_WIDTH_M = 2.4;
// Per-instance tree height (ESTIMATED from CHMv2, an estimate and not a measurement): crown top = local
// CHMv2 maximum under the instance's crown footprint, at least CROWN_TOP_SEARCH_M (ASSUMED) - crowns are
// centred on random canopy cells, not on tree tops, so the footprint holds the tree's top; clamped to TREE_HEIGHT_RANGE_M (ASSUMED); 8 m where
// the local CHM is <= 2 m (ASSUMED).
const CROWN_TOP_SEARCH_M = 3;
const TREE_HEIGHT_RANGE_M = [4, 22];
const LOW_CHM_FALLBACK_M = 8;
// Species weights (broadleaf / roundleaf / pine). Campus core: documented 벚나무 and 느티나무 sites ->
// broadleaf. Street edges (within STREET_EDGE_M of a road zone or walkway): Suncheon street-tree counts
// (counts only) 왕벚 1,509 + 느티 800 -> broadleaf, 은행 1,014 + 배롱 817 -> roundleaf. Woodland: pine share
// 30 % ASSUMED until the 임상도 licence is settled.
const STREET_EDGE_M = 6;
const SPECIES_WEIGHTS = {
  core: { broadleaf: 1, roundleaf: 0, pine: 0 },
  street: { broadleaf: 1509 + 800, roundleaf: 1014 + 817, pine: 0 },
  woodland: { broadleaf: 0.7, roundleaf: 0, pine: 0.3 },
};
// Crown radius (m) from local CHMv2 canopy height h (m): 1 + 0.25 h, clamped to 2-5.5 m. An estimate,
// not a measurement; it only sizes instances so the crowns cover the canopy area.
const crownRadiusMetres = (h) => Math.min(5.5, Math.max(2, 1 + 0.25 * h));
// Two crowns stay at least CROWN_SPACING x their mean radius apart.
const CROWN_SPACING = 1.0;
const MAX_TREES = 12000;
// Crown radius of each archetype's geometry in metres at scale 1 (see species below).
const ARCHETYPE_CROWN_METRES = { broadleaf: 2.6, roundleaf: 2.2, pine: 2.1 };

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

// Placement runs before the ground stage, which needs the crown footprints (stages/ground.mjs keeps the
// orthophoto's own crowns out from under them); buildTrees emits the instanced nodes from it later.
export function placeTrees({ inputs, selectableBuildings, campusBuildings, offCampusLots }) {
  const { heightAt, roadZones } = inputs;
  const walkways = JSON.parse(readFileSync(WALKWAYS, "utf8")).features.flatMap(({ geometry, properties }) => {
    const width = Number(properties?.widt) > 0 ? Number(properties.widt) : WALKWAY_FALLBACK_WIDTH_M;
    const lines = geometry.type === "LineString" ? [geometry.coordinates] : geometry.coordinates;
    return lines.map((line) => ({ width, line: line.map(([lon, lat]) => geoToModel(lon, lat)) }));
  });

  // ---- blocked / near-campus masks
  const blocked = new Uint8Array(WIDTH * DEPTH);
  const nearCampus = new Uint8Array(WIDTH * DEPTH);
  const streetEdge = new Uint8Array(WIDTH * DEPTH);
  {
    const mask = new Raster(WIDTH, DEPTH);
    const unit = (ring) => ring.map(([x, z]) => [x - EXTENT.minX, z - EXTENT.minZ]);
    for (const building of [...selectableBuildings, ...campusBuildings]) {
      for (const part of building.parts) mask.fillPolygon([unit(part.outer)], () => [255, 0, 0]);
    }
    for (const polygon of roadZones) mask.fillPolygon(polygon.map(unit), () => [255, 0, 0]);
    for (const lot of offCampusLots) mask.fillPolygon([unit(lot)], () => [128, 0, 0]);
    for (const { width, line } of walkways) mask.strokePolyline(unit(line), metres(width), () => [255, 0, 0]);
    for (let i = 0; i < blocked.length; i += 1) {
      blocked[i] = mask.data[i * 3] > 0 ? 1 : 0;
      nearCampus[i] = mask.data[i * 3] === 255 ? 1 : 0;
    }
    // street edge = within STREET_EDGE_M of a road zone or walkway
    const street = new Raster(WIDTH, DEPTH);
    for (const polygon of roadZones) street.fillPolygon(polygon.map(unit), () => [255, 0, 0]);
    for (const { width, line } of walkways) street.strokePolyline(unit(line), metres(width + 2 * STREET_EDGE_M), () => [255, 0, 0]);
    for (const polygon of roadZones) {
      for (const ring of polygon) street.strokePolyline(unit([...ring, ring[0]]), metres(2 * STREET_EDGE_M), () => [255, 0, 0]);
    }
    for (let i = 0; i < streetEdge.length; i += 1) streetEdge[i] = street.data[i * 3] > 0 ? 1 : 0;
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

  // ---- CHMv2 canopy per scene unit: 3x3 samples on the 1.19 m grid -> canopy height (mean of the
  // samples at or above CANOPY_TREE_METRES) and whether any sample reaches it.
  const chm = decodePng(readFileSync(CHM_PNG));
  const EARTH_RADIUS = 6378137;
  const chmAt = (x, z) => {
    const [lon, lat] = modelToGeo(x, z);
    const mx = (lon * Math.PI * EARTH_RADIUS) / 180;
    const my = EARTH_RADIUS * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
    const px = Math.floor((mx - CHM_GEOREF.originX) / CHM_GEOREF.pixelSize);
    const py = Math.floor((CHM_GEOREF.originY - my) / CHM_GEOREF.pixelSize);
    return px >= 0 && py >= 0 && px < chm.width && py < chm.height ? chm.pixels[py * chm.width + px] : 0;
  };
  const canopyHeight = new Float32Array(WIDTH * DEPTH);
  for (let z = 0; z < DEPTH; z += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      let sum = 0;
      let hits = 0;
      for (let sz = 0; sz < 3; sz += 1) {
        for (let sx = 0; sx < 3; sx += 1) {
          const h = chmAt(EXTENT.minX + x + (sx + 0.5) / 3, EXTENT.minZ + z + (sz + 0.5) / 3);
          if (h >= CANOPY_TREE_METRES) {
            sum += h;
            hits += 1;
          }
        }
      }
      canopyHeight[z * WIDTH + x] = hits ? sum / hits : 0;
    }
  }

  // ---- Poisson placement with a crown radius per point: crowns are centred on unblocked canopy
  // cells (random order), sized from the local canopy height and kept CROWN_SPACING x their mean
  // radius apart, so their footprints cover the CHM canopy area.
  const treeInstances = { broadleaf: [], roundleaf: [], pine: [] };
  let coveredCanopy = 0;
  let canopyCells = 0;
  {
    const rng = mulberry32(20261024);
    const cell = 4;
    const gridW = Math.ceil(WIDTH / cell);
    const gridH = Math.ceil(DEPTH / cell);
    const buckets = Array.from({ length: gridW * gridH }, () => []);
    const reach = Math.ceil((metres(crownRadiusMetres(255)) * CROWN_SPACING) / cell);
    const points = [];
    const candidates = [];
    for (let z = 0; z < DEPTH; z += 1) {
      for (let x = 0; x < WIDTH; x += 1) {
        if (canopyHeight[z * WIDTH + x] > 0 && !blocked[z * WIDTH + x]) candidates.push([x, z]);
      }
    }
    for (let i = candidates.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    for (const [cxCell, czCell] of candidates) {
      const x = EXTENT.minX + cxCell + rng();
      const z = EXTENT.minZ + czCell + rng();
      if (chmAt(x, z) < CANOPY_TREE_METRES) continue;
      const radius = metres(crownRadiusMetres(canopyHeight[czCell * WIDTH + cxCell]));
      const gx = Math.floor((x - EXTENT.minX) / cell);
      const gz = Math.floor((z - EXTENT.minZ) / cell);
      let ok = true;
      for (let dz = -reach; dz <= reach && ok; dz += 1) {
        for (let dx = -reach; dx <= reach && ok; dx += 1) {
          const nx = gx + dx;
          const nz = gz + dz;
          if (nx < 0 || nz < 0 || nx >= gridW || nz >= gridH) continue;
          for (const other of buckets[nz * gridW + nx]) {
            const p = points[other];
            if (Math.hypot(p.x - x, p.z - z) < (CROWN_SPACING * (p.radius + radius)) / 2) {
              ok = false;
              break;
            }
          }
        }
      }
      if (!ok) continue;
      buckets[gz * gridW + gx].push(points.length);
      const k = czCell * WIDTH + cxCell;
      points.push({ x, z, radius, zone: nearCampus[k] !== 1 ? "woodland" : streetEdge[k] ? "street" : "core" });
    }
    if (points.length > MAX_TREES) throw new Error(`trees: ${points.length} instances exceed ${MAX_TREES}; raise CROWN_SPACING`);

    // canopy coverage: unblocked canopy cells whose centre lies under a crown
    const covered = new Uint8Array(WIDTH * DEPTH);
    for (const p of points) {
      const r = p.radius;
      for (let z = Math.max(0, Math.floor(p.z - r - EXTENT.minZ)); z <= Math.min(DEPTH - 1, Math.ceil(p.z + r - EXTENT.minZ)); z += 1) {
        for (let x = Math.max(0, Math.floor(p.x - r - EXTENT.minX)); x <= Math.min(WIDTH - 1, Math.ceil(p.x + r - EXTENT.minX)); x += 1) {
          if (Math.hypot(EXTENT.minX + x + 0.5 - p.x, EXTENT.minZ + z + 0.5 - p.z) <= r) covered[z * WIDTH + x] = 1;
        }
      }
    }
    for (let k = 0; k < covered.length; k += 1) {
      if (canopyHeight[k] > 0 && !blocked[k]) {
        canopyCells += 1;
        coveredCanopy += covered[k];
      }
    }

    const searchStep = metres(1);
    const crownTopMetres = (x, z, radiusMetres) => {
      const searchMetres = Math.max(CROWN_TOP_SEARCH_M, radiusMetres);
      const searchSteps = Math.ceil(searchMetres);
      let top = 0;
      for (let dz = -searchSteps; dz <= searchSteps; dz += 1) {
        for (let dx = -searchSteps; dx <= searchSteps; dx += 1) {
          if (dx * dx + dz * dz > searchMetres * searchMetres) continue;
          top = Math.max(top, chmAt(x + dx * searchStep, z + dz * searchStep));
        }
      }
      return top;
    };
    for (const { x, z, radius, zone } of points) {
      const weights = SPECIES_WEIGHTS[zone];
      const total = weights.broadleaf + weights.roundleaf + weights.pine;
      const roll = rng() * total;
      const kind = roll < weights.broadleaf ? "broadleaf" : roll < weights.broadleaf + weights.roundleaf ? "roundleaf" : "pine";
      const size = metres(radius / SCENE_UNITS_PER_METRE / ARCHETYPE_CROWN_METRES[kind]);
      const chmTop = crownTopMetres(x, z, radius / SCENE_UNITS_PER_METRE);
      const heightMetres = chmTop <= 2 ? LOW_CHM_FALLBACK_M : Math.min(TREE_HEIGHT_RANGE_M[1], Math.max(TREE_HEIGHT_RANGE_M[0], chmTop));
      const angle = rng() * Math.PI * 2;
      const green = 0.82 + rng() * 0.36;
      treeInstances[kind].push({ x, y: heightAt(x, z) - metres(0.2), z, size, heightMetres, zone, radius, angle, tint: [green * (0.92 + rng() * 0.16), green, green * (0.9 + rng() * 0.2)] });
    }
  }
  return { treeInstances, canopyCells, coveredCanopy };
}

export function buildTrees({ glb, placement }) {
  const { treeInstances, canopyCells, coveredCanopy } = placement;

  // ---- materials
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

  for (const parts of Object.values(species)) bakeVertexAo(parts);
  {
    const mean = (c) => c.reduce((sum, value, i) => (i % 4 === 0 ? sum + value : sum), 0) / (c.length / 4) / 255;
    console.log(`trees: vertex AO (${AO_RAYS} rays, ${AO_RAY_METRES} m, floor ${AO_FLOOR}) mean shade ${Object.entries(species).map(([k, [trunk, crown]]) => `${k} trunk ${mean(trunk.colors).toFixed(2)} crown ${mean(crown.colors).toFixed(2)}`).join(", ")}`);
  }

  // Archetype top (m at scale 1): highest crown vertex of each species geometry (DERIVED).
  const archetypeTopMetres = Object.fromEntries(
    Object.entries(species).map(([kind, parts]) => {
      const p = parts[1].positions;
      let top = 0;
      for (let i = 1; i < p.length; i += 3) top = Math.max(top, p[i]);
      return [kind, top];
    }),
  );
  for (const [kind, instances] of Object.entries(treeInstances)) {
    for (const t of instances) t.sizeY = metres(t.heightMetres / archetypeTopMetres[kind]);
  }
  console.log(`trees: CHMv2 canopy (>= ${CANOPY_TREE_METRES} m) covers ${canopyCells} unblocked cells; crowns cover ${((coveredCanopy / Math.max(1, canopyCells)) * 100).toFixed(1)} % of them`);
  {
    const all = Object.values(treeInstances).flat().map((t) => t.heightMetres).sort((a, b) => a - b);
    const median = (values) => (values.length ? values[Math.floor(values.length / 2)] : 0);
    const edges = [4, 6, 8, 10, 12, 14, 16, 18, 20, 22.01];
    const bins = edges.slice(0, -1).map((lo, b) => `${lo}-${Math.round(edges[b + 1])} m: ${all.filter((h) => h >= lo && h < edges[b + 1]).length}`);
    const perKind = Object.entries(treeInstances).map(([kind, list]) => `${kind} ${list.length} (median ${median(list.map((t) => t.heightMetres).sort((a, b) => a - b)).toFixed(1)} m)`);
    console.log(`trees: estimated instance heights (CHMv2 crown top, ${TREE_HEIGHT_RANGE_M[0]}-${TREE_HEIGHT_RANGE_M[1]} m): ${all.length} trees, median ${median(all).toFixed(1)} m; ${bins.join(", ")}`);
    const flat = Object.values(treeInstances).flat().sort((a, b) => a.heightMetres - b.heightMetres);
    const totalArea = flat.reduce((sum, t) => sum + t.radius * t.radius, 0);
    let acc = 0;
    const areaMedian = flat.find((t) => (acc += t.radius * t.radius) >= totalArea / 2)?.heightMetres ?? 0;
    const zones = Object.keys(SPECIES_WEIGHTS).map((zone) => `${zone} ${flat.filter((t) => t.zone === zone).length}`);
    console.log(`trees: crown-area-weighted median height ${areaMedian.toFixed(1)} m; zones ${zones.join(", ")}`);
    console.log(`trees: species ${perKind.join(", ")}; archetype tops ${Object.entries(archetypeTopMetres).map(([k, v]) => `${k} ${v.toFixed(2)} m`).join(", ")}`);
  }

  // ---- instanced nodes
  for (const [kind, instances] of Object.entries(treeInstances)) {
    if (instances.length === 0) continue;
    const translations = new Float32Array(instances.length * 3);
    const rotations = new Float32Array(instances.length * 4);
    const scales = new Float32Array(instances.length * 3);
    const colors = new Float32Array(instances.length * 3);
    instances.forEach((t, i) => {
      translations.set([t.x, t.y, t.z], i * 3);
      rotations.set([0, Math.sin(t.angle / 2), 0, Math.cos(t.angle / 2)], i * 4);
      scales.set([t.size, t.sizeY, t.size], i * 3);
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

  return treeInstances;
}
