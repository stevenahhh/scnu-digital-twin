#!/usr/bin/env bun
// Campus-wide asphalt scan (plan campus-ground-truth-redesign todo 13a): where the NGII orthophoto shows asphalt, does the
// model's ground map say road or lot? Reads the current data/ground/parcels.json and the occlusion masks on every run, so a
// parcel added or lost changes the report. The areas it lists are candidates: a dark roof, shade or water can read as asphalt,
// so each one is looked at by eye and then either gets a parcel or a written reason (data/ground/parcel-curation.json `add`,
// `notAsphalt`). No pixel leaves the caller; the report holds vectors and numbers.
//
//   bun scripts/campus-model/qa/asphaltScan.mjs [--out <dir>] [--parcels <file>] [--min-area 50] [--propose <file.json>]
//   Exits 1 when an area over the minimum has neither a road or lot parcel nor a reason, or a curated parcel's tier is not what the masks give. --propose writes traced rings for
//   the open areas: a starting point to check against the photo, not a record.
//
// Grid: { w, h, origin: [E, N] of the top-left corner, cellM }, cell (x, y) centred at (E0 + (x + 0.5) cellM, N0 - (y + 0.5) cellM).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

// Thresholds read from the sheet's own road zones (T0): the 2025 photo has a blue cast, so lit asphalt is grey with blue above
// red. Lawn has green above blue, roofs and courts leave the band, and shade darker than any lit road falls under MIN_LUMA.
export const ASPHALT_BAND = Object.freeze({ minLuma: 38, maxLuma: 125, minGreenBlue: -14, maxGreenBlue: 9, minRedBlue: -48, maxRedBlue: -6 });
export const CELL_PX = 4; // 1 m cells on the 0.25 m sheet
export const MIN_VISIBLE_PX = 8; // a cell with fewer unmasked pixels is unknown
export const OPEN_CELLS = 1; // a road narrower than 3 m is not looked for: at this width grey kerbs and paths read as asphalt
export const MIN_AREA_M2 = 50;
export const COVERED_SHARE = 0.8;
const CLOSE_CELLS = 2; // cars and paint inside a lot
const SOFT_REACH_CELLS = 4; // hidden cells this close to visible asphalt join a proposal
const SIMPLIFY_M = 0.7;

export function isAsphalt(r, g, b) {
  const luma = (r + g + b) / 3;
  const B = ASPHALT_BAND;
  return luma >= B.minLuma && luma <= B.maxLuma && g - b >= B.minGreenBlue && g - b <= B.maxGreenBlue && r - b >= B.minRedBlue && r - b <= B.maxRedBlue;
}

const median = (values) => {
  values.sort((a, b) => a - b);
  return values[values.length >> 1];
};

// win: { w, h, origin, gsdM, rgb }, mask: Uint8Array w * h (1 = hidden, lib/occlusion.mjs `any`).
export function cellGrid(win, mask, cellPx = CELL_PX) {
  if (win.rgb?.length !== win.w * win.h * 3) throw new Error(`asphaltScan: rgb must hold ${win.w * win.h * 3} bytes, has ${win.rgb?.length}`);
  if (mask?.length !== win.w * win.h) throw new Error(`asphaltScan: mask must hold ${win.w * win.h} cells, has ${mask?.length}`);
  const w = Math.floor(win.w / cellPx);
  const h = Math.floor(win.h / cellPx);
  const asphalt = new Uint8Array(w * h);
  const visible = new Uint8Array(w * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const [r, g, b] = [[], [], []];
      for (let j = 0; j < cellPx; j += 1) {
        for (let i = 0; i < cellPx; i += 1) {
          const k = (y * cellPx + j) * win.w + x * cellPx + i;
          if (mask[k]) continue;
          r.push(win.rgb[k * 3]);
          g.push(win.rgb[k * 3 + 1]);
          b.push(win.rgb[k * 3 + 2]);
        }
      }
      if (r.length < MIN_VISIBLE_PX) continue;
      visible[y * w + x] = 1;
      asphalt[y * w + x] = isAsphalt(median(r), median(g), median(b)) ? 1 : 0;
    }
  }
  return { w, h, origin: [...win.origin], cellM: win.gsdM * cellPx, asphalt, visible };
}

