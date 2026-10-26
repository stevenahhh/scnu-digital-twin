// Context stage: the off-campus buildings of GIS건물통합정보 (inside EXTENT, where stages/buildings.mjs leaves them as
// plain lots, and out on the OuterTerrain ring) as cheap extruded masses, so the town around the campus stands up in
// the views instead of lying flat. Inside EXTENT they stand on the drawn ground, outside on the OuterTerrain mesh.
//   - height: the GIS source height when it gives 2.5-5 m per storey, else floors x the storey median, else one storey
//     (heightOf / assumedHeight of stages/buildings.mjs). Every height is an estimate (추정).
//   - shape: the footprint extruded from just below its lowest ground point to its highest ground point + height, with a
//     flat roof. No parapets, no attachments, no LOD4 forms, no per-building looks.
//   - facade: one 96 x 32 texture with three sections (residential windows | commercial glass band | plain roof), the
//     wall split into bays of about BAY_M so each bay maps one section width and v counts storeys (repeat). The use class
//     (GIS usability) picks the section; a vertex colour per building picks the wall tone.
//   - draw calls: all masses of one TILE_M tile merged into one primitive with the one Context_Building material.
//   - context only: node names Context_Buildings_<i>_<j>, no BLD_ ids, extras { context: true, selectable: false }.
import { EXTENT, metres } from "../lib/frame.mjs";
import { MeshData } from "../lib/meshData.mjs";
import { encodePng } from "../lib/png.mjs";

export const TILE_M = 200;
// Masses whose centre is farther than this (scene units) from the EXTENT centre go into Context_Far_* tiles that cast no
// shadow: the shadow camera (src/lighting/shadowFrustum.mjs, half-size 320) is fitted to the campus and would not
// contain them. They still receive shadows.
export const CONTEXT_REACH = 290;
const BAY_M = 3.2;
const SINK_M = 0.3;
const SECTION = { residential: 0, commercial: 1 / 3, roof: 2 / 3 };
const RESIDENTIAL = /주택|숙박|노유자/;
const COMMERCIAL = /근린생활|업무|판매|의료|문화|종교|교육/;
const TONES = {
  residential: [[236, 228, 212], [226, 214, 196], [214, 196, 178], [240, 236, 228], [200, 176, 160]],
  commercial: [[214, 216, 218], [196, 202, 208], [228, 226, 220], [182, 188, 194]],
  other: [[204, 202, 196], [190, 188, 182]],
};
const ROOF_TONES = [[150, 152, 154], [128, 132, 136], [168, 166, 160]];

// Height of a triangle mesh (positions xyz, indices) under (x, z), or null off the mesh; triangles binned by cell.
export function meshHeightAt(positions, indices, cell = 20) {
  const bins = new Map();
  const key = (i, j) => `${i},${j}`;
  for (let t = 0; t < indices.length; t += 3) {
    const v = [indices[t], indices[t + 1], indices[t + 2]];
    const xs = v.map((k) => positions[k * 3]);
    const zs = v.map((k) => positions[k * 3 + 2]);
    for (let i = Math.floor(Math.min(...xs) / cell); i <= Math.floor(Math.max(...xs) / cell); i += 1) {
      for (let j = Math.floor(Math.min(...zs) / cell); j <= Math.floor(Math.max(...zs) / cell); j += 1) {
        const k = key(i, j);
        if (!bins.has(k)) bins.set(k, []);
        bins.get(k).push(t);
      }
    }
  }
  return (x, z) => {
    for (const t of bins.get(key(Math.floor(x / cell), Math.floor(z / cell))) ?? []) {
      const [a, b, c] = [indices[t], indices[t + 1], indices[t + 2]].map((k) => [positions[k * 3], positions[k * 3 + 1], positions[k * 3 + 2]]);
      const d = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
      if (Math.abs(d) < 1e-12) continue;
      const l1 = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / d;
      const l2 = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / d;
      const l3 = 1 - l1 - l2;
      if (l1 >= -1e-6 && l2 >= -1e-6 && l3 >= -1e-6) return l1 * a[1] + l2 * b[1] + l3 * c[1];
    }
    return null;
  };
}

export function useClass(use, floors) {
  if (RESIDENTIAL.test(use ?? "")) return "residential";
  if (COMMERCIAL.test(use ?? "")) return "commercial";
  return use ? "other" : (floors ?? 1) <= 2 ? "residential" : "other";
}

// 96 x 32 RGB: storey-high sections, white walls (vertex colours tint them), dark glass.
export function contextTexture() {
  const W = 96;
  const H = 32;
  const px = new Uint8Array(W * H * 3).fill(255);
  const set = (x, y, c) => px.set(c, (y * W + x) * 3);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const s = Math.floor(x / 32);
      const u = x % 32;
      if (s === 0 && y >= 9 && y <= 23 && u >= 6 && u <= 25) set(x, y, y >= 21 ? [190, 190, 186] : [70, 82, 92]);
      else if (s === 1 && y >= 5 && y <= 26 && u >= 2 && u <= 29) set(x, y, u % 7 === 2 ? [150, 156, 160] : [82, 102, 118]);
      else if (s === 2) set(x, y, [214, 214, 214]);
      if (s < 2 && y === 0) set(x, y, [224, 224, 222]);
    }
  }
  return encodePng(W, H, 3, px);
}

const signedArea = (ring) => ring.reduce((sum, a, i) => {
  const b = ring[(i + 1) % ring.length];
  return sum + a[0] * b[1] - b[0] * a[1];
}, 0);
const hash = (n) => {
  let x = (n + 1) * 2654435761;
  x ^= x >>> 15;
  return Math.abs(x) >>> 0;
};

