// The planned 국립순천대 의과대학 campus at 조례동 (public/campus-med-site.glb, shown by src/medSite/MedSiteScene.jsx
// when the HUD switches to "의대 예정 부지"): SRTM terrain round the estimated site, graded building pads, the
// buildings of medCampus/plan.mjs in detail (storey spandrels, curtain-wall glass, vertical fins, rooftop plant, signs,
// helipad, sky bridges, canopies), roads, the green spine, low-poly trees and the drama-set village to the south-east.
// Scene units like campus-v2 (0.6242 per metre, +x east, +z south), x/z origin at the site centre; the lowest ground
// of the model sits at y = BASE_Y, above the dashboard's horizon skirt (lighting/HorizonSkirt.jsx, y = 9) like campus-v2.
// Everything but the terrain heights is an estimate (추정). Run: bun scripts/campus-model/med-campus.mjs [out.glb]
import { readFileSync, writeFileSync } from "node:fs";
import { GlbBuilder } from "./lib/glb.mjs";
import { metres } from "./lib/frame.mjs";
import { mulberry32 } from "./lib/raster.mjs";
import { signLetters } from "./lib/signLetters.mjs";
import { Kit, frame, local, rgb } from "./lib/solids.mjs";
import { BRIDGES, BUILDINGS, GREENS, PLAZAS, ROADS, SITE, pointInRing, siteRing } from "./medCampus/plan.mjs";

const M = metres;
const output = process.argv[2] ?? new URL("../../public/campus-med-site.glb", import.meta.url);
const grid = JSON.parse(readFileSync(new URL("./data/med-site/srtm30-grid.json", import.meta.url)));
const EXTENT_M = 450;
const LAT_M = 110950;
const LON_M = 111320 * Math.cos((SITE.centre.latitude * Math.PI) / 180);
const C = {
  forest: "#3f6b3a", forestDark: "#2f5530", lawn: "#6fae4f", lawnDark: "#5c9a43", earth: "#8b7a5c",
  asphalt: "#3b3f45", kerb: "#c9c6bd", lane: "#f2f2ee", paving: "#d8cdb8", pavingDark: "#b9ab92",
  white: "#f1f2ee", stone: "#d9d4c8", warmStone: "#cfc2ad", brick: "#a5523a", teal: "#1d8a8a", navy: "#173a6b",
  metal: "#9aa3ab", darkMetal: "#4d555c", roof: "#7d8388", greenRoof: "#5d9446", solar: "#1f3354", red: "#d8262c",
  yellow: "#f2c230", concrete: "#b7b5ae", trunk: "#6e4b32", pine: "#2e5b35", leaf: "#4f8f3f", leafLight: "#77b04f",
  tile: "#4a4f55", hanji: "#e8dcc0", timber: "#8a5a3a",
};
const GLASS = { hospital: "#7fb2c9", school: "#86a9c2", lab: "#8fb7c4", dorm: "#98b3c6", commons: "#7eaec6", parking: "#6f8796", plant: "#7f9aa8" };