const discOffsets = (radius) => {
  const out = [];
  for (let dy = -radius; dy <= radius; dy += 1) for (let dx = -radius; dx <= radius; dx += 1) if (dx * dx + dy * dy <= radius * radius) out.push([dx, dy]);
  return out;
};
export function erodeCells(mask, w, h, radius) {
  const disc = discOffsets(radius);
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (!mask[y * w + x]) continue;
      out[y * w + x] = disc.every(([dx, dy]) => x + dx >= 0 && y + dy >= 0 && x + dx < w && y + dy < h && mask[(y + dy) * w + x + dx]) ? 1 : 0;
    }
  }
  return out;
}
export function dilateCells(mask, w, h, radius) {
  const disc = discOffsets(radius);
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (!mask[y * w + x]) continue;
      for (const [dx, dy] of disc) if (x + dx >= 0 && y + dy >= 0 && x + dx < w && y + dy < h) out[(y + dy) * w + x + dx] = 1;
    }
  }
  return out;
}
export const openCells = (mask, w, h, radius) => dilateCells(erodeCells(mask, w, h, radius), w, h, radius);
const closeCells = (mask, w, h, radius) => erodeCells(dilateCells(mask, w, h, radius), w, h, radius);

// Every cell centre inside rings (even-odd over [outer, ...holes]) -> visit(k).
function fillRings(grid, rings, visit) {
  const { w, h, origin: [E0, N0], cellM } = grid;
  const ys = rings.flat().map((p) => p[1]);
  const y0 = Math.max(0, Math.floor((N0 - Math.max(...ys)) / cellM) - 1);
  const y1 = Math.min(h - 1, Math.ceil((N0 - Math.min(...ys)) / cellM) + 1);
  for (let y = y0; y <= y1; y += 1) {
    const N = N0 - (y + 0.5) * cellM;
    const xs = [];
    for (const ring of rings) {
      for (let a = 0, b = ring.length - 1; a < ring.length; b = a, a += 1) {
        const [[xa, ya], [xb, yb]] = [ring[a], ring[b]];
        if ((ya > N) !== (yb > N)) xs.push(xa + ((N - ya) * (xb - xa)) / (yb - ya));
      }
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const x0 = Math.max(0, Math.ceil((xs[i] - E0) / cellM - 0.5));
      const x1 = Math.min(w - 1, Math.floor((xs[i + 1] - E0) / cellM - 0.5));
      for (let x = x0; x <= x1; x += 1) visit(y * w + x);
    }
  }
}

// Int32Array of the index of the topmost parcel at each cell (-1: natural ground): highest precedence, later record on a tie,
// the rule lib/parcels.mjs topParcelAt and the stages draw by.
export function rasterTop(parcels, grid) {
  const top = new Int32Array(grid.w * grid.h).fill(-1);
  const order = parcels.map((_, i) => i).sort((a, b) => parcels[a].precedence - parcels[b].precedence || a - b);
  for (const i of order) fillRings(grid, [parcels[i].ring, ...parcels[i].holes], (k) => { top[k] = i; });
  return top;
}

const drivable = (p) => p.class === "road" || p.class === "lot";
// a parcel the photo shows as asphalt: a concrete yard is drivable, but its grey does not count as asphalt covered
const coversAsphalt = (p) => drivable(p) && p.surface !== "concrete";

function checkReasons(notAsphalt) {
  for (const entry of notAsphalt) {
    if (!Array.isArray(entry.ring) || entry.ring.length < 3) throw new Error(`${entry.id}: notAsphalt needs a ring`);
    if (typeof entry.reason !== "string" || !entry.reason) throw new Error(`${entry.id}: notAsphalt needs a reason`);
  }
}

