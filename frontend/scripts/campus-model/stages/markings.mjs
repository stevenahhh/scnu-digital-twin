// Runtime paint support and mesh assembly. No photo loader or paint gate.
import { ShapeUtils, Vector2 } from "three";
import { EXTENT, SCENE_UNITS_PER_METRE, metres } from "../lib/frame.mjs";
import { conform } from "../lib/conform.mjs";
import { decimateDecal } from "../lib/decimate.mjs";
import { DECIMATE_TOLERANCE_M } from "./surfaces.mjs";
import { encodePng } from "../lib/png.mjs";
import { subtractConvex } from "../lib/partition.mjs";
export const PAINT_BEYOND_EXTENT = Object.freeze({ minX: 502, maxX: 540, minZ: -45, maxZ: 20 });
export const inMarkingExtent = ([x,z]) => x >= EXTENT.minX && x <= EXTENT.maxX && z >= EXTENT.minZ && z <= EXTENT.maxZ;
const ZEBRA_PERIOD_M = 0.903, ZEBRA_BAR_M = 0.5;
export const LINE_WIDTH_M_BY_KIND = Object.freeze({ centre_line_yellow: 0.15, edge_line: 0.15, lane_line_solid: 0.125, lane_line_dashed: 0.125, parking_line: 0.1, kerb_no_parking: 0.15, give_way_line: 0.15 });
export const STOP_LINE_M = [0.3, 0.45];
const STOP_LINE_DEFAULT_M = 0.4;
export const DASH_BY_KIND = Object.freeze({ centre_line_yellow: [3,3], lane_line_dashed: [3,5], guide_dotted: [0.5,1] });
const CROSSING_MIN_M = 4, CROSSING_SPLIT_M = 6;
const STATUTE_SOURCE = "경찰청 2024 교통노면표시 설치·관리 업무편람 표 2-1; 도로교통법 시행규칙 별표 6 (2024-11-14)";
const ON_FILL_KINDS = new Set(["disabled_parking", "bike_lane_blue"]);
const clamp = (v, [lo,hi]) => Math.min(hi, Math.max(lo,v));
const PALETTE_SRGB = { white: [226, 226, 220], yellow: [228, 172, 52], blue: [40, 120, 196], green: [38, 140, 96], light_blue: [110, 190, 225] };
const PALETTE_COLOURS = ["white", "yellow", "blue", "green", "light_blue"];
// the colours bake/markings-gate.mjs measures, in its order: supports are [white, yellow, blue, fingerprint, ...]
const GATE_COLOURS = ["white", "yellow", "blue"];
export const PALETTE_U = Object.fromEntries(PALETTE_COLOURS.map((colour, i) => [colour, (i + 0.5) / PALETTE_COLOURS.length]));
const NIGHT_GLOW = 0.18;

export const lineWidthFor = (kind) => LINE_WIDTH_M_BY_KIND[kind] ?? LINE_WIDTH_M_BY_KIND.centre_line_yellow;

// Stop line width: the detected width clamped into STOP_LINE_M, or STOP_LINE_DEFAULT_M without one.
export function stopLineWidth(detected) {
  if (!(detected > 0)) return { width: STOP_LINE_DEFAULT_M, clamped: false, defaulted: true };
  const width = clamp(detected, STOP_LINE_M);
  return { width, clamped: width !== detected, defaulted: false };
}

// Dash intervals [from, to] (metres along the line) of an estimated dashed piece `lengthM` long, starting with a dash.
export function dashPieces(lengthM, kind) {
  const [dash, gap] = DASH_BY_KIND[kind];
  const out = [];
  for (let s = 0; s + dash <= lengthM + 1e-9; s += dash + gap) out.push([s, s + dash]);
  return out;
}

// Crossing width (bar length) check: a warning string, never a rejection.
export function crossingWidthWarning(id, widthM, { split = false } = {}) {
  if (widthM < CROSSING_MIN_M) return `crossing ${id} width ${widthM.toFixed(2)} m < ${CROSSING_MIN_M.toFixed(1)} m (설치 기준, 경고)`;
  if (widthM >= CROSSING_SPLIT_M && !split) return `crossing ${id} width ${widthM.toFixed(2)} m >= ${CROSSING_SPLIT_M.toFixed(1)} m without a split (설치 기준, 경고)`;
  return null;
}

