// Wall-local facade records (§13). GIS supplies placement; photographs supply only the pattern.
import { createHash } from "node:crypto";
import { checkWallMapping, wallsOf, wallCoordinates } from "./anchors.mjs";
import { sceneToTm } from "../../../src/geo/epsg5186.mjs";

const KINDS = new Set(["window", "blank", "door", "glazing", "louver", "stair", "vent"]);
const COLOUR = /^#[0-9a-f]{6}$/i;
const positive = n => Number.isFinite(n) && n > 0;
export class FacadeGridError extends Error {
  constructor(building, detail) {
    super(`${building}: facade grid ${detail}`);
    this.name = "FacadeGridError";
    this.building = building;
  }
}

export function compileFacadeGrid(doc, footprint, entrances = []) {
  const fail = message => { throw new FacadeGridError(doc?.building, message); };
  if (!/^BLD_/.test(doc?.building ?? "") || doc.estimated !== true) fail("needs building and estimated:true");
  if (!footprint) fail("missing footprint");
  const stale = checkWallMapping(doc.building, footprint, footprint.walls);
  if (stale.length) fail(stale.join("; "));
  if (!Array.isArray(doc.storeys) || !doc.storeys.length || doc.storeys.some(s => !positive(s.hM))) fail("invalid storeys");
  if (!doc.walls || Array.isArray(doc.walls) || typeof doc.walls !== "object") fail("needs walls");
  const frames = wallsOf(doc.building, footprint);
  const walls = new Map(), looks = new Map(), recesses = [];
  for (const [id, spec] of Object.entries(doc.walls)) {
    const frame = frames.find(w => w.wall === id);
    if (!frame) fail(`unknown wall ${id}`);
    const { pitchM, count, offsetM } = spec.bays ?? {};
    if (!positive(pitchM) || !Number.isInteger(count) || count < 1 || !Number.isFinite(offsetM) || offsetM < 0 ||
        offsetM + count * pitchM > frame.lengthM + 1e-6) fail(`${id} bays exceed wall or have invalid count/pitch/offset`);
    if (!KINDS.has(spec.default)) fail(`${id} unknown default cell`);
    if (!["T0", "T1", "T2", "T3", "T4"].includes(spec.evidence?.tier) || !spec.evidence.refs?.length) fail(`${id} missing evidence`);
    const material = /^(brick|render|concrete|panel|stone|metal|glass):(#[0-9a-f]{6})$/i.exec(spec.materials?.wall ?? "");
    if (!material || !COLOUR.test(spec.materials?.glass ?? "") || !COLOUR.test(spec.materials?.frame ?? "")) fail(`${id} invalid materials`);
    if (spec.outside !== undefined && !["blank", "legacy"].includes(spec.outside)) fail(`${id} invalid outside treatment`);
    if (spec.surfaceEdges !== undefined && !Array.isArray(spec.surfaceEdges)) fail(`${id} invalid surface edges`);
    const surfaceEdges = spec.surfaceEdges ?? [], surfacePoints = [];
    for (const edge of surfaceEdges) {
      if (![edge.A, edge.B].every(p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite)) ||
          typeof edge.source !== "string" || !edge.source.trim()) fail(`${id} invalid surface edge`);
      const a = wallCoordinates(edge.A, frame), b = wallCoordinates(edge.B, frame);
      if (Math.abs(a.sM - b.sM) < 1e-8 || Math.max(a.sM, b.sM) <= 0 || Math.min(a.sM, b.sM) >= frame.lengthM) {
        fail(`${id} surface edge has no wall span`);
      }
      surfacePoints.push(a.sM, b.sM);
    }
    const surfaceStart = Math.min(0, ...surfacePoints), surfaceEnd = Math.max(frame.lengthM, ...surfacePoints);
    const window = spec.window;
    if (!window || !positive(window.wM) || window.wM > pitchM || !positive(window.hM) ||
        !Number.isFinite(window.sillM) || window.sillM < 0 ||
        doc.storeys.some(s => window.hM + window.sillM > s.hM)) fail(`${id} window exceeds cell`);
    if (spec.cells !== undefined && (!Array.isArray(spec.cells) || spec.cells.length !== doc.storeys.length ||
        spec.cells.some(row => row != null && (!Array.isArray(row) || row.length !== count || row.some(c => !KINDS.has(c)))))) fail(`${id} invalid cells`);
    for (const [name, accent] of Object.entries(spec.accents ?? {})) {
      if (!["piers", "frames", "band"].includes(name) || !COLOUR.test(accent.colour)) fail(`${id} invalid accent ${name}`);
      if (name !== "band" && (!Array.isArray(accent.bays) || accent.bays.some(b => !Number.isInteger(b) || b < 0 || b >= count))) fail(`${id} invalid accent bays`);
      if (name === "piers" && (!positive(accent.widthM) || accent.widthM >= pitchM)) fail(`${id} invalid pier width`);
      if (name === "band" && (!positive(accent.hM) || doc.storeys.some(s => accent.hM >= s.hM))) fail(`${id} invalid band height`);
    }
    const overrides = new Map();
    for (const override of spec.overrides ?? []) {
      const key = `${override.storey}/${override.bay}`;
      if (!Number.isInteger(override.storey) || override.storey < 0 || override.storey >= doc.storeys.length ||
          !Number.isInteger(override.bay) || override.bay < 0 || override.bay >= count || overrides.has(key)) fail(`${id} invalid override ${key}`);
      if (override.cell !== undefined && !KINDS.has(override.cell)) fail(`${id} invalid override cell`);
      overrides.set(key, override);
    }
    const byBay = new Map();
    for (const entry of entrances.filter(e => e.anchor.building === doc.building && e.anchor.wall === id)) {
      const bay = Math.floor((entry.anchor.sM - offsetM) / pitchM);
      if (bay < 0 || bay >= count || byBay.has(bay)) fail(`${id} entrance ${entry.id} outside grid or shares bay`);
      byBay.set(bay, entry);
    }
    for (const recess of spec.recesses ?? []) {
      const entry = [...byBay.values()].find(e => e.id === recess.entrance);
      if (!entry || !Number.isFinite(recess.backM) || recess.backM < 0 ||
          !(recess.depthM > recess.backM) || !positive(recess.hM) || recess.hM > doc.storeys[0].hM) {
        fail(`${id} invalid entrance recess ${recess.entrance}`);
      }
      recesses.push({ frame, s0M: entry.anchor.sM - entry.widthM / 2, s1M: entry.anchor.sM + entry.widthM / 2,
        backM: recess.backM, depthM: recess.depthM, hM: recess.hM });
    }
    const crossingDoors = [...byBay].filter(([bay, entry]) =>
      entry.anchor.sM - entry.widthM / 2 < offsetM + bay * pitchM ||
      entry.anchor.sM + entry.widthM / 2 > offsetM + (bay + 1) * pitchM);
    for (const [, entry] of crossingDoors) {
      if (entry.anchor.sM - entry.widthM / 2 < 0 || entry.anchor.sM + entry.widthM / 2 > frame.lengthM) fail(`${id} entrance ${entry.id} extends beyond wall`);
    }
    const cells = [];
    let h0M = 0;
    doc.storeys.forEach((storey, s) => {
      const h1M = h0M + storey.hM;
      const add = (bay, s0M, s1M, kind, entrance = null, wholeDoor = false) => {
        if (s1M - s0M <= 1e-8) return;
        const override = overrides.get(`${s}/${bay}`);
        const win = { ...window, ...override?.window };
        if (!positive(win.wM) || win.wM > pitchM || !positive(win.hM) || !Number.isFinite(win.sillM) || win.sillM < 0 || win.sillM + win.hM > storey.hM) fail(`${id} override window exceeds cell`);
        const accent = spec.accents;
        const look = {
          cell: kind, pattern: "punched", texture: material[1], wall: material[2], glass: spec.materials.glass, frame: spec.materials.frame,
          bay: pitchM, windows: 1, windowWidth: win.wM / pitchM, windowHeight: win.hM / storey.hM, sill: win.sillM / storey.hM,
          ...(accent?.piers?.bays.includes(bay) ? { piers: { every: 1, width: accent.piers.widthM / pitchM, colour: accent.piers.colour } } : {}),
          ...(accent?.frames?.bays.includes(bay) ? { accent: { kind: "frame", bays: [0, 1, 2, 3], colour: accent.frames.colour } } : {}),
          ...(accent?.band ? { band: { height: accent.band.hM / storey.hM, colour: accent.band.colour } } : {}),
          ...(entrance ? { doorWidth: wholeDoor ? 1 : Math.min(entrance.widthM / pitchM, 1),
            windowCentre: wholeDoor ? 0.5 : (entrance.anchor.sM - s0M) / pitchM, entrance: { doors: spec.materials.glass } } : {}),
        };
        const key = `grid-${createHash("sha256").update(JSON.stringify(look)).digest("hex").slice(0, 16)}`;
        looks.set(key, { ...look, id: key });
        cells.push({ bay, storey: s, s0M, s1M, h0M, h1M, kind, look, tileId: key, entrance });
      };
      const pad = (from, to) => {
        if (spec.outside !== "legacy") { add(-1, from, to, "blank"); return; }
        for (let a = from; a < to - 1e-8; a += pitchM) {
          const b = Math.min(to, a + pitchM);
          cells.push({ bay: -1, storey: s, s0M: a, s1M: b, h0M, h1M, kind: "blank",
            legacy: true, uv0: 0, uv1: (b - a) / pitchM });
        }
      };
      pad(surfaceStart, offsetM);
      for (let bay = 0; bay < count; bay++) {
        const explicit = overrides.get(`${s}/${bay}`)?.cell ?? spec.cells?.[s]?.[bay];
        const entrance = s === 0 ? byBay.get(bay) : null;
        const kind = explicit ?? (entrance ? "door" : spec.default);
        if (entrance && kind !== "door") fail(`${id} entrance ${entrance.id} disagrees with cell ${bay}`);
        if (kind === "door" && !entrance) fail(`${id} door ${s}/${bay} has no entrance anchor`);
        const crossing = entrance && crossingDoors.some(([, entry]) => entry === entrance);
        add(bay, offsetM + bay * pitchM, offsetM + (bay + 1) * pitchM, crossing ? spec.default : kind, crossing ? null : entrance);
      }
      pad(offsetM + count * pitchM, surfaceEnd);
      if (s === 0) for (const [bay, entry] of crossingDoors) {
        const left = entry.anchor.sM - entry.widthM / 2, right = entry.anchor.sM + entry.widthM / 2;
        const clipped = cells.flatMap(cell => {
          if (cell.s1M <= left || cell.s0M >= right) return [cell];
          const pieces = [];
          const uv = at => (cell.uv0 ?? 0) + ((cell.uv1 ?? 1) - (cell.uv0 ?? 0)) * (at - cell.s0M) / (cell.s1M - cell.s0M);
          if (cell.s0M < left) pieces.push({ ...cell, s1M: left, uv1: uv(left) });
          if (cell.s1M > right) pieces.push({ ...cell, s0M: right, uv0: uv(right) });
          return pieces;
        });
        cells.splice(0, cells.length, ...clipped);
        add(bay, left, right, "door", entry, true);
        cells.sort((a, b) => a.s0M - b.s0M);
      }
      h0M = h1M;
    });
    walls.set(id, { ...frame, cells, surfaceEdges });
  }
  return { building: doc.building, estimated: true, walls, looks, recesses, fallbackWalls: frames.filter(w => !walls.has(w.wall)).map(w => w.wall) };
}

