// Design 8.2: directed EPSG:5186 road paths plus section/junction records.
// Coordinates stay in metres until emission into the existing Road_Markings mesh.
// No photo, gate, OSM correction or inferred symbol is read by this generator.
import { sceneToTm, tmToScene } from "../../../src/geo/epsg5186.mjs";
import { SCENE_UNITS_PER_METRE } from "../lib/frame.mjs";
import { add, dot, offsetPath, rect, scale, slicePath, sub, unit } from "../lib/markingFit.mjs";
import { arrowTemplate, bicycleTemplate, busStopBoxTemplate, chevronTemplate, diamondTemplate, hatchedMedianTemplate, hasGlyph, textBlock, triangleTemplate } from "../lib/markingGlyphs.mjs";
import { readFileSync } from "node:fs";
import { junctions as validateJunctions, roadContext, roadSections as validateSections } from "../lib/roadSections.mjs";
import { strokePath } from "./markingsRegular.mjs";

const U = SCENE_UNITS_PER_METRE;
const left = ([e, n]) => [-n, e];
const right = ([e, n]) => [n, -e];

export class RoadMarkingError extends Error {
  constructor(record, detail) {
    super(`${record}: ${detail}`);
    this.name = "RoadMarkingError";
    this.record = record;
  }
}

// The existing circular hump profile, with the record's dimensions.
export const humpProfile = (sM, lengthM = 3.6, heightM = 0.1) =>
  Math.abs(sM) >= lengthM / 2 ? 0 : heightM * (1 - (2 * sM / lengthM) ** 2);

// Outgoing tangent at a vertex, incoming tangent at the final endpoint.
export function frameAt(line, atM, id) {
  let start = 0;
  for (let i = 1; i < line.length; i += 1) {
    const d = sub(line[i], line[i - 1]);
    const length = Math.hypot(...d);
    if (length > 0 && atM >= start && (atM < start + length || i === line.length - 1 && atM <= start + length + 0.001)) {
      return { centre: add(line[i - 1], scale(d, Math.min(length, atM - start) / length)), forward: scale(d, 1 / length) };
    }
    start += length;
  }
  throw new RoadMarkingError(id, `station ${atM} outside road path`);
}

// Lanes are indexed right to left along the directed path. Opposing lanes
// start at the centre line; one-way lanes are centred on the reference path.
function laneLayout(section) {
  const forwardWidth = section.lanes.filter(l => l.dir === "fwd").reduce((sum, l) => sum + l.widthM, 0);
  const backwardWidth = section.lanes.filter(l => l.dir === "bwd").reduce((sum, l) => sum + l.widthM, 0);
  let at = forwardWidth && backwardWidth ? -forwardWidth : -(forwardWidth + backwardWidth) / 2;
  return section.lanes.map(lane => {
    const low = at;
    at += lane.widthM;
    return { ...lane, low, high: at, centre: (low + at) / 2 };
  });
}

