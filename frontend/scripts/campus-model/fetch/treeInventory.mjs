// Tree inventory: every tree crown on the NGII 2025 orthophoto over EXTENT, with an estimated height, crown diameter
// and species type -> data/trees.json (read by stages/trees.mjs). Offline: the NGII sheet in .cache/ngii-ortho/ (D2,
// never committed), data/chm.png (CHMv2) and data/photo/tree-species.json (species groups read on the SCNU 360 VR tour).
//
//   bun scripts/campus-model/fetch/treeInventory.mjs [--debug <dir>]
//
// Method (all values estimates, 추정):
//   1. A 0.5 m grid in EPSG:5186 over EXTENT; each cell takes the mean of its 2 x 2 sheet pixels and the CHMv2 height
//      under it.
//   2. Canopy: green cells (excess green 2g - r - b over the chroma sum >= CANOPY_EXG) that are textured (luma standard
//      deviation over 2.5 m >= CANOPY_TEXTURE; mown lawn is smooth) or stand on CHMv2 canopy (>= 3 m), plus dark
//      cells (crown shade, luma < SHADE_LUMA) inside 1.5 m of such canopy with CHMv2 >= 3 m.
//   3. Tree tops: local maxima of a crown surface (CHMv2 smoothed at 1.2 m plus 1.5 x the distance to the canopy
//      edge, capped at 4 m) within a window that grows with the local height (1.5-4 m); maxima closer than the window
//      to a higher one are dropped.
//   4. Crowns: canopy cells go to the tree top they reach first in a geodesic flood inside the canopy (at most
//      CROWN_MAX_M from it); a crown's position is the centroid of its cells and its diameter the equal-area circle.
//      Crowns under MIN_CROWN_M2 are dropped.
//   5. Height: the CHMv2 maximum over the crown; where CHMv2 shows no canopy (a tree younger than the 2016 imagery
//      behind CHMv2, or one it missed) 1.5 + 2.2 x the crown radius (ASSUMED allometry), 3-14 m.
//   6. Relief lean: a crown in the photo is displaced by the lean field of the registration study (as roofs are) at
//      0.6 x its height; the crown is moved back by that amount.
//   7. Species: the first VR group (data/photo/tree-species.json) whose polygon holds the crown; otherwise columnar
//      crowns (height / diameter >= COLUMNAR_RATIO, height >= 9 m) are columnar conifers, dark blue-green crowns
//      (photo tone) are pines, the rest broadleaf deciduous. Hedges are not crowns: they are the clipped volumes of the
//      planter outlines (stages/trees.mjs).
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sceneToTm, tmToPixel, tmToScene, tmToWgs84, wgs84ToTm } from "../../../src/geo/epsg5186.mjs";
import { EXTENT, SCENE_UNITS_PER_METRE as U, geoToModel } from "../lib/frame.mjs";
import { CHM_GEOREF } from "../lib/landcover.mjs";
import { openSheet } from "../lib/ngiiSheet.mjs";
import { decodePng, encodePng } from "../lib/png.mjs";
import { CACHE, DATA } from "./common.mjs";

const CELL = 0.5;
const EARTH = 6378137;
const CANOPY_EXG = 0.035;
const CANOPY_EXG_ABS = 12;
const CANOPY_TEXTURE = 9;
const CANOPY_TEXTURE_CHM = 6;
const SHADE_LUMA = 55;
const CROWN_MAX_M = 7.5;
const MIN_CROWN_M2 = 8;
const COLUMNAR_RATIO = 1.8;
const COLUMNAR_MIN_M = 12;
const MAX_CROWN_LUMA = 145;
const MAX_ELONGATION = 2.8;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(HERE, "../../../public");
const STATIONS = path.resolve(HERE, "../../perf/vr-stations.json");
const PYTHON = ["uv", "run", "--no-project", "--with", "numpy==2.5.4", "--with", "pillow==11.3.0", "python", "-I"];
// VR colour classes and the photo-tone fallback (fitted by eye on the VR faces and the NGII sheet, ASSUMED).
const VR_DARK_V = 0.45;
const NEIGHBOUR_M = 9;
const STREET_EDGE_M = 6;
const ROAD_ZONES = path.resolve(HERE, "../../../../docs/assets/data/road_zones_wgs84.geojson");
const PINE_LUMA = 85;
const PINE_BLUE_RED = 0.05;
const SPECIES = ["ginkgo", "broadleaf", "pine", "metasequoia", "conifer"];
// Relief lean of the NGII mosaic (registration study, lean_field_m_per_m_height; as fetch/buildingForms.mjs).
const LEAN_FIELD = { E: [-0.02, -0.01285, -0.00121], N: [-0.0549, -0.01201, -0.06335], E0N0: [243835.0182316025, 263760.97123001737] };

