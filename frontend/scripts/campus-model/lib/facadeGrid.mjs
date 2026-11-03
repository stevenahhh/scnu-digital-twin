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
  const walls = new Map(), looks = new Map();
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
    const cells = [];
    let h0M = 0;
    doc.storeys.forEach((storey, s) => {
      const h1M = h0M + storey.hM;
      const add = (bay, s0M, s1M, kind, entrance = null) => {
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
          ...(entrance ? { doorWidth: Math.min(entrance.widthM / pitchM, 1),
            windowCentre: (entrance.anchor.sM - s0M) / pitchM, entrance: { doors: spec.materials.glass } } : {}),
        };
        const key = `grid-${createHash("sha256").update(JSON.stringify(look)).digest("hex").slice(0, 16)}`;
        looks.set(key, { ...look, id: key });
        cells.push({ bay, storey: s, s0M, s1M, h0M, h1M, kind, look, tileId: key, entrance });
      };
      add(-1, 0, offsetM, "blank");
      for (let bay = 0; bay < count; bay++) {
        const explicit = overrides.get(`${s}/${bay}`)?.cell ?? spec.cells?.[s]?.[bay];
        const entrance = s === 0 ? byBay.get(bay) : null;
        const kind = explicit ?? (entrance ? "door" : spec.default);
        if (entrance && kind !== "door") fail(`${id} entrance ${entrance.id} disagrees with cell ${bay}`);
        if (kind === "door" && !entrance) fail(`${id} door ${s}/${bay} has no entrance anchor`);
        add(bay, offsetM + bay * pitchM, offsetM + (bay + 1) * pitchM, kind, entrance);
      }
      add(-1, offsetM + count * pitchM, frame.lengthM, "blank");
      h0M = h1M;
    });
    walls.set(id, { ...frame, cells });
  }
  return { building: doc.building, estimated: true, walls, looks, fallbackWalls: frames.filter(w => !walls.has(w.wall)).map(w => w.wall) };
}

// Match exposed mesh edges to their GIS wall. No moving walls to the LOD4 image and no bay stretching.
// The 0.3 m allowance is the design's mass/footprint containment buffer, not a fit correction.
export function gridCellsOnEdge(grid, aScene, bScene) {
  if (!grid) return null;
  const a = sceneToTm(...aScene), b = sceneToTm(...bScene);
  for (const wall of grid.walls.values()) {
    const p = wallCoordinates(a, wall), q = wallCoordinates(b, wall);
    if (Math.max(Math.abs(p.tM), Math.abs(q.tM)) > 0.3 + 1e-6 || Math.abs(p.sM - q.sM) < 1e-8) continue;
    // Lateral mass tolerance must not permit uncovered strips beyond the ends of the GIS wall.
    if (Math.min(p.sM, q.sM) < -1e-6 || Math.max(p.sM, q.sM) > wall.lengthM + 1e-6) continue;
    const cells = wall.cells.flatMap(cell => {
      const tA = (cell.s0M - p.sM) / (q.sM - p.sM), tB = (cell.s1M - p.sM) / (q.sM - p.sM);
      const t0 = Math.max(0, Math.min(tA, tB)), t1 = Math.min(1, Math.max(tA, tB));
      if (t1 - t0 < 1e-8) return [];
      const u = t => (p.sM + t * (q.sM - p.sM) - cell.s0M) / (cell.s1M - cell.s0M);
      return [{ ...cell, wall: wall.wall, t0, t1, u0: u(t0), u1: u(t1) }];
    });
    return cells.sort((c, d) => c.storey - d.storey || c.t0 - d.t0);
  }
  return null;
}
