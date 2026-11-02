// Per-source registration (design §9): one rigid or similarity transform per imagery/vector source and its residual,
// measured against GIS footprint corners, written to data/registration.json as
// { source, available, transform, residual_m, n, measured, method, note }.
//
//   bun scripts/campus-model/fit/registration.mjs            measure and write data/registration.json
//   bun scripts/campus-model/fit/registration.mjs --report   measure and print one line per source, write nothing
//
// Image sources are matched to the NGII 2025 sheet (T1 by definition, design §9) by normalised cross-correlation of
// 10 m luminance patches centred on GIS footprint corners, sampled on the sheet's 0.25 m pixel centres. A source
// whose cache is absent is written available:false and the run still exits 0. Only numbers leave .cache/.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tmToWgs84, wgs84ToTm } from "../../../src/geo/epsg5186.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(HERE, "..", "data");
export const REGISTRATION_FILE = path.join(DATA, "registration.json");

// Least-squares 2D fit from `from` to `to` points: rotation (+ scale when scale:true) about `pivot`, then the
// translation. Returns { dE, dN, rotDeg, scale, pivot, residual_m (RMS), n }.
export function fitSimilarity(pairs, { scale = false, pivot = null } = {}) {
  if (!Array.isArray(pairs) || pairs.length < 2) throw new Error("fitSimilarity needs at least two point pairs");
  const n = pairs.length;
  const P = pivot ?? [pairs.reduce((s, p) => s + p.from[0], 0) / n, pairs.reduce((s, p) => s + p.from[1], 0) / n];
  const fx = pairs.map((p) => [p.from[0] - P[0], p.from[1] - P[1]]);
  const tx = pairs.map((p) => [p.to[0] - P[0], p.to[1] - P[1]]);
  const mf = [fx.reduce((s, v) => s + v[0], 0) / n, fx.reduce((s, v) => s + v[1], 0) / n];
  const mt = [tx.reduce((s, v) => s + v[0], 0) / n, tx.reduce((s, v) => s + v[1], 0) / n];
  let a = 0;
  let b = 0;
  let ff = 0;
  for (let k = 0; k < n; k += 1) {
    const x = fx[k][0] - mf[0];
    const y = fx[k][1] - mf[1];
    const u = tx[k][0] - mt[0];
    const v = tx[k][1] - mt[1];
    a += x * u + y * v;
    b += x * v - y * u;
    ff += x * x + y * y;
  }
  const theta = Math.atan2(b, a);
  const s = scale && ff > 0 ? Math.hypot(a, b) / ff : 1;
  const c = Math.cos(theta) * s;
  const si = Math.sin(theta) * s;
  // to = R*from + t (pivot-relative); t chosen so the means coincide
  const dE = mt[0] - (c * mf[0] - si * mf[1]);
  const dN = mt[1] - (si * mf[0] + c * mf[1]);
  const apply = ([e, nn]) => {
    const x = e - P[0];
    const y = nn - P[1];
    return [P[0] + c * x - si * y + dE, P[1] + si * x + c * y + dN];
  };
  const errors = pairs.map((p) => {
    const q = apply(p.from);
    return Math.hypot(q[0] - p.to[0], q[1] - p.to[1]);
  });
  const residual = Math.sqrt(errors.reduce((t, e) => t + e * e, 0) / n);
  return { dE, dN, rotDeg: (theta * 180) / Math.PI, scale: s, pivot: P, residual_m: residual, n, errors };
}

// Iterative fit that drops the worst pair while it is farther than rejectM from the fit (at least `minN` stay).
export function robustFit(pairs, { rejectM = 1.0, minN = 3, ...options } = {}) {
  let kept = [...pairs];
  const rejected = [];
  for (;;) {
    const t = fitSimilarity(kept, options);
    const worst = t.errors.reduce((w, e, i) => (e > t.errors[w] ? i : w), 0);
    if (t.errors[worst] <= rejectM || kept.length <= minN) return { ...t, rejected };
    rejected.push(kept[worst].id ?? String(worst));
    kept = kept.filter((_, i) => i !== worst);
  }
}