// Connected areas of asphalt cells on no road or lot parcel, largest first, the rings in notAsphalt cut out.
export function scanRegions(grid, parcels, { minAreaM2 = MIN_AREA_M2, notAsphalt = [] } = {}) {
  checkReasons(notAsphalt);
  const { w, h, origin: [E0, N0], cellM, asphalt } = grid;
  const top = rasterTop(parcels, grid);
  const cellArea = cellM * cellM;
  const explained = {};
  const reasonAt = new Int32Array(w * h).fill(-1);
  notAsphalt.forEach((entry, i) => fillRings(grid, [entry.ring], (k) => { reasonAt[k] = i; }));
  const open = new Uint8Array(w * h);
  let asphaltCells = 0;
  let coveredCells = 0;
  for (let k = 0; k < w * h; k += 1) {
    if (!asphalt[k]) continue;
    asphaltCells += 1;
    if (top[k] >= 0 && coversAsphalt(parcels[top[k]])) { coveredCells += 1; continue; }
    if (reasonAt[k] >= 0) {
      const id = notAsphalt[reasonAt[k]].id;
      explained[id] = (explained[id] ?? 0) + cellArea;
      continue;
    }
    open[k] = 1;
  }
  const seen = new Uint8Array(w * h);
  const regions = [];
  for (let start = 0; start < w * h; start += 1) {
    if (!open[start] || seen[start]) continue;
    const stack = [start];
    seen[start] = 1;
    const cells = [];
    const under = {};
    while (stack.length) {
      const k = stack.pop();
      cells.push(k);
      const key = top[k] >= 0 ? parcels[top[k]].class : "none";
      under[key] = (under[key] ?? 0) + cellArea;
      const x = k % w;
      for (const m of [x + 1 < w ? k + 1 : -1, x > 0 ? k - 1 : -1, k + w < w * h ? k + w : -1, k - w >= 0 ? k - w : -1]) {
        if (m >= 0 && open[m] && !seen[m]) { seen[m] = 1; stack.push(m); }
      }
    }
    if (cells.length * cellArea < minAreaM2) continue;
    const xs = cells.map((k) => k % w);
    const ys = cells.map((k) => Math.floor(k / w));
    const sum = (a) => a.reduce((s, v) => s + v, 0);
    regions.push({
      areaM2: cells.length * cellArea,
      centre: [Math.round(E0 + (sum(xs) / xs.length + 0.5) * cellM), Math.round(N0 - (sum(ys) / ys.length + 0.5) * cellM)],
      bbox: [E0 + Math.min(...xs) * cellM, N0 - (Math.max(...ys) + 1) * cellM, E0 + (Math.max(...xs) + 1) * cellM, N0 - Math.min(...ys) * cellM],
      under,
      cells,
    });
  }
  regions.sort((a, b) => b.areaM2 - a.areaM2);
  return { regions, explained, asphaltM2: asphaltCells * cellArea, coveredM2: coveredCells * cellArea };
}

// What became of each area of the scan without this todo's parcels. covered / reason: at most 20 % of it is left (the share
// alone decides; a small area with most of it left is not covered). open: more than that has neither.
export function baselineStatus(regions, grid, parcels, notAsphalt = [], minAreaM2 = MIN_AREA_M2) {
  checkReasons(notAsphalt);
  const top = rasterTop(parcels, grid);
  const reasonAt = new Int32Array(grid.w * grid.h).fill(-1);
  notAsphalt.forEach((entry, i) => fillRings(grid, [entry.ring], (k) => { reasonAt[k] = i; }));
  const cellArea = grid.cellM * grid.cellM;
  return regions.map((region) => {
    const by = new Map();
    const reasons = new Map();
    let left = 0;
    for (const k of region.cells) {
      const p = top[k] >= 0 ? parcels[top[k]] : null;
      if (p && coversAsphalt(p)) by.set(p.id, (by.get(p.id) ?? 0) + 1);
      else if (reasonAt[k] >= 0) reasons.set(reasonAt[k], (reasons.get(reasonAt[k]) ?? 0) + 1);
      else left += 1;
    }
    const covered = [...by.values()].reduce((s, v) => s + v, 0);
    const reasoned = [...reasons.values()].reduce((s, v) => s + v, 0);
    const leftM2 = left * cellArea;
    const closed = region.cells.length - left >= COVERED_SHARE * region.cells.length - 1e-9; // the float margin keeps exactly 20 % left closed
    const status = !closed || (covered === 0 && reasoned === 0) ? "open" : covered >= reasoned ? "covered" : "reason";
    const main = [...reasons.entries()].sort((a, b) => b[1] - a[1])[0];
    return {
      centre: region.centre, areaM2: region.areaM2, bbox: region.bbox, under: region.under, status, leftM2,
      by: [...by.entries()].sort((a, b) => b[1] - a[1]).filter(([, n]) => n >= 0.1 * covered).map(([id]) => id),
      ...(main ? { reasonId: notAsphalt[main[0]].id, reason: notAsphalt[main[0]].reason } : {}),
    };
  });
}

