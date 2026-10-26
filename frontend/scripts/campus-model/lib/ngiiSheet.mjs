// Reader for the NGII orthophoto sheet (uncompressed 8-bit chunky RGB TIFF + world file), shared by the markings paint
// gate (bake/markings-gate.mjs), the building-form fit (fetch/buildingForms.mjs) and the overhead-blend measurement
// (scripts/perf/overhead-blend.mjs). Only the strips a window touches are read; pixels never leave .cache/.
import { closeSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tmToPixel } from "../../../src/geo/epsg5186.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_SHEET = process.env.NGII_SHEET
  ?? path.join(HERE, "..", ".cache", "ngii-ortho", "(B060)정사영상_2025_34702020.tif");

const TYPE_SIZE = { 1: 1, 3: 2, 4: 4 };
const COMPRESSION_NAMES = { 1: "none", 5: "LZW", 6: "old JPEG", 7: "JPEG", 8: "Deflate", 32773: "PackBits", 32946: "Deflate" };

// World file: six lines a, d, b, e, c, f (pixel size x, rotation, rotation, pixel size y, centre of the top-left pixel).
export function parseTfw(text) {
  const values = text.trim().split(/\s+/).map(Number);
  if (values.length !== 6 || values.some((v) => !Number.isFinite(v))) throw new Error(`world file: expected 6 numbers, got ${values.length}`);
  const [a, rotY, rotX, d, c, f] = values;
  if (rotY !== 0 || rotX !== 0) throw new Error("world file: rotated sheets are not supported");
  return { a, d, c, f };
}

function readIfd(fd) {
  const head = Buffer.alloc(8);
  readSync(fd, head, 0, 8, 0);
  const order = head.toString("latin1", 0, 2);
  if (order !== "II" && order !== "MM") throw new Error("not a TIFF file (byte order mark)");
  const little = order === "II";
  const u16 = (b, o) => (little ? b.readUInt16LE(o) : b.readUInt16BE(o));
  const u32 = (b, o) => (little ? b.readUInt32LE(o) : b.readUInt32BE(o));
  if (u16(head, 2) !== 42) throw new Error("not a classic TIFF file (BigTIFF is not supported)");
  const ifdOffset = u32(head, 4);
  const countBuf = Buffer.alloc(2);
  readSync(fd, countBuf, 0, 2, ifdOffset);
  const count = u16(countBuf, 0);
  const entries = Buffer.alloc(12 * count);
  readSync(fd, entries, 0, entries.length, ifdOffset + 2);
  const tags = {};
  for (let i = 0; i < count; i += 1) {
    const at = i * 12;
    const tag = u16(entries, at);
    const type = u16(entries, at + 2);
    const n = u32(entries, at + 4);
    const size = TYPE_SIZE[type];
    if (!size) continue;
    let buf = entries.subarray(at + 8, at + 12);
    if (size * n > 4) {
      buf = Buffer.alloc(size * n);
      readSync(fd, buf, 0, buf.length, u32(entries, at + 8));
    }
    const values = [];
    for (let k = 0; k < n; k += 1) values.push(size === 1 ? buf[k] : size === 2 ? u16(buf, k * 2) : u32(buf, k * 4));
    tags[tag] = values;
  }
  return tags;
}