// Intersect a vertical facade edge with the recorded doorway volume in wall-local metres.
// The rear door plane is deliberately outside the cut; only the projecting masonry is opened.
export function recessCutsOnEdge(grid, aScene, bScene) {
  if (!grid) return [];
  const a = sceneToTm(...aScene), b = sceneToTm(...bScene);
  return grid.recesses.flatMap(r => {
    const p = wallCoordinates(a, r.frame), q = wallCoordinates(b, r.frame);
    let t0 = 0, t1 = 1;
    for (const [start, end, low, high] of [[p.sM, q.sM, r.s0M, r.s1M], [p.tM, q.tM, r.backM, r.depthM]]) {
      const delta = end - start;
      if (Math.abs(delta) < 1e-9) {
        if (start <= low || start >= high) return [];
      } else {
        const x = (low - start) / delta, y = (high - start) / delta;
        t0 = Math.max(t0, Math.min(x, y)); t1 = Math.min(t1, Math.max(x, y));
      }
    }
    return t1 - t0 > 1e-8 ? [{ t0, t1, hM: r.hM }] : [];
  });
}

export function clipFacadeQuad(rect, cuts) {
  let pieces = [rect];
  for (const cut of cuts) pieces = pieces.flatMap(p => {
    const a = Math.max(p.t0, cut.t0), b = Math.min(p.t1, cut.t1);
    const lo = Math.max(p.y0, cut.y0), hi = Math.min(p.y1, cut.y1);
    if (b <= a || hi <= lo) return [p];
    return [
      { ...p, t1: a }, { ...p, t0: b },
      { t0: a, t1: b, y0: p.y0, y1: lo }, { t0: a, t1: b, y0: hi, y1: p.y1 },
    ].filter(q => q.t1 - q.t0 > 1e-8 && q.y1 - q.y0 > 1e-8);
  });
  return pieces;
}