// ---------------------------------------------------------------- evidence tier of a curated parcel
// Design §2: T1 is what the photo shows outside the masks. Only edge with no road or lot beyond it can be read at all.
export const GRADE = Object.freeze({ measuredShare: 0.25, measuredLostM: 10, maskedArea: 0.25, t1Share: 0.5 });
const EDGE_STEP_M = 0.5;

// rings: outer rings. Callbacks take (E, N). Walks every edge: free when isDrivable is false 1 m outside the parcel;
// free edge is hidden with a mask within 0.75 m across it, else dark where unmasked shade leaves it unreadable.
export function edgeVisibility(rings, { isDrivable, hidden, dark }) {
  let [free, lost, shade] = [0, 0, 0];
  rings.forEach((ring) => {
    const twice = ring.reduce((a, [x, y], i) => { const [u, v] = ring[(i + 1) % ring.length]; return a + x * v - u * y; }, 0);
    const sign = twice > 0 ? 1 : -1;
    ring.forEach((a, i) => {
      const b = ring[(i + 1) % ring.length];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L === 0) return;
      const t = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
      const n = [t[1] * sign, -t[0] * sign];
      for (let s = EDGE_STEP_M / 2; s < L; s += EDGE_STEP_M) {
        const P = [a[0] + t[0] * s, a[1] + t[1] * s];
        if (isDrivable(P[0] + n[0], P[1] + n[1])) continue;
        free += EDGE_STEP_M;
        if ([-0.75, -0.25, 0.25, 0.75].some((d) => hidden(P[0] + n[0] * d, P[1] + n[1] * d))) lost += EDGE_STEP_M;
        else if (dark(P[0], P[1])) shade += EDGE_STEP_M;
      }
    });
  });
  return { freeM: free, hiddenM: lost, darkM: shade };
}

// The share of a parcel's cells with too few unmasked pixels to judge (grid.visible).
export function maskedShare(grid, rings) {
  let [cells, masked] = [0, 0];
  fillRings(grid, rings, (k) => { cells += 1; if (!grid.visible[k]) masked += 1; });
  return cells ? masked / cells : 0;
}

// Measured (T1, not estimated) needs the edge readable and the area outside the masks; T1 with estimated:true when the photo
// still shows at least half of the free edge; below that the outline is an estimate (T4).
export function gradeParcel({ freeM, hiddenM, darkM, maskedAreaShare }) {
  const lostM = hiddenM + darkM;
  const share = freeM ? lostM / freeM : 0;
  if ((share <= GRADE.measuredShare || lostM <= GRADE.measuredLostM) && maskedAreaShare <= GRADE.maskedArea) return { tier: "T1", estimated: false };
  return share <= GRADE.t1Share ? { tier: "T1", estimated: true } : { tier: "T4", estimated: true };
}

