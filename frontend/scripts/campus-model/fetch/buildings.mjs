// Building footprints (lon/lat) with floor counts -> data/gis-buildings.json
//
// The intended source is 국토교통부 GIS건물통합정보 (data.go.kr 15083092, KOGL Type 1), but its file
// download (VWorld catalog ds_id=20171128DS00010, AL_D010_46_*.zip) requires a VWorld login and
// cannot be fetched by a script. Until that file is provisioned this module uses:
//   - footprints: OpenStreetMap buildings in BBOX (api.openstreetmap.org/api/0.6/map, ODbL);
//   - floors:     the SCNU campus registry (w1.scnu.ac.kr/SCNU/campus/list.do floor directory, accepted
//                 only when it lists floors 1..N), else OSM building:levels, else none (the stage then
//                 keeps uni.glb's outline height or the minimum height).
// No VWorld data is read or written. Every record says which source its footprint and floors used.
import path from "node:path";
import { EXTENT, METRES_PER_DEGREE_LAT, METRES_PER_DEGREE_LON, geoToModel } from "../lib/frame.mjs";
import { pointInRing } from "../lib/geometry.mjs";
import { BBOX, DATA, TIMEOUT_MS, USER_AGENT } from "./common.mjs";

const OSM_URL = `https://api.openstreetmap.org/api/0.6/map.json?bbox=${BBOX.west},${BBOX.south},${BBOX.east},${BBOX.north}`;
const REGISTRY_URL = "https://w1.scnu.ac.kr/SCNU/campus/list.do";
const CAMPUS_NAME = "순천대학교";

async function fetchOk(url, init = {}) {
  const response = await fetch(url, { ...init, headers: { "User-Agent": USER_AGENT, ...init.headers }, signal: AbortSignal.timeout(TIMEOUT_MS * 2) });
  if (!response.ok) throw new Error(`${new URL(url).host} HTTP ${response.status}`);
  return response.json();
}

// Registry floor directory lines look like "3층 : 총무과, ..."; basement lines (B1층, 지하1층) are skipped.
export function registryFloors(detail) {
  const floors = [...new Set([...(detail ?? "").matchAll(/(?<![B지하\d])(\d+)\s*층\s*[:：]/g)].map((m) => Number(m[1])))].sort((a, b) => a - b);
  return floors.length && floors.every((floor, i) => floor === i + 1) ? floors.length : 0;
}

async function fetchRegistry() {
  const body = await fetchOk(REGISTRY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: "https://w1.scnu.ac.kr/SCNU/campus/kakao/view.do" },
    body: "",
  });
  return body.list.map((entry) => ({
    code: `${entry.cpSe1}${entry.cpSe2}`,
    name: entry.cpNm.trim(),
    point: [Number(entry.cpLng), Number(entry.cpLat)],
    floors: registryFloors(entry.cpDetailDc),
  }));
}

// Joins open member ways of a multipolygon into closed rings.
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

const toMetres = ([lon, lat]) => [lon * METRES_PER_DEGREE_LON, lat * METRES_PER_DEGREE_LAT];
const areaMetres = (ring) => Math.abs(ring.map(toMetres).reduce((sum, p, i, all) => {
  const q = all[(i + 1) % all.length];
  return sum + p[0] * q[1] - q[0] * p[1];
}, 0) / 2);
const number = (value) => (Number.isFinite(Number.parseFloat(value)) ? Number.parseFloat(value) : 0);
const round7 = ([lon, lat]) => [Number(lon.toFixed(7)), Number(lat.toFixed(7))];