const ncc = (a, b) => {
  let sa = 0;
  let sb = 0;
  for (let i = 0; i < a.length; i += 1) {
    sa += a[i];
    sb += b[i];
  }
  const ma = sa / a.length;
  const mb = sb / b.length;
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i] - ma;
    const y = b[i] - mb;
    ab += x * y;
    aa += x * x;
    bb += y * y;
  }
  return aa > 0 && bb > 0 ? ab / Math.sqrt(aa * bb) : 0;
};

// Exhaustive NCC search of a w x h reference patch inside a (w + 2r) x (h + 2r) moving window; returns the shift
// (dx, dy) in pixels of the content in the moving image relative to the reference (parabolic sub-pixel peak) and the
// peak score.
export function nccSearch(ref, w, h, mov, r) {
  const ww = w + 2 * r;
  const cut = new Float32Array(w * h);
  const scores = [];
  let best = { s: -2, x: 0, y: 0 };
  for (let oy = -r; oy <= r; oy += 1) {
    const row = [];
    for (let ox = -r; ox <= r; ox += 1) {
      for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) cut[y * w + x] = mov[(y + r + oy) * ww + (x + r + ox)];
      const s = ncc(ref, cut);
      row.push(s);
      if (s > best.s) best = { s, x: ox, y: oy };
    }
    scores.push(row);
  }
  const at = (ox, oy) => scores[oy + r]?.[ox + r];
  const sub = (m, c, p) => (m === undefined || p === undefined || m - 2 * c + p === 0 ? 0 : (0.5 * (m - p)) / (m - 2 * c + p));
  return {
    dx: best.x + sub(at(best.x - 1, best.y), best.s, at(best.x + 1, best.y)),
    dy: best.y + sub(at(best.x, best.y - 1), best.s, at(best.x, best.y + 1)),
    ncc: best.s,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Measurement (CLI)

const PATCH_PX = 41; // 10.25 m at 0.25 m
const SEARCH_PX = 12; // +-3 m
const MIN_NCC = 0.6;
const MIN_STD = 12;
const CORNER_TURN_DEG = 30;

// Footprint corners of the campus BLD_* nodes (data/bld-node-map.json -> data/gis-buildings.json), EPSG:5186.
export function footprintCorners() {
  const map = JSON.parse(readFileSync(path.join(DATA, "bld-node-map.json"), "utf8"));
  const gis = JSON.parse(readFileSync(path.join(DATA, "gis-buildings.json"), "utf8"));
  const bySource = new Map(gis.buildings.map((b) => [b.footprintSource, b]));
  const corners = [];
  for (const entry of map.entries) {
    const b = entry.gis && bySource.get(entry.gis.footprintSource);
    if (!b) continue;
    for (const polygon of b.polygons) {
      const ring = polygon[0].map(([lon, lat]) => wgs84ToTm(lon, lat));
      if (ring.length > 1 && ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1]) ring.pop();
      ring.forEach((p, k) => {
        const a = ring[(k - 1 + ring.length) % ring.length];
        const c = ring[(k + 1) % ring.length];
        const turn = Math.abs(Math.atan2((p[0] - a[0]) * (c[1] - p[1]) - (p[1] - a[1]) * (c[0] - p[0]), (p[0] - a[0]) * (c[0] - p[0]) + (p[1] - a[1]) * (c[1] - p[1])));
        if ((turn * 180) / Math.PI >= CORNER_TURN_DEG) corners.push({ id: `${entry.nodeId}#${k}`, tm: p });
      });
    }
  }
  return corners;
}

const std = (a) => {
  const m = a.reduce((s, v) => s + v, 0) / a.length;
  return Math.sqrt(a.reduce((s, v) => s + (v - m) * (v - m), 0) / a.length);
};