function walls(mesh, ring, outward, base, top, storeys, section, color) {
  // outward: true for an outer ring (faces away from the interior), false for a hole (faces into the courtyard)
  const positive = signedArea(ring) > 0;
  const r = positive === outward ? [...ring].reverse() : ring;
  for (let i = 0; i < r.length; i += 1) {
    const a = r[i];
    const b = r[(i + 1) % r.length];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) / metres(1);
    if (L < 0.05) continue;
    const bays = Math.max(1, Math.round(L / BAY_M));
    for (let k = 0; k < bays; k += 1) {
      const p = [a[0] + ((b[0] - a[0]) * k) / bays, a[1] + ((b[1] - a[1]) * k) / bays];
      const q = [a[0] + ((b[0] - a[0]) * (k + 1)) / bays, a[1] + ((b[1] - a[1]) * (k + 1)) / bays];
      mesh.quad([p[0], base, p[1]], [q[0], base, q[1]], [q[0], top, q[1]], [p[0], top, p[1]],
        [[section + 0.002, storeys], [section + 1 / 3 - 0.002, storeys], [section + 1 / 3 - 0.002, 0], [section + 0.002, 0]], color);
    }
  }
}

// parts: contextParts of stages/buildings.mjs; groundAt(x, z) -> terrain y (scene units).
export function buildContext({ glb, parts, groundAt }) {
  const tile = metres(TILE_M);
  const tiles = new Map();
  const counts = { residential: 0, commercial: 0, other: 0 };
  let tallest = 0;
  let beyondReach = 0;
  const [mx, mz] = [(EXTENT.minX + EXTENT.maxX) / 2, (EXTENT.minZ + EXTENT.maxZ) / 2];
  for (const part of parts) {
    const [px, pz] = part.outer.reduce((s, p) => [s[0] + p[0] / part.outer.length, s[1] + p[1] / part.outer.length], [0, 0]);
    const far = Math.hypot(px - mx, pz - mz) > CONTEXT_REACH;
    if (far) beyondReach += 1;
    const ys = part.outer.map(([x, z]) => groundAt(x, z));
    const base = Math.min(...ys) - metres(SINK_M);
    const top = Math.max(...ys) + metres(part.heightMetres);
    const storeys = part.floors || Math.max(1, Math.round(part.heightMetres / 3));
    const cls = useClass(part.use, part.floors);
    counts[cls] += 1;
    tallest = Math.max(tallest, part.heightMetres);
    const tones = TONES[cls];
    const color = [...tones[hash(part.index) % tones.length], 255];
    const roof = [...ROOF_TONES[hash(part.index + 7) % ROOF_TONES.length], 255];
    const [cx, cz] = part.outer.reduce((s, p) => [s[0] + p[0] / part.outer.length, s[1] + p[1] / part.outer.length], [0, 0]);
    const ti = Math.floor((cx - EXTENT.minX) / tile);
    const tj = Math.floor((cz - EXTENT.minZ) / tile);
    const key = `${far ? "Far_" : ""}${ti < 0 ? `m${-ti}` : ti}_${tj < 0 ? `m${-tj}` : tj}`;
    if (!tiles.has(key)) tiles.set(key, { mesh: new MeshData({ uvs: true, colors: true }), n: 0 });
    const t = tiles.get(key);
    const section = SECTION[cls === "commercial" ? "commercial" : "residential"];
    walls(t.mesh, part.outer, true, base, top, storeys, section, color);
    for (const hole of part.holes ?? []) walls(t.mesh, hole, false, base, top, storeys, section, color);
    const first = t.mesh.vertexCount;
    t.mesh.horizontalPolygon(part.outer, part.holes ?? [], top, { color: roof });
    for (let v = first; v < t.mesh.vertexCount; v += 1) t.mesh.uvs.splice(v * 2, 2, SECTION.roof + 1 / 6, 0.5);
    t.n += 1;
  }
  const texture = glb.addTexture(contextTexture(), "image/png", { repeat: true });
  const material = glb.addMaterial({
    name: "Context_Building",
    pbrMetallicRoughness: { baseColorTexture: { index: texture }, baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.9 },
  });
  let triangles = 0;
  for (const [key, t] of [...tiles].sort(([a], [b]) => a.localeCompare(b))) {
    // far tiles: Context_Far_<i>_<j>, which CityModel keeps from casting shadows (NON_CASTER_PARENT_PATTERN)
    const name = key.startsWith("Far_") ? `Context_${key}` : `Context_Buildings_${key}`;
    triangles += t.mesh.indices.length / 3;
    glb.addNode({ name, mesh: glb.addMesh(name, [t.mesh.toPrimitive(material)]),
      extras: { context: true, selectable: false, buildings: t.n, heightsNote: "GIS heights or floors x storey median, else one storey (추정)" } }, { root: true });
  }
  const stats = { buildings: parts.length, far: beyondReach, tiles: tiles.size, triangles, counts, tallestM: Number(tallest.toFixed(1)) };
  console.log(`context: ${stats.buildings} off-campus masses in ${stats.tiles} tile primitives (${TILE_M} m, 1 material), ${triangles} triangles; ` +
    `residential ${counts.residential}, commercial ${counts.commercial}, other ${counts.other}; tallest ${stats.tallestM} m (estimated heights, 추정); ${beyondReach} of them farther than ${CONTEXT_REACH} units in Context_Far_* tiles (no shadow casting)`);
  return stats;
}
