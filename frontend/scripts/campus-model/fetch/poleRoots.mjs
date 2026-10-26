// Pole roots from the NGII 2025 orthophoto: merges the by-eye verdicts of data/photo/pole-review.json with the shadow-
// root refinement of lib/poleShadow.mjs and writes data/photo/pole-roots.json, which stages/lights.mjs and
// stages/furniture.mjs read for every standing pole (lamps, signal, sign and floodlight poles).
//
// Seeds:
//   - every Point street_lamp, traffic_signal_pole, sign_pole and floodlight_pole of data/photo/objects-campus.geojson
//     (by-eye survey and the data.go.kr 순천시_가로등 points the survey kept);
//   - the 67 lamps the old walkway rule placed (data/photo/pole-seeds-rule.json).
// Per seed the review gives the base (seed, root offset, floodlight head) or rejects it; a seed with no review is
// unresolved. Where a base is given, the shadow detector searches REFINE_RADIUS_M around it for the sun-side end of a
// pole shadow: when it finds one within AGREE_M of the by-eye base, the pole goes to the detected root and residualM is the
// distance between the two independent estimates; otherwise the by-eye base is used and residualM is the by-eye
// uncertainty (BY_EYE_RESIDUAL_M, an estimate).
// A floodlight's bright head is offset from its base by the photo's relief lean (leanOffset of stages/furniture.mjs,
// derived from roof outlines): base = head - lean x estimated height.
//
// Usage (from frontend/):  bun scripts/campus-model/fetch/poleRoots.mjs [--seeds-px <file>]
//   --seeds-px writes the seeds with their sheet pixel positions for fetch/pole_review_sheets.py and exits.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GRID_CONVERGENCE_DEG, pixelToTm, tmToPixel, tmToScene, tmToWgs84, wgs84ToTm } from "../../../src/geo/epsg5186.mjs";
import { metres } from "../lib/frame.mjs";
import { openSheet } from "../lib/ngiiSheet.mjs";
import { SUN, darkness, detectPoleRoots, toGrey } from "../lib/poleShadow.mjs";
import { leanOffset } from "../stages/furniture.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PHOTO = path.join(HERE, "..", "data", "photo");
export const POLE_ROOTS = path.join(PHOTO, "pole-roots.json");
const OBJECTS = path.join(PHOTO, "objects-campus.geojson");
const RULE_SEEDS = path.join(PHOTO, "pole-seeds-rule.json");
const REVIEW = path.join(PHOTO, "pole-review.json");
export const POLE_KINDS = ["street_lamp", "traffic_signal_pole", "sign_pole", "floodlight_pole"];
const GSD = 0.25;
const REFINE_RADIUS_M = 1;
const AGREE_M = 0.5;
const BY_EYE_RESIDUAL_M = 0.25;
const HEAD_RESIDUAL_M = 0.5; // head pixel +-1 px plus the lean of an estimated height (+-2 m x ~0.05 m/m)
const WINDOW_PX = 64;

function seeds() {
  const out = [];
  for (const { properties: p, geometry: g } of JSON.parse(readFileSync(OBJECTS, "utf8")).features) {
    if (!POLE_KINDS.includes(p.kind) || g.type !== "Point") continue;
    out.push({ id: p.id, kind: p.kind, source: p.method, heightM: p.height_m, seed: g.coordinates });
  }
  for (const s of JSON.parse(readFileSync(RULE_SEEDS, "utf8")).seeds) {
    out.push({ id: s.id, kind: "street_lamp", source: "rule", heightM: s.heightM, ruleType: s.type, seed: [s.lon, s.lat] });
  }
  return out;
}

const round = (v, d) => Number(v.toFixed(d));
const pxToGeo = ([col, row]) => tmToWgs84(...pixelToTm(col, row)).map((v) => round(v, 8));
const geoToPx = ([lon, lat]) => tmToPixel(...wgs84ToTm(lon, lat));