export function roadMarkingPlan({ sections, junctions, context = roadContext() }) {
  const errors = [...validateSections(sections, context), ...validateJunctions(junctions, context)];
  if (errors.length) throw new RoadMarkingError("roadMarkings", errors.join("; "));
  const paths = new Map(context.segments.map(s => [s.id, s.paths]));
  const pieces = [];
  const humps = [];
  const detailIds = new Set();
  const details = (list, line, owner) => {
    for (const d of list ?? []) {
      if (!d?.id || detailIds.has(d.id)) throw new RoadMarkingError(owner, "missing or duplicate detail id");
      detailIds.add(d.id);
      if (![d.atM, d.lateralOffsetM, d.alongOffsetM, d.yawRad].every(Number.isFinite) ||
          !d.evidence?.refs?.length || !["T0", "T1", "T2", "T3", "T4"].includes(d.evidence?.tier)) throw new RoadMarkingError(d.id, "invalid anchor or evidence");
      const f = frameAt(line, d.atM, d.id);
      const tm = add(f.centre, add(scale(left(f.forward), d.lateralOffsetM), scale(f.forward, d.alongOffsetM)));
      const centre = tmToScene(...tm);
      const direction = unit(sub(tmToScene(...add(tm, f.forward)), centre));
      const a = Math.atan2(direction[1], direction[0]) + d.yawRad;
      const forward = [Math.cos(a), Math.sin(a)], across = [-forward[1], forward[0]];
      const place = ([x, y]) => add(centre, scale(add(scale(across, x), scale(forward, y)), U));
      const s = d.shape;
      const positive = (...xs) => xs.every(n => Number.isFinite(n) && n > 0);
      let polys;
      switch (s?.type) {
        case "rectangle":
          if (!positive(s.lengthM, s.widthM)) throw new RoadMarkingError(d.id, "invalid rectangle dimensions");
          polys = [[rect([0, 0], [0, 1], [1, 0], s.lengthM / 2, s.widthM / 2)]];
          break;
        case "stroke":
          if (!positive(s.widthM) || !Array.isArray(s.path) || s.path.length < 2) throw new RoadMarkingError(d.id, "invalid stroke");
          polys = [[strokePath(s.path, s.widthM / 2)]];
          break;
        case "crossing":
          if (!positive(s.lengthM, s.widthM, s.periodM) || !Number.isInteger(s.count) || s.count < 1 ||
              !Array.isArray(s.slots) || s.slots.some(k => !Number.isInteger(k) || k < 0 || k >= s.count)) throw new RoadMarkingError(d.id, "invalid crossing slots");
          polys = s.slots.map(k => [rect([k * s.periodM, 0], [0, 1], [1, 0], s.lengthM / 2, s.widthM / 2)]);
          break;
        case "glyph": {
          const templates = { arrow: arrowTemplate, bicycle: bicycleTemplate, diamond: diamondTemplate,
            triangle: triangleTemplate, chevron: chevronTemplate, bus_stop_box: busStopBoxTemplate,
            hatched_median: hatchedMedianTemplate, text: (...args) => textBlock(...args).polys };
          if (!templates[s.template] || !Array.isArray(s.args)) throw new RoadMarkingError(d.id, "unknown glyph template");
          polys = templates[s.template](...s.args);
          if (s.centered) {
            const points = polys.flatMap(p => p[0]);
            const mid = [0, 1].map(k => (Math.min(...points.map(p => p[k])) + Math.max(...points.map(p => p[k]))) / 2);
            polys = polys.map(p => p.map(r => r.map(q => sub(q, mid))));
          }
          break;
        }
        case "region":
          if (!Array.isArray(s.boundary) || s.boundary.some(r => !Array.isArray(r) || r.length < 3)) throw new RoadMarkingError(d.id, "invalid painted region");
          polys = [s.boundary];
          break;
        case "hump": {
          if (!positive(s.lengthM, s.widthM, s.heightM)) throw new RoadMarkingError(d.id, "invalid hump dimensions");
          humps.push({ id: d.legacyId ?? d.id, record: d.id, order: d.order, centre, u: forward, v: across,
            widthM: s.widthM, halfWidth: s.widthM * U / 2, lengthM: s.lengthM, heightM: s.heightM,
            bands: false, evidence: d.evidence, estimated: true });
          continue;
        }
        default: throw new RoadMarkingError(d.id, `unknown primitive ${s?.type}`);
      }
      for (const rings of polys) {
        if (rings.some(r => !r || r.some(p => p.length !== 2 || !p.every(Number.isFinite)))) throw new RoadMarkingError(d.id, "non-finite geometry");
        pieces.push({ rings: rings.map(r => r.map(place)), record: d.id, order: d.order, kind: d.kind, colour: d.colour,
          ...(d.legacyId ? { id: d.legacyId } : {}), ...(d.glyph ? { glyph: d.glyph } : {}),
          estimated: true, evidence: d.evidence });
      }
    }
  };
  const emit = (rings, record, kind, colour, owner) => {
    pieces.push({
      id: `${record}/${pieces.length}`, record, kind, colour,
      evidence: owner.evidence, estimated: owner.estimated,
      ...(owner.reason ? { reason: owner.reason } : {}),
      rings: rings.map(ring => ring.map(([e, n]) => tmToScene(e, n))),
    });
  };
  const linePaint = (line, fromM, toM, offset, type, widthM, phase, id, owner, kind) => {
    if (type === "none") return;
    const dashed = type.endsWith("_dashed");
    const colour = type.startsWith("yellow") ? "yellow" : "white";
    const offsets = type === "yellow_double" ? [offset - (widthM + 0.15) / 2, offset + (widthM + 0.15) / 2] : [offset];
    const intervals = [];
    if (dashed) {
      const period = colour === "yellow" ? 6 : 8;
      const p = phase % period;
      for (let s = fromM - p; s < toM; s += period) {
        const a = Math.max(fromM, s), b = Math.min(toM, s + 3);
        if (b > a) intervals.push([a, b]);
      }
    } else intervals.push([fromM, toM]);
    for (const [a, b] of intervals) {
      // Slice the reference first, so dash stations do not drift with curve offset.
      const part = slicePath(line, a, b).filter((p, i, all) => !i || Math.hypot(...sub(p, all[i - 1])) > 1e-8);
      for (const lateral of offsets) {
        const ring = strokePath(offsetPath(part, lateral), widthM / 2);
        if (ring) emit([ring], id, kind, colour, owner);
      }
    }
  };
  const addHump = (line, station, section, h, id, owner) => {
    const { centre, forward } = frameAt(line, station, id);
    const lanes = laneLayout(section);
    const low = lanes[0].low, high = lanes.at(-1).high;
    const centreTm = add(centre, scale(left(forward), section.lateralOffsetM + (low + high) / 2));
    const centreScene = tmToScene(...centreTm);
    const u = unit(sub(tmToScene(...add(centreTm, forward)), centreScene));
    const v = [-u[1], u[0]];
    humps.push({
      id, record: id, centre: centreScene, u, v, widthM: high - low, halfWidth: (high - low) * U / 2,
      tm: { centre: centreTm, forward },
      lengthM: h.lengthM, heightM: h.heightM, bands: h.bands, evidence: owner.evidence, estimated: owner.estimated,
    });
    if (h.bands) {
      // Alternating transverse bands, clipped to the recorded hump footprint.
      const count = Math.ceil(h.lengthM / 0.45);
      for (let i = 0; i < count; i += 1) {
        const a = -h.lengthM / 2 + i * 0.45, b = Math.min(h.lengthM / 2, a + 0.45);
        emit([rect(add(centreTm, scale(forward, (a + b) / 2)), forward, left(forward), (b - a) / 2, (high - low) / 2)],
          id, "speed_bump", i % 2 ? "white" : "yellow", owner);
      }
    }
  };
  for (const [segment, road] of Object.entries(sections)) {
    road.sections.forEach((s, i) => {
      const id = `${segment}/sections/${i}`;
      const line = paths.get(segment)?.[s.pathIndex ?? 0]?.line;
      if (!line) throw new RoadMarkingError(id, "road path geometry is missing");
      const lanes = laneLayout(s);
      const boundary = lanes.findIndex(l => l.dir === "bwd");
      if (boundary >= 0 && lanes.slice(boundary).some(l => l.dir !== "bwd")) throw new RoadMarkingError(id, "lanes must be ordered right to left: fwd then bwd");
      linePaint(line, s.fromM, s.toM, s.lateralOffsetM, s.centre.type, s.centre.widthM, s.dashPhaseM ?? 0, `${id}/centre`, s, "centre_line_yellow");
      for (const [side, sign] of [["left", 1], ["right", -1]]) {
        const lateral = s.lateralOffsetM + sign * s.kerbOffsetsM[side];
        linePaint(line, s.fromM, s.toM, lateral, s.edges[side], 0.15, s.dashPhaseM ?? 0, `${id}/edges/${side}`, s, "edge_line");
        if (s.kerbNoParking[side]) linePaint(line, s.fromM, s.toM, lateral, "yellow_solid", 0.15, 0, `${id}/kerb/${side}`, s, "kerb_no_parking");
      }
      // A same-direction separator is emitted only when the lane records it.
      lanes.forEach((lane, index) => {
        if (lane.line !== undefined && lane.line !== "none") {
          if (!["white_solid", "white_dashed"].includes(lane.line) || lane.dir !== lanes[index + 1]?.dir) throw new RoadMarkingError(id, `lane ${index} has invalid separator`);
          linePaint(line, s.fromM, s.toM, s.lateralOffsetM + lane.high, lane.line, 0.125, s.dashPhaseM ?? 0,
            `${id}/lanes/${index}`, s, lane.line === "white_dashed" ? "lane_line_dashed" : "lane_line_solid");
        }
      });
      s.humps.forEach((h, index) => addHump(line, h.atM, s, h, `${id}/humps/${index}`, s));
      details(s.details, line, id);
    });
  }
  for (const [node, junction] of Object.entries(junctions)) {
    for (const a of junction.approaches) {
      const id = `${node}/${a.segment}/${a.pathIndex ?? 0}/${a.end}`;
      const path = paths.get(a.segment)?.[a.pathIndex ?? 0];
      if (!path?.line) throw new RoadMarkingError(id, "road path geometry is missing");
      details(a.details, path.line, id);
      const sign = a.end === "to" ? 1 : -1;
      const station = distance => a.end === "to" ? path.lengthM - distance : distance;
      const at = (distance) => {
        const sM = station(distance);
        const s = sections[a.segment]?.sections.find(s => (s.pathIndex ?? 0) === (a.pathIndex ?? 0) && sM >= s.fromM && sM <= s.toM);
        if (!s) throw new RoadMarkingError(id, `no section at station ${sM}`);
        const f = frameAt(path.line, sM, id);
        return { ...f, section: s, lanes: laneLayout(s), travel: scale(f.forward, sign),
          centre: add(f.centre, scale(left(f.forward), s.lateralOffsetM)) };
      };
      if (a.stopLineSetbackM !== null) {
        const f = at(a.stopLineSetbackM);
        const incoming = f.lanes.filter(l => l.dir === (sign === 1 ? "fwd" : "bwd"));
        if (!incoming.length) throw new RoadMarkingError(id, "stop line has no incoming lane");
        const low = incoming[0].low, high = incoming.at(-1).high;
        emit([rect(add(f.centre, scale(left(f.forward), (low + high) / 2)), f.forward, left(f.forward), 0.2, (high - low) / 2)],
          `${id}/stop`, "stop_line", "white", a);
      }
      if (a.crossing !== null) {
        const c = a.crossing, f = at(c.offsetM);
        const low = f.lanes[0].low, high = f.lanes.at(-1).high;
        const count = Math.max(0, Math.floor((high - low - c.barWidthM) / c.zebraPeriodM) + 1);
        const first = (low + high - (count - 1) * c.zebraPeriodM) / 2;
        for (let k = 0; k < count; k += 1) emit([rect(add(f.centre, scale(left(f.forward), first + k * c.zebraPeriodM)),
          f.forward, left(f.forward), c.widthM / 2, c.barWidthM / 2)], `${id}/crossing/${k}`, "zebra_bar", "white", a);
      }
      for (const kind of ["arrows", "text"]) {
        a[kind].forEach((mark, i) => {
          const record = `${id}/${kind}/${i}`;
          const f = at((a.stopLineSetbackM ?? 0) + mark.atM);
          const lane = f.lanes[mark.lane];
          if (!lane || lane.dir !== (sign === 1 ? "fwd" : "bwd")) throw new RoadMarkingError(record, "lane is missing or outgoing");
          const centre = add(f.centre, scale(left(f.forward), lane.centre));
          if (kind === "text" && [...mark.text].some(c => !hasGlyph(c))) throw new RoadMarkingError(record, "text contains an unsupported glyph");
          const polys = kind === "arrows" ? arrowTemplate(`arrow_${mark.type}`, 5, 1)
            : textBlock(mark.text.split("\n"), Math.min(2.4, lane.widthM - 0.4), 5).polys;
          for (const rings of polys) emit(rings.map(r => r.map(([x, y]) => add(centre, add(scale(right(f.travel), x), scale(f.travel, y))))),
            record, kind === "arrows" ? "arrow" : "text", "white", { ...a, estimated: true });
        });
      }
      a.humps.forEach((h, i) => addHump(path.line, station(h.atM), at(h.atM).section, h, `${id}/humps/${i}`, a));
      for (const [i, mark] of a.yieldTriangles.entries()) {
        const ring = strokePath([...mark.points, mark.points[0]], 0.075);
        emit([ring], `${id}/yield/${i}`, "give_way_line", "white", a);
      }
      for (const [i, mark] of a.guideLines.entries()) {
        const ring = strokePath(mark.points, 0.075);
        if (!ring) throw new RoadMarkingError(`${id}/guide/${i}`, "guide line has no length");
        emit([ring], `${id}/guide/${i}`, "guide_line", "white", a);
      }
    }
  }
  humps.sort((a, b) => (a.order ?? -1) - (b.order ?? -1));
  const heightAt = (x, z) => {
    const point = sceneToTm(x, z);
    for (const h of humps) {
      // Horizontal TM metres include the projection scale; dividing scene
      // distance by the vertical scene-unit scale subtly changes the profile.
      if (h.tm) {
        const delta = sub(point, h.tm.centre);
        if (Math.abs(dot(delta, left(h.tm.forward))) <= h.widthM / 2 && Math.abs(dot(delta, h.tm.forward)) < h.lengthM / 2) return humpProfile(dot(delta, h.tm.forward), h.lengthM, h.heightM);
      } else {
        const delta = [x - h.centre[0], z - h.centre[1]];
        if (Math.abs(dot(delta, h.v)) <= h.halfWidth && Math.abs(dot(delta, h.u)) < h.lengthM * U / 2) return humpProfile(dot(delta, h.u) / U, h.lengthM, h.heightM);
      }
    }
    return 0;
  };
  heightAt.near = (minX, minZ, maxX, maxZ) => humps.some(h => {
    const radius = Math.hypot(h.lengthM * U / 2, h.halfWidth);
    return Math.hypot(Math.max(minX - h.centre[0], 0, h.centre[0] - maxX), Math.max(minZ - h.centre[1], 0, h.centre[1] - maxZ)) <= radius;
  });
  pieces.sort((a, b) => (a.order ?? -1) - (b.order ?? -1));
  return { pieces, humps, heightAt, warnings: [], source: "data/ground/road-sections.json + data/ground/junctions.json" };
}

export function loadRoadMarkings() {
  const read = name => JSON.parse(readFileSync(new URL(`../data/ground/${name}.json`, import.meta.url), "utf8"));
  return roadMarkingPlan({ sections: read("road-sections"), junctions: read("junctions") });
}

// Explicit preview/export entry point; never substitutes absent campus records
// with an empty model or photo fallback.
if (import.meta.main) {
  const { readFileSync, writeFileSync } = await import("node:fs");
  const args = process.argv.slice(2);
  const option = (name) => {
    const i = args.indexOf(name);
    if (i < 0 || !args[i + 1]) throw new RoadMarkingError("CLI", `${name} is required`);
    return args[i + 1];
  };
  const sections = JSON.parse(readFileSync(option("--sections"), "utf8"));
  const junctions = JSON.parse(readFileSync(option("--junctions"), "utf8"));
  const plan = roadMarkingPlan({ sections, junctions });
  writeFileSync(option("--out"), `${JSON.stringify({ pieces: plan.pieces, humps: plan.humps, source: plan.source }, null, 2)}\n`);
  console.log(`roadMarkings: ${plan.pieces.length} pieces, ${plan.humps.length} humps`);
}
