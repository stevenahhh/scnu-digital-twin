#!/usr/bin/env bun
// Parking seed (plan campus-ground-truth-redesign todo 12): turns what the build used to draw into the row records of
// data/ground/parking.json, once. The stages read the records from then on; this file stays so the migration can be read and
// repeated. Input data/photo/evidence/parking-migration.json holds the three retired sources in EPSG:5186:
//   - lines: the gate-accepted parking_line pieces the markings stage drew (photo evidence, tier T1);
//   - cells: the blue bay cells with their symbol, top bearing and rule (markings-bays.json), so every symbol keeps its reading;
//   - stallRows: the 33 stall_row features of site-detail.geojson (VR, tier T2) with their wheel stops.
// Order of work:
//   1. Dividers group into rows (parallel, side by side). The grid walks the gaps: a gap of n pitches holds n-1 undetected
//      dividers, unless two or more of them are visibly empty (design §6.2 rule 5), which ends the row. A stall whose paint
//      drifts more than DRIFT_M from the uniform grid becomes an exception, so dividers stay on their paint.
//      A row whose dividers are mostly other rows' rails is no row (dissolveRailRows): its pieces go back to the free lines,
//      and step 4 makes them those rows' end lines.
//   2. A stall_row gives the photo rows under it its wheel stops, end lines and VR reading; alone it is a row of its own.
//   3. A blue cell becomes a stall of the row it lies in, extends the row it adjoins, or makes a row of its own.
//   4. Pieces no row takes stay as recorded free lines. Rows and lines within LOT_LINK_M share a lot.
//   5. Every row is graded on the photo (photo.line, photo.blue): photoSupport is the share of its visible dividers with paint
//      over the ground beside them, or for a row of blue cells the mean share of its fills on blue. It never counts detections:
//      the paint gate accepted false strokes, which is what this step found. A row with no such evidence is not T1.
//
//   6. A lot in data/ground/parking-curation.json replaces what the steps above made there (applyCuration): reviewed records are
//      kept in that file, never in parking.json, which this seed rewrites. The file names its lots by an anchor point and its rows
//      by their own ids, so the numbering of the steps above cannot move them.
//
//   bun scripts/campus-model/fit/parkingSeed.mjs --write    writes parking.json with parcel null (then run parcelsSeed.mjs --write)
//   bun scripts/campus-model/fit/parkingSeed.mjs --link     names each lot's parcel from parcels.json
import { orientedBox } from "../lib/markingFit.mjs";
import { PAINT_CONTRAST } from "./parkingRows.mjs";

const LONG_LINE_M = 7.5;
const MIN_ASPECT = 3;
const PARALLEL_DEG = 8;
const ATTACH_DEG = 25;
const END_LINE_M = 0.6;
const LOOSE_PITCH_M = 3.6;
const SHORT_M = 2.5;
const PROPOSE_REACH_M = 3;
const GROUP_REACH_M = 20;
const MERGE_M = 0.6;
const PITCH_RANGE = [2.0, 6.5];
const MAX_MISSING = 5;
const DRIFT_M = 0.15;
const SKEW_MIN = 0.03;
const VISIBLE = 0.5;
const SUPPORTED = 0.3;
const JOIN_DEG = 12;
const JOIN_T_M = 1.5;
const JOIN_END_M = 1.2;
const LOT_LINK_M = 8;
const T3_DEPTH_M = 5;
const FULL_LENGTH_M = 3;
const MIN_STALL_M = 2; // pieces closer than this are not two dividers (lib/schemas.mjs)
const BLUE_MIN = 0.35; // share of a fill on photo blue; the symbol, hatch and border are white

