#!/usr/bin/env bun
// Road segment ID registry: one feature per road segment with a stable RD_### id -> backend/simulation/data/road_segments.geojson,
// plus add-only element additions to common/data/common_elemetns.json (CW_025-CW_031, newly allocated RD ids, the
// SW_ sidewalk placeholder list and metadata.id_scheme). The scheme is documented in backend/simulation/README.md
// ("ID 체계") and common/data/README.md.
//
//   bun scripts/campus-model/network/roadIds.mjs [--dry-run]
//
// Interior segments: the named road-zone polygons of docs/assets/data/road_zones_wgs84.geojson matched to the RD_
// elements by name (zones named like an intersection are ND_ areas, zones named like a car park are lots: neither is a
// road segment), plus the RD_ elements no zone carries. A road zone with no RD_ name gets the next free RD_ id above
// the highest one, appended to the elements file (geometry stays null there). Centrelines are the vehicle edges of
// backend/simulation/data/campus_transport_network.geojson that carry the RD_ id; a zone without such edges uses the
// principal axis of its polygon. width_m is measured on the zone polygon: median of perpendicular widths every 5 m
// along the centreline, taking the smaller of the network centreline and the polygon's principal axis (an oblique cut
// only overestimates). lanes = 2 when a photo-traced centre_line_yellow marking lies within 1.5 m of the centreline
// over > 30 % of its length, else 1 (bidirectional, assumed). Perimeter segments: OSM arterial/connector ways from
// data/osm-ground.json (ODbL 1.0), each with an RD_ id and external_ids.osm_way; OSM ids appear on perimeter features
// only. Geometry is in the simulation frame (metres east/north of the D4 anchor, src/geo/epsg5186.mjs) with an
// EPSG:5186 copy in properties.epsg5186.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { simulationToTm, wgs84ToSimulation } from "../../../src/geo/epsg5186.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../../..");
const PATHS = {
  roadZones: path.join(REPO, "docs/assets/data/road_zones_wgs84.geojson"),
  crosswalks: path.join(REPO, "docs/assets/data/crosswalks_wgs84.geojson"),
  walkways: path.join(REPO, "docs/assets/data/walkways_wgs84.geojson"),
  network: path.join(REPO, "backend/simulation/data/campus_transport_network.geojson"),
  elements: path.join(REPO, "common/data/common_elemetns.json"),
  elementsCopy: path.join(REPO, "backend/simulation/data/source/common_elemetns.json"),
  osmGround: path.join(HERE, "../data/osm-ground.json"),
  markings: path.join(HERE, "../data/photo/evidence/markings.geojson"),
  output: path.join(REPO, "backend/simulation/data/road_segments.geojson"),
};

const WIDTH_STEP_M = 5;
const WIDTH_REACH_M = 30;
const YELLOW_REACH_M = 1.5;
const YELLOW_SHARE = 0.3;
const INTERSECTION_NAME = /(삼거리|사거리|오거리|교차로)$/;
const LOT_NAME = /주차장$/;

export const ID_SCHEME = {
  RD_: "road segment between ND_ intersections (interior) or OSM way (perimeter)",
  ND_: "intersection node",
  CW_: "crossing polygon CW_001-CW_031",
  SW_: "sidewalk strip from NGII A003 (SW_###, sides _L/_R when split)",
  external_ids: "osm_way (ODbL, perimeter only), juso_rn_cd (reserved; login-gated source)",
};

// ---------------------------------------------------------------- geometry (simulation frame, metres)
const toSim = ([lon, lat]) => {
  const p = wgs84ToSimulation(lon, lat);
  return [p.x, p.z];
};
const round = (v, d = 3) => Math.round(v * 10 ** d) / 10 ** d;

function polygonRings(geometry) {
  if (!geometry) return [];
  const polys = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.type === "MultiPolygon" ? geometry.coordinates : [];
  return polys.flat();
}

