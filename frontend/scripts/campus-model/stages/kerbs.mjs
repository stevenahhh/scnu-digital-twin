// Kerb stage (plan uhf-ground-roads-routing todo 11): 3D kerb ribbons on the A003 walkway outlines, the gutter band on
// their road side, the raised sidewalk slab inside the A003 rings and dropped kerbs at every crossing that touches one.
//
// Kerb lines are the A003 outlines (closed rings and open lines; network/surfaces.mjs `outlines`), cut into pieces of
// at most PIECE_M. A piece gets a kerb when exactly one side of it is walkway (inside an A003 ring: the slab side) or,
// on an open line, when one side is road (ASPHALT/LOT in the label raster) and the other not; no kerb between two
// paved areas (both sides walkway, or the far side PAVING/BICYCLE/KERB: a plaza, a building apron, another walkway).
// Kerbs are never extrapolated onto a road edge without an A003 outline.
//
// A kerb is a KERB_WIDTH_M (0.20 m) ribbon on the walkway side of the line, its outer face on the line, from
// KERB_BURIED_M below the terrain to KERB_EXPOSED_M (0.15 m, ASSUMED: within the 0.25 m legal cap, asserted) above it;
// only its top, outer face and run ends are drawn (the inner face is under the slab). The slab: inside the A003 rings
// the walkway decals stand KERB_EXPOSED_M higher (slabHeight), falling to 0 over FEATHER_M at every walkway edge without
// a kerb (no cliff towards a plaza or apron) and at 1/12 (DROP_RAMP, RAMP_RUN_M 1.8 m) towards each dropped kerb.
// Dropped kerbs: every kerb piece within CROSSING_REACH_M (1.0 m) of a crosswalk polygon (docs/assets/data/
// crosswalks_wgs84.geojson, CW_001-CW_031), widened by DROP_FLANK_M (0.5 m) each side along the kerb, has height 0
// (DROP_STEP_M 0 cm); kerbs and slab rise from it at 1/12, so the 1.5 m landing (DROP_LANDING_M) beyond the ramp is
// level. The gutter: a GUTTER_M (0.35 m, 형식4 default) darker asphalt band (Ground_Gutter, precedence 3.5) on the road
// side of every kerb piece that faces a road. groundHeightAt(x, z) = terrain + slab: the height sidecar (todo 28)
// and the furniture and lamps stand on it. Every height and width here is an estimate, not a survey value.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sceneToTm, tmToScene } from "../../../src/geo/epsg5186.mjs";
import { EXTENT, SCENE_UNITS_PER_METRE, geoToModel } from "../lib/frame.mjs";
import { pointInRing, segmentDistance } from "../lib/geometry.mjs";
import { Kit, rgb } from "../lib/solids.mjs";
import { SURFACE_CLASS } from "../lib/surfaceClass.mjs";
import { SURFACE_LIFT_M } from "./surfaces.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CROSSWALKS = path.resolve(HERE, "../../../..", "docs", "assets", "data", "crosswalks_wgs84.geojson");
const UNIT = SCENE_UNITS_PER_METRE;

export const KERB_WIDTH_M = 0.2;
export const KERB_STONE_M = 0.25;
export const KERB_EXPOSED_M = 0.15;
export const KERB_LEGAL_CAP_M = 0.25;
export const KERB_BURIED_M = KERB_STONE_M - KERB_EXPOSED_M;
export const GUTTER_M = 0.35;
export const DROP_RAMP = 1 / 12;
export const DROP_LANDING_M = 1.5;
export const DROP_STEP_M = 0.0;
export const DROP_FLANK_M = 0.5;
export const CROSSING_REACH_M = 1.0;
export const FEATHER_M = 0.5;
const PIECE_M = 0.5;
const SIDE_PROBE_M = 0.6;
const GUTTER_PRECEDENCE = 3.5;
// Walkway decals on a raised slab sit SLAB_DECAL_DROP_M under the slab top, so the kerb's concrete top shows.
export const SLAB_DECAL_DROP_M = 0.003;
const KERB_COLOUR = rgb("#b9b5ac");
const PAVED = new Set([SURFACE_CLASS.PAVING, SURFACE_CLASS.BICYCLE, SURFACE_CLASS.KERB]);
const ROAD = new Set([SURFACE_CLASS.ASPHALT, SURFACE_CLASS.LOT]);