const add = (p, q) => [p[0] + q[0], p[1] + q[1]];
const sub = (p, q) => [p[0] - q[0], p[1] - q[1]];
const mul = (p, k) => [p[0] * k, p[1] * k];
const dot = (p, q) => p[0] * q[0] + p[1] * q[1];
const unit = (p) => mul(p, 1 / Math.hypot(p[0], p[1]));
const cos = (deg) => Math.cos((deg * Math.PI) / 180);
const bearing = (deg) => [Math.sin((deg * Math.PI) / 180), Math.cos((deg * Math.PI) / 180)];
const toBearing = ([E, N]) => ((Math.atan2(E, N) * 180) / Math.PI + 360) % 360;
const r3 = (v) => { const x = Math.round(v * 1e3) / 1e3; return x === 0 ? 0 : x; };
const r4 = (v) => Math.round(v * 1e4) / 1e4;
const median = (list) => { const s = [...list].sort((a, b) => a - b); return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const eastward = (v) => (v[0] > 1e-9 || (Math.abs(v[0]) <= 1e-9 && v[1] > 0) ? v : mul(v, -1));
const northward = (v) => (v[1] > 1e-9 || (Math.abs(v[1]) <= 1e-9 && v[0] > 0) ? v : mul(v, -1));
const leftOf = (a) => [-a[1], a[0]];
const pointInRing = ([x, y], ring) => {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
};
const pieceRef = (piece) => piece.id ?? `parking_line@${r3(piece.box.centre[0])},${r3(piece.box.centre[1])}`;

// ---------------------------------------------------------------- a stall_row feature as a row record
// feature: { line: [[E, N], ...] running along the open end, id, properties }. The stops stay where they were: 0.9 m from
// the back, 1.6 m long.
export function stallRowRecord({ line, id, properties: p }) {
  const [a, b] = [line[0], line.at(-1)];
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const stalls = p.stalls ?? Math.max(1, Math.round(length / 2.5));
  const u = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
  const left = leftOf(u);
  const skewed = Number.isFinite(p.divider_bearing_deg);
  const towardsBack = skewed ? bearing(p.divider_bearing_deg) : p.side === "right" ? mul(left, -1) : left;
  const depth = p.depth_m ?? T3_DEPTH_M;
  const back = (q) => add(q, mul(towardsBack, depth)).map(r3);
  const stop = p.wheel_stops ? { offsetFromBackM: 0.9, lengthM: 1.6, ...(p.stopColour ? { colour: p.stopColour } : {}), every: 1 } : null;
  return {
    backLine: { abs: [back(a), back(b)] },
    side: dot(mul(towardsBack, -1), left) > 0 ? 1 : -1,
    pitchM: r4(length / stalls),
    depthM: depth,
    startOffsetM: 0,
    count: stalls + 1,
    ...(skewed ? { dividerBearingDeg: r3((p.divider_bearing_deg + 180) % 360) } : {}),
    divider: { style: "single", widthM: 0.1, colour: p.colour === "yellow" ? "yellow" : "white" },
    endCaps: true,
    ...(p.back_line ? { paintBack: true } : {}),
    ...(p.front_line ? { paintFront: true } : {}),
    stalls: [],
    wheelStops: stop,
    entryFrom: "aisle",
    evidence: { tier: "T2", refs: [`site-detail ${id} (VR ${p.vr_scene ?? "?"} ${p.vr_face ?? "?"}): ${p.note ?? "stall row"}`], photoSupport: null },
    estimated: true,
  };
}

// The frame of a record while the seed edits it.
const frameOf = (row) => {
  const [p, q] = row.backLine.abs;
  const length = Math.hypot(q[0] - p[0], q[1] - p[1]);
  const a = [(q[0] - p[0]) / length, (q[1] - p[1]) / length];
  const d = Number.isFinite(row.dividerBearingDeg) ? bearing(row.dividerBearingDeg) : mul(leftOf(a), row.side);
  const det = a[0] * d[1] - a[1] * d[0];
  const local = (c) => { const v = sub(c, p); return { s: (v[0] * d[1] - v[1] * d[0]) / det, t: (a[0] * v[1] - a[1] * v[0]) / det }; };
  return { p, a, d, length, local, at: (s, t) => add(p, add(mul(a, s), mul(d, t))) };
};

// Stall widths along s: the pitch, or the stall's own width.
const widthsOf = (row) => Array.from({ length: row.count - 1 }, (_, i) => row.stalls.find((s) => s.index === i)?.widthM ?? row.pitchM);

// Merge fragments of one divider, sorted by position.
function mergeAcross(items) {
  const out = [];
  for (const it of [...items].sort((x, y) => x.s - y.s)) {
    const last = out.at(-1);
    if (last && it.s - last.s <= MERGE_M) {
      last.members.push(it.piece);
      last.s = last.members.length ? (last.s * (last.members.length - 1) + it.s) / last.members.length : it.s;
      last.t0 = Math.min(last.t0, it.t0);
      last.t1 = Math.max(last.t1, it.t1);
    } else out.push({ s: it.s, t0: it.t0, t1: it.t1, members: [it.piece] });
  }
  return out;
}

// ---------------------------------------------------------------- 1. photo dividers group into rows
function groupParallel(pieces) {
  const parent = pieces.map((_, i) => i);
  const root = (i) => (parent[i] === i ? i : (parent[i] = root(parent[i])));
  for (let i = 0; i < pieces.length; i += 1) {
    for (let j = i + 1; j < pieces.length; j += 1) {
      const [p, q] = [pieces[i], pieces[j]];
      if (p.colour !== q.colour || Math.abs(dot(p.box.long, q.box.long)) < cos(PARALLEL_DEG)) continue;
      const delta = sub(q.box.centre, p.box.centre);
      if (Math.abs(dot(delta, p.box.short)) > GROUP_REACH_M) continue;
      const along = dot(delta, p.box.long);
      const overlap = Math.min(p.box.halfLong, along + q.box.halfLong) - Math.max(-p.box.halfLong, along - q.box.halfLong);
      if (overlap >= Math.min(p.box.halfLong, q.box.halfLong)) parent[root(i)] = root(j);
    }
  }
  const groups = new Map();
  pieces.forEach((piece, i) => groups.set(root(i), [...(groups.get(root(i)) ?? []), piece]));
  return [...groups.values()];
}

// One group -> rows, plus the pieces no row took.
function rowsFromGroup(group, probe, photo) {
  const axis = eastward(group[0].box.short);
  const long = northward(leftOf(axis));
  const a0 = eastward([long[1], -long[0]]);
  const items = group.map((piece) => {
    const c = dot(piece.box.centre, long);
    return { s: dot(piece.box.centre, a0), t0: c - piece.box.halfLong, t1: c + piece.box.halfLong, piece };
  });
  // a piece closer to a better one than the narrowest stall is not a divider: paint first, then the longer piece
  const measured = mergeAcross(items).map((x) => {
    const seen = photo?.line({ from: add(mul(a0, x.s), mul(long, x.t1)), dir: mul(long, -1), across: a0, lengthM: x.t1 - x.t0 });
    if (!seen) return { ...x, rank: 1 };
    if (seen.visible < VISIBLE) return { ...x, rank: 1 };
    return seen.contrast >= PAINT_CONTRAST ? { ...x, s: x.s + seen.offsetM, rank: 2 } : { ...x, rank: 0 };
  });
  const kept = [];
  const dropped = [];
  for (const x of [...measured].sort((p, q) => q.rank - p.rank || (q.t1 - q.t0) - (p.t1 - p.t0))) (kept.some((k) => Math.abs(k.s - x.s) < MIN_STALL_M) ? dropped : kept).push(x);
  const dividers = kept.sort((p, q) => p.s - q.s);
  const gaps = dividers.slice(1).map((x, k) => x.s - dividers[k].s);
  const inRange = gaps.filter((g) => g >= PITCH_RANGE[0] && g <= PITCH_RANGE[1]);
  if (!inRange.length) return { rows: [], loose: group };
  const p0 = median(inRange);
  const probeAt = (s, tBack, tFront) => {
    if (!photo) return probe(add(mul(a0, s), mul(long, tBack)), add(mul(a0, s), mul(long, tFront)));
    const seen = photo.line({ from: add(mul(a0, s), mul(long, tBack)), dir: mul(long, -1), across: a0, lengthM: tBack - tFront });
    return { visible: seen.visible, support: seen.contrast >= PAINT_CONTRAST ? 1 : 0 };
  };

  // split into runs at visibly empty stretches
  const runs = [];
  let run = [{ ...dividers[0], detected: true }];
  const tFront = median(dividers.map((x) => x.t0));
  const tBack = median(dividers.map((x) => x.t1));
  gaps.forEach((g, k) => {
    const n = Math.max(1, Math.round(g / p0));
    const missing = [];
    let empties = 0;
    let longest = 0;
    for (let m = 1; m < n; m += 1) {
      const s = dividers[k].s + (m * g) / n;
      const seen = probeAt(s, tBack, tFront);
      empties = seen.visible >= VISIBLE && seen.support < SUPPORTED ? empties + 1 : 0;
      longest = Math.max(longest, empties);
      missing.push({ s, detected: false });
    }
    if (n - 1 > MAX_MISSING || longest >= 2) {
      runs.push(run);
      run = [];
    } else run.push(...missing);
    run.push({ ...dividers[k + 1], detected: true });
  });
  runs.push(run);

  const rows = [];
  const loose = [];
  for (const members of runs) {
    const seen = members.filter((x) => x.detected);
    // two far-apart or short pieces do not prove a stall between them
    const span = members.length === 2 ? members[1].s - members[0].s : 0;
    if (seen.length < 2 || (members.length === 2 && (span > LOOSE_PITCH_M || Math.max(...seen.map((x) => x.t1 - x.t0)) < SHORT_M))) {
      loose.push(...seen.flatMap((x) => x.members));
      continue;
    }
    // back: the end of the dividers that lines up best; the record's depth runs to the other end
    const full = seen.filter((x) => x.t1 - x.t0 >= FULL_LENGTH_M);
    const basis = full.length >= 2 ? full : seen;
    const spread = (list) => { const m = median(list); return median(list.map((v) => Math.abs(v - m))); };
    const highBack = spread(basis.map((x) => x.t1)) <= spread(basis.map((x) => x.t0)) + 1e-9;
    const endOf = (x) => (highBack ? x.t1 : x.t0);
    // a row whose back ends step along it is skewed: its axis follows them, the dividers keep their direction
    let slope = 0;
    if (basis.length >= 3) {
      const [ms, mt] = [basis.reduce((m, x) => m + x.s, 0) / basis.length, basis.reduce((m, x) => m + endOf(x), 0) / basis.length];
      const den = basis.reduce((m, x) => m + (x.s - ms) ** 2, 0);
      const fit = den ? basis.reduce((m, x) => m + (x.s - ms) * (endOf(x) - mt), 0) / den : 0;
      if (Math.abs(fit) >= SKEW_MIN) slope = fit;
    }
    const tAt = (s) => {
      const residual = basis.map((x) => endOf(x) - slope * x.s);
      return median(residual) + slope * s;
    };
    const stretch = Math.hypot(1, slope);
    const a = unit(add(a0, mul(long, slope)));
    const s0 = members[0].s;
    const origin = add(mul(a0, s0), mul(long, tAt(s0)));
    const pos = members.map((x) => (x.s - s0) * stretch);
    // widths: the uniform pitch unless the paint drifts from it
    const seenGaps = pos.slice(1).map((v, k) => v - pos[k]);
    const pitch = median(seenGaps);
    const stalls = [];
    let drawn = 0;
    for (let k = 0; k + 1 < pos.length; k += 1) {
      if (Math.abs(drawn + pitch - pos[k + 1]) > DRIFT_M) {
        stalls.push({ index: k, kind: "general", widthM: r3(pos[k + 1] - drawn) });
        drawn = pos[k + 1];
      } else drawn += pitch;
    }
    const d = mul(long, highBack ? -1 : 1);
    const end = add(origin, mul(a, drawn));
    const lengths = (full.length ? full : seen).map((x) => x.t1 - x.t0);
    const missing = members.map((x, i) => (x.detected ? null : i)).filter((i) => i !== null);
    const visibleEmpty = missing.length;
    const support = seen.length / (seen.length + visibleEmpty); // pieces per position: the tier until the photo grades the row
    const tier = support >= 0.5 ? "T1" : "T2";
    rows.push({
      backLine: { abs: [origin.map(r3), end.map(r3)] },
      side: dot(d, leftOf(a)) > 0 ? 1 : -1,
      pitchM: r4(pitch),
      depthM: r3(median(lengths)),
      startOffsetM: 0,
      count: members.length,
      ...(slope ? { dividerBearingDeg: r3(toBearing(d)) } : {}),
      divider: { style: "single", widthM: 0.1, colour: seen[0].members[0].colour },
      endCaps: true,
      stalls,
      wheelStops: null,
      entryFrom: "aisle",
      ...(missing.length ? { estimatedDividers: missing } : {}),
      evidence: { tier, refs: [
        `photo dividers ${seen.length}/${members.length}: ${seen.flatMap((x) => x.members).slice(0, 24).map(pieceRef).join(" ")}`,
        ...(() => {
          const within = dropped.filter((x) => x.s >= members[0].s && x.s <= members.at(-1).s).flatMap((x) => x.members);
          return within.length ? [`no paint or under ${MIN_STALL_M} m from a divider, not drawn: ${within.slice(0, 24).map(pieceRef).join(" ")}`] : [];
        })(),
      ], photoSupport: null },
      estimated: tier !== "T1",
      seenDividers: seen,
    });
  }
  return { rows, loose };
}

// A piece along another row's back or front line, square to that row's dividers, is that row's rail.
function onRail(piece, row) {
  const f = frameOf(row);
  if (Math.abs(dot(piece.box.long, f.a)) < cos(PARALLEL_DEG)) return false;
  const { s, t } = f.local(piece.box.centre);
  const overlap = Math.min(f.length, s + piece.box.halfLong) - Math.max(0, s - piece.box.halfLong);
  return overlap >= piece.box.halfLong && (Math.abs(t) <= END_LINE_M || Math.abs(t - row.depthM) <= END_LINE_M);
}
// The paint test asks whether a line exists at a position, not whose line it is: rails of neighbouring rows pass it, and the
// depth of a row between them reads as a stall width. Only a row with more dividers can own a rail, so two rows at right
// angles cannot dissolve each other. A row with fewer than two dividers of its own goes; its pieces return as free lines.
function dissolveRailRows(rows, log) {
  const count = (row) => row.seenDividers.length;
  const loose = [];
  const kept = rows.filter((row) => {
    const owned = row.seenDividers.filter((x) => !x.members.every((piece) => rows.some((other) => other !== row && count(other) > count(row) && onRail(piece, other))));
    if (owned.length === count(row)) return true;
    log(`RAIL ${owned.length >= 2 ? "kept" : "dissolved"}: pitch ${row.pitchM} m, ${count(row) - owned.length}/${count(row)} dividers on other rows' rails, from ${JSON.stringify(row.backLine.abs[0])}: ${row.seenDividers.flatMap((x) => x.members).map(pieceRef).join(" ")}`);
    if (owned.length >= 2) return true;
    loose.push(...row.seenDividers.flatMap((x) => x.members));
    return false;
  });
  for (const row of kept) delete row.seenDividers;
  return { kept, loose };
}

// Estimator rows that do not lie on a row already found. Their pitch is uniform by construction, so blue cells may refit it.
function freshProposals(proposed, rows) {
  const out = [];
  for (const row of proposed) {
    const f = frameOf(row);
    const mids = [0.25, 0.5, 0.75].map((k) => f.at(f.length * k, row.depthM / 2));
    const taken = [...rows, ...out].some((other) => {
      const g = frameOf(other);
      return Math.abs(dot(g.d, f.d)) >= cos(ATTACH_DEG) && mids.some((p) => { const { s, t } = g.local(p); return s >= 0 && s <= g.length && t >= 0 && t <= other.depthM; });
    });
    if (!taken) out.push({ ...row, photoGrid: true });
  }
  return out;
}

// ---------------------------------------------------------------- 2. a stall_row joins the photo rows it lies on
// The back line moves to the other end of the stalls; a stall keeps its place.
function flipRow(row) {
  const f = frameOf(row);
  row.backLine.abs = [f.at(0, row.depthM).map(r3), f.at(f.length, row.depthM).map(r3)];
  row.side = -row.side;
  if (Number.isFinite(row.dividerBearingDeg)) row.dividerBearingDeg = r3((row.dividerBearingDeg + 180) % 360);
}
// Its wheel stops, end lines and VR reading move to every photo row that holds its stops, so the stops stand square to the
// painted dividers (design §6.1: no bearing of their own). With no photo row under it, it stays a row of its own: estimated
// dividers where the VR saw them, wheel stops alone where it only says the dividers are in the markings data.
function attachStallRow(feature, rows, propose) {
  const record = stallRowRecord(feature);
  const f = frameOf(record);
  const stalls = record.count - 1;
  // the stops the record drew, and the line it was traced on: a stops-only record often lies a stall's depth off its row
  const spotsAt = (t) => Array.from({ length: stalls }, (_, i) => f.at((i + 0.5) * record.pitchM, t));
  const spotSets = [spotsAt(Math.min(0.9, record.depthM / 2)), spotsAt(record.depthM)];
  const holds = (row) => {
    const g = frameOf(row);
    if (Math.abs(dot(g.d, f.d)) < cos(ATTACH_DEG)) return false;
    return spotSets.some((spots) => spots.filter((p) => { const { s, t } = g.local(p); return s >= -0.5 && s <= g.length + 0.5 && t >= -1 && t <= row.depthM + 1; }).length >= Math.min(2, stalls));
  };
  let hits = rows.filter(holds);
  if (!hits.length) {
    // no drawn paint here, yet the VR saw stalls: ask the estimator (fit/parkingRows.mjs) on the photo around the record
    const [p, q] = record.backLine.abs;
    const reach = (u, v) => add(u, add(mul(f.a, v), [0, 0]));
    const ring = [reach(f.at(0, -PROPOSE_REACH_M), -PROPOSE_REACH_M), reach(f.at(f.length, -PROPOSE_REACH_M), PROPOSE_REACH_M), reach(f.at(f.length, record.depthM + PROPOSE_REACH_M), PROPOSE_REACH_M), reach(f.at(0, record.depthM + PROPOSE_REACH_M), -PROPOSE_REACH_M)];
    const hint = add(mul(add(p, q), 0.5), mul(f.d, -40));
    rows.push(...freshProposals(propose(feature.id, ring, hint), rows));
    hits = rows.filter(holds);
  }
  if (!hits.length) {
    if (feature.properties.dividers === false) record.divider = { style: "none" };
    else record.estimatedDividers = Array.from({ length: record.count }, (_, i) => i);
    rows.push(record);
    return;
  }
  for (const row of hits) {
    if (dot(frameOf(row).d, f.d) < 0) flipRow(row);
    // the photo sees only the aisle end of a row under a leaning roof: the VR's depth holds, the front stays on its paint
    if (row.photoGrid && feature.properties.dividers !== false && record.depthM > row.depthM + 1) {
      const g = frameOf(row);
      const shift = record.depthM - row.depthM;
      row.backLine.abs = [g.at(0, -shift).map(r3), g.at(g.length, -shift).map(r3)];
      row.depthM = record.depthM;
    }
    if (record.wheelStops) row.wheelStops = record.wheelStops;
    if (record.paintBack) row.paintBack = true;
    if (record.paintFront) row.paintFront = true;
    row.evidence.refs.push(...record.evidence.refs);
  }
  if (hits.length > 1 || feature.properties.dividers === false) return;
  // the VR saw more stalls than the photo shows: the row runs on, estimated
  const [row] = hits;
  const g = frameOf(row);
  const ends = record.backLine.abs.map((p) => g.local(p).s);
  const grow = (excess, side) => {
    const k = excess > 0.5 * row.pitchM ? Math.round(excess / row.pitchM) : 0;
    for (let i = 0; i < k; i += 1) {
      extendRow(row, side, row.pitchM);
      const added = side === "end" ? row.count - 1 : 0;
      row.estimatedDividers = [...(row.estimatedDividers ?? []), added].sort((x, y) => x - y);
    }
  };
  grow(-Math.min(...ends), "start");
  grow(Math.max(...ends) - g.length, "end");
}

// ---------------------------------------------------------------- 3. blue cells become stalls
function sideOfBearing(deg, f) {
  const v = bearing(deg);
  const sides = [["start", mul(f.a, -1)], ["end", f.a], ["back", mul(f.d, -1)], ["front", f.d]];
  return sides.sort((x, y) => dot(y[1], v) - dot(x[1], v))[0][0];
}
function stallFromCell(cell, row, index, widthM) {
  const f = frameOf(row);
  const rule = cell.rule ?? {};
  const aisle = Array.isArray(rule.aisle) ? rule.aisle[cell.cell] : rule.aisle;
  const isPm = cell.symbol === "P";
  return {
    index, kind: isPm ? "pm" : "accessible", widthM: r3(widthM),
    aisle: aisle && Number.isFinite(aisle.bearingDeg) ? { side: sideOfBearing(aisle.bearingDeg, f), widthM: aisle.widthM, ...(aisle.outside ? { outside: true } : {}) } : null,
    symbol: cell.symbol ?? "wheelchair",
    upBearingDeg: cell.upBearingDeg,
    ...(rule.figure?.symbol === "scooter" ? { figure: { symbol: "scooter", side: sideOfBearing(rule.figure.endBearingDeg, f), frontBearingDeg: rule.figure.frontBearingDeg } } : {}),
  };
}
function cellRef(cell) {
  return `blue ${cell.ids.join("+")} cell ${cell.cell}${cell.rule?.source ? `: ${cell.rule.source}` : ""}`;
}
// Extends the row by one stall before its first or after its last divider.
function extendRow(row, side, width) {
  const f = frameOf(row);
  if (side === "end") {
    row.backLine.abs[1] = f.at(f.length + width, 0).map(r3);
  } else {
    row.backLine.abs[0] = f.at(-width, 0).map(r3);
    for (const s of row.stalls) s.index += 1;
    if (row.estimatedDividers) row.estimatedDividers = row.estimatedDividers.map((i) => i + 1);
  }
  row.count += 1;
}
function joinCell(cell, rows) {
  const across = bearing(cell.acrossBearingDeg);
  const ranked = rows.map((row) => ({ row, f: frameOf(row) }))
    .filter(({ f }) => Math.abs(dot(across, f.a)) >= cos(JOIN_DEG))
    .map((x) => ({ ...x, ...x.f.local(cell.centre) }))
    .filter(({ row, t, s, f }) => t >= -JOIN_T_M && t <= row.depthM + JOIN_T_M && s >= -cell.widthM / 2 - JOIN_END_M && s <= f.length + cell.widthM / 2 + JOIN_END_M)
    .sort((x, y) => Math.abs(x.t - x.row.depthM / 2) - Math.abs(y.t - y.row.depthM / 2));
  for (const { row, f, s } of ranked) {
    if (s >= 0 && s <= f.length) {
      const widths = widthsOf(row);
      let at = 0;
      let index = 0;
      while (index < widths.length - 1 && at + widths[index] <= s) {
        at += widths[index];
        index += 1;
      }
      const own = row.stalls.find((x) => x.index === index);
      if ((own && own.kind !== "general") || cell.widthM > (row.photoGrid ? 2 : 1.6) * widths[index]) continue;
      row.stalls = row.stalls.filter((x) => x.index !== index);
      row.stalls.push(stallFromCell(cell, row, index, row.photoGrid ? cell.widthM : widths[index]));
      if (row.photoGrid) (row.blueCentres ??= []).push({ index, s, widthM: cell.widthM });
      return row;
    }
    if (s > f.length) {
      const width = s + cell.widthM / 2 - f.length;
      extendRow(row, "end", width);
      row.stalls.push(stallFromCell(cell, row, row.count - 2, width));
      return row;
    }
    const width = cell.widthM / 2 - s;
    extendRow(row, "start", width);
    row.stalls.push(stallFromCell(cell, row, 0, width));
    return row;
  }
  return null;
}
function rowFromCell(cell) {
  // the cell's axes are its across bearing and the square to it. The symbol's bearing can lie along either (a traced figure
  // often lies along the width), so it only says which end is the back, and the symbol keeps it as its own.
  const up = bearing(cell.upBearingDeg);
  const a = eastward(bearing(cell.acrossBearingDeg));
  const towardsBack = dot(up, leftOf(a)) >= 0 ? leftOf(a) : mul(leftOf(a), -1);
  const back = add(cell.centre, mul(towardsBack, cell.deepM / 2));
  const start = add(back, mul(a, -cell.widthM / 2));
  const end = add(back, mul(a, cell.widthM / 2));
  const d = mul(towardsBack, -1);
  const row = {
    backLine: { abs: [start.map(r3), end.map(r3)] },
    side: dot(d, leftOf(a)) > 0 ? 1 : -1,
    pitchM: r4(cell.widthM),
    depthM: r3(cell.deepM),
    startOffsetM: 0,
    count: 2,
    divider: { style: "single", widthM: 0.1, colour: "white" },
    endCaps: true,
    stalls: [],
    wheelStops: null,
    entryFrom: "aisle",
    evidence: { tier: "T1", refs: [], photoSupport: null },
    estimated: false,
  };
  row.stalls.push(stallFromCell(cell, row, 0, cell.widthM));
  return row;
}

// An estimator row has a uniform pitch: with its blue bays known, its ends sit on their outer edges and the other stalls
// share what is left.
function refitPhotoGrid(row) {
  for (const { index, s, widthM } of row.blueCentres ?? []) {
    const f = frameOf(row);
    if (index === 0) row.backLine.abs[0] = f.at(s - widthM / 2, 0).map(r3);
    if (index === row.count - 2) row.backLine.abs[1] = f.at(s + widthM / 2, 0).map(r3);
  }
  // the first shift moved s of the others by the same amount, but only the ends were read above
  const f = frameOf(row);
  const exceptions = row.stalls.filter((x) => Number.isFinite(x.widthM));
  const general = row.count - 1 - exceptions.length;
  if (general > 0) row.pitchM = r4((f.length - exceptions.reduce((n, x) => n + x.widthM, 0)) / general);
  delete row.photoGrid;
  delete row.blueCentres;
}

// ---------------------------------------------------------------- 5. the photo grades every row
const demote = (row, why) => {
  row.evidence.refs.push(`not T1: ${why}`);
  row.evidence.tier = "T2";
  row.estimated = true;
};
function gradeRow(row, photo) {
  const f = frameOf(row);
  const widths = widthsOf(row);
  const narrow = widths.filter((w) => w < MIN_STALL_M);
  if (row.evidence.tier === "T1" && row.divider?.style !== "none" && narrow.length) demote(row, `${narrow.length} stalls under ${MIN_STALL_M} m`);
  if (!photo) return;
  let s = 0;
  const cells = widths.map((w, index) => { const c = { index, s0: s, s1: s + w }; s += w; return c; });
  for (const c of cells) {
    const stall = row.stalls.find((x) => x.index === c.index);
    if (!stall || (stall.kind !== "accessible" && stall.kind !== "pm")) continue; // only these are filled blue
    const [i0, i1, j0, j1] = [c.s0 + 0.1, c.s1 - 0.1, 0.1, row.depthM - 0.1];
    const seen = photo.blue([f.at(i0, j0), f.at(i1, j0), f.at(i1, j1), f.at(i0, j1)]);
    c.share = seen.share;
    stall.paintSupport = seen.share === null ? null : r3(seen.share);
    if (seen.share === null || seen.share < BLUE_MIN) {
      stall.estimated = true;
      row.evidence.refs.push(`${stall.kind} stall ${stall.index}: ${seen.share === null ? "hidden on the photo" : `${r3(seen.share)} of its fill on photo blue`}`);
    }
  }
  if (row.divider?.style === "none") return;
  const special = cells.filter((c) => "share" in c);
  if (special.length === cells.length) {
    const shares = special.map((c) => c.share).filter((v) => v !== null);
    row.evidence.photoSupport = shares.length ? r3(shares.reduce((n, v) => n + v, 0) / shares.length) : null;
    if (row.evidence.tier === "T1" && !(row.evidence.photoSupport >= BLUE_MIN)) demote(row, row.evidence.photoSupport === null ? "its fills are hidden on the photo" : `no blue paint under its fills (${row.evidence.photoSupport})`);
    return;
  }
  const lines = [0, ...cells.map((c) => c.s1)].map((at) => photo.line({ from: f.at(at, 0), dir: f.d, across: f.a, lengthM: row.depthM }));
  const visible = lines.filter((m) => m.visible >= VISIBLE);
  const painted = visible.filter((m) => m.contrast >= PAINT_CONTRAST);
  row.evidence.photoSupport = visible.length ? r3(painted.length / visible.length) : null;
  if (row.evidence.tier !== "T1") return;
  const flagged = lines.flatMap((m, i) => (m.visible >= VISIBLE && m.contrast >= PAINT_CONTRAST ? [] : [i]));
  if (flagged.length) row.estimatedDividers = flagged;
  else delete row.estimatedDividers;
  if (!visible.length) demote(row, "no divider visible on the photo");
  else if (row.evidence.photoSupport < 0.5) demote(row, `no paint under most dividers (${painted.length}/${visible.length} visible ones)`);
}

// A free line along a row's back or front is that row's end line; one on a divider of an estimator row is that divider.
function absorbEndLines(rows, lines) {
  return lines.filter((line) => {
    if (!line.abs) return true;
    const [c, q] = line.abs;
    const u = unit(sub(q, c));
    const length = Math.hypot(q[0] - c[0], q[1] - c[1]);
    const mid = mul(add(c, q), 0.5);
    for (const row of rows) {
      const f = frameOf(row);
      if (row.divider?.style === "none" || Math.abs(dot(u, f.a)) < cos(PARALLEL_DEG)) continue;
      const { s, t } = f.local(mid);
      const overlap = Math.min(f.length, s + length / 2) - Math.max(0, s - length / 2);
      if (overlap < 0.5 * Math.min(length, f.length)) continue;
      const key = Math.abs(t) <= END_LINE_M ? "paintBack" : Math.abs(t - row.depthM) <= END_LINE_M ? "paintFront" : null;
      if (!key) continue;
      row[key] = true;
      row.evidence.refs.push(`${key === "paintBack" ? "back" : "front"} line ${line.evidence.refs[0]}`);
      return false;
    }
    return true;
  });
}

// ---------------------------------------------------------------- 4. lots
function footprint(row) {
  const f = frameOf(row);
  return [f.at(0, 0), f.at(f.length, 0), f.at(f.length, row.depthM), f.at(0, row.depthM)];
}
const bounds = (points) => points.reduce((b, [x, y]) => [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)], [Infinity, Infinity, -Infinity, -Infinity]);
const boxGap = (a, b) => Math.hypot(Math.max(0, a[0] - b[2], b[0] - a[2]), Math.max(0, a[1] - b[3], b[1] - a[3]));

