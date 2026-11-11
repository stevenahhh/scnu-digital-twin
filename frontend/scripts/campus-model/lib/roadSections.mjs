// Design sections 8.1 and 10.4. Station distances are metres along a directed
// EPSG:5186 path. A branched RD segment uses pathIndex, never concatenated arms.
import { readFileSync } from "node:fs";

const dataUrl = new URL("../../../../backend/simulation/data/", import.meta.url);
const text = (v) => typeof v === "string" && v.length > 0;
const positive = (v) => Number.isFinite(v) && v > 0;
const nonnegative = (v) => Number.isFinite(v) && v >= 0;
const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const pair = (v) => Array.isArray(v) && v.length === 2 && v.every(Number.isFinite);
const centreTypes = new Set(["none", "yellow_solid", "yellow_double", "yellow_dashed"]);
const edgeTypes = new Set(["none", "white_solid", "white_dashed", "yellow_solid", "yellow_dashed"]);
const arrowTypes = new Set(["straight", "left", "right", "straight_left", "straight_right", "uturn"]);

export function roadContext() {
  const roads = JSON.parse(readFileSync(new URL("road_segments.geojson", dataUrl), "utf8"));
  const network = JSON.parse(readFileSync(new URL("campus_transport_network.geojson", dataUrl), "utf8"));
  const anchor = network.metadata.epsg5186_anchor;
  const junctionPoints = network.features.filter(f => f.geometry.type === "Point" && /^ND_/.test(f.properties.id))
    .map(f => ({ id: f.properties.id, point: f.properties.epsg5186 ?? [anchor.E + f.geometry.coordinates[0], anchor.N + f.geometry.coordinates[1]] }));
  return {
    nodes: junctionPoints.map(p => p.id), junctionPoints,
    segments: roads.features.map(({ properties: p }) => ({
      id: p.id, widthM: p.width_m, lanes: p.lanes,
      paths: p.epsg5186.map((line) => ({
        line, lengthM: line.slice(1).reduce((sum, q, i) => sum + Math.hypot(q[0] - line[i][0], q[1] - line[i][1]), 0),
      })),
    })),
  };
}

function evidence(record, fail) {
  const e = record.evidence;
  if (!object(e) || !["T0", "T1", "T2", "T3", "T4"].includes(e.tier) ||
      !Array.isArray(e.refs) || !e.refs.length || !e.refs.every(text)) fail("evidence needs a tier and non-empty refs");
  if (e?.photoSupport !== undefined && e.photoSupport !== null &&
      !(Number.isFinite(e.photoSupport) && e.photoSupport >= 0 && e.photoSupport <= 1)) fail("evidence.photoSupport must be in [0,1] or null");
  if (typeof record.estimated !== "boolean") fail("estimated must be a boolean");
  if (record.estimated === false && !["T0", "T1", "T2"].includes(e?.tier)) fail("evidence for a measurement must be T0-T2");
  if (e?.tier === "T4" && !text(record.reason)) fail("T4 needs a reason");
}

function humps(list, fail, fromM, toM) {
  if (!Array.isArray(list)) { fail("humps must be an array"); return; }
  list.forEach((h, i) => {
    if (!object(h) || !Number.isFinite(h.atM) || h.atM < fromM || h.atM > toM ||
        !positive(h.lengthM) || !positive(h.heightM) || typeof h.bands !== "boolean") fail(`humps[${i}] needs an in-range station, positive dimensions and bands`);
    if (h?.bandAxis !== undefined && !["travel","across"].includes(h.bandAxis)) fail(`humps[${i}] has unknown bandAxis`);
    if (h?.bandWidthM !== undefined && !positive(h.bandWidthM)) fail(`humps[${i}] needs positive bandWidthM`);
    if (h?.widthM !== undefined && !positive(h.widthM)) fail(`humps[${i}] needs positive widthM`);
    if (h?.lateralOffsetM !== undefined && !Number.isFinite(h.lateralOffsetM)) fail(`humps[${i}] needs finite lateralOffsetM`);
    if (h?.bandStartColour !== undefined && !["yellow","white"].includes(h.bandStartColour)) fail(`humps[${i}] has unknown bandStartColour`);
    if (h?.bandAngleDeg !== undefined && !(Number.isFinite(h.bandAngleDeg) && Math.abs(h.bandAngleDeg) < 60)) fail(`humps[${i}] needs bandAngleDeg within 60 degrees of travel`);
    if (h?.bandOffsetM !== undefined && !nonnegative(h.bandOffsetM)) fail(`humps[${i}] needs nonnegative bandOffsetM`);
  });
}

