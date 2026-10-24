// Outer-ring terrain from the Copernicus DEM GLO-30 (ESA / Copernicus, keyless on AWS Open Data),
// read straight from its Cloud-Optimised GeoTIFF with HTTP range requests -> data/cop30.png
// (16-bit greyscale, one pixel per 1-arcsecond source pixel) + data/cop30.json (window, encoding,
// attribution). Only the tiles under the window are downloaded; they are cached under .cache/cop30/.
// The values are the DEM's surface heights (a DSM: EGM2008 metres including trees and roofs); the
// outerTerrain stage smooths them and fits them to uni.glb's terrain.
//
//   bun scripts/campus-model/fetch/terrain.mjs
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { deflateSync, inflateSync } from "node:zlib";
import { CACHE, DATA, TIMEOUT_MS, USER_AGENT } from "./common.mjs";

const COP30_URL =
  "https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_N34_00_E127_00_DEM/Copernicus_DSM_COG_10_N34_00_E127_00_DEM.tif";
export const COP30_WINDOW = Object.freeze({ west: 127.455, east: 127.505, south: 34.95, north: 34.99 });
export const COP30_ATTRIBUTION =
  "produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved";
export const COP30_DOI = "10.5270/ESA-c5d3d65";
// cop30.png stores round((metres - ENCODING.offset) / ENCODING.scale) as u16.
const ENCODING = Object.freeze({ offset: -100, scale: 0.1 });
const HEADER_BYTES = 65536;
const COP30_CACHE = path.join(CACHE, "cop30");
const PNG_FILE = path.join(DATA, "cop30.png");
const JSON_FILE = path.join(DATA, "cop30.json");