function assignLots(rows, lines, named) {
  const items = [
    ...rows.map((record) => ({ record, kind: "row", points: footprint(record) })),
    ...lines.map((record) => ({ record, kind: "line", points: record.ring ?? record.abs })),
  ].map((item) => ({ ...item, box: bounds(item.points) }));
  const parent = items.map((_, i) => i);
  const root = (i) => (parent[i] === i ? i : (parent[i] = root(parent[i])));
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) if (boxGap(items[i].box, items[j].box) <= LOT_LINK_M) parent[root(i)] = root(j);
  }
  const clusters = new Map();
  items.forEach((item, i) => clusters.set(root(i), [...(clusters.get(root(i)) ?? []), item]));
  const sorted = [...clusters.values()].map((list) => ({ list: list.sort((p, q) => p.box[0] - q.box[0] || p.box[1] - q.box[1]), box: bounds(list.flatMap((x) => x.points)) }))
    .sort((p, q) => p.box[0] - q.box[0] || p.box[1] - q.box[1]);
  const used = new Set();
  const lots = [];
  for (const { list, box } of sorted) {
    const centres = list.map((x) => { const b = x.box; return [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]; });
    let id = Object.entries(named).find(([name, ring]) => !used.has(name) && centres.some((c) => pointInRing(c, ring)))?.[0];
    if (!id) {
      const base = `LOT_E${Math.abs(Math.round(box[0]))}_N${Math.abs(Math.round(box[1]))}`;
      id = base;
      for (let n = 2; used.has(id); n += 1) id = `${base}_${n}`;
    }
    used.add(id);
    const lotRows = list.filter((x) => x.kind === "row").map((x, i) => {
      const rowId = `${id}/R${i + 1}`;
      const stalls = x.record.stalls.map((s) => ({ id: `${rowId}/S${s.index}`, ...s })).sort((p, q) => p.index - q.index);
      return { id: rowId, ...x.record, stalls };
    });
    const lotLines = list.filter((x) => x.kind === "line").map((x, i) => ({ id: `${id}/L${i + 1}`, ...x.record }));
    lots.push({ id, parcel: null, rows: lotRows, ...(lotLines.length ? { lines: lotLines } : {}) });
  }
  return lots;
}