// ---------------------------------------------------------------- proposals
function cornerLoops(mask, w, h) {
  // directed edges with the cell on the left; corner key = y * (w + 1) + x
  const next = new Map();
  const add = (a, b) => next.set(a, [...(next.get(a) ?? []), b]);
  const c = (x, y) => y * (w + 1) + x;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (!mask[y * w + x]) continue;
      if (y === 0 || !mask[(y - 1) * w + x]) add(c(x + 1, y), c(x, y));
      if (y === h - 1 || !mask[(y + 1) * w + x]) add(c(x, y + 1), c(x + 1, y + 1));
      if (x === 0 || !mask[y * w + x - 1]) add(c(x, y), c(x, y + 1));
      if (x === w - 1 || !mask[y * w + x + 1]) add(c(x + 1, y + 1), c(x + 1, y));
    }
  }
  const loops = [];
  for (const start of [...next.keys()]) {
    while (next.get(start)?.length) {
      const loop = [start];
      let at = next.get(start).pop();
      while (at !== start) {
        loop.push(at);
        const list = next.get(at);
        at = list.pop();
      }
      loops.push(loop.map((k) => [k % (w + 1), Math.floor(k / (w + 1))]));
    }
  }
  return loops;
}

const shoelace = (ring) => Math.abs(ring.reduce((a, [x, y], i) => { const [u, v] = ring[(i + 1) % ring.length]; return a + x * v - u * y; }, 0)) / 2;

function simplify(points, tolerance) {
  const dist = ([x, y], [ax, ay], [bx, by]) => {
    const [dx, dy] = [bx - ax, by - ay];
    const len = Math.hypot(dx, dy) || 1;
    return Math.abs((x - ax) * dy - (y - ay) * dx) / len;
  };
  const walk = (lo, hi, keep) => {
    let worst = -1;
    let at = -1;
    for (let i = lo + 1; i < hi; i += 1) {
      const d = dist(points[i], points[lo], points[hi]);
      if (d > worst) { worst = d; at = i; }
    }
    if (worst > tolerance) { walk(lo, at, keep); keep.add(at); walk(at, hi, keep); }
  };
  // split a closed ring at the vertex farthest from the first
  let far = 1;
  points.forEach((p, i) => { if (Math.hypot(p[0] - points[0][0], p[1] - points[0][1]) > Math.hypot(points[far][0] - points[0][0], points[far][1] - points[0][1])) far = i; });
  const closed = [...points, points[0]];
  const keep = new Set([0, far]);
  const saved = points;
  points = closed;
  walk(0, far, keep);
  walk(far, closed.length - 1, keep);
  points = saved;
  return [...keep].filter((i) => i < saved.length).sort((a, b) => a - b).map((i) => saved[i]);
}