// A reviewed/inferred road centreline can refine a coarse transport path.
// Sections and their junction approaches share this one axis.
export function roadPath(road, spec, segment) {
  if (spec.alignment !== undefined) {
    const a = road?.alignments?.[spec.alignment];
    if (!Array.isArray(a?.line) || a.line.length < 2 || !a.line.every(pair)) return null;
    return { line: a.line, lengthM: a.line.slice(1).reduce((n,p,i)=>n+Math.hypot(p[0]-a.line[i][0],p[1]-a.line[i][1]),0) };
  }
  return segment?.paths ? segment.paths[spec.pathIndex ?? 0] : segment;
}

export function roadSections(doc, context = roadContext()) {
  if (!object(doc)) return ["roadSections: expected segment-keyed object"];
  const segments = new Map(context.segments.map((s) => [s.id, s]));
  const errors = [];
  const sectionIds = new Set();
  for (const [id, road] of Object.entries(doc)) {
    const segment = segments.get(id);
    if (!segment) { errors.push(`${id}: segment is not in road_segments`); continue; }
    if (!Array.isArray(road?.sections) || !road.sections.length) { errors.push(`${id}: sections must be non-empty`); continue; }
    if (road.splitAtM !== undefined && (!Array.isArray(road.splitAtM) ||
        road.splitAtM.some((s, i, all) => !positive(s) || (i > 0 && s <= all[i - 1]) ||
          !road.sections.some((r) => r?.fromM === s && (r.pathIndex ?? 0) === 0)))) errors.push(`${id}/splitAtM: split stations must be ordered section boundaries on path 0`);
    for (const [name,a] of Object.entries(road.alignments ?? {})) {
      const fail = message => errors.push(`${id}/alignments/${name}: ${message}`);
      if (!object(a) || !Array.isArray(a.line) || a.line.length < 2 || !a.line.every(pair)) fail("alignment needs EPSG:5186 centreline points");
      if (object(a)) evidence(a,fail);
    }
    const ends = new Map();
    road.sections.forEach((s, index) => {
      const fail = (message) => errors.push(`${s?.id ?? `${id}/sections[${index}]`}: ${message}`);
      if (!object(s)) { fail("section must be an object"); return; }
      if (s.id !== undefined) {
        if (!text(s.id) || sectionIds.has(s.id)) fail("section id is missing or repeated");
        sectionIds.add(s.id);
      }
      const pathIndex = s.pathIndex ?? 0;
      const length = roadPath(road,s,segment)?.lengthM;
      const pathKey = s.alignment ?? pathIndex;
      if (!Number.isInteger(pathIndex) || pathIndex < 0 || !positive(length)) fail("pathIndex must name a road path");
      if (!nonnegative(s.fromM) || !Number.isFinite(s.toM) || s.toM <= s.fromM || s.toM > length + 0.001) fail("fromM/toM must form an interval inside the segment");
      if (s.fromM < (ends.get(pathKey) ?? 0)) fail("sections overlap or are unordered");
      ends.set(pathKey, s.toM);
      if (!Array.isArray(s.lanes) || !s.lanes.length || s.lanes.some((l) => !["fwd", "bwd"].includes(l?.dir) || !positive(l.widthM))) fail("lanes need direction fwd/bwd and positive widthM");
      if (s.lanes?.some(l => l.line !== undefined && !["none","white_solid","white_dashed"].includes(l.line))) fail("lane line needs a known type");
      if (!centreTypes.has(s.centre?.type) || !positive(s.centre?.widthM)) fail("centre needs known type and positive widthM");
      if (!edgeTypes.has(s.edges?.left) || !edgeTypes.has(s.edges?.right)) fail("edges need known left/right line types");
      if (!Number.isFinite(s.lateralOffsetM)) fail("lateralOffsetM must be finite");
      if (!nonnegative(s.kerbOffsetsM?.left) || !nonnegative(s.kerbOffsetsM?.right)) fail("kerbOffsetsM needs nonnegative left/right offsets");
      if (typeof s.kerbNoParking?.left !== "boolean" || typeof s.kerbNoParking?.right !== "boolean") fail("kerbNoParking needs left/right booleans");
      if (s.dashPhaseM !== undefined && !nonnegative(s.dashPhaseM)) fail("dashPhaseM must be nonnegative");
      humps(s.humps, fail, s.fromM, s.toM);
      if (s.details?.length) fail("legacy details cannot generate section paint");
      if (s.dashPattern !== undefined && (!positive(s.dashPattern?.dashM) || !positive(s.dashPattern?.gapM))) fail("dashPattern needs positive dashM/gapM");
      evidence(s, fail);
    });
  }
  return errors;
}