const args = process.argv.slice(2);
const debugDir = args.includes("--debug") ? args[args.indexOf("--debug") + 1] : null;

// ---- grid over EXTENT in EPSG:5186 (north-up)
const corners = [[EXTENT.minX, EXTENT.minZ], [EXTENT.maxX, EXTENT.minZ], [EXTENT.minX, EXTENT.maxZ], [EXTENT.maxX, EXTENT.maxZ]].map(([x, z]) => sceneToTm(x, z));
const E0 = Math.floor(Math.min(...corners.map((c) => c[0])));
const N1 = Math.ceil(Math.max(...corners.map((c) => c[1])));
const W = Math.ceil((Math.max(...corners.map((c) => c[0])) - E0) / CELL);
const H = Math.ceil((N1 - Math.min(...corners.map((c) => c[1]))) / CELL);
const cellE = (i) => E0 + (i + 0.5) * CELL;
const cellN = (j) => N1 - (j + 0.5) * CELL;
const N = W * H;

// ---- photo: 2 x 2 sheet pixels per cell
const sheet = openSheet();
const [col0f, row0f] = tmToPixel(E0, N1, sheet.tfw);
const col0 = Math.round(col0f);
const row0 = Math.round(row0f);
const ppc = Math.round(CELL / Math.abs(sheet.tfw.a));
const raw = sheet.readWindow(col0, row0, W * ppc, H * ppc);
sheet.close();
const R = new Float32Array(N);
const G = new Float32Array(N);
const B = new Float32Array(N);
for (let j = 0; j < H; j += 1) {
  for (let i = 0; i < W; i += 1) {
    let r = 0, g = 0, b = 0;
    for (let dy = 0; dy < ppc; dy += 1) for (let dx = 0; dx < ppc; dx += 1) {
      const p = ((j * ppc + dy) * W * ppc + i * ppc + dx) * 3;
      r += raw[p]; g += raw[p + 1]; b += raw[p + 2];
    }
    const k = j * W + i;
    R[k] = r / (ppc * ppc); G[k] = g / (ppc * ppc); B[k] = b / (ppc * ppc);
  }
}

// ---- CHMv2 per cell (EPSG:3857 grid of data/chm.png)
const chm = decodePng(readFileSync(path.join(DATA, "chm.png")));
const CHM = new Float32Array(N);
{
  for (let j = 0; j < H; j += 1) {
    for (let i = 0; i < W; i += 1) {
      const [lon, lat] = tmToWgs84(cellE(i), cellN(j));
      const mx = (lon * Math.PI * EARTH) / 180;
      const my = EARTH * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
      const px = Math.floor((mx - CHM_GEOREF.originX) / CHM_GEOREF.pixelSize);
      const py = Math.floor((CHM_GEOREF.originY - my) / CHM_GEOREF.pixelSize);
      CHM[j * W + i] = px >= 0 && py >= 0 && px < chm.width && py < chm.height ? chm.pixels[py * chm.width + px] : 0;
    }
  }
}