// Match exposed mesh edges to their GIS wall. No moving walls to the LOD4 image and no bay stretching.
// The 0.3 m allowance is the design's mass/footprint containment buffer, not a fit correction.
export function gridCellsOnEdge(grid, aScene, bScene) {
  if (!grid) return null;
  const a = sceneToTm(...aScene), b = sceneToTm(...bScene);
  for (const wall of grid.walls.values()) {
    const p = wallCoordinates(a, wall), q = wallCoordinates(b, wall);
    if (Math.abs(p.sM - q.sM) < 1e-8) continue;
    // Explicit source correspondence does not widen the automatic buffer. Both endpoints
    // must match the reviewed EPSG:5186 snapshot within 1 mm, in either direction.
    const near = (x, y) => Math.hypot(x[0] - y[0], x[1] - y[1]) <= 0.001;
    const surfaceEdge = wall.surfaceEdges.findIndex(e => (near(a, e.A) && near(b, e.B)) || (near(a, e.B) && near(b, e.A)));
    if (surfaceEdge < 0 && Math.max(Math.abs(p.tM), Math.abs(q.tM)) > 0.3 + 1e-6) continue;
    // Lateral mass tolerance must not permit uncovered strips beyond the ends of the GIS wall.
    // Explicit snapshots include end caps; unbound overhangs still fall back.
    if (surfaceEdge < 0 && (Math.min(p.sM, q.sM) < -1e-6 || Math.max(p.sM, q.sM) > wall.lengthM + 1e-6)) continue;
    const cells = wall.cells.flatMap(cell => {
      const tA = (cell.s0M - p.sM) / (q.sM - p.sM), tB = (cell.s1M - p.sM) / (q.sM - p.sM);
      const t0 = Math.max(0, Math.min(tA, tB)), t1 = Math.min(1, Math.max(tA, tB));
      if (t1 - t0 < 1e-8) return [];
      const u = t => (cell.uv0 ?? 0) + ((cell.uv1 ?? 1) - (cell.uv0 ?? 0)) *
        (p.sM + t * (q.sM - p.sM) - cell.s0M) / (cell.s1M - cell.s0M);
      return [{ ...cell, wall: wall.wall, ...(surfaceEdge >= 0 ? { surfaceEdge } : {}), t0, t1, u0: u(t0), u1: u(t1) }];
    });
    return cells.sort((c, d) => c.storey - d.storey || c.t0 - d.t0);
  }
  return null;
}