function insideRings(p, rings) {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

// Distance along the ray p + t*d (t > 0) to the nearest crossing of any ring edge.
function rayHit(p, d, rings) {
  let best = Infinity;
  for (const ring of rings) {
    for (let i = 0; i + 1 < ring.length; i += 1) {
      const [ax, ay] = ring[i];
      const [bx, by] = ring[i + 1];
      const ex = bx - ax;
      const ey = by - ay;
      const den = d[0] * ey - d[1] * ex;
      if (Math.abs(den) < 1e-12) continue;
      const t = ((ax - p[0]) * ey - (ay - p[1]) * ex) / den;
      const u = ((ax - p[0]) * d[1] - (ay - p[1]) * d[0]) / den;
      if (t > 1e-9 && u >= 0 && u <= 1) best = Math.min(best, t);
    }
  }
  return best;
}

// Points every `step` metres along each polyline, with the unit direction there.
function samples(lines, step) {
  const out = [];
  for (const line of lines) {
    let carry = step / 2;
    for (let i = 0; i + 1 < line.length; i += 1) {
      const [ax, ay] = line[i];
      const [bx, by] = line[i + 1];
      const len = Math.hypot(bx - ax, by - ay);
      if (len < 1e-9) continue;
      const dir = [(bx - ax) / len, (by - ay) / len];
      for (let s = carry; s <= len; s += step) out.push({ p: [ax + dir[0] * s, ay + dir[1] * s], dir });
      carry = step - ((len - carry) % step);
      if (carry > step) carry -= step;
    }
  }
  return out;
}

const lineLength = (lines) => lines.reduce((sum, line) => sum + line.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - line[i][0], p[1] - line[i][1]), 0), 0);

// Median perpendicular width of the polygon along the centreline (samples inside the polygon with both sides hit).
export function measureWidth(lines, rings, step = WIDTH_STEP_M) {
  const widths = [];
  for (const { p, dir } of samples(lines, step)) {
    if (!insideRings(p, rings)) continue;
    const n = [-dir[1], dir[0]];
    const left = rayHit(p, n, rings);
    const right = rayHit(p, [-n[0], -n[1]], rings);
    if (left <= WIDTH_REACH_M && right <= WIDTH_REACH_M) widths.push(left + right);
  }
  if (!widths.length) return null;
  widths.sort((a, b) => a - b);
  const mid = widths.length >> 1;
  return widths.length % 2 ? widths[mid] : (widths[mid - 1] + widths[mid]) / 2;
}

// Principal axis of the polygon's outer ring, clipped to its extent along that axis (fallback centreline).
export function principalAxis(rings) {
  const pts = rings[0].slice(0, -1);
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const [x, y] of pts) {
    sxx += (x - cx) ** 2;
    sxy += (x - cx) * (y - cy);
    syy += (y - cy) ** 2;
  }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const d = [Math.cos(angle), Math.sin(angle)];
  const proj = pts.map(([x, y]) => (x - cx) * d[0] + (y - cy) * d[1]);
  const lo = Math.min(...proj);
  const hi = Math.max(...proj);
  return [[cx + d[0] * lo, cy + d[1] * lo], [cx + d[0] * hi, cy + d[1] * hi]];
}

function pointSegmentDistance(p, a, b) {
  const ex = b[0] - a[0];
  const ey = b[1] - a[1];
  const len2 = ex * ex + ey * ey;
  const t = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ey) / len2)) : 0;
  return Math.hypot(p[0] - a[0] - t * ex, p[1] - a[1] - t * ey);
}

// Share of the centreline (1 m samples) within `reach` of any yellow centre-line segment.
export function yellowShare(lines, yellowLines, reach = YELLOW_REACH_M) {
  const pts = samples(lines, 1);
  if (!pts.length || !yellowLines.length) return 0;
  let near = 0;
  for (const { p } of pts) {
    if (yellowLines.some((line) => line.some((q, i) => i > 0 && pointSegmentDistance(p, line[i - 1], q) <= reach))) near += 1;
  }
  return near / pts.length;
}

