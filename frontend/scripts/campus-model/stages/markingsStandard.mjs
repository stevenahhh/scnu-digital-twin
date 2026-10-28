// Standard marking instances (lib/markingStandards.mjs): every piece of paint the markings stage draws belongs to one
// instance { t: template id, ev: placement evidence id, p: placement parameters }, and the GLB carries one record per
// instance (stages/markings.mjs buildMarkings: node extras `markingInstances`, the record index in each vertex's v
// texture coordinate) so scripts/qa/markings-audit.mjs can check every marking against its template.
//
// This module adds the parking stalls (lib/parkingRows.mjs: the rows of data/photo/parking-lots.json as stall
// templates) and resolves overlaps between instances: two instances never paint the same ground. Where they would, the
// one with the higher OVERLAP_RANK keeps its paint and the other gives way: a straight line is cut there (the cut
// leaves no piece shorter than MIN_RUN_M, and a dash is dropped whole), anything else is left out whole. Each giving
// way is logged.
import { SCENE_UNITS_PER_METRE as U } from "../lib/frame.mjs";
import { TEMPLATES } from "../lib/markingStandards.mjs";
import { readParkingLots, rowGeometry } from "../lib/parkingRows.mjs";
import { wheelchairTemplate } from "../lib/markingGlyphs.mjs";

const SAMPLE_M = 0.02;
const MIN_RUN_M = 0.5;
// higher keeps its paint
// a stall row read on the photo outranks a stop line: inside a lot a traced "stop line" across stalls is a stall line
const OVERLAP_RANK = { crosswalk: 6, stall: 5.5, line_stop: 5, glyph: 3, text: 3, line: 2, hatch: 1, surface: 0 };
const rankOf = (inst) => {
  const t = TEMPLATES[inst.t];
  if (!t) return -1;
  return t.kind === "line" && inst.t === "stop_line" ? OVERLAP_RANK.line_stop : OVERLAP_RANK[t.kind] ?? 0;
};

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const toScene = (p) => [p[0] * U, p[1] * U];

// ---------------------------------------------------------------- parking
export function parkingInstances({ blocked = () => false } = {}) {
  const pieces = [];
  const log = { lots: 0, rows: 0, bays: 0, accessible: 0, skippedRows: [], residualM: [] };
  for (const lot of readParkingLots()) {
    log.lots += 1;
    for (const row of lot.rows) {
      const g = rowGeometry(row);
      // a row whose bays stand on a building or a sidewalk (most bay centres there) is not drawn (logged); its lines
      // may reach the kerb of the sidewalk it faces
      const probes = g.widths.map((w, k) => {
        const s0 = g.widths.slice(0, k).reduce((a, x) => a + x, 0) + w / 2;
        return [g.origin[0] + g.u[0] * s0 + g.v[0] * g.depth / 2, g.origin[1] + g.u[1] * s0 + g.v[1] * g.depth / 2];
      });
      if (probes.filter((p) => blocked(toScene(p))).length > probes.length * 0.5) {
        log.skippedRows.push(row.id);
        continue;
      }
      const inst = {
        t: g.template, ev: `${row.id}: ${row.evidence}`,
        p: { lot: lot.id, origin: toScene(g.origin), u: g.u, v: g.v, bays: g.widths.length, depth: g.depth, widths: g.widths, pitch: g.pitch, accessible: row.accessible, line: g.line, sharedBack: row.backLine === false },
      };
      for (const r of g.rects) if (!r.shared) pieces.push({ rings: [r.ring.map(toScene)], colour: "white", kind: "parking_line", estimated: false, inst });
      const sym = TEMPLATES.stall_accessible.symbol;
      for (const s of g.symbols) {
        const half = sym.squareM / 2;
        const sq = [[-half, -half], [half, -half], [half, half], [-half, half]].map(([x, y]) => [s.centre[0] + g.u[0] * x + g.v[0] * y, s.centre[1] + g.u[1] * x + g.v[1] * y]);
        pieces.push({ rings: [sq.map(toScene)], colour: "blue", kind: "disabled_parking", estimated: false, inst });
        // the wheelchair upright for the driver entering from the front line (its top towards the back line)
        for (const rings of wheelchairTemplate(sym.wheelchairM)) {
          pieces.push({ rings: rings.map((ring) => ring.map(([x, y]) => toScene([s.centre[0] + g.u[0] * x + g.v[0] * y, s.centre[1] + g.u[1] * x + g.v[1] * y]))), colour: "white", kind: "disabled_parking", estimated: false, inst });
        }
      }
      log.rows += 1;
      log.bays += g.widths.length;
      log.accessible += g.symbols.length;
      if (g.photoResidualM !== null) log.residualM.push({ row: row.id, m: +g.photoResidualM.toFixed(3) });
    }
  }
  return { pieces, log };
}