export async function fetchBuildings() {
  const [osm, registry] = await Promise.all([fetchOk(OSM_URL), fetchRegistry()]);
  const nodes = new Map();
  const ways = new Map();
  for (const element of osm.elements) {
    if (element.type === "node") nodes.set(element.id, [element.lon, element.lat]);
    if (element.type === "way") ways.set(element.id, element);
  }
  const coordinates = (ids) => ids.map((id) => nodes.get(id));
  const campusWay = [...ways.values()].find((way) => way.tags?.amenity === "university" && way.tags?.name?.includes(CAMPUS_NAME));
  if (!campusWay) throw new Error(`OSM: no amenity=university way named ${CAMPUS_NAME} in the bbox`);
  const campusRing = coordinates(campusWay.nodes);

  const candidates = [];
  for (const element of osm.elements) {
    if (!element.tags?.building || element.tags.building === "no") continue;
    let rings;
    if (element.type === "way" && element.nodes[0] === element.nodes.at(-1)) {
      rings = [{ role: "outer", nodes: element.nodes }];
    } else if (element.type === "relation" && element.tags.type === "multipolygon") {
      const memberWays = (role) => element.members.filter((m) => m.type === "way" && (m.role || "outer") === role && ways.has(m.ref)).map((m) => ways.get(m.ref).nodes);
      rings = [
        ...joinWays(memberWays("outer")).map((ring) => ({ role: "outer", nodes: ring })),
        ...joinWays(memberWays("inner")).map((ring) => ({ role: "inner", nodes: ring })),
      ];
    } else continue;
    const outers = rings.filter((r) => r.role === "outer").map((r) => coordinates(r.nodes));
    const inners = rings.filter((r) => r.role === "inner").map((r) => coordinates(r.nodes));
    if (!outers.length || outers.flat().some((p) => !p)) continue;
    // One polygon per outer ring; inner rings go to the outer that contains them.
    const polygons = outers.map((outer) => [outer, ...inners.filter((inner) => pointInRing(inner[0], outer))]);
    candidates.push({ element, polygons });
  }

  const kept = [];
  for (const { element, polygons } of candidates) {
    const [x, z] = geoToModel(...polygons[0][0][0]);
    if (x < EXTENT.minX - 30 || x > EXTENT.maxX + 30 || z < EXTENT.minZ - 30 || z > EXTENT.maxZ + 30) continue;
    const tags = element.tags;
    const outer = polygons[0][0];
    const onCampus = outer.every((p) => pointInRing(p, campusRing)) || pointInRing(outer[0], campusRing);
    const codeMatch = /^([A-F]\d{1,2})\s/.exec(tags.name ?? "");
    const entry = onCampus
      ? registry.find((r) => codeMatch && r.code === codeMatch[1]) ?? registry.find((r) => polygons.some((polygon) => pointInRing(r.point, polygon[0])))
      : undefined;
    const levels = Math.round(number(tags["building:levels"]));
    const floors = entry?.floors || levels;
    const floorsSource = entry?.floors ? `SCNU registry ${entry.code}` : levels ? "OSM building:levels" : "none";
    const baseName = entry ? `${entry.code} ${entry.name}` : (tags.name ?? "").trim();
    kept.push({
      name: onCampus ? `${CAMPUS_NAME} ${baseName}`.trim() : baseName,
      floors,
      undergroundFloors: Math.round(number(tags["building:levels:underground"])),
      heightMetres: number(tags.height),
      areaMetres: Math.round(polygons.reduce((sum, [o, ...holes]) => sum + areaMetres(o) - holes.reduce((s, h) => s + areaMetres(h), 0), 0)),
      usability: tags.building === "yes" ? (tags.amenity ?? tags.tourism ?? null) : tags.building,
      structure: tags["building:material"] ?? null,
      approvalDate: tags.start_date ?? null,
      pnu: null,
      footprintSource: `OSM ${element.type}/${element.id}`,
      floorsSource,
      polygons: polygons.map((polygon) => polygon.map((ring) => ring.map(round7))),
    });
  }
  // The same building mapped twice (each outline contains the other's centre): keep the larger one.
  const centre = (ring) => ring.slice(0, -1).reduce(([x, y], [lon, lat], _, all) => [x + lon / all.length, y + lat / all.length], [0, 0]);
  const duplicates = new Set();
  for (const a of kept) {
    for (const b of kept) {
      if (a === b || a.areaMetres < b.areaMetres || duplicates.has(a)) continue;
      if (pointInRing(centre(a.polygons[0][0]), b.polygons[0][0]) && pointInRing(centre(b.polygons[0][0]), a.polygons[0][0])) {
        duplicates.add(b);
        console.log(`building ${b.footprintSource} dropped: duplicate of ${a.footprintSource} (${b.name || "unnamed"})`);
      }
    }
  }
  const unique = kept.filter((b) => !duplicates.has(b));
  unique.sort((a, b) => a.polygons[0][0][0][0] - b.polygons[0][0][0][0] || a.polygons[0][0][0][1] - b.polygons[0][0][0][1]);
  return unique;
}

export async function writeBuildings() {
  const buildings = await fetchBuildings();
  await Bun.write(path.join(DATA, "gis-buildings.json"), `${JSON.stringify({
    source: "Footprints: © OpenStreetMap contributors (ODbL 1.0), api.openstreetmap.org/api/0.6/map. " +
      "Floors: SCNU campus registry floor directory (w1.scnu.ac.kr/SCNU/campus/list.do), else OSM building:levels. " +
      "GIS건물통합정보 (data.go.kr 15083092) not used: its download requires a VWorld login. EPSG:4326",
    bbox: BBOX,
    buildings,
  })}\n`);
  for (const b of buildings) console.log(`building ${b.footprintSource} floors=${b.floors} (${b.floorsSource}) ${b.name || "(unnamed)"}`);
  const count = (source) => buildings.filter((b) => b.floorsSource.startsWith(source)).length;
  console.log(`gis-buildings.json: ${buildings.length} OSM footprints; floors from SCNU registry ${count("SCNU")}, OSM building:levels ${count("OSM")}, none ${count("none")}`);
}