// ---- helpers
function boxBlur(src, radius) {
  const tmp = new Float32Array(N);
  const out = new Float32Array(N);
  for (let j = 0; j < H; j += 1) {
    let acc = 0;
    for (let i = -radius; i <= radius; i += 1) acc += src[j * W + Math.min(W - 1, Math.max(0, i))];
    for (let i = 0; i < W; i += 1) {
      tmp[j * W + i] = acc / (2 * radius + 1);
      acc += src[j * W + Math.min(W - 1, i + radius + 1)] - src[j * W + Math.max(0, i - radius)];
    }
  }
  for (let i = 0; i < W; i += 1) {
    let acc = 0;
    for (let j = -radius; j <= radius; j += 1) acc += tmp[Math.min(H - 1, Math.max(0, j)) * W + i];
    for (let j = 0; j < H; j += 1) {
      out[j * W + i] = acc / (2 * radius + 1);
      acc += tmp[Math.min(H - 1, j + radius + 1) * W + i] - tmp[Math.max(0, j - radius) * W + i];
    }
  }
  return out;
}
const gauss = (src, sigmaM) => {
  const r = Math.max(1, Math.round((sigmaM / CELL) * 0.9));
  return boxBlur(boxBlur(boxBlur(src, r), r), r);
};
// Chamfer distance (metres) to the nearest cell outside `mask`.
function distanceInside(mask) {
  const d = new Float32Array(N);
  const INF = 1e9;
  for (let k = 0; k < N; k += 1) d[k] = mask[k] ? INF : 0;
  const a = CELL;
  const b = CELL * Math.SQRT2;
  for (let j = 0; j < H; j += 1) for (let i = 0; i < W; i += 1) {
    const k = j * W + i;
    if (!d[k]) continue;
    let v = d[k];
    if (i > 0) v = Math.min(v, d[k - 1] + a);
    if (j > 0) v = Math.min(v, d[k - W] + a);
    if (i > 0 && j > 0) v = Math.min(v, d[k - W - 1] + b);
    if (i + 1 < W && j > 0) v = Math.min(v, d[k - W + 1] + b);
    d[k] = v;
  }
  for (let j = H - 1; j >= 0; j -= 1) for (let i = W - 1; i >= 0; i -= 1) {
    const k = j * W + i;
    if (!d[k]) continue;
    let v = d[k];
    if (i + 1 < W) v = Math.min(v, d[k + 1] + a);
    if (j + 1 < H) v = Math.min(v, d[k + W] + a);
    if (i + 1 < W && j + 1 < H) v = Math.min(v, d[k + W + 1] + b);
    if (i > 0 && j + 1 < H) v = Math.min(v, d[k + W - 1] + b);
    d[k] = v;
  }
  return d;
}

// ---- canopy mask
const luma = new Float32Array(N);
const exg = new Float32Array(N);
for (let k = 0; k < N; k += 1) {
  luma[k] = 0.299 * R[k] + 0.587 * G[k] + 0.114 * B[k];
  const s = R[k] + G[k] + B[k] + 1e-6;
  exg[k] = (2 * G[k] - R[k] - B[k]) / s;
}
const texture = (() => {
  const m = boxBlur(luma, 2);
  const sq = boxBlur(luma.map((v) => v * v), 2);
  return m.map((v, k) => Math.sqrt(Math.max(0, sq[k] - v * v)));
})();
// MCEE level-3 land cover (KOGL Type 1, the cache of fetch/landcover.mjs): forest type (311 broadleaf, 321 conifer,
// 331 mixed) per cell, and sports grounds (622) and water (711, 712), where no crown is kept.
const MCEE = new Uint16Array(N);
{
  const files = readdirSync(path.join(CACHE, "mcee")).filter((f) => f.endsWith(".json"));
  const WANT = new Set(["311", "321", "331", "622", "711", "712"]);
  for (const f of files) {
    for (const { geometry, properties } of JSON.parse(readFileSync(path.join(CACHE, "mcee", f), "utf8")).features) {
      if (!geometry || !WANT.has(String(properties.l3_code))) continue;
      const polygons = geometry.type === "MultiPolygon" ? geometry.coordinates : [geometry.coordinates];
      for (const rings of polygons) {
        const tm = rings.map((ring) => ring.map(([mx, my]) => wgs84ToTm((mx / EARTH) * (180 / Math.PI), (2 * Math.atan(Math.exp(my / EARTH)) - Math.PI / 2) * (180 / Math.PI))));
        const ys = tm[0].map((p) => p[1]);
        const j0 = Math.max(0, Math.floor((N1 - Math.max(...ys)) / CELL));
        const j1 = Math.min(H - 1, Math.ceil((N1 - Math.min(...ys)) / CELL));
        for (let j = j0; j <= j1; j += 1) {
          const y = cellN(j);
          const xs = [];
          for (const ring of tm) {
            for (let a = 0, b = ring.length - 1; a < ring.length; b = a, a += 1) {
              const [xa, ya] = ring[a];
              const [xb, yb] = ring[b];
              if (ya > y !== yb > y) xs.push(xa + ((y - ya) * (xb - xa)) / (yb - ya));
            }
          }
          xs.sort((p, q) => p - q);
          for (let q = 0; q + 1 < xs.length; q += 2) {
            const i0 = Math.max(0, Math.ceil((xs[q] - E0) / CELL - 0.5));
            const i1 = Math.min(W - 1, Math.floor((xs[q + 1] - E0) / CELL - 0.5));
            for (let i = i0; i <= i1; i += 1) MCEE[j * W + i] = Number(properties.l3_code);
          }
        }
      }
    }
  }
}
const exgSmooth = gauss(exg, 0.5);
const exgAbs = gauss(Float32Array.from({ length: N }, (_, k) => 2 * G[k] - R[k] - B[k]), 0.5);
const canopy = new Uint8Array(N);
for (let k = 0; k < N; k += 1) {
  if (MCEE[k] === 622 || MCEE[k] === 711 || MCEE[k] === 712) continue;
  if (exgSmooth[k] >= CANOPY_EXG && exgAbs[k] >= CANOPY_EXG_ABS && G[k] >= R[k] && texture[k] >= (CHM[k] >= 3 ? CANOPY_TEXTURE_CHM : CANOPY_TEXTURE)) canopy[k] = 1;
}
{
  // crown shade next to canopy, where CHMv2 holds canopy
  const near = distanceInside(canopy.map((v) => 1 - v));
  for (let k = 0; k < N; k += 1) if (!canopy[k] && luma[k] < SHADE_LUMA && exgAbs[k] >= 4 && texture[k] >= CANOPY_TEXTURE_CHM && CHM[k] >= 3 && near[k] <= 1.5) canopy[k] = 2;
  // open by one cell: drop single-cell specks
  const keep = new Uint8Array(N);
  for (let j = 1; j < H - 1; j += 1) for (let i = 1; i < W - 1; i += 1) {
    const k = j * W + i;
    if (!canopy[k]) continue;
    let n = 0;
    for (const o of [-1, 1, -W, W, -W - 1, -W + 1, W - 1, W + 1]) if (canopy[k + o]) n += 1;
    if (n >= 4) keep[k] = canopy[k];
  }
  canopy.set(keep);
}