// ---------------------------------------------------------------- crossings
export async function loadCrossings() {
  const data = JSON.parse(await Bun.file(CROSSWALKS).text());
  return data.features.map((f) => ({ id: f.properties.id, ring: f.geometry.coordinates[0].map(([lon, lat]) => sceneToTm(...geoToModel(lon, lat))) }));
}

// ---------------------------------------------------------------- segment index (model units)
class SegmentIndex {
  constructor(cell) {
    this.cell = cell;
    this.cells = new Map();
    this.segments = [];
  }

  add(a, b, data) {
    const k = this.segments.push({ a, b, data }) - 1;
    const [x0, x1] = [Math.min(a[0], b[0]), Math.max(a[0], b[0])].map((v) => Math.floor(v / this.cell));
    const [z0, z1] = [Math.min(a[1], b[1]), Math.max(a[1], b[1])].map((v) => Math.floor(v / this.cell));
    for (let i = x0; i <= x1; i += 1) for (let j = z0; j <= z1; j += 1) {
      const key = `${i},${j}`;
      if (!this.cells.has(key)) this.cells.set(key, []);
      this.cells.get(key).push(k);
    }
  }

  // Distance (model units) to the nearest segment within `reach`, else Infinity.
  nearest(p, reach) {
    let best = Infinity;
    const r = Math.ceil(reach / this.cell);
    const ci = Math.floor(p[0] / this.cell);
    const cj = Math.floor(p[1] / this.cell);
    const seen = new Set();
    for (let i = ci - r; i <= ci + r; i += 1) for (let j = cj - r; j <= cj + r; j += 1) {
      for (const k of this.cells.get(`${i},${j}`) ?? []) {
        if (seen.has(k)) continue;
        seen.add(k);
        const s = this.segments[k];
        best = Math.min(best, segmentDistance(p, s.a, s.b));
      }
    }
    return best <= reach ? best : Infinity;
  }
}

// ---------------------------------------------------------------- planning
const toModel = (ring) => ring.map(([E, N]) => tmToScene(E, N));
const insidePolygon = (p, polygon) => pointInRing(p, polygon[0]) && !polygon.slice(1).some((hole) => pointInRing(p, hole));
const ringDistance = (p, ring) => ring.reduce((best, a, i) => Math.min(best, segmentDistance(p, a, ring[(i + 1) % ring.length])), Infinity);