// Matches `lumAt(E, N)` (a source sampler, may be async) to the sheet at every corner; returns robust-fit pairs.
async function matchToSheet(sheet, corners, lumAt) {
  const { tfw } = sheet;
  const half = (PATCH_PX - 1) / 2;
  const ww = PATCH_PX + 2 * SEARCH_PX;
  const pairs = [];
  const rgb = [0, 0, 0];
  for (const corner of corners) {
    const col = Math.round((corner.tm[0] - tfw.c) / tfw.a);
    const row = Math.round((corner.tm[1] - tfw.f) / tfw.d);
    const ref = new Float32Array(PATCH_PX * PATCH_PX);
    let inside = true;
    for (let y = 0; y < PATCH_PX && inside; y += 1) {
      for (let x = 0; x < PATCH_PX; x += 1) {
        if (!sheet.sample(col - half + x, row - half + y, rgb)) {
          inside = false;
          break;
        }
        ref[y * PATCH_PX + x] = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
      }
    }
    if (!inside || std(ref) < MIN_STD) continue;
    const mov = new Float32Array(ww * ww);
    let valid = true;
    for (let y = 0; y < ww && valid; y += 1) {
      for (let x = 0; x < ww; x += 1) {
        const E = tfw.c + (col - half - SEARCH_PX + x) * tfw.a;
        const N = tfw.f + (row - half - SEARCH_PX + y) * tfw.d;
        const v = await lumAt(E, N);
        if (!Number.isFinite(v)) {
          valid = false;
          break;
        }
        mov[y * ww + x] = v;
      }
    }
    if (!valid) continue;
    const m = nccSearch(ref, PATCH_PX, PATCH_PX, mov, SEARCH_PX);
    if (m.ncc < MIN_NCC || Math.abs(m.dx) >= SEARCH_PX || Math.abs(m.dy) >= SEARCH_PX) continue;
    const E = tfw.c + col * tfw.a;
    const N = tfw.f + row * tfw.d;
    // the source shows the sheet's feature at (E + dx*a, N + dy*d); the transform moves it back onto the sheet
    pairs.push({ id: corner.id, from: [E + m.dx * tfw.a, N + m.dy * tfw.d], to: [E, N], ncc: m.ncc });
  }
  return pairs;
}

const round = (v, k = 3) => (v === null || v === undefined ? v : Number(v.toFixed(k)));
const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null;
};

function imageEntry(source, pairs, { method, note, scale = false }) {
  if (pairs.length < 3) return { source, available: true, transform: null, residual_m: null, n: pairs.length, measured: false, method, note: `${note}; too few matched corners (${pairs.length}) for a fit` };
  const t = robustFit(pairs, { scale, rejectM: 1.0 });
  return {
    source,
    available: true,
    transform: { type: scale ? "similarity" : "rigid", dE: round(t.dE), dN: round(t.dN), rotDeg: round(t.rotDeg, 4), ...(scale ? { scale: round(t.scale, 6) } : {}), pivot: t.pivot.map((v) => round(v, 2)) },
    residual_m: round(t.residual_m),
    n: t.n,
    measured: true,
    method,
    note: `${note}; ${t.rejected.length} of ${pairs.length} matched corners rejected beyond 1 m (leaning roofs, changes between epochs)`,
    estimated: true,
  };
}