// grid + { soft: hidden cells that may be ground (crowns, shadows), hard: cells that are not ground (roofs), covered: cells
// already on road or lot } -> one traced ring per area of at least minAreaM2 off road and lot, largest first. Each carries
// hiddenEdgeShare: the share of its edge cells on or next to a hidden cell, where the edge is a guess.
export function proposeRings(grid, { soft, hard, covered, minAreaM2 = MIN_AREA_M2 }) {
  const { w, h, origin: [E0, N0], cellM, asphalt } = grid;
  const n = w * h;
  const base = new Uint8Array(n);
  for (let k = 0; k < n; k += 1) base[k] = asphalt[k] && !hard[k] ? 1 : 0;
  const reach = dilateCells(base, w, h, SOFT_REACH_CELLS);
  const candidate = new Uint8Array(n);
  for (let k = 0; k < n; k += 1) candidate[k] = base[k] || (soft[k] && reach[k] && !hard[k]) ? 1 : 0;
  const closed = closeCells(candidate, w, h, CLOSE_CELLS);
  for (let k = 0; k < n; k += 1) if (hard[k]) closed[k] = 0;
  const opened = openCells(closed, w, h, OPEN_CELLS);
  const out = [];
  const seen = new Uint8Array(n);
  for (let start = 0; start < n; start += 1) {
    if (!opened[start] || covered[start] || seen[start]) continue;
    const stack = [start];
    seen[start] = 1;
    const cells = [];
    while (stack.length) {
      const k = stack.pop();
      cells.push(k);
      const x = k % w;
      for (const m of [x + 1 < w ? k + 1 : -1, x > 0 ? k - 1 : -1, k + w < n ? k + w : -1, k - w >= 0 ? k - w : -1]) {
        if (m >= 0 && opened[m] && !covered[m] && !seen[m]) { seen[m] = 1; stack.push(m); }
      }
    }
    if (cells.length * cellM * cellM < minAreaM2) continue;
    const own = new Uint8Array(n);
    for (const k of cells) own[k] = 1;
    // keep a seam under the road or lot it opens onto
    const grown = dilateCells(own, w, h, 2);
    const mask = new Uint8Array(n);
    for (let k = 0; k < n; k += 1) mask[k] = own[k] || (grown[k] && opened[k] && covered[k]) ? 1 : 0;
    const loop = cornerLoops(mask, w, h).sort((a, b) => shoelace(b) - shoelace(a))[0];
    const ring = simplify(loop, SIMPLIFY_M / cellM).map(([x, y]) => [Math.round((E0 + x * cellM) * 100) / 100, Math.round((N0 - y * cellM) * 100) / 100]);
    let edge = 0;
    let hidden = 0;
    const near = dilateCells(soft, w, h, 1);
    for (let k = 0; k < n; k += 1) {
      if (!mask[k]) continue;
      const x = k % w;
      if ((x + 1 < w && mask[k + 1]) && (x > 0 && mask[k - 1]) && (k + w < n && mask[k + w]) && (k - w >= 0 && mask[k - w])) continue;
      edge += 1;
      if (near[k]) hidden += 1;
    }
    out.push({ ring, areaM2: shoelace(ring), hiddenEdgeShare: edge ? Math.round((hidden / edge) * 1000) / 1000 : 0 });
  }
  return out.sort((a, b) => b.areaM2 - a.areaM2);
}