// Joins edge polylines that share end points into longer chains.
function chain(polylines) {
  const key = (p) => `${p[0].toFixed(3)},${p[1].toFixed(3)}`;
  const lines = polylines.map((l) => l.slice());
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < lines.length; i += 1) {
      for (let j = 0; j < lines.length; j += 1) {
        if (i === j) continue;
        const a = lines[i];
        const b = lines[j];
        if (key(a.at(-1)) === key(b[0])) lines[i] = a.concat(b.slice(1));
        else if (key(a.at(-1)) === key(b.at(-1))) lines[i] = a.concat(b.slice(0, -1).reverse());
        else if (key(a[0]) === key(b.at(-1))) lines[i] = b.concat(a.slice(1));
        else if (key(a[0]) === key(b[0])) lines[i] = b.slice().reverse().concat(a.slice(1));
        else continue;
        lines.splice(j, 1);
        merged = true;
        break outer;
      }
    }
  }
  return lines;
}

const geometryOf = (lines) => (lines.length === 0 ? null : lines.length === 1
  ? { type: "LineString", coordinates: lines[0].map((p) => p.map((v) => round(v))) }
  : { type: "MultiLineString", coordinates: lines.map((l) => l.map((p) => p.map((v) => round(v)))) });
const tmCopy = (lines) => lines.map((l) => l.map(([x, z]) => simulationToTm({ x, z }).map((v) => round(v))));

// ---------------------------------------------------------------- builder
const rdNumber = (id) => Number(id.slice(3));
const rdId = (n) => `RD_${String(n).padStart(3, "0")}`;