export async function measureAll({ log = () => {} } = {}) {
  const { openSheet } = await import("../lib/ngiiSheet.mjs");
  const { openAerial12, AERIAL12_EPOCH } = await import("../lib/aerial12.mjs");
  const corners = footprintCorners();
  log(`corners: ${corners.length} GIS footprint corners of the campus BLD_* nodes`);
  const sources = [];
  sources.push({ source: "gis-footprint", available: true, transform: { type: "identity" }, residual_m: null, n: 0, measured: false, method: "reference", note: "GIS건물통합정보 footprints are the geometry reference (design §3); not compared with photos because of relief lean" });

  let sheet = null;
  try {
    sheet = openSheet();
  } catch (error) {
    log(`ngii-2025: unavailable (${error.message})`);
  }
  sources.push(sheet
    ? { source: "ngii-2025", available: true, transform: { type: "world-file", c: sheet.tfw.c, f: sheet.tfw.f, a: sheet.tfw.a, d: sheet.tfw.d }, residual_m: 0, n: 0, measured: false, method: "definition", note: "NGII 2025 orthophoto sheet 34702020: T1 reference by definition; pixel centres as the world file gives them (no half-pixel correction)" }
    : { source: "ngii-2025", available: false, transform: null, residual_m: null, n: 0, measured: false, method: "definition", note: "sheet not in .cache/ngii-ortho" });

  const aerial = openAerial12();
  if (!aerial) sources.push({ source: "suncheon-12cm", available: false, transform: null, residual_m: null, n: 0, measured: false, method: "ncc-to-ngii", note: `no tiles in .cache/suncheon-12cm/${AERIAL12_EPOCH}` });
  else if (!sheet) sources.push({ source: "suncheon-12cm", available: true, transform: null, residual_m: null, n: 0, measured: false, method: "ncc-to-ngii", note: "NGII sheet missing, cannot measure" });
  else {
    const pairs = await matchToSheet(sheet, corners, aerial.lumAt);
    sources.push(imageEntry("suncheon-12cm", pairs, { scale: true, method: "ncc-to-ngii", note: `순천시 airmap ${aerial.epoch} (${aerial.tileCount} tiles), 10 m patches at GIS corners matched to the NGII sheet; cross-check only (design §9)` }));
  }

  const { loadOrtho, lonToWorldPixel, latToWorldPixel, ORTHO_IMAGE } = await import("../lib/ortho.mjs");
  if (!existsSync(ORTHO_IMAGE) || !sheet) {
    sources.push({ source: "vworld-z19", available: existsSync(ORTHO_IMAGE), transform: null, residual_m: null, n: 0, measured: false, method: "ncc-to-ngii", note: "mosaic or NGII sheet missing" });
  } else {
    const ortho = await loadOrtho();
    const ox = ortho.meta.x0 * 256;
    const oy = ortho.meta.y0 * 256;
    const lumAt = (E, N) => {
      const [lon, lat] = tmToWgs84(E, N);
      const u = lonToWorldPixel(lon, ortho.meta.zoom) - ox - 0.5;
      const v = latToWorldPixel(lat, ortho.meta.zoom) - oy - 0.5;
      if (u < 0 || v < 0 || u >= ortho.width - 1 || v >= ortho.height - 1) return NaN;
      const ix = Math.floor(u);
      const iy = Math.floor(v);
      const tx = u - ix;
      const ty = v - iy;
      const l = (x, y) => {
        const k = (y * ortho.width + x) * 3;
        return 0.299 * ortho.rgb[k] + 0.587 * ortho.rgb[k + 1] + 0.114 * ortho.rgb[k + 2];
      };
      return (l(ix, iy) * (1 - tx) + l(ix + 1, iy) * tx) * (1 - ty) + (l(ix, iy + 1) * (1 - tx) + l(ix + 1, iy + 1) * tx) * ty;
    };
    const pairs = await matchToSheet(sheet, corners, lumAt);
    sources.push(imageEntry("vworld-z19", pairs, { method: "ncc-to-ngii", note: "VWorld Satellite z19 mosaic data/ortho (Web Mercator, about 0.24 m/px), 10 m patches at GIS corners matched to the NGII sheet" }));
  }
  sheet?.close();

  // LOD4: per-building rigid fits of the LOD4 roof plan onto the GIS footprint (fetch/building_forms.py fit_rigid).
  const forms = JSON.parse(readFileSync(path.join(DATA, "building-forms.json"), "utf8"));
  const regs = forms.buildings.filter((b) => b.registration).map((b) => b.registration);
  const typical = regs.filter((r) => Math.hypot(r.dx, r.dy) <= 2);
  sources.push({
    source: "lod4",
    available: regs.length > 0,
    transform: { type: "per-building rigid", file: "data/building-forms.json", field: "registration", medianDE: round(median(typical.map((r) => r.dx))), medianDN: round(median(typical.map((r) => r.dy))) },
    residual_m: round(median(regs.map((r) => r.residual_m))),
    n: regs.length,
    measured: true,
    method: "plan-iou-rigid-per-building",
    note: `median of per-building mean outline distance after fit; ${regs.length - typical.length} buildings moved > 2 m are excluded from the median shift`,
    estimated: true,
  });

  // A003: kerb offsets measured against the photo (data/photo/a003-registration.json, retired by todo 9).
  const a003 = JSON.parse(readFileSync(path.join(DATA, "photo", "a003-registration.json"), "utf8")).corrections.filter((c) => c.op === "move");
  const dE = a003.map((c) => c.dE);
  const dN = a003.map((c) => c.dN);
  const mE = median(dE);
  const mN = median(dN);
  sources.push({
    source: "a003",
    available: true,
    transform: { type: "identity" },
    residual_m: round(median(a003.map((c) => Math.hypot(c.dE - mE, c.dN - mN)))),
    n: a003.length,
    measured: true,
    method: "kerb-median-offset",
    note: `local kerb corrections only (median dE ${round(mE)} m, dN ${round(mN)} m, MAD as residual); local errors go to parcel curation (design §9)`,
    estimated: true,
  });

  // OSM: recorded only, never used as geometry; the crossing translation was measured photo minus OSM (REG).
  sources.push({ source: "osm", available: true, transform: { type: "rigid", dE: -0.905, dN: 0.315, rotDeg: 0 }, residual_m: null, n: 0, measured: false, method: "recorded", note: "OSM crossing ways: translation photo minus OSM from the zebra registration (formerly OSM_SHIFT_M in stages/markings.mjs); recorded only, OSM is not geometry", estimated: true });

  const stations = JSON.parse(readFileSync(path.join(HERE, "..", "..", "perf", "vr-stations.json"), "utf8"));
  const res = stations.map((s) => s.residual_m).filter(Number.isFinite);
  sources.push({ source: "vr-station", available: true, transform: { type: "resection", file: "scripts/perf/vr-stations.json" }, residual_m: round(median(res)), n: stations.length, measured: true, method: "resection", note: "median control-point residual of the station resections (kept in vr-stations.json)", estimated: true });
  return sources;
}