// ---------------------------------------------------------------- overlaps
function inRing([x, z], ring) {
  let r = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, zi] = ring[i];
    const [xj, zj] = ring[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) r = !r;
  }
  return r;
}
const inPiece = (p, rings) => rings.filter((ring) => inRing(p, ring)).length % 2 === 1;
// strictly inside (at least EDGE_M from every edge): two pieces that only touch along an edge do not overlap
const EDGE_M = 0.001;
function edgeDistance(p, rings) {
  let best = Infinity;
  for (const ring of rings) for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const ab = sub(b, a), l2 = dot(ab, ab);
    const t = l2 > 0 ? Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2)) : 0;
    best = Math.min(best, Math.hypot(p[0] - a[0] - ab[0] * t, p[1] - a[1] - ab[1] * t));
  }
  return best;
}
const inPieceStrict = (p, rings) => inPiece(p, rings) && edgeDistance(p, rings) > EDGE_M;

// instance -> its pieces, plan box (metres)
function groupInstances(pieces) {
  const map = new Map();
  for (const pc of pieces) {
    if (!pc.inst) throw new Error(`a ${pc.kind} piece has no marking instance`);
    if (!map.has(pc.inst)) map.set(pc.inst, []);
    map.get(pc.inst).push(pc);
  }
  return [...map].map(([inst, list]) => {
    const pts = list.flatMap((pc) => pc.rings[0]).map(([x, z]) => [x / U, z / U]);
    const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[1]);
    return { inst, list, box: [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)] };
  });
}

// Points of a piece's interior on the SAMPLE_M lattice (metres).
function lattice(rings) {
  const m = rings.map((r) => r.map(([x, z]) => [x / U, z / U]));
  const xs = m[0].map((p) => p[0]), zs = m[0].map((p) => p[1]);
  const out = [];
  for (let i = Math.ceil(Math.min(...xs) / SAMPLE_M); i <= Math.floor(Math.max(...xs) / SAMPLE_M); i += 1) {
    for (let j = Math.ceil(Math.min(...zs) / SAMPLE_M); j <= Math.floor(Math.max(...zs) / SAMPLE_M); j += 1) {
      const p = [i * SAMPLE_M, j * SAMPLE_M];
      if (inPiece(p, m)) out.push(p);
    }
  }
  return out;
}

// Cut a straight line instance where `hit(p)` (metres): the remaining runs as new instances (each MIN_RUN_M or more).
function cutLine(group, hit) {
  const { inst } = group;
  const a = [inst.p.a[0] / U, inst.p.a[1] / U], b = [inst.p.b[0] / U, inst.p.b[1] / U];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const d = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
  const n = [-d[1], d[0]];
  const w = TEMPLATES[inst.t].widthM;
  const step = SAMPLE_M;
  const free = [];
  for (let s = 0; s <= len + 1e-9; s += step) {
    let ok = true;
    for (let t = -w / 2; t <= w / 2 + 1e-9 && ok; t += step) if (hit([a[0] + d[0] * s + n[0] * t, a[1] + d[1] * s + n[1] * t])) ok = false;
    free.push(ok);
  }
  const runs = [];
  let start = null;
  free.forEach((ok, k) => {
    if (ok && start === null) start = k;
    if ((!ok || k === free.length - 1) && start !== null) {
      const end = ok ? k : k - 1;
      // keep a clear line width off the paint it gives way to (a crossing line meets the cut at an angle)
      const s0 = start === 0 ? 0 : start * step + w, s1 = end === free.length - 1 ? len : end * step - w;
      if (s1 - s0 >= MIN_RUN_M) runs.push([s0, s1]);
      start = null;
    }
  });
  if (inst.p.dash) return [];
  return runs.map(([s0, s1]) => {
    const p0 = [a[0] + d[0] * s0, a[1] + d[1] * s0], p1 = [a[0] + d[0] * s1, a[1] + d[1] * s1];
    const ring = [[p0[0] + n[0] * w / 2, p0[1] + n[1] * w / 2], [p1[0] + n[0] * w / 2, p1[1] + n[1] * w / 2], [p1[0] - n[0] * w / 2, p1[1] - n[1] * w / 2], [p0[0] - n[0] * w / 2, p0[1] - n[1] * w / 2]];
    const sub_ = { ...inst, p: { ...inst.p, a: toScene(p0), b: toScene(p1) } };
    return { inst: sub_, list: [{ ...group.list[0], rings: [ring.map(toScene)], inst: sub_ }] };
  });
}