// ------------------------------------------------------------------------------------------------ terrain
const toGeo = (x, z) => [SITE.centre.latitude - z / LAT_M, SITE.centre.longitude + x / LON_M];
function rawElevation(x, z) {
  const [lat, lon] = toGeo(x, z);
  const n = grid.N;
  const fr = Math.min(n - 1.0001, Math.max(0, ((lat - grid.lat0) / (grid.lat1 - grid.lat0)) * (n - 1)));
  const fc = Math.min(n - 1.0001, Math.max(0, ((lon - grid.lon0) / (grid.lon1 - grid.lon0)) * (n - 1)));
  const [r, c] = [Math.floor(fr), Math.floor(fc)];
  const [tr, tc] = [fr - r, fc - c];
  const e = (i, j) => grid.elev[i * n + j];
  return (e(r, c) * (1 - tc) + e(r, c + 1) * tc) * (1 - tr) + (e(r + 1, c) * (1 - tc) + e(r + 1, c + 1) * tc) * tr;
}
const ring = siteRing();
const smoothstep = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
function distanceToRing([x, z], r) {
  let best = Infinity;
  r.forEach((a, i) => {
    const b = r[(i + 1) % r.length];
    const [dx, dz] = [b[0] - a[0], b[1] - a[1]];
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz)));
    best = Math.min(best, Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t));
  });
  return best;
}
// Inside the site the hillside is eased (a 9-point average over +-40 m), fading in over 40 m from the boundary.
function easedElevation(x, z) {
  const raw = rawElevation(x, z);
  if (!pointInRing([x, z], ring)) return raw;
  let sum = 0;
  for (const dx of [-40, 0, 40]) for (const dz of [-40, 0, 40]) sum += rawElevation(x + dx, z + dz);
  return raw + (sum / 9 - raw) * smoothstep(distanceToRing([x, z], ring) / 40);
}
// Building pads: the footprint plus 8 m levelled at the mean eased ground under it, blending back over 22 m.
const PAD_MARGIN_M = 8;
const PAD_BLEND_M = 22;
const grounded = BUILDINGS.filter((b) => b.baseM === 0);
const pads = grounded.map((b) => {
  const xs = b.footprint.map((p) => p[0]);
  const zs = b.footprint.map((p) => p[1]);
  const box = [Math.min(...xs) - PAD_MARGIN_M, Math.min(...zs) - PAD_MARGIN_M, Math.max(...xs) + PAD_MARGIN_M, Math.max(...zs) + PAD_MARGIN_M];
  let sum = 0;
  for (let i = 0; i <= 4; i += 1) for (let j = 0; j <= 4; j += 1) sum += easedElevation(box[0] + ((box[2] - box[0]) * i) / 4, box[1] + ((box[3] - box[1]) * j) / 4);
  return { id: b.id, box, level: sum / 25 };
});
const padOf = (id) => pads.find((p) => p.id === id) ?? pads.find((p) => p.id === "hospital-podium");
const boxDistance = ([x0, z0, x1, z1], x, z) => Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(z0 - z, 0, z - z1));
function gradedElevation(x, z) {
  const eased = easedElevation(x, z);
  let best = null;
  for (const pad of pads) {
    const w = 1 - smoothstep(boxDistance(pad.box, x, z) / PAD_BLEND_M);
    if (w > 0 && (!best || w > best.w)) best = { w, level: pad.level };
  }
  return best ? eased + (best.level - eased) * best.w : eased;
}
const BASE_Y = 11.5;
let floorElevation = Infinity;
for (let x = -EXTENT_M; x <= EXTENT_M; x += 15) for (let z = -EXTENT_M; z <= EXTENT_M; z += 15) floorElevation = Math.min(floorElevation, gradedElevation(x, z));
const yOf = (elevationM) => BASE_Y + M(elevationM - floorElevation);
const groundY = (x, z) => yOf(gradedElevation(x, z));
const S = ([x, z]) => [M(x), M(z)];

const glb = new GlbBuilder();
glb.json.asset.extras = { site: SITE.address, areaM2: SITE.areaM2, origin: "site centre (estimated)", baseY: BASE_Y, baseElevationM: +floorElevation.toFixed(1), terrain: grid.source };
const painted = glb.addMaterial({ name: "MS_Painted", pbrMetallicRoughness: { metallicFactor: 0, roughnessFactor: 0.82 } });
const glassMaterial = glb.addMaterial({ name: "MS_Glass", pbrMetallicRoughness: { metallicFactor: 0.35, roughnessFactor: 0.12 } });
const terrainMaterial = glb.addMaterial({ name: "MS_Terrain", pbrMetallicRoughness: { metallicFactor: 0, roughnessFactor: 0.95 } });

function terrainMesh() {
  const step = 7.5;
  const n = Math.round((2 * EXTENT_M) / step) + 1;
  const random = mulberry32(11);
  const positions = [];
  const normals = [];
  const colors = [];
  const indices = [];
  const height = (x, z) => gradedElevation(x, z);
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      const x = -EXTENT_M + j * step;
      const z = -EXTENT_M + i * step;
      const h = height(x, z);
      positions.push(M(x), yOf(h), M(z));
      const nx = height(x - step, z) - height(x + step, z);
      const nz = height(x, z - step) - height(x, z + step);
      const l = Math.hypot(nx, 2 * step, nz);
      normals.push(nx / l, (2 * step) / l, nz / l);
      const inside = pointInRing([x, z], ring);
      const slope = Math.hypot(nx, nz) / (2 * step);
      const jitter = random();
      const base = inside ? (jitter < 0.5 ? C.lawn : C.lawnDark) : slope > 0.35 ? C.earth : jitter < 0.55 ? C.forest : C.forestDark;
      colors.push(...rgb(base));
    }
  }
  for (let i = 0; i + 1 < n; i += 1) {
    for (let j = 0; j + 1 < n; j += 1) {
      const a = i * n + j;
      indices.push(a, a + n, a + 1, a + 1, a + n, a + n + 1);
    }
  }
  return { positions: Float32Array.from(positions), normals: Float32Array.from(normals), colors: Uint8Array.from(colors), indices, material: terrainMaterial };
}

