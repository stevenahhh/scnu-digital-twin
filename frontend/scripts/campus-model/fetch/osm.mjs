#!/usr/bin/env bun
// Ground features for the campus bbox -> data/osm-ground.json. stages/ground.mjs paints them into
// the ground texture.
//
//   bun scripts/campus-model/fetch/osm.mjs
//
// The file has three sections, each with its own licence:
//   osm          OpenStreetMap closed ways / multipolygons (ODbL 1.0, © OpenStreetMap contributors),
//                buildings excluded. kind:
//                  stadium  leisure=stadium
//                  track    leisure=track
//                  pitch    leisure=pitch / sports_centre / playground, or any area with sport=*
//                  parking  amenity=parking (surface lots only)
//                  plaza    area:highway=pedestrian|footway, highway=pedestrian + area=yes, place=square
//                  water    natural=water, landuse=basin
//   facilities   MCEE level-3 land cover (lv3_2025y, KOGL Type 1) polygons of class 141
//                (문화·체육·휴양시설). They outline the running track, the courts and the plaza's
//                oval lawn far more closely than OSM, which maps only the stadium and two loose
//                pitch polygons there. Same WFS and cache as fetch/landcover.mjs.
//   supplements  project-authored entries (not OSM, not MCEE), see SUPPLEMENTS.
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pointInRing } from "../lib/geometry.mjs";
import { BBOX, CACHE, DATA, TIMEOUT_MS, USER_AGENT } from "./common.mjs";

const API = "https://api.openstreetmap.org/api/0.6/map.json";
const MAX_SPLIT_DEPTH = 3;
const KEEP_TAGS = ["name", "leisure", "sport", "surface", "amenity", "parking", "area:highway", "highway", "place", "natural", "water", "landuse"];

const MCEE_WFS = "https://api.mcee.go.kr/geoserver/wfs";
const MCEE_LAYER = "lv3_2025y";
const MCEE_FACILITY_CODE = "141";
const MCEE_PAGE_SIZE = 1000;
const MCEE_MAX_PAGES = 20;
const MCEE_CACHE = path.join(CACHE, "mcee");

// Project-authored entries (checked 2026-10-24):
//   surface     labels a court or lawn inside an MCEE facility polygon. Each facility pixel takes the
//               surface of the nearest label inside the same polygon (one MCEE polygon holds the
//               basketball, futsal and multi courts). Neither source says which court is which: class
//               141 is generic, and OSM's 농구장 polygon (way 366373756) lies over the futsal/multi
//               courts, not over the blue basketball courts. headingDegrees is the court's long axis
//               in the scene frame (degrees from +x toward +z); court markings are drawn around `at`.
//   roundabout  the red-paved roundabout of the central intersection. OSM maps only its two oneway
//               carriageways (ways 1364521191/1364521192), MCEE folds it into class 154 (road).
//   fountain    the fountain at the west end of the plaza's oval lawn; mapped by neither source.
// Positions and radii are estimates, not survey values; replace them once OSM maps the features.
const SUPPLEMENTS = [
  { kind: "surface", note: "blue basketball court (full court)", at: [127.4831566,34.9679874], surface: "basketball", headingDegrees: 12 },
  { kind: "surface", note: "blue basketball court (half court)", at: [127.4831955,34.9678223], surface: "basketball", lines: false },
  { kind: "surface", note: "futsal pitch west of the multi court", at: [127.4829982,34.9675956], surface: "futsal", headingDegrees: 102 },
  { kind: "surface", note: "multi court (green apron, red court)", at: [127.483195,34.9675667], surface: "multi", headingDegrees: 102 },
  { kind: "surface", note: "tennis courts (테니스장)", at: [127.4831938,34.9671985], surface: "tennis", headingDegrees: 102 },
  { kind: "surface", note: "oval lawn in the central plaza", at: [127.4800853,34.9695595], surface: "lawn" },
  { kind: "roundabout", note: "central intersection roundabout (estimate)", centre: [127.4806378, 34.9692591], radiusMetres: 11 },
  { kind: "fountain", note: "central plaza fountain (estimate)", centre: [127.4799993, 34.9695797], radiusMetres: 3.6 },
];

const round7 = ([lon, lat]) => [Number(lon.toFixed(7)), Number(lat.toFixed(7))];
const BOX_RING = [[BBOX.west, BBOX.south], [BBOX.east, BBOX.south], [BBOX.east, BBOX.north], [BBOX.west, BBOX.north]];