// ---- tree tops
const edge = distanceInside(canopy);
const chmSmooth = gauss(CHM, 1.2);
const surface = new Float32Array(N);
for (let k = 0; k < N; k += 1) surface[k] = canopy[k] ? chmSmooth[k] + 1.5 * Math.min(4, edge[k]) : -1;
const surfaceSmooth = gauss(surface, 0.8);
const heightGuess = (k) => Math.max(chmSmooth[k], 3 + 2 * Math.min(4, edge[k]));
const windowM = (k) => Math.min(5, Math.max(2.5, 1.5 + 0.18 * heightGuess(k)));
const tops = [];
for (let j = 0; j < H; j += 1) for (let i = 0; i < W; i += 1) {
  const k = j * W + i;
  if (!canopy[k] || edge[k] < 1) continue;
  const r = Math.round(windowM(k) / CELL);
  const v = surfaceSmooth[k];
  let isMax = true;
  for (let dj = -r; dj <= r && isMax; dj += 1) {
    const jj = j + dj;
    if (jj < 0 || jj >= H) continue;
    for (let di = -r; di <= r; di += 1) {
      const ii = i + di;
      if (ii < 0 || ii >= W || (di === 0 && dj === 0) || di * di + dj * dj > r * r) continue;
      const w = surfaceSmooth[jj * W + ii];
      if (w > v || (w === v && jj * W + ii < k)) { isMax = false; break; }
    }
  }
  if (isMax) tops.push(k);
}

// ---- crowns: geodesic flood from the tops inside the canopy (bucketed Dijkstra on 0.5 m steps)
const owner = new Int32Array(N).fill(-1);
const dist = new Float32Array(N).fill(Infinity);
{
  const buckets = [];
  const push = (k, d) => {
    const b = Math.round(d / (CELL / 2));
    (buckets[b] ??= []).push(k);
  };
  tops.forEach((k, t) => { owner[k] = t; dist[k] = 0; push(k, 0); });
  const steps = [[1, 0, CELL], [-1, 0, CELL], [0, 1, CELL], [0, -1, CELL], [1, 1, CELL * Math.SQRT2], [-1, 1, CELL * Math.SQRT2], [1, -1, CELL * Math.SQRT2], [-1, -1, CELL * Math.SQRT2]];
  for (let b = 0; b < buckets.length; b += 1) {
    for (const k of buckets[b] ?? []) {
      const d = dist[k];
      if (Math.round(d / (CELL / 2)) !== b) continue;
      const i = k % W;
      const j = (k - i) / W;
      for (const [di, dj, c] of steps) {
        const ii = i + di;
        const jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= W || jj >= H) continue;
        const n = jj * W + ii;
        const nd = d + c;
        if (!canopy[n] || nd > CROWN_MAX_M || nd >= dist[n]) continue;
        dist[n] = nd;
        owner[n] = owner[k];
        push(n, nd);
      }
    }
  }
}