// roadZones: GeoJSON FC (lon/lat, properties.ZONE_NAME / FEATURE_ID); osmLines: osm-ground.json osm.lines;
// elements: the `elements` array; network: transport network FC in the simulation frame (optional);
// yellowLines: centre_line_yellow polylines in the simulation frame (optional).
export function buildRoadSegments({ roadZones, osmLines = [], elements, network = null, yellowLines = [] }) {
  const roadElements = elements.filter((e) => e.element_type === "road" && /^RD_\d{3}$/.test(e.element_id));
  const byName = new Map(roadElements.map((e) => [e.name, e]));
  const byOsm = new Map(roadElements.filter((e) => e.external_ids?.osm_way).map((e) => [e.external_ids.osm_way, e]));
  const names = new Map();
  for (const f of roadZones.features) {
    const name = f.properties.ZONE_NAME;
    if (!name) continue;
    if (names.has(name)) throw new Error(`duplicate road name ${name}: zones ${names.get(name)} and ${f.properties.FEATURE_ID}`);
    names.set(name, f.properties.FEATURE_ID);
  }
  let next = Math.max(0, ...roadElements.map((e) => rdNumber(e.element_id))) + 1;
  const allocated = [];
  const allocate = (element) => {
    const id = rdId(next);
    next += 1;
    const e = { element_id: id, element_type: "road", geometry: null, ...element };
    allocated.push(e);
    return e;
  };

  // Vehicle edges per RD id (simulation frame already).
  const edgesByRd = new Map();
  for (const f of network?.features ?? []) {
    if (f.properties.feature_type !== "edge" || !f.properties.allowed_types?.includes("car") || f.geometry?.type !== "LineString") continue;
    for (const rd of f.properties.road_ids ?? []) {
      if (!edgesByRd.has(rd)) edgesByRd.set(rd, []);
      edgesByRd.get(rd).push(f.geometry.coordinates);
    }
  }

  const stats = { zones: roadZones.features.length, zoneMatched: 0, zoneAllocated: 0, intersectionZones: 0, lotZones: 0, rdWithoutZone: 0, perimeter: 0, perimeterAllocated: 0, nullGeometry: 0 };
  const features = [];
  const zoneOf = new Map();
  for (const f of [...roadZones.features].sort((a, b) => String(a.properties.FEATURE_ID).localeCompare(String(b.properties.FEATURE_ID)))) {
    const name = f.properties.ZONE_NAME;
    if (!byName.has(name)) {
      if (INTERSECTION_NAME.test(name)) { stats.intersectionZones += 1; continue; }
      if (LOT_NAME.test(name)) { stats.lotZones += 1; continue; }
      const e = allocate({ name, zone_id: null, source: "roadIds.mjs (road_zones_wgs84.geojson zone name)", notes: `road zone ${f.properties.FEATURE_ID} with no RD_ name in ID부여.pdf` });
      byName.set(name, e);
      stats.zoneAllocated += 1;
    } else {
      stats.zoneMatched += 1;
    }
    zoneOf.set(byName.get(name).element_id, f);
  }

  const interior = (element) => {
    const zone = zoneOf.get(element.element_id);
    const rings = zone ? polygonRings(zone.geometry).map((ring) => ring.map(toSim)) : [];
    let lines = chain(edgesByRd.get(element.element_id) ?? []);
    let centreSource = "campus_transport_network vehicle edges";
    if (!lines.length && rings.length) {
      lines = [principalAxis(rings)];
      centreSource = "principal axis of the road zone polygon";
    }
    if (!lines.length) centreSource = "none";
    // Oblique cuts only overestimate a width, so the smaller median of the two candidate centrelines wins.
    const candidates = rings.length ? [lines.length ? measureWidth(lines, rings) : null, measureWidth([principalAxis(rings)], rings)].filter((w) => w !== null) : [];
    const width = candidates.length ? Math.min(...candidates) : null;
    const share = lines.length ? yellowShare(lines, yellowLines) : 0;
    if (!zone) stats.rdWithoutZone += 1;
    if (!lines.length) stats.nullGeometry += 1;
    return {
      type: "Feature",
      geometry: geometryOf(lines),
      properties: {
        id: element.element_id,
        name: element.name,
        kind: "interior",
        external_ids: { osm_way: null, juso_rn_cd: null },
        width_m: width === null ? null : round(width, 2),
        width_source: width === null ? "none" : "road_zone_measured",
        lanes: share > YELLOW_SHARE ? 2 : 1,
        lanes_source: share > YELLOW_SHARE ? "markings" : "assumed",
        yellow_centre_share: round(share, 3),
        road_zone: zone?.properties.FEATURE_ID ?? null,
        centreline_source: centreSource,
        length_m: round(lineLength(lines), 1),
        source: zone ? "road_zones_wgs84.geojson (road_zone_sketchup.dxf)" : "common_elemetns.json (no road zone polygon)",
        confidence: zone && lines.length ? 0.5 : lines.length ? 0.3 : 0.1,
        estimated: true,
        epsg5186: tmCopy(lines),
      },
    };
  };

  for (const e of [...roadElements, ...allocated].filter((x) => !x.external_ids?.osm_way).sort((a, b) => rdNumber(a.element_id) - rdNumber(b.element_id))) features.push(interior(e));

  for (const line of [...osmLines].filter((l) => l.kind === "arterial" || l.kind === "connector").sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }))) {
    let element = byOsm.get(line.id);
    if (!element) {
      element = allocate({ name: line.tags?.name ?? `${line.tags?.highway ?? "road"} ${line.id}`, zone_id: null, source: "roadIds.mjs (OpenStreetMap, ODbL 1.0)", notes: `perimeter ${line.kind} ${line.id}`, external_ids: { osm_way: line.id, juso_rn_cd: null } });
      stats.perimeterAllocated += 1;
    }
    const lines = [line.line.map(toSim)];
    const width = Number.parseFloat(line.tags?.width);
    const lanes = Number.parseInt(line.tags?.lanes, 10);
    stats.perimeter += 1;
    features.push({
      type: "Feature",
      geometry: geometryOf(lines),
      properties: {
        id: element.element_id,
        name: line.tags?.name ?? null,
        kind: "perimeter",
        external_ids: { osm_way: line.id, juso_rn_cd: null },
        width_m: Number.isFinite(width) ? width : null,
        width_source: Number.isFinite(width) ? "osm_tag" : "none",
        lanes: Number.isFinite(lanes) ? lanes : 1,
        lanes_source: Number.isFinite(lanes) ? "osm_tag" : "assumed",
        osm_kind: line.kind,
        highway: line.tags?.highway ?? null,
        length_m: round(lineLength(lines), 1),
        source: "OpenStreetMap (ODbL 1.0, © OpenStreetMap contributors)",
        confidence: 0.5,
        estimated: true,
        epsg5186: tmCopy(lines),
      },
    });
  }
  features.sort((a, b) => rdNumber(a.properties.id) - rdNumber(b.properties.id));
  return {
    type: "FeatureCollection",
    metadata: {
      schema_version: 1,
      coordinate_system: "local meters, x=east, z=north (D4 anchor; src/geo/epsg5186.mjs)",
      generated_by: "frontend/scripts/campus-model/network/roadIds.mjs",
      id_scheme: ID_SCHEME,
      licence_note: "perimeter features derive from OpenStreetMap (ODbL 1.0, © OpenStreetMap contributors); interior features from the project road zones",
      estimated: "widths, lanes and centrelines are estimates derived from digitised polygons, photo markings and OSM, not survey data",
    },
    features,
    allocated,
    stats,
  };
}

