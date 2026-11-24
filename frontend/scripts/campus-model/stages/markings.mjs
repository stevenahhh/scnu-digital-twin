// Runtime paint support and mesh assembly. No photo loader or paint gate.
import { ShapeUtils, Vector2 } from "three";
import { EXTENT, SCENE_UNITS_PER_METRE, metres } from "../lib/frame.mjs";
import { conform } from "../lib/conform.mjs";
import { decimateDecal } from "../lib/decimate.mjs";
import { encodePng } from "../lib/png.mjs";
import { splitByLine, subtractConvex } from "../lib/partition.mjs";
import { ringArea } from "../lib/geometry.mjs";
import { pieceKey } from "../lib/parcels.mjs";
import { sceneToTm } from "../../../src/geo/epsg5186.mjs";
import { finalPaintReceipt } from "../qa/paintReceipt.mjs";
import { PAINT_DECIMATE_TOLERANCE_M, MARKING_LIFT_M, emitGroundNode, markingGroup, markingKind, nodeName } from "../lib/groundNodes.mjs";
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

// claim(piece) -> the convex parts of a conformed piece that no earlier paint holds (a partition of the paint alone,
// lib/partition.mjs), so two marking pieces never share area; the ground surfaces never claim against it.
// baseOffset(x, z) -> metres of the ground under the paint above the terrain (the raised walkway slab). The paint lies
// MARKING_LIFT_M above that ground (lib/groundNodes.mjs): a layer on top of intact pavement, never cut out of it.
const fan = (poly) => poly.slice(1, -1).map((p, k) => [poly[0], p, poly[k + 2]]);
// One editable node per marking element (lib/groundNodes.mjs markingGroup: a road marking object, or a parking lot's
// paint): Road_Markings_<id> under the Road_Markings collection node, which carries the inventory extras.
// splits: convex outlines in plan (the hump tops) the paint is cut along, inside parts and outside parts both kept: a
// face spanning a hump's raised edge would slope through the hump top it lies on.
export async function buildMarkings({ glb, markings, surface, extraHeight = () => 0, claim = (piece) => [piece], baseOffset = () => 0, decimate = true, exclusions = [], splits = [] }) {
  // element id -> { id, parking, kinds, positions, normals, uvs, indices, index, paintSources }, in drawing order
  const elements = new Map();
  const roadParts = [], droppedRoadParts = [];
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
  const outlines = splits.map((ring) => {
    const sign = ringArea(ring) > 0 ? 1 : -1;
    const edges = ring.map((a, i) => {
      const b = ring[(i + 1) % ring.length];
      return (p) => sign * ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]));
    });
    const xs = ring.map((p) => p[0]), zs = ring.map((p) => p[1]);
    return { ring, edges, box: [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)] };
  });
  const splitAlong = (poly) => outlines.reduce((parts, { ring, edges, box }) => parts.flatMap((part) => {
    if (part.every((p) => p[0] <= box[0]) || part.every((p) => p[1] <= box[1]) || part.every((p) => p[0] >= box[2]) || part.every((p) => p[1] >= box[3])) return [part];
    let inside = part;
    for (const f of edges) if (inside) inside = splitByLine(inside, f).inside;
    return inside ? [inside, ...subtractConvex(part, ring)] : [part];
  }), [poly]);
  const vertex = (element, [x, z], colour) => {
    const key = `${Math.round(x * 1e5)},${Math.round(z * 1e5)},${colour}`;
    let i = element.index.get(key);
    if (i === undefined) {
      i = element.positions.length / 3;
      element.index.set(key, i);
      element.positions.push(x, surface.height(x, z) + metres(baseOffset(x, z) + extraHeight(x, z) + MARKING_LIFT_M), z);
      element.normals.push(...surface.normal(x, z));
      element.uvs.push(PALETTE_U[colour], 0.5);
    }
    return i;
  };
  let source = 0;
  // A white symbol painted on a blue fill (the access symbol, the P, a bicycle) claims its area before the fill, so the
  // fill is cut around it instead of the two colours sharing one plane.
  const onFill = (piece) => piece.colour === "white" && ON_FILL_KINDS.has(piece.kind);
  const drawOrder = [...markings.pieces.filter(onFill), ...markings.pieces.filter((piece) => !onFill(piece))];
  for (const piece of drawOrder) {
    const identity = piece.partId ? { objectId: piece.objectId, partId: piece.partId, ownerId: piece.ownerId } : null;
    // paint beyond EXTENT lies on the context ground, drawn there
    if (!inMarkingExtent(piece.rings[0].reduce((a, q) => [a[0] + q[0] / piece.rings[0].length, a[1] + q[1] / piece.rings[0].length], [0, 0]))) {
      if (identity) droppedRoadParts.push({ ...identity, reason: "outside-extent" });
      continue;
    }
    const paintId = piece.id ?? piece.partId ?? piece.record ?? pieceKey(piece, p => sceneToTm(...p));
    const group = markingGroup(piece) ?? { id: paintId, parking: false };
    if (!elements.has(group.id)) elements.set(group.id, { ...group, kinds: [], estimated: [], positions: [], normals: [], uvs: [], indices: [], index: new Map(), paintSources: [] });
    const element = elements.get(group.id);
    const triangles = [];
    const faces = [];
    let sourceAreaScene = 0, emittedAreaScene = 0;
    const [outer, ...holes] = piece.rings;
    const contour = outer.map(([x, z]) => new Vector2(x, z));
    const holeVectors = holes.map((ring) => ring.map(([x, z]) => new Vector2(x, z)));
    const all = [...outer, ...holes.flat()];
    for (const [a, b, c] of ShapeUtils.triangulateShape(contour, holeVectors)) {
      source += 1;
      const flat = [all[a], all[b], all[c]];
      sourceAreaScene += Math.abs((flat[1][0]-flat[0][0])*(flat[2][1]-flat[0][1])-(flat[1][1]-flat[0][1])*(flat[2][0]-flat[0][0]))/2;
      const clipped = cuts.reduce((parts, {triangle, bounds: b}) => parts.flatMap(part =>
        part.every(p => p[0] <= b[0]) || part.every(p => p[1] <= b[1]) || part.every(p => p[0] >= b[2]) || part.every(p => p[1] >= b[3])
          ? [part] : subtractConvex(part, triangle)), [flat]).flatMap(splitAlong).flatMap(fan);
      const near = extraHeight.near ?? (() => false);
      for (const tri of clipped.flatMap(t => splitFine(t, metres(RAISED_EDGE_M), near)).flatMap((t) => conform(t, surface)).flatMap(claim).flatMap(fan)) {
        // Upward face (+y): the (x, z) cross product of the edges must be negative.
        const cross = (tri[1][0] - tri[0][0]) * (tri[2][1] - tri[0][1]) - (tri[1][1] - tri[0][1]) * (tri[2][0] - tri[0][0]);
        if (Math.abs(cross) < 1e-10) continue;
        const ordered = cross < 0 ? tri : [tri[0], tri[2], tri[1]];
        const face = ordered.map((p) => vertex(element, p, piece.colour));
        element.indices.push(...face);
        faces.push(face);
        triangles.push(ordered.map(p => [...p]));
        emittedAreaScene += Math.abs(cross) / 2;
      }
    }
    if (faces.length) {
      element.paintSources.push({ id: paintId, faces });
      element.kinds.push(piece.kind);
      element.estimated.push(Boolean(piece.estimated));
    }
    if (identity) {
      if (triangles.length) roadParts.push({ ...identity, sourceAreaScene, emittedAreaScene, triangles });
      else droppedRoadParts.push({ ...identity, reason: "no-emitted-triangles" });
    }
  }
  const roadEmission = {
    source: "Road_Markings after extent, exclusion and paint claims; before outline-preserving decimation",
    parts: roadParts, dropped: droppedRoadParts,
    summary: {
      emittedRoadObjects: [...new Set(roadParts.map(p => p.objectId))],
      emittedRoadParts: roadParts.map(p => p.partId),
      droppedRoadParts: droppedRoadParts.map(p => p.partId),
    },
  };

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
  // Decimation (lib/decimate.mjs), per element: every outline vertex of the paint stays, so each dash, bar and line keeps
  // its plan geometry; only the partition's interior slivers collapse where the terrain is flat within
  // PAINT_DECIMATE_TOLERANCE_M (1 mm, lib/groundNodes.mjs), so the paint never sinks into the ground it lies above.
  // The receipt (qa/paintReceipt.mjs) reads each element's final world-space primitive before its node pivot is taken out.
  const receipts = new Map();
  const decimated = { before: 0, after: 0 };
  let sourceTriangles = 0, vertices = 0, triangles = 0, nodes = 0;
  const names = new Map();
  for (const element of elements.values()) {
    if (!element.indices.length) continue;
    let primitive = { positions: Float32Array.from(element.positions), normals: Float32Array.from(element.normals), uvs: Float32Array.from(element.uvs), indices: element.indices };
    const sourcePositions = primitive.positions;
    sourceTriangles += element.indices.length / 3;
    if (decimate) {
      const out = await decimateDecal({
        positions: primitive.positions, indices: element.indices, toleranceM: PAINT_DECIMATE_TOLERANCE_M, unitsPerMetre: SCENE_UNITS_PER_METRE,
        attributes: [{ array: primitive.normals, size: 3 }, { array: primitive.uvs, size: 2 }],
      });
      decimated.before += out.before;
      decimated.after += out.after;
      primitive = { positions: out.positions, normals: out.attributes[0].array, uvs: out.attributes[1].array, indices: Array.from(out.indices) };
    }
    for (const row of finalPaintReceipt({ primitive, sourcePositions, sourcePieces: element.paintSources })) {
      if (receipts.has(row.id)) receipts.get(row.id).triangles.push(...row.triangles);
      else receipts.set(row.id, row);
    }
    const kind = markingKind(element.kinds, element.parking);
    const name = nodeName("Road_Markings", element.id);
    if (names.has(name)) throw new Error(`markings: elements ${names.get(name)} and ${element.id} share the node name ${name}`);
    names.set(name, element.id);
    const node = emitGroundNode(glb, {
      name, id: element.id, kind, category: "marking", collection: `Ground/Markings/${kind}`,
      primitives: [{ ...primitive, material }],
      extras: { pieces: element.paintSources.length, pieceKinds: [...new Set(element.kinds)], estimatedPieces: element.estimated.filter(Boolean).length },
    });
    if (node === null) continue;
    nodes += 1;
    vertices += primitive.positions.length / 3;
    triangles += primitive.indices.length / 3;
  }
  if (decimate) console.log(`markings: decimated ${decimated.before} -> ${decimated.after} triangles in ${nodes} element nodes (paint outlines locked)`);
  const paintEmission = [...receipts.values()];
  const detected = markings.pieces.filter((p) => !p.estimated).length;
  // the Ground/Markings collection node itself (lib/glb.mjs groupRoots): it holds the inventory, the elements its children
  glb.addNode({
    name: "Road_Markings",
    extras: {
      elementNodes: nodes,
      elementNodesNote: "every marking element (a road marking object, or the paint of one parking lot) is its own node Road_Markings_<id> with extras.editable (lib/groundNodes.mjs); this collection node holds no geometry",
      markingsDetected: detected,
      markingsEstimated: markings.pieces.length - detected,
      source: markings.source,
      note: "road-section and junction records generated as strokes, crossing grids and glyph templates; source evidence and estimated dimensions are recorded per marking",
      regular: markings.log?.regular ? {
        fittedLines: markings.log.regular.chains, straightRuns: markings.log.regular.straightRuns, arcs: markings.log.regular.arcs,
        crossings: markings.log.regular.crossings, templates: markings.log.regular.glyphs,
      } : null,
      estimatedStallDividers: markings.pieces.filter((p) => p.estimated && p.kind === "parking_line").length,
      report: { ...markings.pieceReport, ...roadEmission.summary },
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
  }, { collectionNode: "Ground/Markings" });
  return { vertices, triangles, nodes, sourceTriangles: source, conformedTriangles: sourceTriangles, roadEmission, paintEmission };
}

export const describeMarkings = ({pieces, humps=[]}) => `road records: ${pieces.length} paint pieces, ${humps.length} humps`;
