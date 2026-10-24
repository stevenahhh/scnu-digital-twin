// Lights stage: street lamps as two instanced nodes, with no real-time lights.
//   Lamps_heads  pole + arm + head in one primitive (Lamp_Head). The head is masked by a tiny emissive
//                texture, so only it glows; CityModel drives the glow with the night weight.
//   Lamps_pools  a ground-aligned disc under each head (Lamp_Pool, unlit, vertex-colour falloff) that
//                CityModel draws additively at night and hides by day.
// Positions:
//   - real: data/streetlights.json (data.go.kr 15064740 순천시_가로등, data date 2021-09-01). City road
//     lamps only; none stand inside the campus (none within 250 m of D4).
//   - estimated: campus lamps placed along the walkway centrelines every LAMP_SPACING_M, on the walkway
//     edge, skipping spots a real lamp already lights. These are ESTIMATED positions, not surveyed ones;
//     the node extras and the build log say so.
// Lamp heights, head size and pool radii are ASSUMED (typical road / pedestrian luminaires).
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EXTENT, geoToModel, metres } from "../lib/frame.mjs";
import { pointInRing } from "../lib/geometry.mjs";
import { MeshData } from "../lib/meshData.mjs";
import { encodePng } from "../lib/png.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STREETLIGHTS = path.join(HERE, "..", "data", "streetlights.json");
const WALKWAYS = path.resolve(HERE, "../../../..", "docs", "assets", "data", "walkways_wgs84.geojson");
const WALKWAY_FALLBACK_WIDTH_M = 2.4; // as ground.mjs

// Median nearest-neighbour spacing of the real lamps near campus is ~27 m (MEASURED from the CSV);
// estimated lamps reuse it (ASSUMED placement).
const LAMP_SPACING_M = 27;
// An estimated lamp is dropped when a real or already placed lamp is this close.
const REAL_CLEARANCE_M = LAMP_SPACING_M / 2;
const ESTIMATED_CLEARANCE_M = 18;
// Estimated lamps only on walkways within this distance of a campus building (keeps them on campus).
const CAMPUS_REACH_M = 60;
// ASSUMED luminaire sizes: road lamps 8 m with a 7 m pool, pedestrian lamps 4.5 m with a 4.5 m pool.
const ROAD_LAMP = { heightM: 8, poolRadiusM: 7 };
const PATH_LAMP = { heightM: 4.5, poolRadiusM: 4.5 };
// Archetype in metres for a 6 m pole; instances scale it uniformly to their height.
const ARCHETYPE_HEIGHT_M = 6;
const ARM_REACH_M = 1.5;
const POOL_LIFT_M = 0.12;

// u < 0.5 of the 8x8 mask is black (pole/arm), u > 0.5 is white (head). UVs sit on texel centres far
// from the edge, so filtering and lossy WebP leave the pole dark.
const POLE_UV = [0.125, 0.5];
const HEAD_UV = [0.875, 0.5];

function box(mesh, [x0, y0, z0], [x1, y1, z1], uv) {
  const s = metres(1);
  const p = (x, y, z) => [x * s, y * s, z * s];
  const uvs = [uv, uv, uv, uv];
  mesh.quad(p(x0, y0, z1), p(x1, y0, z1), p(x1, y1, z1), p(x0, y1, z1), uvs); // +z
  mesh.quad(p(x1, y0, z0), p(x0, y0, z0), p(x0, y1, z0), p(x1, y1, z0), uvs); // -z
  mesh.quad(p(x1, y0, z1), p(x1, y0, z0), p(x1, y1, z0), p(x1, y1, z1), uvs); // +x
  mesh.quad(p(x0, y0, z0), p(x0, y0, z1), p(x0, y1, z1), p(x0, y1, z0), uvs); // -x
  mesh.quad(p(x0, y1, z1), p(x1, y1, z1), p(x1, y1, z0), p(x0, y1, z0), uvs); // top
  mesh.quad(p(x0, y0, z0), p(x1, y0, z0), p(x1, y0, z1), p(x0, y0, z1), uvs); // bottom
}

// Pole along +y, arm and head reaching +x. Scale 1 = ARCHETYPE_HEIGHT_M.
function lampArchetype() {
  const mesh = new MeshData();
  const h = ARCHETYPE_HEIGHT_M;
  box(mesh, [-0.09, 0, -0.09], [0.09, h, 0.09], POLE_UV);
  box(mesh, [0, h - 0.16, -0.05], [ARM_REACH_M - 0.3, h - 0.04, 0.05], POLE_UV);
  box(mesh, [ARM_REACH_M - 0.6, h - 0.3, -0.18], [ARM_REACH_M, h - 0.12, 0.18], HEAD_UV);
  return mesh;
}