// ---- per-crown statistics
const T = tops.length;
const acc = Array.from({ length: T }, () => ({ tex: 0, f311: 0, f321: 0, f331: 0, n: 0, e: 0, nn: 0, chm: 0, r: 0, g: 0, b: 0, lit: 0, sr: 0, sg: 0, sb: 0, see: 0, snn: 0, sen: 0 }));
for (let k = 0; k < N; k += 1) {
  const t = owner[k];
  if (t < 0) continue;
  const a = acc[t];
  const i = k % W;
  const j = (k - i) / W;
  const e = cellE(i);
  const n = cellN(j);
  a.n += 1; a.e += e; a.nn += n;
  if (MCEE[k] === 311) a.f311 += 1; else if (MCEE[k] === 321) a.f321 += 1; else if (MCEE[k] === 331) a.f331 += 1;
  a.see += e * e; a.snn += n * n; a.sen += e * n;
  a.chm = Math.max(a.chm, CHM[k]);
  if (luma[k] >= SHADE_LUMA) { a.lit += 1; a.sr += R[k]; a.sg += G[k]; a.sb += B[k]; }
  a.r += R[k]; a.g += G[k]; a.b += B[k];
  a.tex += texture[k];
}

// ---- crown records
const lean = (e, n, h) => {
  const de = (e - LEAN_FIELD.E0N0[0]) / 100;
  const dn = (n - LEAN_FIELD.E0N0[1]) / 100;
  return [h * (LEAN_FIELD.E[0] + LEAN_FIELD.E[1] * de + LEAN_FIELD.E[2] * dn), h * (LEAN_FIELD.N[0] + LEAN_FIELD.N[1] * de + LEAN_FIELD.N[2] * dn)];
};
const records = [];
let rejected = 0;
const toneByForest = { 311: [], 321: [], 331: [], none: [] };
for (let t = 0; t < T; t += 1) {
  const a = acc[t];
  const area = a.n * CELL * CELL;
  if (area < MIN_CROWN_M2) continue;
  const radius = Math.sqrt(area / Math.PI);
  const pe = a.e / a.n;
  const pn = a.nn / a.n;
  const chmSupported = a.chm >= 3;
  const height = chmSupported ? Math.min(30, a.chm) : Math.min(14, Math.max(3, 1.5 + 2.2 * radius));
  const [le, ln] = lean(pe, pn, 0.6 * height);
  // photo tone of the sunlit part (all cells when the crown is in shade)
  const lit = a.lit >= 4;
  const r = lit ? a.sr / a.lit : a.r / a.n;
  const g = lit ? a.sg / a.lit : a.g / a.n;
  const b = lit ? a.sb / a.lit : a.b / a.n;
  const luma0 = 0.299 * r + 0.587 * g + 0.114 * b;
  const blueRed = (b - r) / (r + g + b + 1e-6);
  // elongation (plan shape): ratio of the principal axes of the crown's cells
  const ce = a.see / a.n - pe * pe;
  const cn = a.snn / a.n - pn * pn;
  const cen = a.sen / a.n - pe * pn;
  const tr = ce + cn;
  const det = ce * cn - cen * cen;
  const l1 = tr / 2 + Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  const l2 = tr / 2 - Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  const elongation = Math.sqrt(l1 / Math.max(1e-6, l2));
  // painted green surfaces (roofs, courts) read as bright, elongated bands along their textured edges
  if (luma0 > MAX_CROWN_LUMA || elongation > MAX_ELONGATION) { rejected += 1; continue; }
  const forest = a.f321 > a.n / 2 ? 321 : a.f311 > a.n / 2 ? 311 : a.f331 > a.n / 2 ? 331 : null;
  toneByForest[forest ?? "none"].push([luma0, blueRed]);
  records.push({ e: pe - le, n: pn - ln, radius, height, chmSupported, luma: luma0, blueRed, elongation, texture: a.tex / a.n, forest });
}

