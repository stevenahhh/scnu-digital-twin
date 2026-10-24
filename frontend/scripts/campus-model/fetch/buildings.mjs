// VWorld LT_C_BLDGINFO footprints (lon/lat) with floor counts and heights -> data/vworld-buildings.json
import path from "node:path";
import { EXTENT, geoToModel } from "../lib/frame.mjs";
import { BBOX, DATA, fetchJson, vworldKey } from "./common.mjs";

export async function fetchBuildings() {
  const key = await vworldKey();
  const features = [];
  for (let page = 1; ; page += 1) {
    const url = new URL("https://api.vworld.kr/req/data");
    url.search = new URLSearchParams({
      service: "data",
      request: "GetFeature",
      data: "LT_C_BLDGINFO",
      key,
      domain: "localhost",
      geomFilter: `BOX(${BBOX.west},${BBOX.south},${BBOX.east},${BBOX.north})`,
      size: "1000",
      page: String(page),
      format: "json",
      crs: "EPSG:4326",
      geometry: "true",
      attribute: "true",
    }).toString();
    const body = await fetchJson(url);
    if (body.response?.status !== "OK") throw new Error(`VWorld: ${JSON.stringify(body.response?.error)}`);
    const batch = body.response.result.featureCollection.features;
    features.push(...batch);
    if (page >= Number(body.response.page?.total ?? 1) || batch.length === 0) break;
  }

  const kept = [];
  for (const feature of features) {
    const polygons = feature.geometry.type === "MultiPolygon" ? feature.geometry.coordinates : [feature.geometry.coordinates];
    const [x, z] = geoToModel(...polygons[0][0][0]);
    if (x < EXTENT.minX - 30 || x > EXTENT.maxX + 30 || z < EXTENT.minZ - 30 || z > EXTENT.maxZ + 30) continue;
    const p = feature.properties;
    kept.push({
      name: [p.bld_nm, p.dong_nm].filter(Boolean).join(" ").trim(),
      floors: Number(p.grnd_flr) || 0,
      basementFloors: Number(p.ugrnd_flr) || 0,
      heightMetres: Number(p.height) || 0,
      polygons: polygons.map((polygon) =>
        polygon.map((ring) => ring.map(([lon, lat]) => [Number(lon.toFixed(7)), Number(lat.toFixed(7))])),
      ),
    });
  }
  kept.sort((a, b) => a.polygons[0][0][0][0] - b.polygons[0][0][0][0] || a.polygons[0][0][0][1] - b.polygons[0][0][0][1]);
  return kept;
}

export async function writeBuildings() {
  const buildings = await fetchBuildings();
  await Bun.write(path.join(DATA, "vworld-buildings.json"), `${JSON.stringify({
    source: "VWorld open data LT_C_BLDGINFO (building register footprints), EPSG:4326",
    bbox: BBOX,
    buildings,
  })}\n`);
  console.log(`vworld-buildings.json: ${buildings.length} footprints`);
}