// ---------------------------------------------------------------- OpenStreetMap
async function fetchBox(box, depth = 0) {
  const url = `${API}?bbox=${box.west},${box.south},${box.east},${box.north}`;
  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS * 2) });
  // 400: too many nodes / area too large -> split into quadrants
  if (response.status === 400 && depth < MAX_SPLIT_DEPTH) {
    const midLon = (box.west + box.east) / 2;
    const midLat = (box.south + box.north) / 2;
    const quads = [
      { west: box.west, south: box.south, east: midLon, north: midLat },
      { west: midLon, south: box.south, east: box.east, north: midLat },
      { west: box.west, south: midLat, east: midLon, north: box.north },
      { west: midLon, south: midLat, east: box.east, north: box.north },
    ];
    return (await Promise.all(quads.map((quad) => fetchBox(quad, depth + 1)))).flat();
  }
  if (!response.ok) throw new Error(`OSM map ${url}: HTTP ${response.status}`);
  return (await response.json()).elements;
}

// Joins open member ways of a multipolygon into closed rings (node id lists).
function joinWays(wayNodeLists) {
  const pending = wayNodeLists.map((list) => [...list]);
  const rings = [];
  while (pending.length) {
    const ring = pending.shift();
    for (let guard = 0; ring[0] !== ring.at(-1) && guard < 1000; guard += 1) {
      const i = pending.findIndex((list) => list[0] === ring.at(-1) || list.at(-1) === ring.at(-1));
      if (i < 0) break;
      const [next] = pending.splice(i, 1);
      ring.push(...(next[0] === ring.at(-1) ? next : next.reverse()).slice(1));
    }
    if (ring.length >= 4 && ring[0] === ring.at(-1)) rings.push(ring);
  }
  return rings;
}

export function groundKind(tags) {
  if (!tags || (tags.building && tags.building !== "no")) return null;
  if (tags.leisure === "stadium") return "stadium";
  if (tags.leisure === "track") return "track";
  if (["pitch", "sports_centre", "playground"].includes(tags.leisure) || tags.sport) return "pitch";
  if (tags.amenity === "parking") return ["underground", "multi-storey", "rooftop"].includes(tags.parking) ? null : "parking";
  if (["pedestrian", "footway"].includes(tags["area:highway"])) return "plaza";
  if (tags.highway === "pedestrian" && tags.area === "yes") return "plaza";
  if (tags.place === "square") return "plaza";
  if (tags.natural === "water" || tags.landuse === "basin") return "water";
  return null;
}

async function fetchOsmFeatures() {
  const elements = await fetchBox(BBOX);
  const nodeOf = new Map();
  const ways = new Map();
  const relations = new Map();
  for (const element of elements) {
    if (element.type === "node") nodeOf.set(element.id, [element.lon, element.lat]);
    if (element.type === "way") ways.set(element.id, element);
    if (element.type === "relation") relations.set(element.id, element);
  }
  const features = [];
  for (const element of [...ways.values(), ...relations.values()]) {
    const kind = groundKind(element.tags);
    if (!kind) continue;
    let rings;
    if (element.type === "way") {
      if (element.nodes[0] !== element.nodes.at(-1)) continue;
      rings = [element.nodes];
    } else if (element.tags.type === "multipolygon") {
      const member = (role) => element.members.filter((m) => m.type === "way" && (m.role || "outer") === role && ways.has(m.ref)).map((m) => ways.get(m.ref).nodes);
      rings = [...joinWays(member("outer")), ...joinWays(member("inner"))];
    } else continue;
    const coords = rings.map((ring) => ring.map((id) => nodeOf.get(id)));
    if (!coords.length || coords.flat().some((p) => !p)) continue;
    if (!coords[0].some((p) => pointInRing(p, BOX_RING))) continue;
    const tags = Object.fromEntries(KEEP_TAGS.filter((k) => element.tags[k] !== undefined).map((k) => [k, element.tags[k]]));
    features.push({ id: `${element.type}/${element.id}`, kind, tags, rings: coords.map((ring) => ring.map(round7)) });
  }
  return features.sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));
}

