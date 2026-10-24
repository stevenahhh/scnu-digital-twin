// Trees stage: species geometry and materials, the blocked/near-campus masks, Poisson placement
// over satellite tree cover and the instanced tree nodes.
import * as THREE from "three";
import { EXTENT, metres } from "../lib/frame.mjs";
import { LANDCOVER } from "../lib/landcover.mjs";
import { Raster, hashNoise, mulberry32 } from "../lib/raster.mjs";

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

export function buildTrees({ glb, inputs, selectableBuildings, campusBuildings, offCampusLots }) {
  const { heightAt, roadZones, walkways, landcoverPng } = inputs;

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

  // ---- blocked / near-campus masks
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

  // ---- Poisson placement
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

  return treeInstances;
}