// Registration entry of a source (throws on an unknown source so a typo cannot silently fall back to zero).
export function registrationOf(source, file = REGISTRATION_FILE) {
  const doc = JSON.parse(readFileSync(file, "utf8"));
  const entry = doc.sources.find((s) => s.source === source);
  if (!entry) throw new Error(`${path.basename(file)} has no source "${source}"`);
  return entry;
}

if (import.meta.main) {
  const report = process.argv.includes("--report");
  const sources = await measureAll({ log: (m) => console.error(m) });
  for (const s of sources) {
    const t = s.transform && "dE" in s.transform ? ` dE ${s.transform.dE} dN ${s.transform.dN}` : "";
    console.log(`${s.source.padEnd(14)} available ${s.available} measured ${s.measured} n ${s.n} residual_m ${s.residual_m ?? "-"}${t}`);
  }
  if (!report) {
    const { validate } = await import("../lib/schemas.mjs");
    const doc = { generated: new Date().toISOString().slice(0, 10), frame: "EPSG:5186", description: "Per-source transform and residual (design §9), written by fit/registration.mjs. Estimates from image matching, not survey data.", sources };
    const { ok, errors } = validate("registration", doc);
    if (!ok) throw new Error(`registration.json would be invalid: ${errors.join("; ")}`);
    writeFileSync(REGISTRATION_FILE, `${JSON.stringify(doc, null, 2)}\n`);
    console.log(`wrote ${path.relative(process.cwd(), REGISTRATION_FILE)}`);
  }
}