// ---------------------------------------------------------------- 6. curated lots
// curation: data/ground/parking-curation.json. Each lot takes the place of the seeded lot its anchor lies on. The photo measures
// its rows (photoSupport, paintSupport, which dividers it cannot confirm) but does not decide for the person: a row the person
// read and the mask hides stays as read, and a T1 row with paint missing under it stops the seed, so the file gets looked at.
function hitsLot(lot, point) {
  return lot.rows.some((row) => pointInRing(point, footprint(row))) || (lot.lines ?? []).some((line) => {
    const b = bounds(line.ring ?? line.abs);
    return point[0] >= b[0] - 0.5 && point[0] <= b[2] + 0.5 && point[1] >= b[1] - 0.5 && point[1] <= b[3] + 0.5;
  });
}
function gradeCurated(row, photo) {
  const graded = structuredClone(row);
  gradeRow(graded, photo);
  if (row.evidence.tier === "T1" && graded.evidence.tier !== "T1" && graded.evidence.photoSupport !== null) throw new Error(`${row.id}: curated T1 but photoSupport ${graded.evidence.photoSupport}`);
  if (row.estimatedDividers) {
    // a person may read what the mask hides, not overrule what the photo sees
    const f = frameOf(row);
    let s = 0;
    const places = [0, ...widthsOf(row).map((w) => (s += w))];
    for (const i of graded.estimatedDividers ?? []) {
      if (!row.estimatedDividers.includes(i) && photo.line({ from: f.at(places[i], 0), dir: f.d, across: f.a, lengthM: row.depthM }).visible >= VISIBLE) throw new Error(`${row.id}: estimatedDividers leaves out divider ${i}, which the photo sees without paint`);
    }
  }
  row.evidence.photoSupport = graded.evidence.photoSupport ?? null;
  for (const stall of row.stalls) {
    const seen = graded.stalls.find((x) => x.index === stall.index);
    if ("paintSupport" in seen) stall.paintSupport = seen.paintSupport;
    if (seen.estimated) stall.estimated = true;
  }
  if (!row.estimatedDividers && graded.estimatedDividers?.length) row.estimatedDividers = graded.estimatedDividers;
}
export function applyCuration(doc, curation, { photo = null, log = () => {} } = {}) {
  const taken = new Map();
  const lots = doc.lots.map((lot) => ({ ...lot }));
  for (const entry of curation.lots) {
    const index = doc.lots.findIndex((lot) => hitsLot(lot, entry.anchor));
    const where = `${entry.id}: anchor ${JSON.stringify(entry.anchor)}`;
    if (index < 0) throw new Error(`${where} lies on no seeded lot`);
    if (taken.has(index)) throw new Error(`${where} lies on a lot another curation took (${taken.get(index)})`);
    taken.set(index, entry.id);
    const rows = structuredClone(entry.rows);
    if (photo) rows.forEach((row) => gradeCurated(row, photo));
    log(`CURATED ${entry.id} replaces seeded ${doc.lots[index].id}: ${doc.lots[index].rows.length} rows and ${(doc.lots[index].lines ?? []).length} lines -> ${rows.length} rows and ${entry.lines.length} lines`);
    lots[index] = { id: entry.id, parcel: doc.lots[index].parcel ?? null, curated: entry.curated, rows, ...(entry.lines.length ? { lines: structuredClone(entry.lines) } : {}) };
  }
  const curatedRows = lots.filter((_, i) => taken.has(i)).flatMap((lot) => lot.rows);
  for (const [i, lot] of lots.entries()) {
    if (taken.has(i)) continue;
    for (const row of lot.rows) {
      const f = frameOf(row);
      const mid = f.at(f.length / 2, row.depthM / 2);
      const on = curatedRows.find((other) => pointInRing(mid, footprint(other)));
      if (on) throw new Error(`${row.id} lies on curated row ${on.id}`);
    }
  }
  return { ...doc, lots };
}

