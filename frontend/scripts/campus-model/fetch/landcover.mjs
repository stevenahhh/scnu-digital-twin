// Landcover classes (lib/landcover.mjs) per scene unit over EXTENT, classified from VWorld Satellite
// z18 WMTS tiles (summer foliage), cached under .cache -> data/landcover.png
import path from "node:path";
import { EXTENT, modelToGeo } from "../lib/frame.mjs";
import { decodePng, encodePng } from "../lib/png.mjs";
import { classifyCell } from "../lib/landcover.mjs";
import { CACHE, DATA, TIMEOUT_MS, USER_AGENT, vworldKey } from "./common.mjs";

const ZOOM = 18;

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
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Imagery tile ${x},${y}: HTTP ${response.status}`);
    await Bun.write(file, await response.arrayBuffer());
  }
  const png = await Bun.file(file).image().png().toBuffer();
  return decodePng(png);
}

export async function buildLandcover() {
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

export async function writeLandcover() {
  const landcover = await buildLandcover();
  await Bun.write(path.join(DATA, "landcover.png"), encodePng(landcover.width, landcover.height, 1, landcover.grid));
  console.log(`landcover.png: ${landcover.width}x${landcover.height}`);
}