// By-eye base (sheet pixels) of a reviewed seed, or null.
function byEyeBase(s, r) {
  const [col, row] = geoToPx(s.seed);
  if (r.verdict === "seed") return [col, row];
  if (r.verdict === "root") return [col + r.offsetM[0] / GSD, row + r.offsetM[1] / GSD];
  if (r.verdict === "head") {
    const [hc, hr] = r.headPx;
    const [dx, dz] = leanOffset(tmToScene(...pixelToTm(hc, hr)), s.heightM);
    // leanOffset is the top's displacement in scene units (+x east, +z south); the base is the head moved back
    return [hc - dx / metres(1) / GSD, hr - dz / metres(1) / GSD];
  }
  return null;
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--seeds-px")) {
    const roots = existsSync(POLE_ROOTS) ? new Map(JSON.parse(readFileSync(POLE_ROOTS, "utf8")).poles.map((q) => [q.id, q])) : new Map();
    const out = seeds().map((s) => {
      const [col, row] = geoToPx(s.seed);
      const r = roots.get(s.id);
      const root = r?.root ? geoToPx(r.root) : null;
      return { id: s.id, kind: s.kind, source: s.source, heightM: s.heightM, col, row, verdict: r?.verdict ?? null, ...(root ? { rootCol: root[0], rootRow: root[1] } : {}) };
    });
    writeFileSync(args[args.indexOf("--seeds-px") + 1], JSON.stringify(out));
    console.log(`poleRoots: ${out.length} seeds with sheet pixels`);
    return;
  }
  const sheet = openSheet();
  const review = JSON.parse(readFileSync(REVIEW, "utf8")).reviews;
  const records = [];
  for (const s of seeds()) {
    const r = review[s.id];
    const record = { id: s.id, kind: s.kind, source: s.source, heightM: s.heightM, seed: s.seed.map((v) => round(v, 8)) };
    if (s.ruleType) record.ruleType = s.ruleType;
    if (!r) {
      Object.assign(record, { verdict: "unresolved", note: "no pole base resolvable on the photo (crown, deep shadow or no clear pole image)" });
      records.push(record);
      continue;
    }
    if (r.verdict === "reject") {
      Object.assign(record, { verdict: "rejected", note: r.note });
      records.push(record);
      continue;
    }
    if (r.verdict === "site") {
      Object.assign(record, { verdict: "unresolved", site: r.site, note: r.note });
      records.push(record);
      continue;
    }
    const base = byEyeBase(s, r);
    const [col, row] = geoToPx(s.seed);
    // shadow-root refinement around the by-eye base
    const col0 = Math.round(base[0]) - WINDOW_PX / 2;
    const row0 = Math.round(base[1]) - WINDOW_PX / 2;
    const grey = toGrey(sheet.readWindow(col0, row0, WINDOW_PX, WINDOW_PX), WINDOW_PX, WINDOW_PX);
    const D = darkness(grey, WINDOW_PX, WINDOW_PX);
    const [hit] = detectPoleRoots(grey, WINDOW_PX, WINDOW_PX, { seedX: base[0] - col0, seedY: base[1] - row0, radiusPx: REFINE_RADIUS_M / GSD, heightM: s.heightM, convergenceDeg: GRID_CONVERGENCE_DEG, D, count: 1 });
    const detected = hit ? [col0 + hit.x, row0 + hit.y] : null;
    const agreeM = detected ? Math.hypot(detected[0] - base[0], detected[1] - base[1]) * GSD : null;
    const useDetected = r.verdict !== "head" && detected && agreeM <= AGREE_M;
    const at = useDetected ? detected : base;
    Object.assign(record, {
      verdict: useDetected ? "shadow-root" : r.verdict === "head" ? "head-lean" : "by-eye-root",
      root: pxToGeo(at),
      shiftM: round(Math.hypot(at[0] - col, at[1] - row) * GSD, 2),
      residualM: round(useDetected ? Math.max(agreeM, hit.residualPx * GSD) : r.verdict === "head" ? HEAD_RESIDUAL_M : BY_EYE_RESIDUAL_M, 2),
      residualKind: useDetected ? "agreement of the by-eye base and the detected shadow root (max with the line-fit sigma)" : "by-eye uncertainty (estimate)",
      byEye: pxToGeo(base),
      ...(detected ? { detectedRoot: pxToGeo(detected), detectedAgreeM: round(agreeM, 2), detectedScore: round(hit.score, 2) } : {}),
      note: r.note,
    });
    records.push(record);
  }
  sheet.close();
  const counts = {};
  for (const r of records) {
    const key = `${r.kind}/${r.source}`;
    counts[key] ??= {};
    counts[key][r.verdict] = (counts[key][r.verdict] ?? 0) + 1;
  }
  const doc = {
    note: "Standing-pole bases read from the NGII 2025 orthophoto (sheet 34702020, 0.25 m GSD). verdict shadow-root: by-eye base confirmed by the shadow detector (lib/poleShadow.mjs) within 0.5 m, placed at the detected root; by-eye-root: base by eye (data/photo/pole-review.json); head-lean: floodlight head minus the relief lean; unresolved: no base visible, survey and data.go.kr poles stay at their seed (metre-level; site 'median' when the photo shows the seed on a median or island); rejected: no pole there (not drawn). Positions WGS84; residualM per pole; heights stay estimates (추정).",
    generator: "scripts/campus-model/fetch/poleRoots.mjs",
    sun: { ...SUN, note: "sun of the photo as estimated in data/photo/README.md (shadows fall west)" },
    counts,
    poles: records,
  };
  writeFileSync(POLE_ROOTS, `${JSON.stringify(doc, null, 1)}\n`);
  console.log(`poleRoots: ${records.length} seeds -> ${JSON.stringify(counts)}`);
  for (const r of records.filter((q) => q.root)) console.log(`  ${r.id} ${r.kind} ${r.verdict} shift ${r.shiftM} m residual ${r.residualM} m${r.detectedAgreeM !== undefined ? ` (detector ${r.detectedAgreeM} m from by-eye)` : ""}`);
}

main();
