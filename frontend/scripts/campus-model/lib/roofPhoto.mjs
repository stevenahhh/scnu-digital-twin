// Roof colours and rooftop solar panels from the VWorld z19 orthophoto (lib/ortho.mjs, consent D1). Estimates
// derived from imagery, not measurements.
//
// sampleRoofPhoto() samples the photo every SAMPLE_M inside a building's footprint, skipping a band EDGE_M wide
// along the outline (parapets, and the facade that leans into the roof outline in the photo), and sorts every
// sample (raw mosaic values, see lib/orthoGround.mjs) into:
//   - shadow: cast shadow (shadowWeight >= 0.5, or red below ROOF_SHADOW_RED with luminance below
//     ROOF_SHADOW_LUMA), from parapets, rooftop plant or a taller neighbour;
//   - panel: photovoltaic modules, which read dark slate blue in this mosaic (cluster centres on the C1, C2, B1
//     and B7 arrays: red 33-56, blue 27-51 above red and 2-22 above green, luminance 50-76): red in
//     PANEL_RED, blue at least PANEL_BLUE_OVER_RED above red and not below green, luminance in PANEL_LUMA;
//   - canopy: tree crowns over the roof (excess green above VEG_EXG and rough, or dark), unlike a painted green
//     roof, which is green but smooth;
//   - roof: everything else.
// The roof colour is the per-channel median of the roof samples, calibrated to an albedo estimate like the ground.
// With fewer than MIN_ROOF_SHARE roof samples the roof counts as occluded (trees, shadow) and keeps its default.
//
// panelModules() turns the panel samples of one footprint part into module rectangles: a grid aligned with the
// part's longest edge (cells closer than PANEL_EDGE_M + PANEL_EDGE_LEAN x height to the outline left out, which
// drops glazed facades leaning into the outline), closed by one cell and opened by one cell, then connected components that look like an array:
// at least MIN_ARRAY_M2, at least MIN_ARRAY_DEPTH_M thick across both roof axes, filling at least
// MIN_ARRAY_FILL of their bounding box and bordering cast shadow on at most MAX_SHADOW_BORDER of their rim
// (the fringe of a deep shadow reads slate blue too). Clearly blue components (mean blue / green at least
// BLUE_ARRAY_RATIO) count as arrays; greyer ones, which a dark membrane or metal roof can match in colour, only
// as rows - at least ROW_ELONGATION times as long as they are deep and at most ROW_MAX_DEPTH_M deep - when a part
// has at least MIN_ROWS of them, or as blocks whose module grid shows as texture (mean luminance step to the
// neighbouring cells at least GRID_ROUGHNESS; a membrane is smoother). Arrays are tiled with MODULE_ALONG_M x MODULE_DEPTH_M modules (ASSUMED 60-cell
// module, tilted MODULE_TILT_DEGREES towards the roof axis closest to south) wherever PANEL_FILL of a module's
// cells are panel.
import { SCENE_UNITS_PER_METRE } from "./frame.mjs";
import { pointInRing, segmentDistance } from "./geometry.mjs";
import { sampleOrtho } from "./ortho.mjs";
import { VEG_EXG, excessGreen, shadowWeight } from "./orthoGround.mjs";

const SAMPLE_M = 0.25;
const EDGE_M = 1.0;
const MIN_ROOF_SHARE = 0.3;
const MIN_ROOF_SAMPLES = 40;
const ROOF_SHADOW_RED = 30;
const ROOF_SHADOW_LUMA = 55;
const PANEL_RED = [32, 80];
const PANEL_BLUE_OVER_RED = 25;
const PANEL_LUMA = [48, 100];
const CANOPY_ROUGHNESS = 9; // mean absolute luminance step to the 4 neighbours 0.25 m away (sRGB units)
const CANOPY_DARK_LUMA = 70;
const MIN_ARRAY_M2 = 12;
const MIN_ARRAY_DEPTH_M = 1.2;
const MIN_ARRAY_FILL = 0.45;
const MAX_SHADOW_BORDER = 0.3;
const BLUE_ARRAY_RATIO = 1.12;
const ROW_ELONGATION = 3;
const ROW_MAX_DEPTH_M = 3.5;
const MIN_ROWS = 3;
const GRID_ROUGHNESS = 6;
const PANEL_EDGE_M = 1.5;
const PANEL_EDGE_LEAN = 0.03;
export const MODULE_ALONG_M = 1.0;
export const MODULE_DEPTH_M = 1.65;
export const MODULE_TILT_DEGREES = 15;
const PANEL_FILL = 0.55;
const MODULE_INSET_M = 0.8; // modules stay this far inside the footprint outline