// Unit disc facing up: warm centre fading to black at the rim (additive, so black adds nothing).
function poolArchetype(segments = 24) {
  const mesh = new MeshData({ uvs: false, colors: true });
  const up = [0, 1, 0];
  // roughly (1 - r^2)^2: bright centre, no visible rim
  const rings = [[0, 255], [0.25, 225], [0.5, 145], [0.7, 66], [0.85, 20], [1, 0]];
  const centre = mesh.vertex([0, 0, 0], up, undefined, [255, 255, 255, 255]);
  const ringStart = rings.slice(1).map(([radius, level]) => {
    const start = mesh.vertexCount;
    for (let i = 0; i < segments; i += 1) {
      const a = (i / segments) * Math.PI * 2;
      mesh.vertex([Math.cos(a) * radius, 0, Math.sin(a) * radius], up, undefined, [level, level, level, 255]);
    }
    return start;
  });
  // The angle runs +x -> +z, so (centre, next, current) gives a +y face normal.
  for (let i = 0; i < segments; i += 1) {
    const j = (i + 1) % segments;
    mesh.triangle(centre, ringStart[0] + j, ringStart[0] + i);
    for (let r = 1; r < ringStart.length; r += 1) {
      const inner = ringStart[r - 1];
      const outer = ringStart[r];
      mesh.triangle(inner + i, inner + j, outer + j);
      mesh.triangle(inner + i, outer + j, outer + i);
    }
  }
  return mesh;
}

function nearestOnSegment([px, pz], [ax, az], [bx, bz]) {
  const dx = bx - ax;
  const dz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1)));
  return [ax + t * dx, az + t * dz];
}

function nearestOnRings(point, rings) {
  let best = null;
  let bestDistance = Infinity;
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i += 1) {
      const q = nearestOnSegment(point, ring[i], ring[(i + 1) % ring.length]);
      const d = Math.hypot(q[0] - point[0], q[1] - point[1]);
      if (d < bestDistance) {
        bestDistance = d;
        best = q;
      }
    }
  }
  return { point: best, distance: bestDistance };
}

const inExtent = ([x, z]) => x > EXTENT.minX + 2 && x < EXTENT.maxX - 2 && z > EXTENT.minZ + 2 && z < EXTENT.maxZ - 2;