// ------------------------------------------------------------------------------------------------ draped surfaces
// A ribbon along a polyline (metres) widthM wide, liftM above the graded ground, sampled every stepM.
function ribbon(kit, line, widthM, liftM, paint, { closed = false, stepM = 3, offsetM = 0 } = {}) {
  const pts = closed ? [...line, line[0]] : line;
  for (let i = 0; i + 1 < pts.length; i += 1) {
    const [a, b] = [pts[i], pts[i + 1]];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const [ux, uz] = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    const [vx, vz] = [-uz, ux];
    const steps = Math.max(1, Math.ceil(len / stepM));
    for (let k = 0; k < steps; k += 1) {
      const at = (t, side) => {
        const x = a[0] + ux * len * t + vx * (offsetM + side * widthM / 2);
        const z = a[1] + uz * len * t + vz * (offsetM + side * widthM / 2);
        return [M(x), groundY(x, z) + M(liftM), M(z)];
      };
      const [t0, t1] = [k / steps, (k + 1) / steps];
      kit.face([at(t0, -1), at(t1, -1), at(t1, 1), at(t0, 1)], [0, 1, 0], paint);
    }
  }
}
// A draped rectangle or disc, subdivided every stepM.
function drapedRect(kit, rect, liftM, paint, stepM = 4) {
  const xs = rect.map((p) => p[0]);
  const zs = rect.map((p) => p[1]);
  const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  const nx = Math.ceil((x1 - x0) / stepM);
  const nz = Math.ceil((z1 - z0) / stepM);
  const at = (x, z) => [M(x), groundY(x, z) + M(liftM), M(z)];
  for (let i = 0; i < nx; i += 1) {
    for (let j = 0; j < nz; j += 1) {
      const [xa, xb] = [x0 + ((x1 - x0) * i) / nx, x0 + ((x1 - x0) * (i + 1)) / nx];
      const [za, zb] = [z0 + ((z1 - z0) * j) / nz, z0 + ((z1 - z0) * (j + 1)) / nz];
      kit.face([at(xa, za), at(xb, za), at(xb, zb), at(xa, zb)], [0, 1, 0], paint);
    }
  }
}
function drapedDisc(kit, [cx, cz], radiusM, liftM, paints, rings = 6, sides = 48) {
  const at = (r, a) => {
    const x = cx + r * Math.cos(a);
    const z = cz + r * Math.sin(a);
    return [M(x), groundY(x, z) + M(liftM), M(z)];
  };
  for (let k = 0; k < rings; k += 1) {
    const [r0, r1] = [(radiusM * k) / rings, (radiusM * (k + 1)) / rings];
    for (let s = 0; s < sides; s += 1) {
      const [a0, a1] = [(2 * Math.PI * s) / sides, (2 * Math.PI * (s + 1)) / sides];
      const quad = r0 === 0 ? [at(0, 0), at(r1, a0), at(r1, a1)] : [at(r0, a0), at(r1, a0), at(r1, a1), at(r0, a1)];
      kit.face(quad, [0, 1, 0], paints[k % paints.length]);
    }
  }
}

const landscape = new Kit();
for (const road of ROADS) {
  ribbon(landscape, road.line, road.widthM + 1.2, 0.18, rgb(C.kerb), { closed: road.closed });
  ribbon(landscape, road.line, road.widthM, 0.26, rgb(C.asphalt), { closed: road.closed });
  ribbon(landscape, road.line, 0.18, 0.3, rgb(C.lane), { closed: road.closed, stepM: 3 });
}
for (const plaza of PLAZAS) drapedDisc(landscape, plaza.centre, plaza.radiusM, 0.3, [rgb(C.paving), rgb(C.pavingDark)]);
for (const green of GREENS) drapedRect(landscape, green.ring, 0.22, rgb(C.lawn));
// paths: the spine walk and the 왕의산 trail loop on the north slope
ribbon(landscape, [[12, 100], [12, -40], [18, -77]], 6, 0.3, rgb(C.paving));
ribbon(landscape, [[-150, -175], [-60, -200], [60, -205], [150, -185], [205, -125]], 2.5, 0.3, rgb(C.earth), { stepM: 4 });