// walkways: polygons [outer, ...holes] in EPSG:5186 (the A003 layers); outlines: [{ ufid, closed, line (EPSG:5186) }];
// crossings: [{ id, ring (EPSG:5186) }]; labelAt([x, z]) -> SURFACE_CLASS (model units); terrainAt(x, z) -> scene y.
export function planKerbs({ walkways, outlines, crossings, labelAt, terrainAt, exposedM = KERB_EXPOSED_M, warn = console.warn }) {
  if (exposedM > KERB_LEGAL_CAP_M) throw new Error(`kerb exposed height ${exposedM} m exceeds the legal cap ${KERB_LEGAL_CAP_M} m`);
  const rampRun = exposedM / DROP_RAMP;
  const polygons = walkways.map((polygon) => {
    const model = polygon.map(toModel);
    const xs = model[0].map((p) => p[0]);
    const zs = model[0].map((p) => p[1]);
    return { model, box: [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)] };
  });
  const inWalkway = (p) => polygons.some(({ model, box }) => p[0] >= box[0] && p[0] <= box[2] && p[1] >= box[1] && p[1] <= box[3] && insidePolygon(p, model));
  const crossingRings = crossings.map((c) => ({ id: c.id, ring: toModel(c.ring) }));
  const probe = SIDE_PROBE_M * UNIT;

  // ---- pieces of every outline with their kerb decision
  const lines = [];
  for (const [lineIndex, outline] of outlines.entries()) {
    const line = toModel(outline.line);
    const pieces = [];
    let s = 0;
    for (let i = 0; i + 1 < line.length; i += 1) {
      const a = line[i];
      const b = line[i + 1];
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (length < 1e-6) continue;
      const n = Math.max(1, Math.ceil(length / (PIECE_M * UNIT)));
      const u = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
      const left = [-u[1], u[0]];
      for (let k = 0; k < n; k += 1) {
        const p = [a[0] + (b[0] - a[0]) * (k / n), a[1] + (b[1] - a[1]) * (k / n)];
        const q = [a[0] + (b[0] - a[0]) * ((k + 1) / n), a[1] + (b[1] - a[1]) * ((k + 1) / n)];
        const mid = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
        const l = [mid[0] + left[0] * probe, mid[1] + left[1] * probe];
        const r = [mid[0] - left[0] * probe, mid[1] - left[1] * probe];
        const inL = inWalkway(l);
        const inR = inWalkway(r);
        let inward = null;
        let reason = null;
        if (inL !== inR) inward = inL ? left : [-left[0], -left[1]];
        else if (inL && inR) reason = "walkway both sides";
        else {
          const roadL = ROAD.has(labelAt(l));
          const roadR = ROAD.has(labelAt(r));
          if (roadL !== roadR) inward = roadL ? [-left[0], -left[1]] : left;
          else reason = "side undetermined";
        }
        let outerLabel = null;
        if (inward) {
          outerLabel = labelAt([mid[0] - inward[0] * probe, mid[1] - inward[1] * probe]);
          if (PAVED.has(outerLabel)) {
            reason = "paved both sides";
            inward = null;
          }
        }
        const lengthM = Math.hypot(q[0] - p[0], q[1] - p[1]) / UNIT;
        pieces.push({ lineIndex, p, q, s0: s, s1: s + lengthM, inward, reason, road: inward ? ROAD.has(outerLabel) : false });
        s += lengthM;
      }
    }
    lines.push({ ufid: outline.ufid, closed: outline.closed, line, pieces });
  }

  // ---- dropped kerbs: kerb pieces within CROSSING_REACH_M of a crossing, widened by DROP_FLANK_M along the kerb
  const reach = CROSSING_REACH_M * UNIT;
  const dropped = [];
  const touched = new Set();
  for (const lineEntry of lines) {
    const kerbPieces = lineEntry.pieces.filter((piece) => piece.inward);
    for (const crossing of crossingRings) {
      const near = kerbPieces.filter((piece) => {
        const mid = [(piece.p[0] + piece.q[0]) / 2, (piece.p[1] + piece.q[1]) / 2];
        return pointInRing(mid, crossing.ring) || ringDistance(mid, crossing.ring) <= reach;
      });
      if (!near.length) continue;
      touched.add(crossing.id);
      // contiguous runs of touching pieces
      near.sort((x, y) => x.s0 - y.s0);
      let run = null;
      const flush = () => {
        if (!run) return;
        dropped.push({ cwId: crossing.id, lineIndex: run.lineIndex, ufid: lineEntry.ufid, from: Math.max(0, run.from - DROP_FLANK_M), to: run.to + DROP_FLANK_M, crossFrom: run.from, crossTo: run.to, pieces: run.pieces });
        run = null;
      };
      for (const piece of near) {
        if (run && piece.s0 - run.to < 1e-6) {
          run.to = piece.s1;
          run.pieces.push(piece);
        } else {
          flush();
          run = { lineIndex: piece.lineIndex, from: piece.s0, to: piece.s1, pieces: [piece] };
        }
      }
      flush();
    }
  }
  for (const crossing of crossingRings) if (!touched.has(crossing.id)) warn(`crossing ${crossing.id} touches no kerb (estimated connector)`);

  // Dropped segments (the line between from and to) and walkway edges without a kerb, indexed for distance queries.
  const dropIndex = new SegmentIndex(2 * UNIT);
  for (const drop of dropped) {
    for (const piece of lines[drop.lineIndex].pieces) {
      if (piece.s1 > drop.from + 1e-9 && piece.s0 < drop.to - 1e-9) {
        piece.dropped = drop.cwId;
        const t0 = Math.max(0, (drop.from - piece.s0) / (piece.s1 - piece.s0));
        const t1 = Math.min(1, (drop.to - piece.s0) / (piece.s1 - piece.s0));
        const at = (t) => [piece.p[0] + (piece.q[0] - piece.p[0]) * t, piece.p[1] + (piece.q[1] - piece.p[1]) * t];
        dropIndex.add(at(t0), at(t1), drop.cwId);
      }
    }
  }
  const featherIndex = new SegmentIndex(2 * UNIT);
  const kerbIndex = new SegmentIndex(2 * UNIT);
  for (const lineEntry of lines) for (const piece of lineEntry.pieces) if (piece.inward) kerbIndex.add(piece.p, piece.q);
  for (const { model } of polygons) {
    for (const ring of model) {
      for (let i = 0; i < ring.length; i += 1) {
        const a = ring[i];
        const b = ring[(i + 1) % ring.length];
        const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const n = Math.max(1, Math.ceil(length / (PIECE_M * UNIT)));
        for (let k = 0; k < n; k += 1) {
          const p = [a[0] + (b[0] - a[0]) * (k / n), a[1] + (b[1] - a[1]) * (k / n)];
          const q = [a[0] + (b[0] - a[0]) * ((k + 1) / n), a[1] + (b[1] - a[1]) * ((k + 1) / n)];
          const mid = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
          if (kerbIndex.nearest(mid, 0.05 * UNIT) === Infinity) featherIndex.add(p, q);
        }
      }
    }
  }

  const rampReach = rampRun * UNIT;
  const featherReach = FEATHER_M * UNIT;
  // Height factor 0..1 of the kerb/slab at a plan point from the dropped kerbs (1/12 ramp).
  const dropFactor = (p) => Math.min(1, dropIndex.nearest(p, rampReach) / rampReach);
  // Slab height (metres) above the terrain at a model point.
  const slabHeight = (x, z) => {
    const p = [x, z];
    if (!inWalkway(p)) return 0;
    const feather = Math.min(1, featherIndex.nearest(p, featherReach) / featherReach);
    return exposedM * Math.min(dropFactor(p), feather);
  };
  // Kerb top (metres above terrain) at a point on a kerb line.
  const kerbHeight = (p) => exposedM * dropFactor(p);
  // Points within this reach of a ramp or feather edge need a fine tessellation to follow the slab.
  const nearSlabChange = (p, reachM) => dropIndex.nearest(p, (rampRun + reachM) * UNIT) < Infinity || featherIndex.nearest(p, (FEATHER_M + reachM) * UNIT) < Infinity;

  const kerbPieces = lines.flatMap((l) => l.pieces.filter((piece) => piece.inward));
  return {
    lines,
    pieces: kerbPieces,
    dropped,
    touched: [...touched].sort(),
    slabHeight,
    kerbHeight,
    nearSlabChange,
    groundHeightAt: (x, z) => terrainAt(x, z) + slabHeight(x, z) * UNIT,
    exposedM,
    crossings: crossingRings.length,
  };
}