// ---- VR tour colours (tree_vr.py): every crown seen from the 42 exterior stations, nearest views first
const sidecar = JSON.parse(readFileSync(path.join(PUBLIC, "campus-v2-height.json"), "utf8"));
const heights = new Uint16Array(readFileSync(path.join(PUBLIC, "campus-v2-height.bin")).buffer.slice(0));
const groundY = (x, z) => {
  const i = Math.min(sidecar.width - 1, Math.max(0, Math.round((x - sidecar.originX) / sidecar.step)));
  const j = Math.min(sidecar.height - 1, Math.max(0, Math.round((z - sidecar.originZ) / sidecar.step)));
  return sidecar.minY + heights[j * sidecar.width + i] * sidecar.scale;
};
const vrColours = (() => {
  const stations = JSON.parse(readFileSync(STATIONS, "utf8")).map((s) => {
    const x = s.station_refined_x ?? s.station_x;
    const z = s.station_refined_z ?? s.station_z;
    return { scene: s.scene, x, z, y: groundY(x, z) + (s.height_refined_m ?? s.height_m_est) * U, yaw: s.yaw_refined_deg ?? s.yaw_deg };
  });
  const buildings = JSON.parse(readFileSync(path.join(DATA, "gis-buildings.json"), "utf8")).buildings.flatMap((bld) => {
    const heightM = bld.heightMetres > 0 ? bld.heightMetres : (bld.floors || 2) * 3.8;
    return (bld.polygons ?? []).map((poly) => {
      const ring = poly[0].map(([lon, lat]) => geoToModel(lon, lat));
      const [cx, cz] = ring.reduce(([sx, sz], [x, z]) => [sx + x / ring.length, sz + z / ring.length], [0, 0]);
      return { ring, topY: groundY(cx, cz) + heightM * U };
    });
  });
  const crownsIn = records.map((c) => {
    const [x, z] = tmToScene(c.e, c.n);
    const gy = groundY(x, z);
    return [x, z, gy, gy + 0.3 * c.height * U, gy + c.height * U, c.radius * U];
  });
  const dir = mkdtempSync(path.join(tmpdir(), "tree-vr-"));
  try {
    writeFileSync(path.join(dir, "in.json"), JSON.stringify({ crowns: crownsIn, stations, buildings, vr: path.join(CACHE, "vr") }));
    execFileSync(PYTHON[0], [...PYTHON.slice(1), path.join(HERE, "tree_vr.py"), path.join(dir, "in.json"), path.join(dir, "out.json")], { stdio: ["ignore", "inherit", "inherit"] });
    return JSON.parse(readFileSync(path.join(dir, "out.json"), "utf8"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
})();

// ---- species
const groupsFile = JSON.parse(readFileSync(path.join(DATA, "photo", "tree-species.json"), "utf8"));
const groups = groupsFile.groups.map((g) => ({ ...g, ring: g.polygon.map(([lon, lat]) => wgs84ToTm(lon, lat)) }));
const inRing = ([x, y], ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
// VR crown colour class (sRGB median): yellow (ginkgo, metasequoia turning), warm (zelkova russet, cherry red),
// dark (evergreen: pines, junipers), green (broadleaf not yet turning); grey or blue samples (sky, facades) count as unseen.
function vrClass([views, r, g, b]) {
  if (!views) return null;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const v = max / 255;
  const s = max ? (max - min) / max : 0;
  let hue = 0;
  if (max !== min) {
    if (max === r) hue = (60 * ((g - b) / (max - min)) + 360) % 360;
    else if (max === g) hue = 60 * ((b - r) / (max - min)) + 120;
    else hue = 60 * ((r - g) / (max - min)) + 240;
  }
  // sky, facades and paving where a view misses the crown: grey, or blue
  if (s < 0.2 || (hue > 170 && hue < 330)) return null;
  if (v < VR_DARK_V && hue >= 70) return "dark";
  if (s >= 0.3 && (hue < 38 || hue >= 330)) return "warm";
  if (s >= 0.35 && hue >= 38 && hue < 68 && v >= 0.4) return "yellow";
  if (hue >= 38) return "green";
  return null;
}
// Street edge: crowns within STREET_EDGE_M of a measured road zone outline (docs/assets/data/road_zones_wgs84.geojson).
const roadEdges = JSON.parse(readFileSync(ROAD_ZONES, "utf8")).features.flatMap(({ geometry }) => {
  const polygons = geometry.type === "MultiPolygon" ? geometry.coordinates : [geometry.coordinates];
  return polygons.flatMap((rings) => rings.flatMap((ring) => ring.slice(1).map((p, i) => [wgs84ToTm(...ring[i]), wgs84ToTm(...p)])));
});
const segDist = ([px, py], [[ax, ay], [bx, by]]) => {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
};
const own = records.map((c, k) => vrClass(vrColours[k]));
const vrWeight = (k) => Math.min(3, vrColours[k][0]);
// Neighbour votes: crowns of one row or stand share a species, and one VR view of a single crown can miss it (station
// positions are estimates), so each crown takes the weighted majority of the VR classes within NEIGHBOUR_M.
const cellOf = (c) => `${Math.floor(c.e / 25)},${Math.floor(c.n / 25)}`;
const buckets = new Map();
records.forEach((c, k) => {
  const key = cellOf(c);
  if (!buckets.has(key)) buckets.set(key, []);
  buckets.get(key).push(k);
});
const neighbours = (c, radius) => {
  const out = [];
  const [bx, by] = [Math.floor(c.e / 25), Math.floor(c.n / 25)];
  for (let dx = -1; dx <= 1; dx += 1) for (let dy = -1; dy <= 1; dy += 1) {
    for (const k of buckets.get(`${bx + dx},${by + dy}`) ?? []) if (Math.hypot(records[k].e - c.e, records[k].n - c.n) <= radius) out.push(k);
  }
  return out;
};
const crowns = [];
const counts = Object.fromEntries(SPECIES.map((s) => [s, 0]));
const sources = {};
const vrClasses = { yellow: 0, warm: 0, dark: 0, green: 0, unseen: 0 };
records.forEach((c, k) => {
  const ratio = c.height / (2 * c.radius);
  const vr = own[k];
  vrClasses[vr ?? "unseen"] += 1;
  const votes = { yellow: 0, warm: 0, dark: 0, green: 0 };
  for (const n of neighbours(c, NEIGHBOUR_M)) if (own[n]) votes[own[n]] += vrWeight(n) * (n === k ? 2 : 1);
  const voted = Object.entries(votes).sort((p, q) => q[1] - p[1]).find(([, v]) => v >= 2)?.[0] ?? null;
  const street = c.forest === null && roadEdges.some((s) => segDist([c.e, c.n], s) <= STREET_EDGE_M);
  const group = groups.find((gr) => inRing([c.e, c.n], gr.ring));
  let species;
  let source;
  if (group && !(group.exceptVr ?? []).includes(vr)) {
    species = group.species;
    source = `vr-group:${group.id}`;
  } else if (voted === "yellow") {
    species = c.height >= COLUMNAR_MIN_M && ratio >= COLUMNAR_RATIO ? "metasequoia" : "ginkgo";
    source = "vr-colour:yellow";
  } else if (voted === "dark") {
    species = c.height >= 6 && ratio >= COLUMNAR_RATIO ? "conifer" : "pine";
    source = "vr-colour:dark";
  } else if (voted === "warm") {
    species = "broadleaf";
    source = "vr-colour:warm";
  } else if (street && voted === "green" && votes.yellow > 0) {
    species = "ginkgo";
    source = "vr-colour:street-row";
  } else if (c.forest === 321) {
    species = "pine";
    source = "mcee:321";
  } else if (c.forest === 311 || c.forest === 331) {
    species = c.luma < PINE_LUMA && c.blueRed < PINE_BLUE_RED ? "pine" : "broadleaf";
    source = `mcee:${c.forest}`;
  } else if (voted === "green") {
    species = c.height >= COLUMNAR_MIN_M && ratio >= COLUMNAR_RATIO ? "metasequoia" : "broadleaf";
    source = "vr-colour:green";
  } else if (c.luma < PINE_LUMA && c.blueRed < PINE_BLUE_RED) {
    species = "pine";
    source = "photo:dark-olive";
  } else {
    species = "broadleaf";
    source = "default:broadleaf";
  }
  counts[species] += 1;
  const kind = source.split(":")[0];
  sources[kind] = (sources[kind] ?? 0) + 1;
  crowns.push([
    Math.round(c.e * 100) / 100,
    Math.round(c.n * 100) / 100,
    Math.round(2 * c.radius * 10) / 10,
    Math.round(c.height * 10) / 10,
    SPECIES.indexOf(species),
    c.chmSupported ? 1 : 0,
    source,
    vrColours[k][0],
    Math.round(c.luma),
    Math.round(c.blueRed * 1000) / 1000,
  ]);
});

const out = {
  description: "Tree crowns over the campus model EXTENT, traced on the NGII 2025 orthophoto (sheet 34702020) with CHMv2 heights and species types read on the SCNU 360 VR tour; every value is an estimate (추정). Written by scripts/campus-model/fetch/treeInventory.mjs.",
  frame: "EPSG:5186 metres (east, north): trunk position after removing the photo's relief lean",
  species: SPECIES,
  columns: ["east", "north", "crownDiameterM", "heightM", "species", "heightFromChm", "speciesSource", "vrViews", "photoLuma", "photoBlueMinusRed"],
  method: {
    grid: `${CELL} m cells, 2 x 2 sheet pixels each`,
    canopy: `smoothed excess green >= ${CANOPY_EXG} (and 2g - r - b >= ${CANOPY_EXG_ABS}), g >= r, luma std over 2.5 m >= ${CANOPY_TEXTURE} (${CANOPY_TEXTURE_CHM} on CHMv2 canopy); crown shade (luma < ${SHADE_LUMA}) within 1.5 m on CHMv2 canopy; no crowns on MCEE sports grounds or water`,
    tops: "local maxima of CHMv2 (smoothed 1.2 m) + 1.5 x distance to the canopy edge (cap 4 m), window 2.5-5 m by height",
    crowns: `geodesic flood inside the canopy from the tops, at most ${CROWN_MAX_M} m; crowns under ${MIN_CROWN_M2} m2, brighter than luma ${MAX_CROWN_LUMA} or more elongated than ${MAX_ELONGATION} dropped; diameter of the equal-area circle`,
    height: "CHMv2 maximum over the crown; 1.5 + 2.2 x radius (3-14 m, ASSUMED) where CHMv2 has no canopy",
    lean: "position moved back by the registration lean field at 0.6 x height",
    species: `VR group polygon (data/photo/tree-species.json) first; else the weighted majority VR colour class of the crowns within ${NEIGHBOUR_M} m on the VR tour cube faces (tree_vr.py; yellow -> ginkgo, or metasequoia when columnar: height >= ${COLUMNAR_MIN_M} m and height / diameter >= ${COLUMNAR_RATIO}; warm -> broadleaf (zelkova/cherry); dark -> pine, or conifer when columnar; green -> broadleaf, or ginkgo on a street edge (within ${STREET_EDGE_M} m of a road zone) with a yellow neighbour); unseen crowns: MCEE forest type (321 conifer -> pine, 311 broadleaf), else photo tone (luma < ${PINE_LUMA} and (b - r) / sum < ${PINE_BLUE_RED} -> pine), else broadleaf`,
  },
  counts,
  speciesSources: sources,
  vrClasses,
  crowns,
};
writeFileSync(path.join(DATA, "trees.json"), `${JSON.stringify(out).replace(/\],\[/g, "],\n[")}\n`);
{
  const med = (list, c) => (list.length ? list.map((v) => v[c]).sort((p, q) => p - q)[Math.floor(list.length / 2)].toFixed(3) : "-");
  console.log(`trees: crown photo tone by MCEE forest type (median luma / (b - r)): ${Object.entries(toneByForest).map(([k, v]) => `${k} n=${v.length} ${med(v, 0)} / ${med(v, 1)}`).join("; ")}`);
}
console.log(`trees: ${tops.length} tops, ${rejected} bright or elongated regions dropped, ${crowns.length} crowns (${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(", ")}); VR colour ${JSON.stringify(vrClasses)}; sources ${JSON.stringify(sources)}; grid ${W} x ${H}`);

if (debugDir) {
  mkdirSync(debugDir, { recursive: true });
  // photo with canopy tint, crown borders and species-coloured tops
  const COLOURS = [[255, 220, 0], [255, 120, 40], [0, 90, 255], [255, 0, 200], [0, 255, 255]];
  const img = new Uint8Array(N * 3);
  for (let k = 0; k < N; k += 1) { img[k * 3] = R[k]; img[k * 3 + 1] = G[k]; img[k * 3 + 2] = B[k]; }
  writeFileSync(path.join(debugDir, "photo.png"), encodePng(W, H, 3, img));
  for (let k = 0; k < N; k += 1) {
    const i = k % W;
    if (owner[k] >= 0 && i + 1 < W && k + W < N && (owner[k + 1] !== owner[k] || owner[k + W] !== owner[k])) img.set([255, 255, 255], k * 3);
  }
  for (const c of crowns) {
    const i = Math.round((c[0] - E0) / CELL - 0.5);
    const j = Math.round((N1 - c[1]) / CELL - 0.5);
    for (let dj = -2; dj <= 2; dj += 1) for (let di = -2; di <= 2; di += 1) {
      const ii = i + di;
      const jj = j + dj;
      if (ii >= 0 && jj >= 0 && ii < W && jj < H) img.set(COLOURS[c[4]], (jj * W + ii) * 3);
    }
  }
  writeFileSync(path.join(debugDir, "crowns.png"), encodePng(W, H, 3, img));
  writeFileSync(path.join(debugDir, "grid.json"), JSON.stringify({ E0, N1, W, H, CELL }));
}