async function fetchRange(start, length) {
  const response = await fetch(COP30_URL, {
    headers: { "User-Agent": USER_AGENT, Range: `bytes=${start}-${start + length - 1}` },
    signal: AbortSignal.timeout(TIMEOUT_MS * 2),
  });
  if (response.status !== 206) throw new Error(`COP30 range ${start}+${length}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function cached(name, load) {
  const file = Bun.file(path.join(COP30_CACHE, name));
  if (await file.exists()) return Buffer.from(await file.arrayBuffer());
  const bytes = await load();
  await Bun.write(file, bytes);
  return bytes;
}

// First IFD of a little-endian classic TIFF; every array it references must sit inside `bytes`.
function readIfd(bytes) {
  if (bytes.toString("ascii", 0, 2) !== "II" || bytes.readUInt16LE(2) !== 42) throw new Error("COP30: not a little-endian TIFF");
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
    if (offset + size * count > bytes.length) throw new Error(`COP30: tag ${tag} lies outside the header range`);
    const values = [];
    for (let i = 0; i < count; i += 1) {
      const p = offset + i * size;
      values.push(type === 3 ? bytes.readUInt16LE(p) : type === 4 ? bytes.readUInt32LE(p) : bytes.readDoubleLE(p));
    }
    tags.set(tag, values);
  }
  return tags;
}

// Deflate tile with the TIFF floating-point predictor (3): each row holds the float32 bytes split
// into planes, most significant first, and byte-differenced along the row.
function decodeFloatTile(raw, tileWidth, tileHeight) {
  const bytes = inflateSync(raw);
  const out = new Float32Array(tileWidth * tileHeight);
  const le = new Uint8Array(out.buffer);
  const stride = tileWidth * 4;
  for (let y = 0; y < tileHeight; y += 1) {
    const row = bytes.subarray(y * stride, (y + 1) * stride);
    for (let i = 1; i < stride; i += 1) row[i] = (row[i] + row[i - 1]) & 0xff;
    for (let x = 0; x < tileWidth; x += 1) {
      const p = (y * tileWidth + x) * 4;
      for (let b = 0; b < 4; b += 1) le[p + 3 - b] = row[b * tileWidth + x];
    }
  }
  return out;
}

export async function fetchTerrain() {
  await mkdir(COP30_CACHE, { recursive: true });
  const tags = readIfd(await cached("header.bin", () => fetchRange(0, HEADER_BYTES)));
  const [imageWidth] = tags.get(256);
  const [bits] = tags.get(258);
  const [compression] = tags.get(259);
  const [tileWidth] = tags.get(322);
  const [tileHeight] = tags.get(323);
  const offsets = tags.get(324);
  const counts = tags.get(325);
  const [sampleFormat] = tags.get(339);
  const [predictor] = tags.get(317);
  const [pixelX, pixelY] = tags.get(33550);
  const tiepoint = tags.get(33922);
  const geoKeys = tags.get(34735);
  if (bits !== 32 || sampleFormat !== 3 || compression !== 8 || predictor !== 3) {
    throw new Error(`COP30: expected float32 deflate tiles with predictor 3 (bits ${bits}, format ${sampleFormat}, compression ${compression}, predictor ${predictor})`);
  }
  // GTRasterTypeGeoKey (1025) = 2: the tiepoint is the centre of pixel (0, 0).
  let pixelIsPoint = false;
  for (let k = 4; k < geoKeys.length; k += 4) if (geoKeys[k] === 1025) pixelIsPoint = geoKeys[k + 3] === 2;
  const originLon = tiepoint[3] - (pixelIsPoint ? pixelX / 2 : 0);
  const originLat = tiepoint[4] + (pixelIsPoint ? pixelY / 2 : 0);

  // First column/row whose pixel centre lies on or inside the window edge (the window edges fall on
  // pixel centres, so a plain round would flip on floating-point noise).
  const colOff = Math.ceil((COP30_WINDOW.west - originLon) / pixelX - 0.5 - 1e-6);
  const rowOff = Math.ceil((originLat - COP30_WINDOW.north) / pixelY - 0.5 - 1e-6);
  const width = Math.round((COP30_WINDOW.east - COP30_WINDOW.west) / pixelX);
  const height = Math.round((COP30_WINDOW.north - COP30_WINDOW.south) / pixelY);
  const tilesAcross = Math.ceil(imageWidth / tileWidth);
  const metres = new Float32Array(width * height);
  const jobs = [];
  for (let ty = Math.floor(rowOff / tileHeight); ty <= Math.floor((rowOff + height - 1) / tileHeight); ty += 1) {
    for (let tx = Math.floor(colOff / tileWidth); tx <= Math.floor((colOff + width - 1) / tileWidth); tx += 1) jobs.push([tx, ty]);
  }
  await Promise.all(
    jobs.map(async ([tx, ty]) => {
      const index = ty * tilesAcross + tx;
      const tile = decodeFloatTile(await cached(`tile-${tx}-${ty}.deflate`, () => fetchRange(offsets[index], counts[index])), tileWidth, tileHeight);
      for (let y = 0; y < tileHeight; y += 1) {
        const row = ty * tileHeight + y - rowOff;
        if (row < 0 || row >= height) continue;
        for (let x = 0; x < tileWidth; x += 1) {
          const col = tx * tileWidth + x - colOff;
          if (col >= 0 && col < width) metres[row * width + col] = tile[y * tileWidth + x];
        }
      }
    }),
  );
  return {
    width,
    height,
    metres,
    // geographic bounds of the window's pixel edges (pixel-is-area)
    west: originLon + colOff * pixelX,
    north: originLat - rowOff * pixelY,
    pixelDegreesX: pixelX,
    pixelDegreesY: pixelY,
  };
}

// ---------------------------------------------------------------- 16-bit greyscale PNG
const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (bytes) => {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodePng16(width, height, values) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 16;
  header[9] = 0;
  const stride = width * 2;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) raw.writeUInt16BE(values[y * width + x], y * (stride + 1) + 1 + x * 2);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// Decodes the non-interlaced 16-bit greyscale PNG that encodePng16 writes (any filter type).
function decodePng16(buffer) {
  const bytes = Buffer.from(buffer);
  let offset = 8;
  let width = 0;
  let height = 0;
  const idat = [];
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 16 || data[9] !== 0 || data[12] !== 0) throw new Error("cop30.png must be 16-bit greyscale, non-interlaced");
    } else if (type === "IDAT") {
      idat.push(data);
    }
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 2;
  const rows = new Uint8Array(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = rows.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? rows.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x += 1) {
      const a = x >= 2 ? out[x - 2] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= 2 ? prev[x - 2] : 0;
      let value = line[x];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[x] = value & 0xff;
    }
  }
  const values = new Uint16Array(width * height);
  for (let i = 0; i < values.length; i += 1) values[i] = (rows[i * 2] << 8) | rows[i * 2 + 1];
  return { width, height, values };
}

// ---------------------------------------------------------------- data files
export async function writeTerrain(terrain) {
  const values = new Uint16Array(terrain.metres.length);
  terrain.metres.forEach((m, k) => {
    const value = Math.round((m - ENCODING.offset) / ENCODING.scale);
    if (!(value >= 0 && value <= 0xffff)) throw new Error(`COP30 height ${m} m at pixel ${k} does not fit cop30.png`);
    values[k] = value;
  });
  await Bun.write(PNG_FILE, encodePng16(terrain.width, terrain.height, values));
  const meta = {
    source: COP30_URL,
    product: "Copernicus DEM GLO-30 (DSM, EGM2008 heights)",
    attribution: COP30_ATTRIBUTION,
    doi: COP30_DOI,
    width: terrain.width,
    height: terrain.height,
    west: terrain.west,
    north: terrain.north,
    pixelDegreesX: terrain.pixelDegreesX,
    pixelDegreesY: terrain.pixelDegreesY,
    encoding: { ...ENCODING, note: "metres = offset + value * scale" },
  };
  await Bun.write(JSON_FILE, `${JSON.stringify(meta, null, 2)}\n`);
  let min = Infinity;
  let max = -Infinity;
  for (const m of terrain.metres) {
    min = Math.min(min, m);
    max = Math.max(max, m);
  }
  console.log(`cop30.png: ${terrain.width}x${terrain.height} (COP30, ${min.toFixed(1)}-${max.toFixed(1)} m)`);
}

// data/cop30.png + cop30.json -> { width, height, metres: Float32Array (row-major, north row first), meta }
export async function readTerrain() {
  const meta = JSON.parse(await Bun.file(JSON_FILE).text());
  const png = decodePng16(await Bun.file(PNG_FILE).arrayBuffer());
  if (png.width !== meta.width || png.height !== meta.height) throw new Error("cop30.png does not match cop30.json");
  const metres = Float32Array.from(png.values, (v) => meta.encoding.offset + v * meta.encoding.scale);
  return { width: png.width, height: png.height, metres, meta };
}

if (import.meta.main) {
  await mkdir(DATA, { recursive: true });
  await writeTerrain(await fetchTerrain());
}
