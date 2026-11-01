// Canopy height for the campus window from Meta/WRI CHMv2 (global 1 m canopy height map, CC BY 4.0),
// read straight from its Cloud-Optimised GeoTIFF with HTTP range requests -> data/chm.png
// (8-bit metres, one pixel per source pixel, EPSG:3857 grid of the source tile).
// Only the tiles under the window are downloaded and they are cached under .cache/chmv2/.
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { inflateSync } from "node:zlib";
import { encodePng } from "../lib/png.mjs";
import { CACHE, DATA, TIMEOUT_MS, USER_AGENT } from "./common.mjs";

const CHM_URL =
  "https://dataforgood-fb-data.s3.amazonaws.com/forests/v2/global/dinov3_global_chm_v2_ml3/chm/1321121212.tif";
// Pixel window of the campus inside the quadkey tile above.
export const CHM_WINDOW = Object.freeze({ colOff: 19189, rowOff: 22471, width: 1538, height: 1422 });
const HEADER_BYTES = 65536;
const CHM_CACHE = path.join(CACHE, "chmv2");

async function fetchRange(start, length) {
  const response = await fetch(CHM_URL, {
    headers: { "User-Agent": USER_AGENT, Range: `bytes=${start}-${start + length - 1}` },
    signal: AbortSignal.timeout(TIMEOUT_MS * 2),
  });
  if (response.status !== 206) throw new Error(`CHMv2 range ${start}+${length}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function cached(name, load) {
  const file = Bun.file(path.join(CHM_CACHE, name));
  if (await file.exists()) return Buffer.from(await file.arrayBuffer());
  const bytes = await load();
  await Bun.write(file, bytes);
  return bytes;
}

// First IFD of a little-endian classic TIFF; every array it references must sit inside `bytes`.
function readIfd(bytes) {
  if (bytes.toString("ascii", 0, 2) !== "II" || bytes.readUInt16LE(2) !== 42) throw new Error("CHMv2: not a little-endian TIFF");
  const sizes = { 3: 2, 4: 4, 12: 8 };
  const ifd = bytes.readUInt32LE(4);
  const tags = new Map();
  for (let k = 0; k < bytes.readUInt16LE(ifd); k += 1) {
    const entry = ifd + 2 + k * 12;
    const tag = bytes.readUInt16LE(entry);
    const type = bytes.readUInt16LE(entry + 2);
    const count = bytes.readUInt32LE(entry + 4);
    const size = sizes[type];
    if (!size) continue;
    const offset = size * count <= 4 ? entry + 8 : bytes.readUInt32LE(entry + 8);
    if (offset + size * count > bytes.length) throw new Error(`CHMv2: tag ${tag} lies outside the header range`);
    const values = [];
    for (let i = 0; i < count; i += 1) {
      const p = offset + i * size;
      values.push(type === 3 ? bytes.readUInt16LE(p) : type === 4 ? bytes.readUInt32LE(p) : bytes.readDoubleLE(p));
    }
    tags.set(tag, values);
  }
  return tags;
}

export async function fetchCanopy() {
  await mkdir(CHM_CACHE, { recursive: true });
  const header = await cached("header.bin", () => fetchRange(0, HEADER_BYTES));
  const tags = readIfd(header);
  const [imageWidth] = tags.get(256);
  const [bits] = tags.get(258);
  const [compression] = tags.get(259);
  const [tileWidth] = tags.get(322);
  const [tileHeight] = tags.get(323);
  const offsets = tags.get(324);
  const counts = tags.get(325);
  const [pixelSize] = tags.get(33550);
  const tiepoint = tags.get(33922);
  const predictor = tags.get(317)?.[0] ?? 1;
  if (bits !== 8 || compression !== 8 || predictor !== 1) {
    throw new Error(`CHMv2: expected 8-bit deflate tiles without predictor (bits ${bits}, compression ${compression}, predictor ${predictor})`);
  }

  const { colOff, rowOff, width, height } = CHM_WINDOW;
  const tilesAcross = Math.ceil(imageWidth / tileWidth);
  const pixels = new Uint8Array(width * height);
  const jobs = [];
  for (let ty = Math.floor(rowOff / tileHeight); ty <= Math.floor((rowOff + height - 1) / tileHeight); ty += 1) {
    for (let tx = Math.floor(colOff / tileWidth); tx <= Math.floor((colOff + width - 1) / tileWidth); tx += 1) jobs.push([tx, ty]);
  }
  await Promise.all(
    jobs.map(async ([tx, ty]) => {
      const index = ty * tilesAcross + tx;
      const raw = await cached(`tile-${tx}-${ty}.deflate`, () => fetchRange(offsets[index], counts[index]));
      const tile = inflateSync(raw);
      for (let y = 0; y < tileHeight; y += 1) {
        const row = ty * tileHeight + y - rowOff;
        if (row < 0 || row >= height) continue;
        for (let x = 0; x < tileWidth; x += 1) {
          const col = tx * tileWidth + x - colOff;
          if (col >= 0 && col < width) pixels[row * width + col] = tile[y * tileWidth + x];
        }
      }
    }),
  );
  return {
    width,
    height,
    pixels,
    // EPSG:3857 metres of the window's top-left corner and the pixel size
    originX: tiepoint[3] + colOff * pixelSize,
    originY: tiepoint[4] - rowOff * pixelSize,
    pixelSize,
  };
}

export async function writeCanopy(canopy) {
  await Bun.write(path.join(DATA, "chm.png"), encodePng(canopy.width, canopy.height, 1, canopy.pixels));
  console.log(`chm.png: ${canopy.width}x${canopy.height} (CHMv2, ${canopy.pixelSize.toFixed(3)} m/px)`);
}