// ---------------------------------------------------------------- geometry
// Kerb boxes (Kit, vertex colours): per piece the top and the outer face, run ends capped. Heights follow the terrain
// at every corner and the kerb height (dropped kerbs) along the line.
export function kerbSolids(plan, terrainAt) {
  const kit = new Kit();
  let maxHeight = 0;
  const width = KERB_WIDTH_M * UNIT;
  for (const lineEntry of plan.lines) {
    const pieces = lineEntry.pieces;
    pieces.forEach((piece, i) => {
      if (!piece.inward) return;
      const [nx, nz] = piece.inward;
      const a = piece.p;
      const b = piece.q;
      const ai = [a[0] + nx * width, a[1] + nz * width];
      const bi = [b[0] + nx * width, b[1] + nz * width];
      const ha = plan.kerbHeight(a);
      const hb = plan.kerbHeight(b);
      maxHeight = Math.max(maxHeight, ha, hb);
      const bottom = (p) => [p[0], terrainAt(p[0], p[1]) - KERB_BURIED_M * UNIT, p[1]];
      const top = (p, h) => [p[0], terrainAt(p[0], p[1]) + h * UNIT, p[1]];
      const prevKerb = i > 0 && pieces[i - 1].inward;
      const nextKerb = i + 1 < pieces.length && pieces[i + 1].inward;
      if (ha < 1e-4 && hb < 1e-4) return; // dropped: flush with the road, nothing above ground
      kit.hexa(
        [bottom(a), bottom(b), bottom(bi), bottom(ai), top(a, ha), top(b, hb), top(bi, hb), top(ai, ha)],
        KERB_COLOUR,
        { top: true, bottom: false, sides: [true, !nextKerb, false, !prevKerb] },
      );
    });
  }
  return { kit, maxHeight };
}