// ---------------------------------------------------------------- the seed
// lines: [{ id, colour, ring }]; cells: [{ ids, cell, centre, widthM, deepM, acrossBearingDeg, upBearingDeg, symbol, rule }];
// stallRows: features of site-detail with `line` in EPSG:5186; probe(p, q) -> { visible, support } of the photo along a
// divider position; propose(id, ring, backHint) -> estimator rows on the photo; named: { lotId: { ring, backHint } };
// photo: { line({ from, dir, across, lengthM }) -> { visible, contrast, offsetM }, blue(ring) -> { visible, share } }.
// Returns the parking.json document (parcel null).
export function seedLots({ lines, cells, stallRows, probe = () => ({ visible: 1, support: 0 }), propose = () => [], named = {}, photo = null, log = () => {}, curation = null }) {
  const pieces = lines.map((line) => {
    const box = orientedBox(line.ring);
    return { ...line, box: { ...box, long: northward(box.long), short: box.short } };
  });
  const asLine = (piece) => (piece.ring.length === 4 && piece.box.halfLong >= MIN_ASPECT * piece.box.halfShort
    ? { abs: [add(piece.box.centre, mul(piece.box.long, -piece.box.halfLong)).map(r3), add(piece.box.centre, mul(piece.box.long, piece.box.halfLong)).map(r3)], widthM: 0.1, colour: piece.colour, evidence: { tier: "T1", refs: [pieceRef(piece)] } }
    : { ring: piece.ring.map((q) => q.map(r3)), colour: piece.colour, evidence: { tier: "T1", refs: [pieceRef(piece)] } });
  const candidates = [];
  const free = [];
  for (const piece of pieces) {
    const length = 2 * piece.box.halfLong;
    if (piece.ring.length !== 4 || length >= LONG_LINE_M || piece.box.halfLong < MIN_ASPECT * piece.box.halfShort) free.push(piece);
    else candidates.push(piece);
  }
  const photoRows = [];
  for (const group of groupParallel(candidates)) {
    const { rows: found, loose } = rowsFromGroup(group, probe, photo);
    photoRows.push(...found);
    free.push(...loose);
  }
  const { kept: rows, loose: rails } = dissolveRailRows(photoRows, log);
  free.push(...rails);
  for (const [id, { ring, backHint }] of Object.entries(named)) rows.push(...freshProposals(propose(id, ring, backHint), rows));
  for (const feature of stallRows) attachStallRow(feature, rows, propose);
  // first the cells that adjoin a stall row or a photo row; a lone group of cells then forms one row of its own
  for (const cell of cells) {
    const row = joinCell(cell, rows);
    if (row) row.evidence.refs.push(cellRef(cell));
    else {
      const own = rowFromCell(cell);
      own.evidence.refs.push(cellRef(cell));
      rows.push(own);
    }
  }
  rows.filter((row) => row.photoGrid).forEach(refitPhotoGrid);
  for (const row of rows) gradeRow(row, photo);
  const doc = { lots: assignLots(rows, absorbEndLines(rows, free.map(asLine)), Object.fromEntries(Object.entries(named).map(([id, def]) => [id, def.ring ?? def]))) };
  return curation ? applyCuration(doc, curation, { photo, log }) : doc;
}