// ---------------------------------------------------------------- mesh
// extraHeight(x, z): metres of raised road under the paint (the road-record speed humps); triangles over it
// (extraHeight.near(minX, minZ, maxX, maxZ)) are split to at most RAISED_EDGE_M so the paint follows the hump's arc.
const RAISED_EDGE_M = 0.3;
function splitFine(tri, maxEdge, near) {
  const longest = Math.max(...tri.map((p, i) => Math.hypot(tri[(i + 1) % 3][0] - p[0], tri[(i + 1) % 3][1] - p[1])));
  const xs = tri.map((p) => p[0]);
  const zs = tri.map((p) => p[1]);
  if (longest <= maxEdge || !near(Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs))) return [tri];
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const [a, b, c] = tri;
  const [ab, bc, ca] = [mid(a, b), mid(b, c), mid(c, a)];
  return [[a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]].flatMap((t) => splitFine(t, maxEdge, near));
}

// claim(piece) -> the convex parts of a conformed piece that no higher ground class holds (lib/partition.mjs);
// baseOffset(x, z) -> metres of the ground under the paint above the terrain (the raised walkway slab). The paint lies
// flush on that ground: it is cut out of the surfaces under it, not stacked on them.
const fan = (poly) => poly.slice(1, -1).map((p, k) => [poly[0], p, poly[k + 2]]);
export async function buildMarkings({ glb, markings, surface, extraHeight = () => 0, claim = (piece) => [piece], baseOffset = () => 0, decimate = true, exclusions = [] }) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  const index = new Map();
  // A documented non-paint parcel excludes its whole surface, not only the
  // centre of the originally rejected marking. This also clips nearby stripes
  // that would otherwise protrude across the pedestrian island's boundary.
  const cuts = exclusions.flatMap(([outer, ...holes]) => {
    const all = [...outer, ...holes.flat()];
    return ShapeUtils.triangulateShape(outer.map(p => new Vector2(...p)), holes.map(r => r.map(p => new Vector2(...p))))
      .map(face => {
        const triangle = face.map(i => all[i]);
        return { triangle, bounds: [Math.min(...triangle.map(p => p[0])), Math.min(...triangle.map(p => p[1])),
          Math.max(...triangle.map(p => p[0])), Math.max(...triangle.map(p => p[1]))] };
      });
  });
  const vertex = ([x, z], colour) => {
    const key = `${Math.round(x * 1e5)},${Math.round(z * 1e5)},${colour}`;
    let i = index.get(key);
    if (i === undefined) {
      i = positions.length / 3;
      index.set(key, i);
      positions.push(x, surface.height(x, z) + metres(baseOffset(x, z) + extraHeight(x, z)), z);
      normals.push(...surface.normal(x, z));
      uvs.push(PALETTE_U[colour], 0.5);
    }
    return i;
  };
  let source = 0;
  // A white symbol painted on a blue fill (the access symbol, the P, a bicycle) claims its area before the fill, so the
  // fill is cut around it instead of the two colours sharing one plane.
  const onFill = (piece) => piece.colour === "white" && ON_FILL_KINDS.has(piece.kind);
  const drawOrder = [...markings.pieces.filter(onFill), ...markings.pieces.filter((piece) => !onFill(piece))];
  for (const piece of drawOrder) {
    // paint beyond EXTENT lies on the context ground, drawn there
    if (!inMarkingExtent(piece.rings[0].reduce((a, q) => [a[0] + q[0] / piece.rings[0].length, a[1] + q[1] / piece.rings[0].length], [0, 0]))) continue;
    const [outer, ...holes] = piece.rings;
    const contour = outer.map(([x, z]) => new Vector2(x, z));
    const holeVectors = holes.map((ring) => ring.map(([x, z]) => new Vector2(x, z)));
    const all = [...outer, ...holes.flat()];
    for (const [a, b, c] of ShapeUtils.triangulateShape(contour, holeVectors)) {
      source += 1;
      const flat = [all[a], all[b], all[c]];
      const clipped = cuts.reduce((parts, {triangle, bounds: b}) => parts.flatMap(part =>
        part.every(p => p[0] <= b[0]) || part.every(p => p[1] <= b[1]) || part.every(p => p[0] >= b[2]) || part.every(p => p[1] >= b[3])
          ? [part] : subtractConvex(part, triangle)), [flat]).flatMap(fan);
      const near = extraHeight.near ?? (() => false);
      for (const tri of clipped.flatMap(t => splitFine(t, metres(RAISED_EDGE_M), near)).flatMap((t) => conform(t, surface)).flatMap(claim).flatMap(fan)) {
        // Upward face (+y): the (x, z) cross product of the edges must be negative.
        const cross = (tri[1][0] - tri[0][0]) * (tri[2][1] - tri[0][1]) - (tri[1][1] - tri[0][1]) * (tri[2][0] - tri[0][0]);
        if (Math.abs(cross) < 1e-10) continue;
        const ordered = cross < 0 ? tri : [tri[0], tri[2], tri[1]];
        indices.push(...ordered.map((p) => vertex(p, piece.colour)));
      }
    }
  }

  const bands = PALETTE_COLOURS.length;
  const palette = new Uint8Array(16 * bands * 16 * 3);
  for (let y = 0; y < 16; y += 1) {
    for (let x = 0; x < 16 * bands; x += 1) palette.set(PALETTE_SRGB[PALETTE_COLOURS[Math.floor(x / 16)]], (y * 16 * bands + x) * 3);
  }
  const texture = glb.addTexture(encodePng(16 * bands, 16, 3, palette), "image/png", { repeat: false });
  glb.extensionsUsed.add("KHR_materials_emissive_strength");
  const material = glb.addMaterial({
    name: "Road_Marking",
    pbrMetallicRoughness: { baseColorTexture: { index: texture }, metallicFactor: 0, roughnessFactor: 0.75 },
    emissiveTexture: { index: texture },
    emissiveFactor: [1, 1, 1],
    // CityModel multiplies its night weight (0..1) by this strength; by day the emissive intensity is 0.
    extensions: { KHR_materials_emissive_strength: { emissiveStrength: NIGHT_GLOW } },
  });
  // Decimation (lib/decimate.mjs): every outline vertex of the paint stays, so each dash, bar and line keeps its plan
  // geometry; only the partition's interior slivers collapse where the terrain is flat within DECIMATE_TOLERANCE_M.
  let primitive = { positions: Float32Array.from(positions), normals: Float32Array.from(normals), uvs: Float32Array.from(uvs), indices };
  const sourceTriangles = indices.length / 3;
  if (decimate) {
    const out = await decimateDecal({
      positions: primitive.positions, indices, toleranceM: DECIMATE_TOLERANCE_M, unitsPerMetre: SCENE_UNITS_PER_METRE,
      attributes: [{ array: primitive.normals, size: 3 }, { array: primitive.uvs, size: 2 }],
    });
    primitive = { positions: out.positions, normals: out.attributes[0].array, uvs: out.attributes[1].array, indices: Array.from(out.indices) };
    console.log(`markings: decimated ${out.before} -> ${out.after} triangles (paint outlines locked)`);
  }
  const mesh = glb.addMesh("Road_Markings", [{ ...primitive, material }]);
  const detected = markings.pieces.filter((p) => !p.estimated).length;
  glb.addNode({
    name: "Road_Markings",
    mesh,
    extras: {
      markingsDetected: detected,
      markingsEstimated: markings.pieces.length - detected,
      source: markings.source,
      note: "road-section and junction records generated as strokes, crossing grids and glyph templates; source evidence and estimated dimensions are recorded per marking",
      regular: markings.log?.regular ? {
        fittedLines: markings.log.regular.chains, straightRuns: markings.log.regular.straightRuns, arcs: markings.log.regular.arcs,
        crossings: markings.log.regular.crossings, templates: markings.log.regular.glyphs,
      } : null,
      estimatedStallDividers: markings.pieces.filter((p) => p.estimated && p.kind === "parking_line").length,
      report: markings.pieceReport ?? null,
      zebra: { periodM: ZEBRA_PERIOD_M, periodSource: "measured", barM: ZEBRA_BAR_M, gapM: Number((ZEBRA_PERIOD_M - ZEBRA_BAR_M).toFixed(3)), barSource: "assumed" },
      statute: {
        source: STATUTE_SOURCE,
        widths: LINE_WIDTH_M_BY_KIND,
        widthsEstimated: true,
        stopLineM: STOP_LINE_M,
        stopLineDefaultM: STOP_LINE_DEFAULT_M,
        dashes: DASH_BY_KIND,
        dashesApplyTo: "every dashed line, phased on its detected dashes; the photo's own period where it differs from the statute one by more than 15 %",
        crossingWidthM: { warnBelow: CROSSING_MIN_M, warnAtOrAboveWithoutSplit: CROSSING_SPLIT_M },
      },
      warnings: markings.warnings,
    },
  }, { root: true });
  return { vertices: primitive.positions.length / 3, triangles: primitive.indices.length / 3, sourceTriangles: source, conformedTriangles: sourceTriangles };
}

export const describeMarkings = ({pieces, humps=[]}) => `road records: ${pieces.length} paint pieces, ${humps.length} humps`;