// Gutter bands (EPSG:5186 polygons, one per contiguous run of road-facing kerb pieces) as Ground_Gutter layers.
export function gutterLayers(plan) {
  const out = [];
  const width = GUTTER_M * UNIT;
  for (const lineEntry of plan.lines) {
    let run = [];
    const flush = () => {
      if (run.length) {
        const outer = run.map((piece) => [piece.p[0] - piece.inward[0] * width, piece.p[1] - piece.inward[1] * width]);
        const last = run.at(-1);
        outer.push([last.q[0] - last.inward[0] * width, last.q[1] - last.inward[1] * width]);
        const inner = [...run.map((piece) => piece.p), last.q];
        const ring = [...inner, ...outer.reverse()].map(([x, z]) => sceneToTm(x, z));
        let area = 0;
        for (let i = 0; i < ring.length; i += 1) area += ring[i][0] * ring[(i + 1) % ring.length][1] - ring[(i + 1) % ring.length][0] * ring[i][1];
        out.push({ cls: "ASPHALT", mesh: "Ground_Gutter", label: SURFACE_CLASS.ASPHALT, precedence: GUTTER_PRECEDENCE, source: "project-estimated", source_ref: `gutter A003 ${lineEntry.ufid}`, estimated: true, rings: [area > 0 ? ring : ring.reverse()] });
      }
      run = [];
    };
    for (const piece of lineEntry.pieces) {
      if (piece.inward && piece.road) run.push(piece);
      else flush();
    }
    flush();
  }
  return out;
}

