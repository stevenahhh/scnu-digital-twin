#!/usr/bin/env bun
// Refreshes the committed source data under ./data. Needs network access and VITE_VWORLD_API_KEY
// (read from the environment or frontend/.env; it is never written anywhere).
//
//   bun scripts/campus-model/fetch-sources.mjs
//
// Writes:
//   data/vworld-buildings.json  VWorld LT_C_BLDGINFO footprints (lon/lat) with floor counts and heights
//   data/landcover.png          one byte per scene unit over EXTENT, classes in LANDCOVER (lib/landcover.mjs),
//                               classified from VWorld Satellite z18 WMTS tiles (summer foliage)
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EXTENT, geoToModel, modelToGeo } from "./lib/frame.mjs";
import { decodePng, encodePng } from "./lib/png.mjs";
import { classifyCell } from "./lib/landcover.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.resolve(HERE, "../..");
const DATA = path.join(HERE, "data");
const CACHE = path.join(HERE, ".cache");
const BBOX = { west: 127.4715, south: 34.964, east: 127.488, north: 34.9765 };
const ZOOM = 18;
const USER_AGENT = "scnu-digital-twin campus-model generator";

async function vworldKey() {
  if (process.env.VITE_VWORLD_API_KEY) return process.env.VITE_VWORLD_API_KEY;
  const envFile = Bun.file(path.join(FRONTEND, ".env"));
  if (await envFile.exists()) {
    const match = (await envFile.text()).match(/^VITE_VWORLD_API_KEY\s*=\s*"?([^"\s]+)/m);
    if (match) return match[1];
  }
  throw new Error("VITE_VWORLD_API_KEY is not set (environment or frontend/.env)");
}

async function fetchBuildings() {
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
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`VWorld HTTP ${response.status}`);
    const body = await response.json();
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

const lonToTile = (lon) => ((lon + 180) / 360) * 2 ** ZOOM;
const latToTile = (lat) => {
  const rad = (lat * Math.PI) / 180;
  return ((1 - Math.asinh(Math.tan(rad)) / Math.PI) / 2) * 2 ** ZOOM;
};

async function loadTile(key, x, y) {
  const file = path.join(CACHE, `vworld-satellite-${ZOOM}-${x}-${y}.jpeg`);
  if (!(await Bun.file(file).exists())) {
    const url = `https://api.vworld.kr/req/wmts/1.0.0/${key}/Satellite/${ZOOM}/${y}/${x}.jpeg`;
    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Referer: "http://localhost:5173/" },
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`Imagery tile ${x},${y}: HTTP ${response.status}`);
    await Bun.write(file, await response.arrayBuffer());
  }
  const png = await Bun.file(file).image().png().toBuffer();
  return decodePng(png);
}

async function buildLandcover() {
  const key = await vworldKey();
  const [west, north] = modelToGeo(EXTENT.minX, EXTENT.minZ);
  const [east, south] = modelToGeo(EXTENT.maxX, EXTENT.maxZ);
  const x0 = Math.floor(lonToTile(west));
  const x1 = Math.floor(lonToTile(east));
  const y0 = Math.floor(latToTile(north));
  const y1 = Math.floor(latToTile(south));
  const tiles = new Map();
  const jobs = [];
  for (let x = x0; x <= x1; x += 1) {
    for (let y = y0; y <= y1; y += 1) jobs.push([x, y]);
  }
  for (let i = 0; i < jobs.length; i += 12) {
    const batch = jobs.slice(i, i + 12);
    const loaded = await Promise.all(batch.map(([x, y]) => loadTile(key, x, y)));
    batch.forEach(([x, y], index) => tiles.set(`${x}:${y}`, loaded[index]));
  }

  const sample = (lon, lat) => {
    const tx = lonToTile(lon);
    const ty = latToTile(lat);
    const tile = tiles.get(`${Math.floor(tx)}:${Math.floor(ty)}`);
    if (!tile) return null;
    const px = Math.min(tile.width - 1, Math.floor((tx % 1) * tile.width));
    const py = Math.min(tile.height - 1, Math.floor((ty % 1) * tile.height));
    const i = (py * tile.width + px) * tile.channels;
    return [tile.pixels[i], tile.pixels[i + 1], tile.pixels[i + 2]];
  };

  const width = EXTENT.maxX - EXTENT.minX;
  const height = EXTENT.maxZ - EXTENT.minZ;
  const grid = new Uint8Array(width * height);
  const pixels = [];
  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      pixels.length = 0;
      for (let sy = 0; sy < 3; sy += 1) {
        for (let sx = 0; sx < 3; sx += 1) {
          const [lon, lat] = modelToGeo(EXTENT.minX + col + (sx + 0.5) / 3, EXTENT.minZ + row + (sy + 0.5) / 3);
          const rgb = sample(lon, lat);
          if (rgb) pixels.push(rgb);
        }
      }
      grid[row * width + col] = classifyCell(pixels);
    }
  }
  return { width, height, grid };
}

await mkdir(DATA, { recursive: true });
await mkdir(CACHE, { recursive: true });
const buildings = await fetchBuildings();
await Bun.write(path.join(DATA, "vworld-buildings.json"), `${JSON.stringify({
  source: "VWorld open data LT_C_BLDGINFO (building register footprints), EPSG:4326",
  bbox: BBOX,
  buildings,
})}\n`);
console.log(`vworld-buildings.json: ${buildings.length} footprints`);
const landcover = await buildLandcover();
await Bun.write(path.join(DATA, "landcover.png"), encodePng(landcover.width, landcover.height, 1, landcover.grid));
console.log(`landcover.png: ${landcover.width}x${landcover.height}`);
