import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { openSheet, parseTfw, sheetWindowForTm } from "./ngiiSheet.mjs";

const W = 64;
const H = 48;
const ROWS_PER_STRIP = 10; // 5 strips, the last one 8 rows
const pixel = (c, r) => [(c * 4) & 255, (r * 5) & 255, (c + r * 3) & 255];
const TFW = "0.25\n0\n0\n-0.25\n243324.125\n264485.875\n";

// Little-endian classic TIFF: header, pixel strips, then the IFD and its out-of-line arrays.
function writeTiff(file, { compression = 1 } = {}) {
  const strips = Math.ceil(H / ROWS_PER_STRIP);
  const data = Buffer.alloc(W * H * 3);
  for (let r = 0; r < H; r += 1) for (let c = 0; c < W; c += 1) data.set(pixel(c, r), (r * W + c) * 3);
  const dataOffset = 8;
  const entries = [
    [256, 3, 1, W],
    [257, 3, 1, H],
    [258, 3, 3, "bits"],
    [259, 3, 1, compression],
    [262, 3, 1, 2],
    [273, 4, strips, "offsets"],
    [277, 3, 1, 3],
    [278, 3, 1, ROWS_PER_STRIP],
    [279, 4, strips, "counts"],
    [284, 3, 1, 1],
  ];
  const ifdOffset = dataOffset + data.length;
  const ifdSize = 2 + entries.length * 12 + 4;
  let extra = ifdOffset + ifdSize;
  const arrays = [];
  const ifd = Buffer.alloc(ifdSize);
  ifd.writeUInt16LE(entries.length, 0);
  entries.forEach(([tag, type, count, value], i) => {
    const at = 2 + i * 12;
    ifd.writeUInt16LE(tag, at);
    ifd.writeUInt16LE(type, at + 2);
    ifd.writeUInt32LE(count, at + 4);
    if (typeof value === "number") {
      if (type === 3) ifd.writeUInt16LE(value, at + 8);
      else ifd.writeUInt32LE(value, at + 8);
      return;
    }
    let buf;
    if (value === "bits") {
      buf = Buffer.alloc(6);
      [8, 8, 8].forEach((b, k) => buf.writeUInt16LE(b, k * 2));
    } else {
      buf = Buffer.alloc(4 * strips);
      for (let s = 0; s < strips; s += 1) {
        const rows = Math.min(ROWS_PER_STRIP, H - s * ROWS_PER_STRIP);
        buf.writeUInt32LE(value === "offsets" ? dataOffset + s * ROWS_PER_STRIP * W * 3 : rows * W * 3, s * 4);
      }
    }
    ifd.writeUInt32LE(extra, at + 8);
    arrays.push(buf);
    extra += buf.length;
  });
  const head = Buffer.from([0x49, 0x49, 42, 0, 0, 0, 0, 0]);
  head.writeUInt32LE(ifdOffset, 4);
  writeFileSync(file, Buffer.concat([head, data, ifd, ...arrays]));
  writeFileSync(file.replace(/\.tif$/, ".tfw"), TFW);
}

function withSheet(fn, options) {
  const dir = mkdtempSync(path.join(tmpdir(), "ngii-sheet-test-"));
  try {
    const file = path.join(dir, "sheet.tif");
    writeTiff(file, options);
    return fn(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function assertWindow(sheet, col0, row0, w, h) {
  const rgb = sheet.readWindow(col0, row0, w, h);
  assert.equal(rgb.length, w * h * 3);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const c = col0 + x;
      const r = row0 + y;
      const expected = c >= 0 && r >= 0 && c < W && r < H ? pixel(c, r) : [0, 0, 0];
      const at = (y * w + x) * 3;
      assert.deepEqual([rgb[at], rgb[at + 1], rgb[at + 2]], expected, `pixel ${c},${r} of window ${col0},${row0}`);
    }
  }
}

test("synthetic 64x48 RGB TIFF reads back exactly through readWindow", () => {
  withSheet((file) => {
    const sheet = openSheet(file);
    try {
      assert.equal(sheet.width, W);
      assert.equal(sheet.height, H);
      assert.equal(sheet.rowsPerStrip, ROWS_PER_STRIP);
      assertWindow(sheet, 0, 0, W, H); // whole sheet
      assertWindow(sheet, 5, 7, 20, 9); // crosses the strip boundary at row 10
      assertWindow(sheet, 50, 40, 20, 12); // clipped at the right and bottom edge
      assertWindow(sheet, -3, -2, 8, 6); // clipped at the top-left corner
      const out = new Uint8Array(3);
      assert.equal(sheet.sample(33, 21, out), true);
      assert.deepEqual([...out], pixel(33, 21));
      assert.equal(sheet.sample(64, 0, out), false);
    } finally {
      sheet.close();
    }
  });
});

test("world file parses to the six numbers", () => {
  assert.deepEqual(parseTfw(TFW), { a: 0.25, d: -0.25, c: 243324.125, f: 264485.875 });
  withSheet((file) => {
    const sheet = openSheet(file);
    sheet.close();
    assert.deepEqual(sheet.tfw, { a: 0.25, d: -0.25, c: 243324.125, f: 264485.875, width: W, height: H });
  });
  assert.throws(() => parseTfw("0.25\n0\n0\n"), /expected 6 numbers/);
});

test("sheetWindowForTm starts at the pixel centred on the corner", () => {
  withSheet((file) => {
    const sheet = openSheet(file);
    try {
      const win = sheetWindowForTm(sheet, 243324.125 + 2 * 0.25, 264485.875 - 3 * 0.25, 4 * 0.25, 2 * 0.25);
      assert.deepEqual([win.col0, win.row0, win.w, win.h], [2, 3, 4, 2]);
      assert.deepEqual([win.rgb[0], win.rgb[1], win.rgb[2]], pixel(2, 3));
    } finally {
      sheet.close();
    }
  });
});

test("compressed TIFF (tag 259 = 5, LZW) is rejected naming the compression", () => {
  withSheet((file) => {
    assert.throws(() => openSheet(file), /compression tag 259 = 5 \(LZW\)/);
  }, { compression: 5 });
});

test("missing sheet throws ENOENT with the path", () => {
  const missing = path.resolve("/nonexistent.tif");
  assert.throws(() => openSheet(missing), (error) => error.code === "ENOENT" && error.message.includes(missing));
});
