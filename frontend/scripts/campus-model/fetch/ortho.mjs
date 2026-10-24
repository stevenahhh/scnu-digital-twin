// VWorld Satellite z19 WMTS tiles over EXTENT -> data/ortho/vworld-satellite-z19.jpg (the tile mosaic, Web
// Mercator, no resampling) + vworld-satellite-z19.json (tile range and provenance). Tiles are cached in
// .cache/vworld-satellite-19-<x>-<y>.jpeg; only missing tiles are requested, with VITE_VWORLD_API_KEY from the
// environment or frontend/.env (never written anywhere). Storing and baking VWorld data follows the project
// owner's consent of 2026-10-24 (docs/data-licences.md, D1).
//
//   bun scripts/campus-model/fetch/ortho.mjs      (also run by model:fetch)
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { encodePng, decodePng } from "../lib/png.mjs";
import { ORTHO_DIR, ORTHO_IMAGE, ORTHO_META, ORTHO_TILE, ORTHO_ZOOM, orthoTileRange } from "../lib/ortho.mjs";
import { CACHE, TIMEOUT_MS, USER_AGENT, vworldKey } from "./common.mjs";

const JPEG_QUALITY = 92;
const tileFile = (x, y) => path.join(CACHE, `vworld-satellite-${ORTHO_ZOOM}-${x}-${y}.jpeg`);

async function loadTile(x, y, key) {
  const file = tileFile(x, y);
  if (!(await Bun.file(file).exists())) {
    const url = `https://api.vworld.kr/req/wmts/1.0.0/${await key()}/Satellite/${ORTHO_ZOOM}/${y}/${x}.jpeg`;
    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Referer: "http://localhost:5173/" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`VWorld Satellite tile ${ORTHO_ZOOM}/${y}/${x}: HTTP ${response.status}`);
    await Bun.write(file, await response.arrayBuffer());
  }
  const tile = decodePng(await Bun.file(file).image().png().toBuffer());
  if (tile.width !== ORTHO_TILE || tile.height !== ORTHO_TILE) throw new Error(`${path.basename(file)} is ${tile.width}x${tile.height}`);
  return { tile, modified: (await stat(file)).mtime };
}

export async function writeOrtho() {
  const range = orthoTileRange();
  const columns = range.x1 - range.x0 + 1;
  const rows = range.y1 - range.y0 + 1;
  let cachedKey = null;
  const key = async () => (cachedKey ??= await vworldKey());
  await mkdir(CACHE, { recursive: true });
  const width = columns * ORTHO_TILE;
  const height = rows * ORTHO_TILE;
  const mosaic = new Uint8Array(width * height * 3);
  const dates = [];
  for (let ty = range.y0; ty <= range.y1; ty += 1) {
    const loaded = await Promise.all(Array.from({ length: columns }, (_, i) => loadTile(range.x0 + i, ty, key)));
    loaded.forEach(({ tile, modified }, i) => {
      dates.push(modified);
      for (let y = 0; y < ORTHO_TILE; y += 1) {
        for (let x = 0; x < ORTHO_TILE; x += 1) {
          const source = (y * ORTHO_TILE + x) * tile.channels;
          const target = (((ty - range.y0) * ORTHO_TILE + y) * width + i * ORTHO_TILE + x) * 3;
          mosaic[target] = tile.pixels[source];
          mosaic[target + 1] = tile.pixels[source + 1];
          mosaic[target + 2] = tile.pixels[source + 2];
        }
      }
    });
  }
  await mkdir(ORTHO_DIR, { recursive: true });
  const jpeg = await new Bun.Image(encodePng(width, height, 3, mosaic)).jpeg({ quality: JPEG_QUALITY }).toBuffer();
  await Bun.write(ORTHO_IMAGE, jpeg);
  const day = (date) => date.toISOString().slice(0, 10);
  const sorted = dates.sort((a, b) => a - b);
  const meta = {
    source: "VWorld WMTS Satellite (https://api.vworld.kr/req/wmts/1.0.0/{key}/Satellite/{z}/{y}/{x}.jpeg)",
    attribution: "출처: 브이월드 (VWorld Satellite)",
    licence: "VWorld terms; stored and baked with the project owner's consent of 2026-10-24 (docs/data-licences.md, D1)",
    projection: "EPSG:3857, 256 px tiles; the mosaic's top-left pixel is the top-left corner of tile (x0, y0)",
    ...range,
    tilesFetched: `${day(sorted[0])}..${day(sorted.at(-1))}`,
    jpegQuality: JPEG_QUALITY,
  };
  await Bun.write(ORTHO_META, `${JSON.stringify(meta, null, 2)}\n`);
  console.log(`ortho: ${columns * rows} z${ORTHO_ZOOM} tiles -> ${path.basename(ORTHO_IMAGE)} ${width}x${height} (${jpeg.length} B, q${JPEG_QUALITY})`);
}

if (import.meta.main) await writeOrtho();
