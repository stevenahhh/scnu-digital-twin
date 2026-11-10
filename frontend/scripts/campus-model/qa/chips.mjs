#!/usr/bin/env bun
// Curation chip sheets (plan campus-ground-truth-redesign todo 8): one tile per ground parcel, the NGII 2025 orthophoto
// crop around it with the parcel outline drawn over it (outer ring yellow, holes cyan), tiles in a grid, written outside
// the repository (the sheet is the photo: never commit it). The first tiles are the curation priorities: the parcels
// around BLD_E3 and the car park south of it, then the sports and lawn edges.
//
//   bun scripts/campus-model/qa/chips.mjs --parcels --out <png> [--ids A,B] [--limit 48] [--tile 256]
import { readFileSync } from "node:fs";

import { encodePng } from "../lib/png.mjs";
import { openSheet, sheetWindowForTm } from "../lib/ngiiSheet.mjs";
import { PARCELS_FILE } from "../fit/parcelsSeed.mjs";

const MARGIN_M = 6;
const OUTER = [255, 225, 40];
const HOLE = [40, 230, 255];

const bboxOf = (ring) => ring.reduce((b, [x, y]) => [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)], [Infinity, Infinity, -Infinity, -Infinity]);
const centre = (ring) => { const b = bboxOf(ring); return [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]; };

// Curation order: parcels within 90 m of the E3 centre first (nearest first), then SPORTS parcels and the lawn rims,
// then everything else in file order.
export function curationOrder(parcels, e3Centre) {
  const dist = (p) => { const [x, y] = centre(p.ring); return Math.hypot(x - e3Centre[0], y - e3Centre[1]); };
  const near = parcels.filter((p) => dist(p) <= 90).sort((a, b) => dist(a) - dist(b));
  const edge = parcels.filter((p) => !near.includes(p) && (p.cls === "SPORTS" || /facility .* rim|rim$/.test(p.source_ref)));
  const rest = parcels.filter((p) => !near.includes(p) && !edge.includes(p));
  return [...near, ...edge, ...rest];
}

// One tile: photo window around the parcel scaled to `tile` px, outline drawn in TM space.
function chip(sheet, parcel, tile) {
  const b = bboxOf(parcel.ring);
  const span = Math.max(b[2] - b[0], b[3] - b[1]) + 2 * MARGIN_M;
  const [cx, cy] = centre(parcel.ring);
  const E0 = cx - span / 2;
  const N0 = cy + span / 2;
  const out = new Uint8Array(tile * tile * 3);
  const win = sheetWindowForTm(sheet, E0, N0, span, span);
  if (win.rgb) {
    for (let y = 0; y < tile; y += 1) {
      for (let x = 0; x < tile; x += 1) {
        const c = Math.min(win.w - 1, Math.floor((x / tile) * win.w));
        const r = Math.min(win.h - 1, Math.floor((y / tile) * win.h));
        out.set(win.rgb.subarray((r * win.w + c) * 3, (r * win.w + c) * 3 + 3), (y * tile + x) * 3);
      }
    }
  }
  const toPx = ([E, N]) => [((E - E0) / span) * tile, ((N0 - N) / span) * tile];
  const plot = (x, y, colour) => {
    for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
      const px = Math.round(x) + dx;
      const py = Math.round(y) + dy;
      if (px >= 0 && py >= 0 && px < tile && py < tile) out.set(colour, (py * tile + px) * 3);
    }
  };
  const stroke = (ring, colour) => {
    for (let i = 0; i < ring.length; i += 1) {
      const [ax, ay] = toPx(ring[i]);
      const [bx, by] = toPx(ring[(i + 1) % ring.length]);
      const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay)));
      for (let s = 0; s <= steps; s += 1) plot(ax + ((bx - ax) * s) / steps, ay + ((by - ay) * s) / steps, colour);
    }
  };
  stroke(parcel.ring, OUTER);
  for (const hole of parcel.holes) stroke(hole, HOLE);
  return { pixels: out, covered: Boolean(win.rgb) };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
  if (!args.includes("--parcels")) {
    console.error("usage: chips.mjs --parcels --out <png> [--ids A,B] [--limit 48] [--tile 256]");
    process.exit(2);
  }
  const out = opt("--out", null);
  if (!out) throw new Error("--out <png> is required (write it under the evidence directory, never the repository)");
  const tile = Number(opt("--tile", 256));
  const limit = Number(opt("--limit", 48));
  const { parcels } = JSON.parse(readFileSync(PARCELS_FILE, "utf8"));
  const map = JSON.parse(readFileSync(new URL("../data/bld-node-map.json", import.meta.url), "utf8"));
  const e3 = map.entries.find((e) => e.nodeId === "BLD_E3").gisCentreTm;
  const ids = opt("--ids", null)?.split(",");
  const picked = (ids ? ids.map((id) => parcels.find((p) => p.id === id) ?? (() => { throw new Error(`no parcel ${id}`); })()) : curationOrder(parcels, e3)).slice(0, limit);
  const sheet = openSheet();
  const cols = Math.ceil(Math.sqrt(picked.length));
  const rows = Math.ceil(picked.length / cols);
  const W = cols * tile;
  const rgb = new Uint8Array(W * rows * tile * 3);
  const index = [];
  picked.forEach((parcel, k) => {
    const { pixels, covered } = chip(sheet, parcel, tile);
    const ox = (k % cols) * tile;
    const oy = Math.floor(k / cols) * tile;
    for (let y = 0; y < tile; y += 1) rgb.set(pixels.subarray(y * tile * 3, (y + 1) * tile * 3), ((oy + y) * W + ox) * 3);
    index.push({ tile: k, id: parcel.id, cls: parcel.cls, tier: parcel.evidence.tier, covered });
  });
  sheet.close();
  await Bun.write(out, encodePng(W, rows * tile, 3, rgb));
  await Bun.write(out.replace(/\.png$/, ".index.json"), `${JSON.stringify(index, null, 1)}\n`);
  console.log(`CHIPS ${JSON.stringify({ tiles: picked.length, grid: [cols, rows], uncovered: index.filter((i) => !i.covered).length, out })}`);
}