const luma = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
const unit = (m) => m * SCENE_UNITS_PER_METRE;

function edgeDistance(point, rings) {
  let best = Infinity;
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i += 1) best = Math.min(best, segmentDistance(point, ring[i], ring[(i + 1) % ring.length]));
  }
  return best;
}

const insidePart = (point, part) => pointInRing(point, part.outer) && !part.holes.some((hole) => pointInRing(point, hole));

// Raw mosaic RGB at a model point, or null outside the mosaic.
function photoAt(ortho, x, z, out) {
  const u = ortho.col(x);
  const v = ortho.row(z);
  if (u < 1 || v < 1 || u > ortho.width - 1 || v > ortho.height - 1) return null;
  return sampleOrtho(ortho, u, v, out);
}

// Sample class at a model point: "shadow" | "panel" | "canopy" | "roof" | null (outside the mosaic).
export function classifyRoofSample(ortho, x, z) {
  const c = photoAt(ortho, x, z, [0, 0, 0]);
  if (!c) return null;
  const [r, g, b] = c;
  const y = luma(r, g, b);
  if (shadowWeight(r, g, b) >= 0.5 || (r < ROOF_SHADOW_RED && y < ROOF_SHADOW_LUMA)) return { kind: "shadow", rgb: c };
  if (r >= PANEL_RED[0] && r <= PANEL_RED[1] && b - r >= PANEL_BLUE_OVER_RED && b >= g && y >= PANEL_LUMA[0] && y <= PANEL_LUMA[1]) return { kind: "panel", rgb: c };
  if (excessGreen(r, g, b) > VEG_EXG) {
    const step = unit(SAMPLE_M);
    let rough = 0;
    for (const [dx, dz] of [[step, 0], [-step, 0], [0, step], [0, -step]]) {
      const n = photoAt(ortho, x + dx, z + dz, [0, 0, 0]);
      rough += n ? Math.abs(luma(...n) - y) / 4 : 0;
    }
    if (rough >= CANOPY_ROUGHNESS || y < CANOPY_DARK_LUMA) return { kind: "canopy", rgb: c };
  }
  return { kind: "roof", rgb: c };
}

// parts: [{ outer, holes }] in model units. Returns { status, rgb (albedo sRGB) | null, counts, samples }.
export function sampleRoofPhoto(ortho, calibration, parts) {
  const counts = { shadow: 0, panel: 0, canopy: 0, roof: 0, outside: 0 };
  const roof = [[], [], []];
  const step = unit(SAMPLE_M);
  const edge = unit(EDGE_M);
  for (const part of parts) {
    const xs = part.outer.map((p) => p[0]);
    const zs = part.outer.map((p) => p[1]);
    const rings = [part.outer, ...part.holes];
    for (let z = Math.min(...zs) + step / 2; z < Math.max(...zs); z += step) {
      for (let x = Math.min(...xs) + step / 2; x < Math.max(...xs); x += step) {
        if (!insidePart([x, z], part) || edgeDistance([x, z], rings) < edge) continue;
        const sample = classifyRoofSample(ortho, x, z);
        if (!sample) {
          counts.outside += 1;
          continue;
        }
        counts[sample.kind] += 1;
        if (sample.kind === "roof") for (let ch = 0; ch < 3; ch += 1) roof[ch].push(sample.rgb[ch]);
      }
    }
  }
  const total = counts.shadow + counts.panel + counts.canopy + counts.roof;
  if (counts.outside > total) return { status: "outside the orthophoto", rgb: null, counts, total };
  if (counts.roof < MIN_ROOF_SAMPLES || counts.roof < MIN_ROOF_SHARE * total) {
    return { status: counts.canopy >= counts.shadow ? "hidden by tree crowns" : "in shadow", rgb: null, counts, total };
  }
  const median = roof.map((values) => values.sort((a, b) => a - b)[values.length >> 1]);
  const rgb = median.map((c, ch) => calibration.calibrate(c, ch));
  const exg = excessGreen(...median);
  const surface = exg > 0.12 ? "green" : luma(...rgb) < 110 ? "dark" : luma(...rgb) > 175 ? "light" : "grey";
  return { status: "photo", rgb, raw: median, surface, counts, total };
}