// ------------------------------------------------------------------------------------------------ trees (low poly)
const trees = new Kit();
function pine([x, z], heightM, random) {
  const g = groundY(x, z);
  trees.pole(S([x, z]), g - M(0.2), g + M(heightM * 0.3), 0.22, 0.18, rgb(C.trunk), { sides: 5, cap: false });
  const r = heightM * 0.26;
  const base = Array.from({ length: 7 }, (_, i) => {
    const a = (2 * Math.PI * (i + random())) / 7;
    return [M(x + Math.cos(a) * r), g + M(heightM * 0.25), M(z + Math.sin(a) * r)];
  });
  trees.cone([M(x), g + M(heightM), M(z)], base, rgb(random() < 0.5 ? C.pine : C.forestDark));
}
function broadleaf([x, z], heightM, random) {
  const g = groundY(x, z);
  trees.pole(S([x, z]), g - M(0.2), g + M(heightM * 0.45), 0.2, 0.15, rgb(C.trunk), { sides: 5, cap: false });
  const r = heightM * 0.33;
  const mid = g + M(heightM * 0.68);
  const crown = Array.from({ length: 6 }, (_, i) => {
    const a = (2 * Math.PI * (i + random() * 0.4)) / 6;
    return [M(x + Math.cos(a) * r), mid, M(z + Math.sin(a) * r)];
  });
  const paint = rgb(random() < 0.5 ? C.leaf : C.leafLight);
  trees.cone([M(x), g + M(heightM), M(z)], crown, paint, { base: false });
  trees.cone([M(x), g + M(heightM * 0.4), M(z)], crown, paint, { base: false });
}
const nearRoad = ([x, z], marginM) => ROADS.some((road) => {
  const pts = road.closed ? [...road.line, road.line[0]] : road.line;
  return pts.slice(1).some((b, i) => distanceToRing([x, z], [pts[i], b]) < road.widthM / 2 + marginM);
});
const onPad = ([x, z]) => pads.some((p) => boxDistance(p.box, x, z) < 4);
const dramaCentre = [(SITE.dramaSet.longitude - SITE.centre.longitude) * LON_M, (SITE.centre.latitude - SITE.dramaSet.latitude) * LAT_M];
const inDramaSet = ([x, z]) => Math.abs(x - dramaCentre[0]) < SITE.dramaSet.widthM / 2 + 10 && Math.abs(z - dramaCentre[1]) < SITE.dramaSet.depthM / 2 + 10;
{
  const random = mulberry32(2030);
  for (let x = -EXTENT_M + 6; x < EXTENT_M - 6; x += 15) {
    for (let z = -EXTENT_M + 6; z < EXTENT_M - 6; z += 15) {
      const p = [x + (random() - 0.5) * 10, z + (random() - 0.5) * 10];
      if (random() < 0.3 || pointInRing(p, ring) || distanceToRing(p, ring) < 6 || nearRoad(p, 3) || inDramaSet(p)) continue;
      (random() < 0.7 ? pine : broadleaf)(p, 9 + random() * 7, random);
    }
  }
  // campus planting: the spine avenues, the healing garden and the school court
  for (let z = -36; z <= 96; z += 9) for (const x of [-8, 32]) broadleaf([x, z], 8, random);
  for (let i = 0; i < 16; i += 1) broadleaf([-122 + (i % 8) * 9, 94 + Math.floor(i / 8) * 11], 6.5, random);
  for (let i = 0; i < 9; i += 1) broadleaf([58 + (i % 3) * 14, -24 + Math.floor(i / 3) * 12], 7, random);
  for (const p of ring) {
    const inward = [p[0] * 0.93, p[1] * 0.93];
    if (!nearRoad(inward, 3) && !onPad(inward)) pine(inward, 11, random);
  }
}