// CW_025-CW_031 from the digitised crosswalk polygons; zone_id of the nearest CW polygon that already has an element.
export function crosswalkElements(crosswalks, elements) {
  const known = new Map(elements.filter((e) => e.element_type === "crosswalk").map((e) => [e.element_id, e]));
  const centroid = (f) => {
    const ring = polygonRings(f.geometry)[0].map(toSim);
    return [ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length];
  };
  const centres = crosswalks.features.map((f) => ({ id: f.properties.id, c: centroid(f), source: f.properties.source }));
  const out = [];
  for (const cw of centres.filter((c) => !known.has(c.id)).sort((a, b) => a.id.localeCompare(b.id))) {
    let best = null;
    for (const k of centres.filter((c) => known.has(c.id) && known.get(c.id).zone_id)) {
      const d = Math.hypot(k.c[0] - cw.c[0], k.c[1] - cw.c[1]);
      if (!best || d < best.d) best = { d, zone: known.get(k.id).zone_id, id: k.id };
    }
    out.push({
      element_id: cw.id,
      name: `횡단보도 ${cw.id}`,
      element_type: "crosswalk",
      zone_id: best?.zone ?? null,
      geometry: null,
      source: `crosswalks_wgs84.geojson (${cw.source})`,
      notes: `digitised polygon without a name; zone_id from the nearest named crossing ${best?.id} (${best ? best.d.toFixed(0) : "?"} m)`,
    });
  }
  return out;
}

// SW_ placeholders: one per A003 walkway feature with a ufid (todo 15 fills geometry and sides).
export function sidewalkPlaceholders(walkways) {
  const ufids = [...new Set(walkways.features.map((f) => f.properties?.ufid).filter(Boolean))].sort();
  return ufids.map((ufid, i) => ({ element_id: `SW_${String(i + 1).padStart(3, "0")}`, element_type: "sidewalk", geometry: null, ufid, source: "NGII A003 (walkways_wgs84.geojson)" }));
}

const indent = (text, n) => text.split("\n").map((l) => " ".repeat(n) + l).join("\n");