// Longest edge direction of a ring (radians in the x-z plane).
function dominantAngle(ring) {
  let best = 0;
  let angle = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (length > best) {
      best = length;
      angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
    }
  }
  return angle;
}

// Module rectangles for one footprint part: [{ corners: [lowA, lowB, highB, highA] ([x, z] model units), }]
// plus the tilt axis. low* lie on the south (down-slope) edge.
export function panelModules(ortho, part, heightMetres = 0) {
  const angle = dominantAngle(part.outer);
  let along = [Math.cos(angle), Math.sin(angle)];
  let across = [-along[1], along[0]];
  // tilt down towards the axis closest to south (+z): `across` is the down-slope direction
  if (Math.abs(along[1]) > Math.abs(across[1])) [along, across] = [across, along];
  if (across[1] < 0) across = [-across[0], -across[1]];
  const project = ([x, z]) => [x * along[0] + z * along[1], x * across[0] + z * across[1]];
  const toModel = (s, t) => [s * along[0] + t * across[0], s * along[1] + t * across[1]];
  const local = part.outer.map(project);
  const s0 = Math.min(...local.map((p) => p[0]));
  const s1 = Math.max(...local.map((p) => p[0]));
  const t0 = Math.min(...local.map((p) => p[1]));
  const t1 = Math.max(...local.map((p) => p[1]));
  const cell = unit(SAMPLE_M);
  const ns = Math.ceil((s1 - s0) / cell);
  const nt = Math.ceil((t1 - t0) / cell);
  const rings = [part.outer, ...part.holes];
  const inset = unit(MODULE_INSET_M);
  const edge = unit(PANEL_EDGE_M + PANEL_EDGE_LEAN * heightMetres);
  let mask = new Uint8Array(ns * nt);
  const shadow = new Uint8Array(ns * nt);
  const blueOverGreen = new Float32Array(ns * nt);
  const roughness = new Float32Array(ns * nt);
  for (let j = 0; j < nt; j += 1) {
    for (let i = 0; i < ns; i += 1) {
      const p = toModel(s0 + (i + 0.5) * cell, t0 + (j + 0.5) * cell);
      if (!insidePart(p, part) || edgeDistance(p, rings) < edge) continue;
      const sample = classifyRoofSample(ortho, p[0], p[1]);
      if (sample?.kind === "panel") {
        mask[j * ns + i] = 1;
        blueOverGreen[j * ns + i] = sample.rgb[2] / Math.max(1, sample.rgb[1]);
        const y = luma(...sample.rgb);
        let step = 0;
        for (const [ds, dt] of [[cell, 0], [-cell, 0], [0, cell], [0, -cell]]) {
          const q = toModel(s0 + (i + 0.5) * cell + ds, t0 + (j + 0.5) * cell + dt);
          const n = photoAt(ortho, q[0], q[1], [0, 0, 0]);
          step += n ? Math.abs(luma(...n) - y) / 4 : 0;
        }
        roughness[j * ns + i] = step;
      } else if (sample?.kind === "shadow") shadow[j * ns + i] = 1;
    }
  }
  const morph = (source, dilate) => {
    const out = new Uint8Array(source.length);
    for (let j = 0; j < nt; j += 1) {
      for (let i = 0; i < ns; i += 1) {
        let any = false;
        let all = true;
        for (const [di, dj] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ii = i + di;
          const jj = j + dj;
          const v = ii >= 0 && jj >= 0 && ii < ns && jj < nt ? source[jj * ns + ii] : 0;
          any ||= v === 1;
          all &&= v === 1;
        }
        out[j * ns + i] = (dilate ? any : all) ? 1 : 0;
      }
    }
    return out;
  };
  mask = morph(morph(mask, true), false); // close
  mask = morph(morph(mask, false), true); // open
  // connected components (4-neighbour), dropped below MIN_ARRAY_M2
  const label = new Int32Array(ns * nt).fill(-1);
  const components = [];
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || label[start] >= 0) continue;
    const stack = [start];
    const cells = [];
    label[start] = components.length;
    while (stack.length) {
      const k = stack.pop();
      cells.push(k);
      const i = k % ns;
      const j = Math.floor(k / ns);
      for (const [ii, jj] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]]) {
        if (ii < 0 || jj < 0 || ii >= ns || jj >= nt) continue;
        const n = jj * ns + ii;
        if (mask[n] && label[n] < 0) {
          label[n] = components.length;
          stack.push(n);
        }
      }
    }
    components.push(cells);
  }
  const modules = [];
  const moduleS = unit(MODULE_ALONG_M);
  const moduleT = unit(MODULE_DEPTH_M * Math.cos((MODULE_TILT_DEGREES * Math.PI) / 180));
  const candidates = components.flatMap((cells, id) => {
    if (cells.length * SAMPLE_M * SAMPLE_M < MIN_ARRAY_M2) return [];
    const is = cells.map((k) => k % ns);
    const js = cells.map((k) => Math.floor(k / ns));
    const spanS = Math.max(...is) - Math.min(...is) + 1;
    const spanT = Math.max(...js) - Math.min(...js) + 1;
    if (Math.min(spanS, spanT) * SAMPLE_M < MIN_ARRAY_DEPTH_M || cells.length / (spanS * spanT) < MIN_ARRAY_FILL) return [];
    // rim: 4-neighbours outside the component; share of them in cast shadow
    let rim = 0;
    let shaded = 0;
    for (const k of cells) {
      const i = k % ns;
      const j = Math.floor(k / ns);
      for (const [ii, jj] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]]) {
        if (ii < 0 || jj < 0 || ii >= ns || jj >= nt || label[jj * ns + ii] === id) continue;
        rim += 1;
        shaded += shadow[jj * ns + ii];
      }
    }
    if (rim && shaded / rim > MAX_SHADOW_BORDER) return [];
    const sampled = cells.filter((k) => blueOverGreen[k] > 0); // cells the closing added carry no colour
    const blue = sampled.reduce((sum, k) => sum + blueOverGreen[k], 0) / Math.max(1, sampled.length) >= BLUE_ARRAY_RATIO;
    const row = Math.max(spanS, spanT) >= ROW_ELONGATION * Math.min(spanS, spanT) && Math.min(spanS, spanT) * SAMPLE_M <= ROW_MAX_DEPTH_M;
    const grid = sampled.reduce((sum, k) => sum + roughness[k], 0) / Math.max(1, sampled.length) >= GRID_ROUGHNESS;
    return [{ id, cells, is, js, blue, row, grid }];
  });
  const rows = candidates.filter((c) => !c.blue && c.row).length;
  const accepted = candidates.filter((c) => c.blue || c.grid || (c.row && rows >= MIN_ROWS));
  for (const { id, is, js } of accepted) {
    const cs0 = s0 + Math.min(...is) * cell;
    const ct0 = t0 + Math.min(...js) * cell;
    const cs1 = s0 + (Math.max(...is) + 1) * cell;
    const ct1 = t0 + (Math.max(...js) + 1) * cell;
    for (let t = ct0; t + moduleT <= ct1 + cell; t += moduleT) {
      for (let s = cs0; s + moduleS <= cs1 + cell; s += moduleS) {
        let hit = 0;
        let seen = 0;
        for (let j = Math.floor((t - t0) / cell); j < Math.ceil((t + moduleT - t0) / cell); j += 1) {
          for (let i = Math.floor((s - s0) / cell); i < Math.ceil((s + moduleS - s0) / cell); i += 1) {
            if (i < 0 || j < 0 || i >= ns || j >= nt) continue;
            seen += 1;
            if (label[j * ns + i] === id) hit += 1;
          }
        }
        if (!seen || hit / seen < PANEL_FILL) continue;
        const corners = [toModel(s, t + moduleT), toModel(s + moduleS, t + moduleT), toModel(s + moduleS, t), toModel(s, t)];
        if (corners.some((p) => !insidePart(p, part) || edgeDistance(p, rings) < inset)) continue;
        modules.push(corners);
      }
    }
  }
  return { modules, arrays: accepted.length, along, across, areaM2: modules.length * MODULE_ALONG_M * MODULE_DEPTH_M };
}