// ------------------------------------------------------------------------------------------------ buildings
const PALETTE = {
  podium: { spandrel: C.white, accent: C.teal, glass: GLASS.hospital, roof: C.greenRoof },
  "bed-tower": { spandrel: C.white, accent: C.teal, glass: GLASS.hospital, roof: C.roof },
  school: { spandrel: C.brick, accent: C.warmStone, glass: GLASS.school, roof: C.roof },
  commons: { spandrel: C.warmStone, accent: C.brick, glass: GLASS.commons, roof: C.greenRoof },
  lab: { spandrel: C.stone, accent: C.metal, glass: GLASS.lab, roof: C.roof },
  dorm: { spandrel: C.warmStone, accent: C.navy, glass: GLASS.dorm, roof: C.roof },
  parking: { spandrel: C.concrete, accent: C.leaf, glass: GLASS.parking, roof: C.concrete },
  plant: { spandrel: C.metal, accent: C.darkMetal, glass: GLASS.plant, roof: C.darkMetal },
};
// Stadium-shaped plan: two half circles joined along the long side (s along the long axis, t across).
const racetrack = ([cx, cz], [w, d], segments = 12) => {
  const r = Math.min(w, d) / 2;
  const half = (Math.max(w, d) - Math.min(w, d)) / 2;
  const pts = [];
  for (const [end, from] of [[1, -Math.PI / 2], [-1, Math.PI / 2]]) {
    for (let i = 0; i <= segments; i += 1) {
      const a = from + (Math.PI * i) / segments;
      const [s, t] = [end * half + r * Math.cos(a), r * Math.sin(a)];
      pts.push(d >= w ? [cx + t, cz + s] : [cx + s, cz + t]);
    }
  }
  return pts;
};
const planOf = (p) => [p[0], p[2]];
const offsetRing = (r, d) => {
  const n = r.length;
  let area = 0;
  r.forEach((a, i) => { const b = r[(i + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; });
  const sign = area > 0 ? 1 : -1;
  return r.map((p, i) => {
    const [a, b] = [r[(i - 1 + n) % n], r[(i + 1) % n]];
    const e1 = [p[0] - a[0], p[1] - a[1]];
    const e2 = [b[0] - p[0], b[1] - p[1]];
    const n1 = [e1[1] * sign, -e1[0] * sign].map((v) => v / Math.hypot(...e1));
    const n2 = [e2[1] * sign, -e2[0] * sign].map((v) => v / Math.hypot(...e2));
    const m = [n1[0] + n2[0], n1[1] + n2[1]];
    const k = d / Math.max(0.5, (m[0] * n1[0] + m[1] * n1[1]) / Math.hypot(...m)) / Math.hypot(...m);
    return [p[0] + m[0] * k, p[1] + m[1] * k];
  });
};
// Points every stepM along a closed ring with the outward normal there (metres).
function aroundRing(r, stepM) {
  const out = [];
  let area = 0;
  r.forEach((a, i) => { const b = r[(i + 1) % r.length]; area += a[0] * b[1] - b[0] * a[1]; });
  const sign = area > 0 ? 1 : -1;
  r.forEach((a, i) => {
    const b = r[(i + 1) % r.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const u = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    const n = [u[1] * sign, -u[0] * sign];
    for (let s = stepM / 2; s < len; s += stepM) out.push({ p: [a[0] + u[0] * s, a[1] + u[1] * s], u, n });
  });
  return out;
}

function letters(kit, f, text, lengthM, heightM, h0, t, paint) {
  for (const letter of signLetters(text, { lengthM, heightM })) {
    for (const { outer, holes } of letter.shapes) {
      const place = ([s, h]) => [s - lengthM / 2, h0 + h];
      kit.extrusion(f, outer.map(place), holes.map((rr) => rr.map(place)), t, paint);
    }
  }
}

function buildBuilding(b) {
  const solid = new Kit();
  const glass = new Kit();
  const pal = PALETTE[b.kind];
  const pad = padOf(b.id);
  const y0 = yOf(pad.level + b.baseM);
  const plan = b.shape === "racetrack" ? racetrack(b.centre, b.size) : b.footprint;
  const sceneRing = (r) => r.map(S);
  const top = y0 + M(b.storeys * b.floorM);
  // plinth down into the pad so the building never floats on the blend
  if (b.baseM === 0) solid.prism(sceneRing(offsetRing(plan, 0.3)), y0 - M(3), y0 + M(0.6), rgb(C.stone));
  glass.prism(sceneRing(offsetRing(plan, -0.25)), y0, top, rgb(pal.glass), { topFace: false });
  const spandrelM = b.kind === "parking" ? 1.1 : b.kind === "dorm" ? 1.2 : 0.95;
  for (let k = 0; k <= b.storeys; k += 1) {
    const yk = y0 + M(k * b.floorM);
    const h = k === 0 ? 0.6 : spandrelM;
    solid.prism(sceneRing(offsetRing(plan, 0.12)), yk - M(k === 0 ? 0 : 0.2), yk + M(h - (k === 0 ? 0 : 0.2)), rgb(k === b.storeys ? pal.accent : pal.spandrel), { topFace: k === b.storeys });
  }
  // vertical fins: sun-shading on the lab, slender mullions elsewhere, coloured accent fins on the wards
  const fin = b.kind === "lab" ? { step: 1.2, depth: 0.85, width: 0.14 } : b.kind === "parking" ? { step: 3.2, depth: 0.3, width: 0.35 } : { step: 1.6, depth: 0.38, width: 0.12 };
  aroundRing(plan, fin.step).forEach(({ p, u, n }, i) => {
    const f = frame([M(p[0]), y0, M(p[1])], u);
    const out = n[0] * f.v[0] + n[1] * f.v[1] > 0 ? 1 : -1;
    const accent = b.kind === "bed-tower" && i % 6 === 0;
    solid.box(f, [-fin.width / 2, fin.width / 2], out > 0 ? [0, fin.depth] : [-fin.depth, 0], [0.6, b.storeys * b.floorM], rgb(accent ? pal.accent : b.kind === "school" ? C.warmStone : C.metal));
  });
  // parapet and roof
  solid.prism(sceneRing(offsetRing(plan, 0.25)), top, top + M(1.2), rgb(pal.accent), { topFace: false });
  solid.prism(sceneRing(offsetRing(plan, -0.2)), top, top + M(0.35), rgb(pal.roof));
  // rooftop plant, solar arrays on the school and commons
  const [cx, cz] = b.centre;
  const [w, d] = b.size;
  const plantFrame = frame([M(cx), top, M(cz)], w >= d ? [1, 0] : [0, 1]);
  const [long, short] = [Math.max(w, d), Math.min(w, d)];
  if (b.kind !== "podium") {
    solid.box(plantFrame, [-long * 0.18, long * 0.18], [-short * 0.22, short * 0.22], [0.3, 4.2], { top: rgb(C.roof), side: rgb(C.metal) });
    for (let s = -long * 0.17; s <= long * 0.17; s += 1.2) solid.box(plantFrame, [s - 0.05, s + 0.05], [-short * 0.225, short * 0.225], [1, 3.8], rgb(C.darkMetal));
  }
  if (["school", "commons", "lab"].includes(b.kind)) {
    for (let s = -long / 2 + 4; s < -long * 0.22; s += 3.2) {
      for (const t of [-short * 0.3, short * 0.3]) {
        const tf = frame(local(plantFrame, s, t, 0.4), plantFrame.u);
        solid.hexa([local(tf, -1.2, -1.6, 0), local(tf, 1.2, -1.6, 0), local(tf, 1.2, 1.6, 0), local(tf, -1.2, 1.6, 0),
          local(tf, -1.2, -1.6, 0.4), local(tf, 1.2, -1.6, 0.4), local(tf, 1.2, 1.6, 1.4), local(tf, -1.2, 1.6, 1.4)], rgb(C.solar));
      }
    }
  }
  if (b.kind === "podium") {
    // green roof terraces between and round the wards, with paved paths
    solid.prism(sceneRing(offsetRing(plan, -3)), top + M(0.35), top + M(0.65), rgb(C.greenRoof));
    const f = frame([M(cx), top, M(cz)], [1, 0]);
    for (const t of [-20, 0, 20]) solid.box(f, [-w / 2 + 4, w / 2 - 4], [t - 1.2, t + 1.2], [0.6, 0.7], rgb(C.paving));
    // main drop-off canopy on the south face and the emergency canopy on the west
    const south = frame([M(cx + 10), y0, M(cz + d / 2)], [1, 0]);
    solid.box(south, [-24, 24], [0, 14], [7.2, 7.8], { top: rgb(C.white), side: rgb(C.teal) });
    for (const s of [-22, -11, 0, 11, 22]) solid.pole(planOf(local(south, s, 12, 0)), y0, y0 + M(7.2), 0.35, 0.35, rgb(C.white));
    const west = frame([M(cx - w / 2), y0, M(cz)], [0, 1]);
    solid.box(west, [-14, 14], [0, 16], [5.4, 6], { top: rgb(C.white), side: rgb(C.red) });
    for (const s of [-12, 12]) solid.pole(planOf(local(west, s, 14.5, 0)), y0, y0 + M(5.4), 0.3, 0.3, rgb(C.white));
    letters(solid, frame(local(west, 0, 16.05, 0), [0, 1]), "응급의료센터", 11, 0.5, 5.45, [0, 0.12], rgb(C.white));
  }
  if (b.kind === "bed-tower") {
    // crown band
    solid.prism(sceneRing(offsetRing(plan, 0.3)), top - M(0.2), top + M(3.2), rgb(C.white), { topFace: false });
    if (b.sign) {
      const east = frame([M(cx + w / 2 + 0.35), top, M(cz)], [0, -1]);
      letters(solid, east, b.sign, 30, 2.3, 0.45, [0, 0.35], rgb(C.navy));
      solid.box(east, [-20.4, -16.6], [0, 0.35], [0.1, 2.9], rgb(C.red));
      solid.box(east, [-19.9, -17.1], [0.35, 0.45], [1.25, 1.75], rgb(C.white));
      solid.box(east, [-18.75, -18.25], [0.35, 0.45], [0.6, 2.4], rgb(C.white));
    }
    if (b.helipad) {
      const deck = top + M(4.2);
      for (const [sx, sz] of [[-8, -8], [8, -8], [8, 8], [-8, 8]]) solid.pole(S([cx + sx, cz + sz]), top + M(0.3), deck, 0.3, 0.3, rgb(C.metal), { sides: 6 });
      solid.pole(S([cx, cz]), deck, deck + M(0.5), 11.5, 11.5, rgb(C.asphalt), { sides: 32 });
      solid.pole(S([cx, cz]), deck - M(0.05), deck + M(0.45), 12.2, 12.2, rgb(C.yellow), { sides: 32, cap: false });
      const hf = frame([M(cx), deck + M(0.5), M(cz)], [1, 0]);
      solid.box(hf, [-3.2, -2.2], [-4, 4], [0, 0.05], rgb(C.white));
      solid.box(hf, [2.2, 3.2], [-4, 4], [0, 0.05], rgb(C.white));
      solid.box(hf, [-2.2, 2.2], [-0.5, 0.5], [0, 0.05], rgb(C.white));
      for (let i = 0; i < 32; i += 1) {
        const a = (2 * Math.PI * i) / 32;
        const rf = frame([M(cx + 9 * Math.cos(a)), deck + M(0.5), M(cz + 9 * Math.sin(a))], [-Math.sin(a), Math.cos(a)]);
        solid.box(rf, [-0.8, 0.8], [-0.3, 0.3], [0, 0.05], rgb(C.yellow));
      }
    }
  }
  if (b.sign && b.kind === "school") {
    const south = frame([M(cx), y0, M(cz + d / 2 + 0.6)], [1, 0]);
    solid.box(south, [-18, 18], [0, 10], [6.4, 7], { top: rgb(C.white), side: rgb(C.brick) });
    for (const s of [-16, 16]) solid.pole(planOf(local(south, s, 9, 0)), y0, y0 + M(6.4), 0.3, 0.3, rgb(C.white));
    letters(solid, frame(local(south, 0, 10.05, 0), [1, 0]), b.sign, 26, 0.55, 6.45, [0, 0.12], rgb(C.white));
  }
  if (b.kind === "parking") {
    const f = frame([M(cx), y0, M(cz)], [1, 0]);
    for (let s = -w / 2 + 3; s < w / 2; s += 6) solid.box(f, [s - 1.2, s + 1.2], [d / 2 + 0.15, d / 2 + 0.35], [1, b.storeys * b.floorM], rgb(C.leaf));
  }
  if (b.kind === "plant") {
    for (const s of [-12, -6]) solid.pole(S([cx + s, cz - 4]), top, top + M(12), 1.1, 0.9, rgb(C.metal), { sides: 12 });
  }
  return glb.addNode({
    name: `MS_Building_${b.id}`,
    mesh: glb.addMesh(`MS_Building_${b.id}`, [solid.toPrimitive(painted), glass.toPrimitive(glassMaterial)]),
    extras: { name: b.name, storeys: b.storeys, floorHeightM: b.floorM, heightM: +b.heightM.toFixed(1), estimated: true },
  });
}

function bridges() {
  const solid = new Kit();
  const glass = new Kit();
  // a bridge end takes the pad of the building it meets (within 1.5 m of the footprint)
  const levelAt = ([x, z]) => {
    const footprintBox = (p) => [p.box[0] + PAD_MARGIN_M, p.box[1] + PAD_MARGIN_M, p.box[2] - PAD_MARGIN_M, p.box[3] - PAD_MARGIN_M];
    const owner = pads.find((p) => boxDistance(footprintBox(p), x, z) <= 1.5);
    return (owner ?? padOf("hospital-podium")).level;
  };
  for (const br of BRIDGES) {
    const [ya, yb] = [levelAt(br.a) + br.baseM, levelAt(br.b) + br.baseM];
    const a = [M(br.a[0]), yOf(ya + br.heightM / 2), M(br.a[1])];
    const b = [M(br.b[0]), yOf(yb + br.heightM / 2), M(br.b[1])];
    glass.beam(a, b, br.widthM, br.heightM, rgb(GLASS.hospital));
    for (const dy of [-br.heightM / 2 - 0.25, br.heightM / 2 + 0.2]) {
      solid.beam([a[0], a[1] + M(dy), a[2]], [b[0], b[1] + M(dy), b[2]], br.widthM + 0.4, 0.45, rgb(C.white));
    }
  }
  return glb.addNode({ name: "MS_Bridges", mesh: glb.addMesh("MS_Bridges", [solid.toPrimitive(painted), glass.toPrimitive(glassMaterial)]) });
}

// ------------------------------------------------------------------------------------------------ drama-set village
function dramaSet() {
  const kit = new Kit();
  const random = mulberry32(1960);
  const [dx, dz] = dramaCentre;
  const { widthM, depthM } = SITE.dramaSet;
  drapedRect(kit, [[dx - widthM / 2, dz - depthM / 2], [dx + widthM / 2, dz - depthM / 2], [dx + widthM / 2, dz + depthM / 2], [dx - widthM / 2, dz + depthM / 2]], 0.2, rgb(C.earth), 10);
  for (let x = dx - widthM / 2 + 10; x < dx + widthM / 2 - 8; x += 17) {
    for (let z = dz - depthM / 2 + 10; z < dz + depthM / 2 - 8; z += 15) {
      if (random() < 0.25) continue;
      const [w, d] = [7 + random() * 6, 6 + random() * 4];
      const storeys = random() < 0.3 ? 2 : 1;
      const g = groundY(x, z);
      const f = frame([M(x), g, M(z)], [1, 0]);
      const wallTop = storeys * 3;
      kit.box(f, [-w / 2, w / 2], [-d / 2, d / 2], [-0.5, wallTop], { top: rgb(C.hanji), side: rgb(random() < 0.5 ? C.hanji : C.timber) });
      const eave = [local(f, -w / 2 - 0.8, -d / 2 - 0.8, wallTop), local(f, w / 2 + 0.8, -d / 2 - 0.8, wallTop), local(f, w / 2 + 0.8, d / 2 + 0.8, wallTop), local(f, -w / 2 - 0.8, d / 2 + 0.8, wallTop)];
      kit.cone(local(f, 0, 0, wallTop + 2.6), eave, rgb(C.tile));
    }
  }
  return glb.addNode({ name: "MS_DramaSet", mesh: glb.addMesh("MS_DramaSet", [kit.toPrimitive(painted)]), extras: { name: "순천드라마촬영장 (OSM way 469956208; village massing illustrative, estimated)" } });
}

// ------------------------------------------------------------------------------------------------ assemble
const GROUPS = { podium: "MS_Hospital", "bed-tower": "MS_Hospital", school: "MS_School", commons: "MS_School", lab: "MS_Research", dorm: "MS_Dorms", parking: "MS_Parking", plant: "MS_Energy" };
const groups = new Map();
for (const b of BUILDINGS) {
  const name = GROUPS[b.kind];
  if (!groups.has(name)) groups.set(name, []);
  groups.get(name).push(buildBuilding(b));
}
const siteLine = new Kit();
ribbon(siteLine, ring, 0.6, 0.35, rgb(C.yellow), { closed: true, stepM: 6 });
glb.addNode({
  name: "MS_Site",
  extras: {
    title: "국립순천대학교 의과대학·부속병원 예정 부지 (배치는 계획 이론에 따른 추정)",
    site: `${SITE.address}, ${SITE.areaM2.toLocaleString("en-US")} m2`,
    plan: "scripts/campus-model/medCampus/plan.mjs (sources in its header)",
  },
  children: [
    glb.addNode({ name: "MS_Terrain", mesh: glb.addMesh("MS_Terrain", [terrainMesh()]) }),
    glb.addNode({ name: "MS_SiteBoundary", mesh: glb.addMesh("MS_SiteBoundary", [siteLine.toPrimitive(painted)]) }),
    glb.addNode({ name: "MS_Landscape", mesh: glb.addMesh("MS_Landscape", [landscape.toPrimitive(painted)]) }),
    glb.addNode({ name: "MS_Trees", mesh: glb.addMesh("MS_Trees", [trees.toPrimitive(painted)]) }),
    ...[...groups].map(([name, children]) => glb.addNode({ name, children })),
    bridges(),
    dramaSet(),
  ],
}, { root: true });
const bytes = glb.toBuffer();
writeFileSync(output, bytes);
console.log(`med-campus: ${BUILDINGS.length} buildings, ${BRIDGES.length} bridges, ${(bytes.byteLength / 1e6).toFixed(1)} MB -> ${output}`);