// ---------------------------------------------------------------- CLI
async function cli(args) {
  const { readFileSync, writeFileSync } = await import("node:fs");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const { validate } = await import("../lib/schemas.mjs");
  const here = path.dirname(fileURLToPath(import.meta.url));
  const data = path.join(here, "..", "data");
  const out = path.join(data, "ground", "parking.json");
  const stamp = "Parametric parking rows (design §6, plan campus-ground-truth-redesign todo 12). Seeded by fit/parkingSeed.mjs from data/photo/evidence/parking-migration.json and data/ground/parking-curation.json: reviewed lots are edited in the curation file, this file is rewritten by the seed. Coordinates EPSG:5186 metres; widths and depths are estimates (추정) unless the evidence says otherwise.";
  if (args.includes("--link")) {
    const { loadParcels, topParcelAt } = await import("../lib/parcels.mjs");
    const doc = JSON.parse(readFileSync(out, "utf8"));
    const { parcels } = loadParcels();
    const at = topParcelAt(parcels);
    const missing = [];
    const dropped = [];
    doc.lots = doc.lots.filter((lot) => {
      const inField = lot.rows.length || (lot.lines ?? []).some((l) => (l.ring ?? l.abs).some((p) => at(p)));
      if (!inField) dropped.push(lot.id);
      return inField;
    });
    for (const lot of doc.lots) {
      const points = [...lot.rows.flatMap((row) => { const f = frameOf(row); return [f.at(f.length / 2, row.depthM / 2), ...footprint(row)]; }), ...(lot.lines ?? []).flatMap((l) => l.ring ?? l.abs)];
      // a row of wheel stops alone has no paint: its lot names the ground it stands on
      lot.parcel = (points.map(at).find((p) => p?.paintAllowed) ?? points.map(at).find(Boolean))?.id ?? null;
      if (!lot.parcel) missing.push(lot.id);
    }
    writeFileSync(out, `${JSON.stringify(doc, null, 1)}\n`);
    console.log(`LINKED ${doc.lots.length - missing.length}/${doc.lots.length}; no parcel: ${missing.join(", ") || "none"}; beyond every parcel, left out: ${dropped.join(", ") || "none"}`);
    return;
  }
  const { wgs84ToTm } = await import("../../../src/geo/epsg5186.mjs");
  const { openSheet, sheetWindowForTm } = await import("../lib/ngiiSheet.mjs");
  const { occlusionMask } = await import("../lib/occlusion.mjs");
  const { LOTS, blueShare, lineContrast, measure, paintThreshold, proposeLot } = await import("./parkingRows.mjs");
  const { paintMasks } = await import("../lib/paintMasks.mjs");
  const read = (f) => JSON.parse(readFileSync(path.join(data, f), "utf8"));
  const migration = read("photo/evidence/parking-migration.json");
  const forms = read("building-forms.json");
  const leans = new Map(read("photo/building-lean.json").buildings.map((b) => [b.id, b.lean]));
  const buildings = forms.buildings.flatMap((b) => b.masses.map((m) => ({
    rings: [m.outer, ...(m.holes ?? [])].map((r) => r.map(([lon, lat]) => wgs84ToTm(lon, lat))),
    heightM: m.topMetres, lean: leans.get(b.key) ?? b.leanPrior,
  })));
  const trees = read("trees.json").trees.map(([east, north, crownDiameterM, heightM]) => ({ east, north, crownDiameterM, heightM }));
  const sheet = openSheet();
  const windowAt = (E0, N0, wM, hM) => {
    const raw = sheetWindowForTm(sheet, E0, N0, wM, hM);
    const gsdM = Math.abs(sheet.tfw.a);
    const origin = [sheet.tfw.c - gsdM / 2 + raw.col0 * gsdM, sheet.tfw.f + gsdM / 2 - raw.row0 * gsdM];
    const geom = { w: raw.w, h: raw.h, origin, gsdM };
    const near = (b) => b.rings[0].some(([E, N]) => E > E0 - 60 && E < E0 + wM + 60 && N < N0 + 60 && N > N0 - hM - 60);
    const { any, roofs, crowns } = occlusionMask(geom, { buildings: buildings.filter(near), trees: trees.filter((t) => t.east > E0 - 20 && t.east < E0 + wM + 20 && t.north < N0 + 20 && t.north > N0 - hM - 20) });
    return { ...geom, rgb: raw.rgb, mask: any, hidden: roofs.map((v, k) => v || crowns[k]) };
  };
  const probe = (p, q) => {
    const win = windowAt(Math.min(p[0], q[0]) - 3, Math.max(p[1], q[1]) + 3, Math.abs(p[0] - q[0]) + 6, Math.abs(p[1] - q[1]) + 6);
    const length = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
    return measure(win, paintThreshold(win), p, [(q[0] - p[0]) / length, (q[1] - p[1]) / length], length);
  };
  const raw = [...read("photo/markings.geojson").features, ...read("photo/markings-extra.geojson").features]
    .filter((f) => f.properties.kind === "parking_line" && f.geometry.type === "Polygon")
    .map((f) => ({ id: f.properties.id, kind: "parking_line", ring: f.geometry.coordinates[0].map(([lon, lat]) => wgs84ToTm(lon, lat)) }));
  const propose = (id, ring, backHint) => {
    const xs = ring.map((p) => p[0]);
    const ys = ring.map((p) => p[1]);
    const [E0, N0] = [Math.min(...xs) - 4, Math.max(...ys) + 4];
    const [wM, hM] = [Math.max(...xs) + 4 - E0, N0 - (Math.min(...ys) - 4)];
    const win = windowAt(E0, N0, wM, hM);
    const lot = proposeLot({ id, parcel: null, ring }, { pieces: raw, window: win, backHint });
    return lot.rows.map(({ divisions, id: _id, ...row }) => {
      const hidden = divisions.filter((d) => d.occluded && !d.detected).map((d) => d.index);
      return { ...row, endCaps: true, ...(hidden.length ? { estimatedDividers: hidden } : {}), evidence: { ...row.evidence, refs: [`estimator on ${id}: ${row.evidence.refs.join("; ")}`] } };
    });
  };
  const all = [...migration.lines.flatMap((l) => l.ring), ...migration.cells.map((c) => c.centre), ...migration.stallRows.flatMap((s) => s.line)];
  const [E0, N0] = [Math.min(...all.map((p) => p[0])) - 40, Math.max(...all.map((p) => p[1])) + 40];
  const campus = windowAt(E0, N0, Math.max(...all.map((p) => p[0])) + 40 - E0, N0 - (Math.min(...all.map((p) => p[1])) - 40));
  const { blue } = paintMasks({ rgb: campus.rgb, width: campus.w, height: campus.h, metresPerPixel: campus.gsdM });
  // shade hides no line (lineContrast reads the ground beside it), but the blue test needs lit pixels
  const unshaded = { ...campus, mask: campus.hidden };
  const photo = { line: (q) => lineContrast(unshaded, q), blue: (ring) => blueShare(campus, blue, ring) };
  const curation = JSON.parse(readFileSync(path.join(data, "ground", "parking-curation.json"), "utf8"));
  const curationCheck = validate("parkingCuration", curation);
  if (!curationCheck.ok) throw new Error(`parking-curation.json is invalid:\n${curationCheck.errors.join("\n")}`);
  const doc = seedLots({
    curation,
    log: console.log,
    photo,
    propose,
    lines: migration.lines,
    cells: migration.cells,
    stallRows: migration.stallRows,
    probe,
    named: LOTS,
  });
  sheet.close();
  const { ok, errors } = validate("parking", doc);
  for (const e of errors.slice(0, 30)) console.error(e);
  const rows = doc.lots.flatMap((l) => l.rows);
  console.log(`SEED ${JSON.stringify({ lots: doc.lots.length, rows: rows.length, dividers: rows.reduce((n, r) => n + r.count, 0), estimated: rows.reduce((n, r) => n + (r.estimatedDividers?.length ?? 0), 0), accessible: rows.flatMap((r) => r.stalls).filter((s) => s.kind === "accessible").length, pm: rows.flatMap((r) => r.stalls).filter((s) => s.kind === "pm").length, wheelStopRows: rows.filter((r) => r.wheelStops).length, lines: doc.lots.flatMap((l) => l.lines ?? []).length })}`);
  if (!ok) process.exit(1);
  if (args.includes("--write")) {
    writeFileSync(out, `${JSON.stringify({ note: stamp, ...doc }, null, 1)}\n`);
    console.log(`wrote ${out}`);
  }
}

if (import.meta.main) await cli(process.argv.slice(2));