// ---------------------------------------------------------------- CLI
function coarsen(mask, w, h, cellPx) {
  const [cw, ch] = [Math.floor(w / cellPx), Math.floor(h / cellPx)];
  const out = new Uint8Array(cw * ch);
  for (let y = 0; y < ch; y += 1) {
    for (let x = 0; x < cw; x += 1) {
      let count = 0;
      for (let j = 0; j < cellPx; j += 1) for (let i = 0; i < cellPx; i += 1) count += mask[(y * cellPx + j) * w + x * cellPx + i] ? 1 : 0;
      out[y * cw + x] = count * 2 >= cellPx * cellPx ? 1 : 0;
    }
  }
  return out;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
  const dataDir = path.join(HERE, "..", "data");
  const read = (file) => JSON.parse(readFileSync(path.join(dataDir, file), "utf8"));
  const { wgs84ToTm } = await import("../../../src/geo/epsg5186.mjs");
  const { openSheet, sheetWindowForTm } = await import("../lib/ngiiSheet.mjs");
  const { occlusionMask } = await import("../lib/occlusion.mjs");
  const parcelsFile = opt("--parcels", path.join(dataDir, "ground", "parcels.json"));
  const { parcels } = JSON.parse(readFileSync(parcelsFile, "utf8"));
  const curation = read("ground/parcel-curation.json");
  const minAreaM2 = Number(opt("--min-area", MIN_AREA_M2));
  const leans = new Map(read("photo/building-lean.json").buildings.map((b) => [b.id, b.lean]));
  const buildings = read("building-forms.json").buildings.flatMap((b) => b.masses.map((m) => ({
    rings: [m.outer, ...(m.holes ?? [])].map((r) => r.map(([lon, lat]) => wgs84ToTm(lon, lat))),
    heightM: m.topMetres, lean: leans.get(b.key) ?? b.leanPrior,
  })));
  const trees = read("trees.json").trees.map(([east, north, crownDiameterM, heightM]) => ({ east, north, crownDiameterM, heightM }));
  const campus = read("osm-campus.json").ring.map(([lon, lat]) => wgs84ToTm(lon, lat));
  const [E0, N0, E1, N1] = campus.reduce((b, [x, y]) => [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)], [Infinity, Infinity, -Infinity, -Infinity]).map((v, i) => (i < 2 ? Math.floor(v) : Math.ceil(v)));
  const sheet = openSheet();
  const raw = sheetWindowForTm(sheet, E0, N1, E1 - E0, N1 - N0);
  const gsdM = Math.abs(sheet.tfw.a);
  const win = { w: raw.w, h: raw.h, gsdM, origin: [sheet.tfw.c - gsdM / 2 + raw.col0 * gsdM, sheet.tfw.f + gsdM / 2 - raw.row0 * gsdM], rgb: raw.rgb };
  const masks = occlusionMask(win, { buildings, trees });
  sheet.close();
  const grid = cellGrid(win, masks.any);
  // the campus polygon: asphalt outside it is the city's
  const inCampus = new Uint8Array(grid.w * grid.h);
  fillRings(grid, [campus], (k) => { inCampus[k] = 1; });
  for (let k = 0; k < inCampus.length; k += 1) if (!inCampus[k]) grid.asphalt[k] = 0;
  const opened = { ...grid, asphalt: openCells(grid.asphalt, grid.w, grid.h, OPEN_CELLS) };
  const baseParcels = parcels.filter((p) => p.source !== "photo-curated");
  const before = scanRegions(opened, baseParcels, { minAreaM2 });
  const now = scanRegions(opened, parcels, { minAreaM2, notAsphalt: curation.notAsphalt });
  const status = baselineStatus(before.regions, opened, parcels, curation.notAsphalt, minAreaM2);
  const unexplained = now.regions.map(({ cells, ...r }) => r);
  // the graded evidence of each curated parcel, by the rule above
  const fine = { w: win.w >> 1, h: win.h >> 1, origin: win.origin, cellM: gsdM * 2 };
  const fineTop = rasterTop(parcels, fine);
  const lookup = (E, N, mask, w, h, cell, outside) => { const i = Math.floor((E - win.origin[0]) / cell); const j = Math.floor((win.origin[1] - N) / cell); return i < 0 || j < 0 || i >= w || j >= h ? outside : mask[j * w + i]; };
  const isDrivable = (E, N) => { const k = lookup(E, N, fineTop, fine.w, fine.h, fine.cellM, -1); return k >= 0 && drivable(parcels[k]); };
  const hidden = (E, N) => Boolean(lookup(E, N, masks.any, win.w, win.h, gsdM, 1));
  const luma = (E, N) => { const i = Math.floor((E - win.origin[0]) / gsdM); const j = Math.floor((win.origin[1] - N) / gsdM); if (i < 0 || j < 0 || i >= win.w || j >= win.h) return 0; const k = (j * win.w + i) * 3; return (win.rgb[k] + win.rgb[k + 1] + win.rgb[k + 2]) / 3; };
  const dark = (E, N) => { const around = []; for (const dy of [-1, 0, 1]) for (const dx of [-1, 0, 1]) around.push(luma(E + dx, N + dy)); return median(around) < 50; };
  const tiers = curation.add.flatMap((rec) => {
    const p = parcels.find((q) => q.id === rec.id);
    if (!p) return [];
    const edge = edgeVisibility([p.ring], { isDrivable, hidden, dark });
    const maskedAreaShare = Math.round(maskedShare(grid, [p.ring]) * 1000) / 1000;
    const want = gradeParcel({ ...edge, maskedAreaShare });
    return [{ id: p.id, ...edge, maskedAreaShare, tier: p.evidence.tier, estimated: p.estimated, wantTier: want.tier, wantEstimated: want.estimated }];
  });
  const tierErrors = tiers.filter((t) => t.tier !== t.wantTier || t.estimated !== t.wantEstimated);
  const report = {
    note: "Photo asphalt (NGII 2025, 1 m cells, occlusion masks off) with no road or lot parcel. Candidates checked by eye; areas are the visible part only, so shade and crowns make them smaller than the real surface.",
    parcels: path.basename(parcelsFile),
    minAreaM2,
    openWidthM: (2 * OPEN_CELLS + 1) * grid.cellM,
    asphaltM2: now.asphaltM2,
    coveredM2: now.coveredM2,
    coveredShare: Math.round((now.coveredM2 / now.asphaltM2) * 1000) / 1000,
    baselineCoveredShare: Math.round((before.coveredM2 / before.asphaltM2) * 1000) / 1000,
    baselineAreas: status,
    unexplained,
    tiers,
  };
  const counts = status.reduce((acc, s) => ({ ...acc, [s.status]: (acc[s.status] ?? 0) + 1 }), {});
  console.log(`ASPHALT ${JSON.stringify({ baselineAreas: status.length, ...counts, unexplained: unexplained.length, coveredShare: report.coveredShare, baselineCoveredShare: report.baselineCoveredShare, tierErrors: tierErrors.length })}`);
  for (const s of status) if (s.status === "open") console.error(`OPEN BASELINE ${s.areaM2} m2 at ${s.centre.join(",")}: ${s.leftM2} m2 left, touched by ${s.by.join(", ") || "nothing"}`);
  for (const t of tierErrors) console.error(`TIER ${t.id}: record ${t.tier} estimated:${t.estimated}, the masks give ${t.wantTier} estimated:${t.wantEstimated} (free ${t.freeM} m, hidden ${t.hiddenM} m, dark ${t.darkM} m, masked area ${t.maskedAreaShare})`);
  for (const r of unexplained) console.error(`OPEN ${r.areaM2} m2 at ${r.centre.join(",")} bbox ${r.bbox.join(",")} under ${JSON.stringify(r.under)}`);
  const out = opt("--out", null);
  if (out) {
    mkdirSync(out, { recursive: true });
    writeFileSync(path.join(out, "asphalt-scan.json"), `${JSON.stringify(report, null, 1)}\n`);
    const rows = status.map((s) => `| ${s.centre.join(", ")} | ${s.areaM2} | ${s.status} | ${s.status === "covered" ? s.by.join(", ") : s.reason ?? ""} | ${s.leftM2} |`);
    writeFileSync(path.join(out, "asphalt-scan.md"), `# Photo asphalt with no road or lot parcel\n\n${report.note}\n\nMinimum ${minAreaM2} m2, width at least ${report.openWidthM} m. Asphalt on road or lot parcels: ${report.baselineCoveredShare} before, ${report.coveredShare} now. Areas still open: ${unexplained.length}.\n\n| Centre E, N | Visible m2 | Status | Parcel or reason | Left m2 |\n|---|---|---|---|---|\n${rows.join("\n")}\n\n## Evidence of the curated parcels\n\nFree edge has no road or lot beyond it. T1 with estimated false: at most 25 % of it (or 10 m) lost to masks and shade, and at most 25 % of the area masked. T1 with estimated true: at most half lost. T4: the rest.\n\n| Parcel | Free m | Hidden m | Dark m | Masked area | Tier | Estimated |\n|---|---|---|---|---|---|---|\n${tiers.map((t) => `| ${t.id} | ${t.freeM} | ${t.hiddenM} | ${t.darkM} | ${t.maskedAreaShare} | ${t.tier} | ${t.estimated} |`).join("\n")}\n`);
  }
  const proposeFile = opt("--propose", null);
  if (proposeFile) {
    const top = rasterTop(parcels, grid);
    const covered = top.map((i) => (i >= 0 && coversAsphalt(parcels[i]) ? 1 : 0));
    const hard = coarsen(masks.roofs, win.w, win.h, CELL_PX);
    const soft = coarsen(masks.any, win.w, win.h, CELL_PX);
    for (let k = 0; k < soft.length; k += 1) if (hard[k]) soft[k] = 0;
    const proposals = proposeRings(grid, { soft, hard, covered: Uint8Array.from(covered), minAreaM2 });
    writeFileSync(proposeFile, `${JSON.stringify(proposals)}\n`);
    console.log(`PROPOSED ${proposals.length} rings -> ${proposeFile}`);
  }
  if (unexplained.length || tierErrors.length || status.some((s) => s.status === "open")) process.exit(1);
}