export function junctions(doc, context = roadContext()) {
  if (!object(doc)) return ["junctions: expected node-keyed object"];
  const errors = [];
  const approachIds = new Set();
  const segments = new Map(context.segments.map((s) => [s.id, s]));
  const sectionDoc = context.roadSections ?? (Object.values(doc).some(j => j?.approaches?.some(a=>a?.alignment))
    ? JSON.parse(readFileSync(new URL("../data/ground/road-sections.json", import.meta.url), "utf8")) : null);
  // The authoritative transport network owns ND ids. Its feature properties
  // carry endpoint references rather than a second mutable junction inventory.
  const network = context.nodes ? null : JSON.parse(readFileSync(new URL("campus_transport_network.geojson", dataUrl), "utf8"));
  const nodes = new Set(context.nodes ?? network.features.flatMap((f) => [f.properties.id, f.properties.from, f.properties.to]).filter((id) => /^ND_/.test(id)));
  for (const [id, junction] of Object.entries(doc)) {
    if (!nodes.has(id)) errors.push(`${id}: node is not in the transport network`);
    if (!Array.isArray(junction?.approaches) || !junction.approaches.length) { errors.push(`${id}: approaches must be non-empty`); continue; }
    const seen = new Set();
    for (const a of junction.approaches) {
      const fail = (message) => errors.push(`${a?.id ?? `${id}/${a?.segment ?? "approach"}`}: ${message}`);
      if (!object(a)) { fail("approach must be an object"); continue; }
      if (a.id !== undefined) {
        if (!text(a.id) || approachIds.has(a.id)) fail("approach id is missing or repeated");
        approachIds.add(a.id);
      }
      const segment = segments.get(a.segment);
      if (!segment) fail("segment is not in road_segments");
      if (!["from", "to"].includes(a.end)) fail("end must be from or to");
      const key = `${a.segment}/${a.alignment ?? a.pathIndex ?? 0}/${a.end}`;
      if (seen.has(key)) fail("approach repeats");
      seen.add(key);
      const length = roadPath(sectionDoc?.[a.segment],a,segment)?.lengthM;
      if (a.section !== undefined && !sectionDoc?.[a.segment]?.sections.some(s=>s.id===a.section && s.alignment===a.alignment)) fail("section reference is missing or on another alignment");
      if (segment && !positive(length)) fail("pathIndex must name a road path");
      if (a.stopLineSetbackM !== null && (!nonnegative(a.stopLineSetbackM) || a.stopLineSetbackM > length)) fail("stopLineSetbackM must be null or within approach");
      if (a.stopLineWidthM !== undefined && !positive(a.stopLineWidthM)) fail("stopLineWidthM must be positive");
      if (a.crossing !== null) {
        const c = a.crossing;
        if (!positive(c?.widthM) || !nonnegative(c?.offsetM) || c.offsetM > length ||
            !positive(c?.barWidthM) || !positive(c?.zebraPeriodM) || c.zebraPeriodM <= c.barWidthM) fail("crossing needs positive width and zebraPeriodM > barWidthM, offset within approach");
      }
      for (const kind of ["arrows", "text"]) {
        if (!Array.isArray(a[kind])) { fail(`${kind} must be an array`); continue; }
        a[kind].forEach((r) => {
          if (!nonnegative(r?.atM) || r.atM > length || !Number.isInteger(r?.lane) || r.lane < 0 ||
              (kind === "arrows" ? !arrowTypes.has(r.type) : !text(r.text))) fail(`${kind} needs an in-range atM, lane and known type/text`);
          if (r.lengthM !== undefined && !positive(r.lengthM) || r.widthM !== undefined && !positive(r.widthM)) fail(`${kind} needs positive dimensions`);
        });
      }
      if (!Array.isArray(a.signalArms) || a.signalArms.some((r) => !Number.isFinite(r?.bearingDeg) || r.bearingDeg < 0 || r.bearingDeg >= 360 || !positive(r?.lengthM))) fail("signalArms need bearingDeg [0,360) and positive lengthM");
      for (const kind of ["yieldTriangles", "guideLines"]) {
        if (!Array.isArray(a[kind]) || a[kind].some((r) => !Array.isArray(r?.points) || r.points.length < (kind === "yieldTriangles" ? 3 : 2) || !r.points.every(pair))) fail(`${kind} need EPSG:5186 points`);
      }
      humps(a.humps, fail, 0, length);
      if (a.details?.length) fail("legacy details cannot generate junction paint");
      for (const name of ["symbols","areas"]) for (const m of a[name] ?? []) {
        if (!nonnegative(m.atM) || m.atM > length || !Number.isInteger(m.lane) || m.lane<0 || !positive(m.lengthM) || !positive(m.widthM)) fail(`${name} needs a lane, station and positive dimensions`);
        if (name==="symbols" && !["diamond","triangle","chevron","bicycle"].includes(m.type)) fail("unknown symbol type");
        if (name==="areas" && !["bus_stop_box","hatched_median","crossing_frame","stripe","colour","green_band"].includes(m.style)) fail("unknown area style");
      }
      evidence(a, fail);
    }
  }
  return errors;
}