export function resolveOverlaps(pieces, second = false) {
  let groups = groupInstances(pieces);
  const log = { cut: 0, dropped: [], pairs: 0 };
  // bucket boxes on a 10 m grid
  const cell = 10;
  const buckets = new Map();
  groups.forEach((g, i) => {
    for (let x = Math.floor(g.box[0] / cell); x <= Math.floor(g.box[2] / cell); x += 1) for (let z = Math.floor(g.box[1] / cell); z <= Math.floor(g.box[3] / cell); z += 1) {
      const k = `${x},${z}`;
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(i);
    }
  });
  const pairs = new Set();
  for (const list of buckets.values()) for (let a = 0; a < list.length; a += 1) for (let b = a + 1; b < list.length; b += 1) {
    const [i, j] = [list[a], list[b]];
    const [A, B] = [groups[i].box, groups[j].box];
    if (A[0] > B[2] || B[0] > A[2] || A[1] > B[3] || B[1] > A[3]) continue;
    pairs.add(i < j ? `${i},${j}` : `${j},${i}`);
  }
  log.pairs = pairs.size;
  const removed = new Set();
  const replacements = new Map();
  // stronger first, so a weaker instance is tested against the final paint of the stronger one
  const ordered = [...pairs].map((k) => k.split(",").map(Number)).sort((x, y) => Math.max(rankOf(groups[y[0]].inst), rankOf(groups[y[1]].inst)) - Math.max(rankOf(groups[x[0]].inst), rankOf(groups[x[1]].inst)));
  for (const [i, j] of ordered) {
    if (removed.has(i) || removed.has(j)) continue;
    const [gi, gj] = [groups[i], groups[j]];
    const [strong, weak, weakIndex] = rankOf(gi.inst) >= rankOf(gj.inst) ? [gi, gj, j] : [gj, gi, i];
    const strongPieces = (replacements.get(strong) ?? [strong]).flatMap((g) => g.list);
    const hit = (p) => strongPieces.some((pc) => inPieceStrict(p, pc.rings.map((r) => r.map(([x, z]) => [x / U, z / U]))));
    const weakGroups = replacements.get(weak) ?? [weak];
    const overlapping = weakGroups.some((g) => g.list.some((pc) => lattice(pc.rings).some(hit)));
    if (!overlapping) continue;
    if (!second && TEMPLATES[weak.inst.t]?.kind === "line" && weak.inst.p?.shape === "straight") {
      const cut = weakGroups.flatMap((g) => cutLine(g, hit));
      replacements.set(weak, cut);
      log.cut += 1;
      if (!cut.length) { removed.add(weakIndex); log.dropped.push(`${weak.inst.t} ${weak.inst.ev} (under ${strong.inst.t})`); }
    } else {
      removed.add(weakIndex);
      log.dropped.push(`${weak.inst.t} ${weak.inst.ev} (under ${strong.inst.t})`);
    }
  }
  const out = [];
  groups.forEach((g, i) => {
    if (removed.has(i)) return;
    for (const r of replacements.get(g) ?? [g]) out.push(...r.list.map((pc) => ({ ...pc, inst: r.inst })));
  });
  // second pass: anything that still shares ground after the cuts (a sliver at a cut end, two cut lines) gives way whole
  if (!second) {
    const again = resolveOverlaps(out, true);
    log.secondPass = again.log.dropped;
    return { pieces: again.pieces, log };
  }
  return { pieces: out, log };
}

// Records for the GLB extras, in the order of first appearance; `index` maps an instance to its record.
export function instanceRecords(pieces) {
  const index = new Map();
  const records = [];
  for (const pc of pieces) {
    if (index.has(pc.inst)) continue;
    index.set(pc.inst, records.length);
    records.push({ id: `M${String(records.length + 1).padStart(5, "0")}`, t: pc.inst.t, ev: pc.inst.ev, c: pc.colour === "blue" && pc.inst.t.startsWith("stall") ? "white" : pc.colour, p: round(pc.inst.p) });
  }
  return { records, index };
}
const round = (v) => (Array.isArray(v) ? v.map(round) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, round(x)])) : typeof v === "number" ? +v.toFixed(5) : v);
export { sub, dot };