// ---------------------------------------------------------------- stage
// surfaces: buildSurfaces() result; groundInfo: the label raster; surface: topographySurface().
export async function buildKerbs({ glb, surfaces, groundInfo, surface, crossings }) {
  const { width, height, px, labels } = groundInfo;
  const { minX, minZ } = EXTENT;
  const labelAt = ([x, z]) => {
    const i = Math.floor((x - minX) * px);
    const j = Math.floor((z - minZ) * px);
    return i < 0 || j < 0 || i >= width || j >= height ? SURFACE_CLASS.NATURAL : labels[j * width + i];
  };
  const terrainAt = (x, z) => surface.height(x, z);
  const warnings = [];
  const plan = planKerbs({
    walkways: surfaces.layers.filter((l) => l.walkway).map((l) => l.rings),
    outlines: surfaces.outlines,
    crossings: crossings ?? (await loadCrossings()),
    labelAt,
    terrainAt,
    warn: (message) => warnings.push(message),
  });
  for (const message of warnings) console.warn(message);
  const { kit, maxHeight } = kerbSolids(plan, terrainAt);
  if (maxHeight > KERB_LEGAL_CAP_M) throw new Error(`kerb height ${maxHeight} m exceeds the legal cap ${KERB_LEGAL_CAP_M} m`);
  const material = glb.addMaterial({
    name: "Kerb",
    pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.85 },
    extras: { estimated: true, note: "kerb stone 0.20 x 0.25 m, 0.15 m exposed (assumed, within the 0.25 m legal cap); colour estimated" },
  });
  const kerbLines = plan.lines
    .filter((l) => l.pieces.some((piece) => piece.inward))
    .map((l, k) => ({
      id: `KB_${l.ufid}_${k}`,
      ufid: l.ufid,
      points5186: [l.pieces[0].p, ...l.pieces.map((piece) => piece.q)].map(([x, z]) => sceneToTm(x, z)),
      height_m: plan.exposedM,
      dropped: plan.dropped.filter((d) => d.lineIndex === l.pieces[0].lineIndex).map((d) => ({ cwId: d.cwId, from: Number(d.from.toFixed(2)), to: Number(d.to.toFixed(2)) })),
    }));
  glb.addNode({
    name: "Kerbs",
    mesh: glb.addMesh("Kerbs", [kit.toPrimitive(material)]),
    extras: {
      estimated: true,
      kerbWidthM: KERB_WIDTH_M, kerbStoneM: KERB_STONE_M, kerbExposedM: plan.exposedM, legalCapM: KERB_LEGAL_CAP_M,
      gutterM: GUTTER_M, dropRamp: "1/12", dropLandingM: DROP_LANDING_M, dropStepM: DROP_STEP_M,
      droppedAt: plan.touched,
      note: "kerbs on NGII A003 outlines only; heights, widths and the gutter are estimates (추정), not survey values",
    },
  }, { root: true });
  const skipped = plan.lines.flatMap((l) => l.pieces).filter((piece) => !piece.inward).reduce((acc, piece) => ({ ...acc, [piece.reason]: (acc[piece.reason] ?? 0) + 1 }), {});
  console.log(
    `kerbs: ${plan.pieces.length} segments (${(plan.pieces.reduce((sum, piece) => sum + (piece.s1 - piece.s0), 0)).toFixed(0)} m) on ${kerbLines.length} A003 outlines, ` +
    `${plan.touched.length} dropped (at ${plan.touched.join(" ")}) of ${plan.crossings} crossings, max height ${maxHeight.toFixed(3)} m; ` +
    `no kerb: ${Object.entries(skipped).map(([k, v]) => `${k} ${v}`).join(", ")}`,
  );
  return { plan, kerbLines, gutters: gutterLayers(plan), groundHeightAt: plan.groundHeightAt, warnings };
}

// Height offset (metres above the terrain) of a ground decal: walkway layers stand on the slab, SLAB_DECAL_DROP_M under
// its top (so the kerb's top shows), blending to their precedence lift where the slab falls to 0.
export const groundDecalOffset = (plan) => (layer, x, z) => {
  const lift = SURFACE_LIFT_M(layer.precedence);
  if (!layer.walkway) return lift;
  const slab = plan.slabHeight(x, z);
  const t = Math.min(1, slab / 0.03);
  return slab + lift * (1 - t) - SLAB_DECAL_DROP_M * t;
};

// Fine tessellation (0.25 m) of walkway decals near the slab ramps and feathered edges.
export const slabRefine = (plan) => ({ maxEdgeM: 0.25, needsFine: (layer, p, reachModel) => layer.walkway && plan.nearSlabChange(p, reachModel / UNIT) });