// ---------------------------------------------------------------- MCEE facilities
const EARTH_RADIUS = 6378137;
const mercatorToGeo = ([x, y]) => [
  (x / EARTH_RADIUS) * (180 / Math.PI),
  (2 * Math.atan(Math.exp(y / EARTH_RADIUS)) - Math.PI / 2) * (180 / Math.PI),
];

// Same request and cache file names as fetch/landcover.mjs, so a fetched cache is reused.
async function fetchMceePage(startIndex) {
  const file = Bun.file(path.join(MCEE_CACHE, `${MCEE_LAYER}-${startIndex}.json`));
  if (await file.exists()) return file.json();
  const params = new URLSearchParams({
    service: "WFS",
    version: "2.0.0",
    request: "GetFeature",
    typeNames: MCEE_LAYER,
    bbox: `${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east},urn:ogc:def:crs:EPSG::4326`,
    outputFormat: "application/json",
    count: String(MCEE_PAGE_SIZE),
    startIndex: String(startIndex),
  });
  const response = await fetch(`${MCEE_WFS}?${params}`, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS * 4) });
  if (!response.ok) throw new Error(`MCEE WFS ${MCEE_LAYER} startIndex ${startIndex}: HTTP ${response.status}`);
  const text = await response.text();
  const page = JSON.parse(text);
  if (!Array.isArray(page.features)) throw new Error(`MCEE WFS ${MCEE_LAYER} startIndex ${startIndex}: no features array`);
  await Bun.write(file, text);
  return page;
}

async function fetchMceeFacilities() {
  await mkdir(MCEE_CACHE, { recursive: true });
  const facilities = [];
  for (let page = 0; ; page += 1) {
    if (page === MCEE_MAX_PAGES) throw new Error(`MCEE WFS ${MCEE_LAYER}: more than ${MCEE_MAX_PAGES * MCEE_PAGE_SIZE} features in the bbox`);
    const { features } = await fetchMceePage(page * MCEE_PAGE_SIZE);
    for (const { geometry, properties } of features) {
      if (String(properties.l3_code) !== MCEE_FACILITY_CODE || !geometry) continue;
      const polygons = geometry.type === "MultiPolygon" ? geometry.coordinates : geometry.type === "Polygon" ? [geometry.coordinates] : [];
      for (const rings of polygons) {
        const geo = rings.map((ring) => ring.map((p) => round7(mercatorToGeo(p))));
        if (geo[0].some((p) => pointInRing(p, BOX_RING))) facilities.push({ l3Code: MCEE_FACILITY_CODE, rings: geo });
      }
    }
    if (features.length < MCEE_PAGE_SIZE) return facilities;
  }
}

// ---------------------------------------------------------------- output
export async function fetchGroundFeatures() {
  const [osm, facilities] = await Promise.all([fetchOsmFeatures(), fetchMceeFacilities()]);
  return {
    fetched: new Date().toISOString().slice(0, 10),
    bbox: BBOX,
    osm: {
      source: "OpenStreetMap API 0.6 map call for the bbox",
      licence: "ODbL 1.0",
      attribution: "© OpenStreetMap contributors",
      features: osm,
    },
    facilities: {
      source: `MCEE level-3 land cover WFS (${MCEE_WFS}), layer ${MCEE_LAYER}, l3_code ${MCEE_FACILITY_CODE}`,
      licence: "KOGL Type 1",
      attribution: "본 저작물은 기후에너지환경부에서 작성하여 공공누리 제1유형으로 개방한 '세분류 토지피복지도(2025)'를 이용하였습니다.",
      features: facilities,
    },
    supplements: {
      source: "project-authored labels and estimated shapes (not OSM, not MCEE)",
      features: SUPPLEMENTS,
    },
  };
}

export async function writeGroundFeatures() {
  const ground = await fetchGroundFeatures();
  await Bun.write(path.join(DATA, "osm-ground.json"), `${JSON.stringify(ground)}\n`);
  const counts = ground.osm.features.reduce((acc, f) => ({ ...acc, [f.kind]: (acc[f.kind] ?? 0) + 1 }), {});
  console.log(
    `osm-ground.json: ${ground.osm.features.length} OSM features ${JSON.stringify(counts)}, ` +
    `${ground.facilities.features.length} MCEE facility polygons, ${ground.supplements.features.length} project supplements`,
  );
}

if (import.meta.main) await writeGroundFeatures();