// Add-only textual edit that keeps the hand-formatted file as it is.
export function addToElementsFile(text, { newElements, idScheme, placeholders }) {
  const parsed = JSON.parse(text);
  const have = new Set(parsed.elements.map((e) => e.element_id));
  const add = newElements.filter((e) => !have.has(e.element_id));
  let out = text;
  if (!parsed.metadata.id_scheme) {
    const at = out.indexOf('\n  },\n  "zones"');
    if (at < 0) throw new Error("common_elemetns.json: metadata block not found");
    out = `${out.slice(0, at)},\n    "id_scheme": ${indent(JSON.stringify(idScheme, null, 2), 4).trimStart()}${out.slice(at)}`;
  }
  const tail = out.lastIndexOf("\n  ]");
  if (tail < 0) throw new Error("common_elemetns.json: elements array end not found");
  const placeholderBlock = parsed.sidewalk_placeholders ? "" : `,\n  "sidewalk_placeholders": ${indent(JSON.stringify(placeholders, null, 2), 2).trimStart()}`;
  if (add.length || placeholderBlock) {
    const elementsEnd = parsed.sidewalk_placeholders ? out.lastIndexOf('\n  ],\n  "sidewalk_placeholders"') : tail;
    const before = out.slice(0, elementsEnd);
    const after = out.slice(elementsEnd);
    const added = add.map((e) => `,\n${indent(JSON.stringify(e, null, 2), 4)}`).join("");
    out = before + added + (placeholderBlock ? `\n  ]${placeholderBlock}\n}\n` : after);
  }
  JSON.parse(out);
  return { text: out, added: add };
}

// ---------------------------------------------------------------- CLI
if (import.meta.main) {
  const dryRun = process.argv.includes("--dry-run");
  const read = async (p) => JSON.parse(await Bun.file(p).text());
  const [roadZones, crosswalks, walkways, network, osmGround, markings] = await Promise.all(
    [PATHS.roadZones, PATHS.crosswalks, PATHS.walkways, PATHS.network, PATHS.osmGround, PATHS.markings].map(read));
  const elementsText = await Bun.file(PATHS.elements).text();
  const { elements } = JSON.parse(elementsText);
  const yellowLines = markings.features.filter((f) => f.properties.kind === "centre_line_yellow" && f.geometry?.type === "LineString").map((f) => f.geometry.coordinates.map(toSim));
  const result = buildRoadSegments({ roadZones, osmLines: osmGround.osm.lines, elements, network, yellowLines });
  const cws = crosswalkElements(crosswalks, elements);
  const placeholders = sidewalkPlaceholders(walkways);
  const { text, added } = addToElementsFile(elementsText, { newElements: [...cws, ...result.allocated], idScheme: ID_SCHEME, placeholders });
  const { allocated, stats, ...fc } = result;
  const lanes2 = fc.features.filter((f) => f.properties.kind === "interior" && f.properties.lanes === 2).length;
  console.log(`road segments: ${fc.features.length} features (${fc.features.filter((f) => f.properties.kind === "interior").length} interior, ${stats.perimeter} perimeter); ` +
    `zones ${stats.zones}: ${stats.zoneMatched} matched by name, ${stats.zoneAllocated} allocated, ${stats.intersectionZones} intersection (ND_) zones and ${stats.lotZones} lot zones skipped; ` +
    `${stats.rdWithoutZone} RD_ without a zone polygon, ${stats.nullGeometry} with no geometry; interior lanes=2 (markings) ${lanes2}`);
  console.log(`allocated RD ids (${allocated.length}): ${allocated.map((e) => `${e.element_id} ${e.name}${e.external_ids?.osm_way ? ` [${e.external_ids.osm_way}]` : ""}`).join("; ")}`);
  console.log(`crosswalk elements added: ${cws.map((c) => `${c.element_id} (${c.zone_id})`).join(", ")}; SW_ placeholders: ${placeholders.length}; elements ${elements.length} -> ${elements.length + added.length}`);
  if (dryRun) {
    console.log("dry run: nothing written");
  } else {
    await Bun.write(PATHS.output, `${JSON.stringify(fc, null, 2)}\n`);
    await Bun.write(PATHS.elements, text);
    await Bun.write(PATHS.elementsCopy, text);
    console.log(`written ${path.relative(REPO, PATHS.output)}, ${path.relative(REPO, PATHS.elements)} and its backend copy ${path.relative(REPO, PATHS.elementsCopy)}`);
  }
}