export function buildLights({ glb, inputs, selectableBuildings, campusBuildings, offCampusLots }) {
  const { heightAt, roadZones } = inputs;
  const source = JSON.parse(readFileSync(STREETLIGHTS, "utf8"));
  const lamps = [];

  // ---- real lamps (MEASURED positions), arm toward the nearest road edge
  const roadRings = roadZones.map((polygon) => polygon[0]);
  const real = source.lamps.map(([id, lon, lat]) => ({ id, at: geoToModel(lon, lat) })).filter(({ at }) => inExtent(at));
  for (const { at } of real) {
    const road = nearestOnRings(at, roadRings);
    const dir = road.distance > 1e-3 && road.distance < metres(15) ? [road.point[0] - at[0], road.point[1] - at[1]] : [1, 0];
    lamps.push({ at, dir, ...ROAD_LAMP, estimated: false });
  }
  const nn = real.map(({ at }, i) => Math.min(...real.filter((_, j) => j !== i).map((o) => Math.hypot(o.at[0] - at[0], o.at[1] - at[1]))));
  nn.sort((a, b) => a - b);
  const medianSpacingM = nn.length ? nn[nn.length >> 1] / metres(1) : 0;

  // ---- estimated campus lamps along walkway centrelines
  const buildingRings = [...selectableBuildings, ...campusBuildings].flatMap((b) => b.parts.map((part) => part.outer));
  const walkways = JSON.parse(readFileSync(WALKWAYS, "utf8")).features.flatMap(({ geometry, properties }) => {
    const width = Number(properties.widt) > 0 ? Number(properties.widt) : WALKWAY_FALLBACK_WIDTH_M;
    const lines = geometry.type === "LineString" ? [geometry.coordinates] : geometry.coordinates;
    return lines.map((line) => ({ width, line: line.map(([lon, lat]) => geoToModel(lon, lat)) }));
  });
  const spacing = metres(LAMP_SPACING_M);
  const tooClose = (p, clearance, estimatedOnly) =>
    lamps.some((lamp) => (!estimatedOnly || lamp.estimated) && Math.hypot(lamp.at[0] - p[0], lamp.at[1] - p[1]) < metres(clearance));
  let skipped = 0;
  for (const { width, line } of walkways) {
    let carry = spacing / 2;
    for (let s = 0; s + 1 < line.length; s += 1) {
      const [ax, az] = line[s];
      const [bx, bz] = line[s + 1];
      const length = Math.hypot(bx - ax, bz - az);
      if (length < 1e-6) continue;
      const ux = (bx - ax) / length;
      const uz = (bz - az) / length;
      for (let t = carry; t <= length; t += spacing) {
        const centre = [ax + ux * t, az + uz * t];
        const side = metres(width / 2 + 0.5);
        const at = [centre[0] - uz * side, centre[1] + ux * side];
        const offCampus =
          !inExtent(at) ||
          offCampusLots.some((lot) => pointInRing(at, lot)) ||
          buildingRings.some((ring) => pointInRing(at, ring)) ||
          nearestOnRings(at, buildingRings).distance > metres(CAMPUS_REACH_M);
        if (offCampus || tooClose(at, REAL_CLEARANCE_M, false) || tooClose(at, ESTIMATED_CLEARANCE_M, true)) {
          skipped += 1;
          continue;
        }
        lamps.push({ at, dir: [centre[0] - at[0], centre[1] - at[1]], ...PATH_LAMP, estimated: true });
      }
      carry = (((carry - length) % spacing) + spacing) % spacing;
    }
  }

  // ---- instances
  const n = lamps.length;
  const heads = { translations: new Float32Array(n * 3), rotations: new Float32Array(n * 4), scales: new Float32Array(n * 3) };
  const pools = { translations: new Float32Array(n * 3), rotations: new Float32Array(n * 4), scales: new Float32Array(n * 3) };
  lamps.forEach((lamp, i) => {
    const [x, z] = lamp.at;
    const length = Math.hypot(lamp.dir[0], lamp.dir[1]) || 1;
    const dx = lamp.dir[0] / length;
    const dz = lamp.dir[1] / length;
    // rotation about +y by angle maps local +x to (cos, 0, -sin)
    const angle = Math.atan2(-dz, dx);
    const quaternion = [0, Math.sin(angle / 2), 0, Math.cos(angle / 2)];
    const scale = lamp.heightM / ARCHETYPE_HEIGHT_M;
    heads.translations.set([x, heightAt(x, z), z], i * 3);
    heads.rotations.set(quaternion, i * 4);
    heads.scales.set([scale, scale, scale], i * 3);
    const reach = metres((ARM_REACH_M - 0.3) * scale);
    const px = x + dx * reach;
    const pz = z + dz * reach;
    const radius = metres(lamp.poolRadiusM);
    pools.translations.set([px, heightAt(px, pz) + metres(POOL_LIFT_M), pz], i * 3);
    pools.rotations.set(quaternion, i * 4);
    pools.scales.set([radius, 1, radius], i * 3);
  });

  const mask = new Uint8Array(8 * 8 * 3);
  for (let y = 0; y < 8; y += 1) for (let x = 4; x < 8; x += 1) mask.fill(255, (y * 8 + x) * 3, (y * 8 + x) * 3 + 3);
  const maskTexture = glb.addTexture(encodePng(8, 8, 3, mask), "image/png", { repeat: false });
  glb.extensionsUsed.add("KHR_materials_emissive_strength");
  glb.extensionsUsed.add("KHR_materials_unlit");
  const headMaterial = glb.addMaterial({
    name: "Lamp_Head",
    pbrMetallicRoughness: { baseColorFactor: [0.3, 0.31, 0.33, 1], metallicFactor: 0.5, roughnessFactor: 0.55 },
    emissiveFactor: [1, 0.74, 0.45],
    emissiveTexture: { index: maskTexture },
    // CityModel multiplies its night weight (0..1) by this strength.
    extensions: { KHR_materials_emissive_strength: { emissiveStrength: 4 } },
  });
  const poolMaterial = glb.addMaterial({
    name: "Lamp_Pool",
    pbrMetallicRoughness: { baseColorFactor: [1, 0.6, 0.28, 1], metallicFactor: 0, roughnessFactor: 1 },
    alphaMode: "BLEND",
    extensions: { KHR_materials_unlit: {} },
  });

  const estimatedCount = lamps.filter((lamp) => lamp.estimated).length;
  const extras = {
    lampsReal: n - estimatedCount,
    lampsEstimated: estimatedCount,
    realSource: `${source.source}, data date ${source.dataDate}`,
    estimatedNote: `estimated positions: campus lamps placed every ${LAMP_SPACING_M} m along walkways (not surveyed)`,
    // instance order: real lamps first, then estimated ones
    estimatedFromInstance: n - estimatedCount,
  };
  const headMesh = glb.addMesh("Lamps_heads", [lampArchetype().toPrimitive(headMaterial)]);
  glb.addNode({ name: "Lamps_heads", mesh: headMesh, extensions: glb.instancingExtension(heads), extras }, { root: true });
  const poolMesh = glb.addMesh("Lamps_pools", [poolArchetype().toPrimitive(poolMaterial)]);
  glb.addNode({ name: "Lamps_pools", mesh: poolMesh, extensions: glb.instancingExtension(pools), extras }, { root: true });

  console.log(
    `lights: ${n} lamps = ${n - estimatedCount} real (${source.source}, ${source.dataDate}; median spacing ${medianSpacingM.toFixed(1)} m) ` +
    `+ ${estimatedCount} estimated positions along walkways every ${LAMP_SPACING_M} m (${skipped} spots skipped); 2 instanced nodes, 0 lights`,
  );
  return { real: n - estimatedCount, estimated: estimatedCount };
}