// Opens the sheet at `tifPath` (its world file is the same path with .tfw). Synchronous: the header is a few hundred
// bytes and windows are read on demand.
export function openSheet(tifPath = DEFAULT_SHEET) {
  const tfwPath = tifPath.replace(/\.tiff?$/i, "") + ".tfw";
  const fd = openSync(tifPath, "r");
  let tags;
  try {
    tags = readIfd(fd);
  } catch (error) {
    closeSync(fd);
    throw new Error(`${tifPath}: ${error.message}`);
  }
  const compression = tags[259]?.[0] ?? 1;
  if (compression !== 1) {
    closeSync(fd);
    throw new Error(`${tifPath}: compression tag 259 = ${compression} (${COMPRESSION_NAMES[compression] ?? "unknown"}); only uncompressed TIFF is supported`);
  }
  const width = tags[256]?.[0];
  const height = tags[257]?.[0];
  const samples = tags[277]?.[0] ?? 1;
  const bits = tags[258] ?? [1];
  const planar = tags[284]?.[0] ?? 1;
  if (samples !== 3 || bits.some((b) => b !== 8) || planar !== 1) {
    closeSync(fd);
    throw new Error(`${tifPath}: expected 8-bit chunky RGB (samples ${samples}, bits ${bits.join("/")}, planar ${planar})`);
  }
  const offsets = tags[273];
  const rowsPerStrip = Math.min(tags[278]?.[0] ?? height, height);
  if (!offsets || offsets.length !== Math.ceil(height / rowsPerStrip)) {
    closeSync(fd);
    throw new Error(`${tifPath}: strip table does not cover ${height} rows`);
  }
  const tfw = { ...parseTfw(readFileSync(tfwPath, "utf8")), width, height };
  const rowBytes = width * 3;
  const contiguous = offsets.every((o, i) => o === offsets[0] + i * rowsPerStrip * rowBytes);
  const fileSize = statSync(tifPath).size;
  if (offsets[0] + height * rowBytes > fileSize && contiguous) {
    closeSync(fd);
    throw new Error(`${tifPath}: file is shorter than its pixel data`);
  }

  // RGB bytes of a w x h window at (col0, row0); pixels outside the sheet stay 0.
  function readWindow(col0, row0, w, h) {
    const out = new Uint8Array(w * h * 3);
    const c0 = Math.max(0, col0);
    const c1 = Math.min(width, col0 + w);
    const r0 = Math.max(0, row0);
    const r1 = Math.min(height, row0 + h);
    if (c0 >= c1 || r0 >= r1) return out;
    const span = (c1 - c0) * 3;
    for (let strip = Math.floor(r0 / rowsPerStrip); strip * rowsPerStrip < r1; strip += 1) {
      const sr0 = Math.max(r0, strip * rowsPerStrip);
      const sr1 = Math.min(r1, (strip + 1) * rowsPerStrip);
      const start = offsets[strip] + (sr0 - strip * rowsPerStrip) * rowBytes;
      const buf = Buffer.alloc((sr1 - sr0) * rowBytes);
      readSync(fd, buf, 0, buf.length, start);
      for (let r = sr0; r < sr1; r += 1) {
        const src = (r - sr0) * rowBytes + c0 * 3;
        out.set(buf.subarray(src, src + span), ((r - row0) * w + (c0 - col0)) * 3);
      }
    }
    return out;
  }

  // One pixel into `out` (length >= 3); returns false outside the sheet.
  const pixel = Buffer.alloc(3);
  function sample(col, row, out) {
    const c = Math.round(col);
    const r = Math.round(row);
    if (c < 0 || r < 0 || c >= width || r >= height) return false;
    const strip = Math.floor(r / rowsPerStrip);
    readSync(fd, pixel, 0, 3, offsets[strip] + (r - strip * rowsPerStrip) * rowBytes + c * 3);
    out[0] = pixel[0];
    out[1] = pixel[1];
    out[2] = pixel[2];
    return true;
  }

  return {
    path: tifPath,
    width,
    height,
    tfw,
    rowsPerStrip,
    // Byte offset of the pixel data when it is stored as one contiguous block (null otherwise).
    dataOffset: contiguous ? offsets[0] : null,
    readWindow,
    sample,
    close: () => closeSync(fd),
  };
}

// Pixel window of the sheet covering an EPSG:5186 rectangle whose top-left corner is (E0, N0); the window starts at the
// pixel whose centre is nearest that corner.
export function sheetWindowForTm(sheet, E0, N0, widthM, heightM) {
  const [col, row] = tmToPixel(E0, N0, sheet.tfw);
  const col0 = Math.round(col);
  const row0 = Math.round(row);
  const w = Math.round(widthM / Math.abs(sheet.tfw.a));
  const h = Math.round(heightM / Math.abs(sheet.tfw.d));
  return { col0, row0, w, h, rgb: sheet.readWindow(col0, row0, w, h) };
}
