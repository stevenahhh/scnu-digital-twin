// Tactile paving at crossing approaches (plan uhf-ground-roads-routing todo 12): at every dropped kerb of
// stages/kerbs.mjs, a TACTILE_BAND_M (0.30 m, one module) deep band of yellow dot modules across the crossing width on
// the walkway side, at the top of the 1/12 ramp (the landing side), and a 0.30 m wide guidance strip leading
// GUIDANCE_M (1.2 m) from the band into the walkway along the crossing axis, with the module turned 90 degrees.
// Both are Ground_Tactile decals on the slab; their UVs run one tile per 0.30 m along the band / strip. Basis:
// 장애인·노인·임산부 등의 편의증진 보장에 관한 법률 시행규칙 별표 1 제16호 (0.3 m module, 36 domes, 6 +- 1 mm, yellow);
// placement and the guidance length are estimates. Tactile paving is placed nowhere else (no data for building
// entrances or stairs). Tile: bake/tactile-tile.mjs.
import { sceneToTm } from "../../../src/geo/epsg5186.mjs";
import { SCENE_UNITS_PER_METRE } from "../lib/frame.mjs";
import { orientedFrame } from "../network/surfaces.mjs";
import { SURFACE_CLASS } from "../lib/surfaceClass.mjs";
import { DROP_RAMP, SLAB_DECAL_DROP_M } from "./kerbs.mjs";
import { SURFACE_LIFT_M } from "./surfaces.mjs";

const UNIT = SCENE_UNITS_PER_METRE;
export const TACTILE_BAND_M = 0.3;
export const GUIDANCE_M = 1.2;
export const TACTILE_PRECEDENCE = 6.5;
const MARGIN_M = 0.05;
const MARCH_M = 0.05;
const MAX_REACH_M = 8;

const unit = (v) => {
  const l = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / l, v[1] / l];
};
const add = (p, v, k) => [p[0] + v[0] * k, p[1] + v[1] * k];
const tmRing = (ring) => {
  const tm = ring.map(([x, z]) => sceneToTm(x, z));
  let area = 0;
  for (let i = 0; i < tm.length; i += 1) area += tm[i][0] * tm[(i + 1) % tm.length][1] - tm[(i + 1) % tm.length][0] * tm[i][1];
  return area > 0 ? tm : tm.reverse();
};

// plan: planKerbs() result. Returns Ground_Tactile layers (EPSG:5186 rings, uvFrame in model units) and a log.
export function planTactile(plan, { warn = console.warn } = {}) {
  const rampRun = plan.exposedM / DROP_RAMP;
  const layers = [];
  let bands = 0;
  for (const drop of plan.dropped) {
    const pieces = drop.pieces;
    const first = pieces[0].p;
    const last = pieces.at(-1).q;
    const along = unit([last[0] - first[0], last[1] - first[1]]);
    // the band spans the crossing's own width: the touching kerb run clipped to the crossing polygon's extent along it
    const runLength = (last[0] - first[0]) * along[0] + (last[1] - first[1]) * along[1];
    const projections = drop.crossingRing.map((q) => (q[0] - first[0]) * along[0] + (q[1] - first[1]) * along[1]);
    const s0 = Math.max(0, Math.min(...projections));
    const s1 = Math.min(runLength, Math.max(...projections));
    if (s1 - s0 < TACTILE_BAND_M * UNIT) {
      warn(`tactile: ${drop.cwId} (A003 ${drop.ufid}) skipped, crossing overlaps the kerb by ${((s1 - s0) / UNIT).toFixed(2)} m`);
      continue;
    }
    const start = add(first, along, s0);
    const end = add(first, along, s1);
    const n = unit(pieces.reduce((acc, piece) => [acc[0] + piece.inward[0], acc[1] + piece.inward[1]], [0, 0]));
    const mid = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
    // only kerbs the crossing walks into: the walking axis (the crossing polygon's long side) meets the kerb within 45 deg
    const box = orientedFrame(drop.crossingRing);
    const walk = [box.ux, box.uz];
    if (Math.abs(walk[0] * n[0] + walk[1] * n[1]) < Math.SQRT1_2) {
      warn(`tactile: ${drop.cwId} (A003 ${drop.ufid}) skipped, the kerb runs along the crossing, not across it`);
      continue;
    }
    // walkway depth available along the crossing axis from the kerb line
    let avail = 0;
    for (let d = MARCH_M; d <= MAX_REACH_M; d += MARCH_M) {
      if (!plan.onPaving(add(mid, n, d * UNIT))) break;
      avail = d;
    }
    const d0 = Math.min(rampRun, avail - TACTILE_BAND_M - MARGIN_M);
    if (d0 < MARGIN_M) {
      warn(`tactile: ${drop.cwId} (A003 ${drop.ufid}) skipped, paving only ${avail.toFixed(2)} m deep behind the kerb`);
      continue;
    }
    const d1 = d0 + TACTILE_BAND_M;
    const band = [add(start, n, d0 * UNIT), add(end, n, d0 * UNIT), add(end, n, d1 * UNIT), add(start, n, d1 * UNIT)];
    const base = { cls: "TACTILE", mesh: "Ground_Tactile", label: SURFACE_CLASS.TACTILE, precedence: TACTILE_PRECEDENCE, tactile: true, source: "project-estimated", estimated: true };
    layers.push({ ...base, source_ref: `${drop.cwId} band`, rings: [tmRing(band)], uvFrame: { origin: band[0], u: along, v: n, sizeM: TACTILE_BAND_M }, widthM: Math.hypot(end[0] - start[0], end[1] - start[1]) / UNIT });
    bands += 1;
    const length = Math.min(GUIDANCE_M, avail - d1 - MARGIN_M);
    if (length >= TACTILE_BAND_M) {
      const half = (TACTILE_BAND_M / 2) * UNIT;
      const g0 = add(add(mid, n, d1 * UNIT), along, -half);
      const strip = [g0, add(g0, along, 2 * half), add(add(g0, along, 2 * half), n, length * UNIT), add(g0, n, length * UNIT)];
      layers.push({ ...base, source_ref: `${drop.cwId} guidance`, rings: [tmRing(strip)], uvFrame: { origin: g0, u: n, v: along, sizeM: TACTILE_BAND_M }, lengthM: length });
    }
  }
  return { layers, bands, dropped: plan.dropped.length };
}

// Height offset of a tactile decal: on the slab just above the walkway decal (still under the kerb top).
export const tactileOffset = (plan, fallback) => (layer, x, z) => {
  if (!layer.tactile) return fallback(layer, x, z);
  const slab = plan.slabHeight(x, z);
  return slab > 0 ? slab - SLAB_DECAL_DROP_M + 0.002 : SURFACE_LIFT_M(TACTILE_PRECEDENCE);
};
