#!/usr/bin/env bun
// Does every parking row reach a road on the ground map (plan campus-ground-truth-redesign todo 13a)? A car needs a run of road
// and lot parcels at least CLEARANCE_M wide, off buildings, from the row to a road parcel that exists without the photo: a
// measured road zone or a mapped road. Paint-support and curated road parcels carry the connection but do not end it, so a
// row on a stray patch of asphalt does not count as reached. Reads the current parking.json and parcels.json.
//
//   bun scripts/campus-model/qa/parkingConnectivity.mjs [--without <PARCEL_ID,...>] [--out <dir>]
//   Exits 1 naming each stranded row with no reason in data/ground/parcel-curation.json `unreachable`.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { rowFrame } from "../stages/parking.mjs";
import { dilateCells, erodeCells, rasterTop } from "./asphaltScan.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const CLEARANCE_M = 2;
export const ROAD_SOURCES = new Set(["road-zone-measured", "OSM-derived"]);
const OVERHEAD_BASE_M = 2.5;
const CELL_M = 0.5;
const TOUCH_M = 0.5; // a row this close to a passable cell's edge opens onto it
const MARGIN_M = 150;

const rowLines = (row) => {
  if (!row.backLine?.abs) return null;
  const f = rowFrame(row);
  return [[f.at(0, 0), f.at(f.length, 0), f.at(f.length, row.depthM), f.at(0, row.depthM)]];
};

// building-forms.json -> the rings no car crosses. A mass on legs over the lane (footbridge, canopy) stops no car.
export const standingMasses = (forms, toTm) => forms.buildings.flatMap((b) => b.masses.filter((m) => m.baseMetres < OVERHEAD_BASE_M).map((m) => [m.outer, ...(m.holes ?? [])].map((r) => r.map(([lon, lat]) => toTm(lon, lat)))));

// parking: parking.json; parcels: parcels.json `parcels`. blocked: [rings] that no car crosses (building footprints).
// Returns { rows: [{ id, connected, via: "asphalt" | "concrete" | null }], stranded: [{ id, reason }], overConcrete: [ids], unexplained: [ids], staleReasons: [ids] }.
// A parcel with surface "concrete" carries cars but is no asphalt: a row reached only across one says so in overConcrete.
export function connectivity(parking, parcels, { blocked = [], reasons = [], without = [] } = {}) {
  const known = new Set(parcels.map((p) => p.id));
  for (const id of without) if (!known.has(id)) throw new Error(`connectivity: --without names no parcel: ${id}`);
  const list = parcels.filter((p) => !without.includes(p.id));
  const rows = parking.lots.flatMap((lot) => lot.rows);
  const shapes = new Map(rows.map((row) => [row.id, rowLines(row)]));
  const points = [...shapes.values()].filter(Boolean).flat(2);
  const results = [];
  if (points.length) {
    const E0 = Math.min(...points.map((p) => p[0])) - MARGIN_M;
    const N1 = Math.max(...points.map((p) => p[1])) + MARGIN_M;
    const w = Math.ceil((Math.max(...points.map((p) => p[0])) + MARGIN_M - E0) / CELL_M);
    const h = Math.ceil((N1 - (Math.min(...points.map((p) => p[1])) - MARGIN_M)) / CELL_M);
    const grid = { w, h, origin: [E0, N1], cellM: CELL_M };
    const top = rasterTop(list, grid);
    const passable = new Uint8Array(w * h);
    for (let k = 0; k < w * h; k += 1) passable[k] = top[k] >= 0 && (list[top[k]].class === "road" || list[top[k]].class === "lot") ? 1 : 0;
    const concrete = (k) => list[top[k]]?.surface === "concrete";
    if (blocked.length) {
      const wall = rasterTop(blocked.map((rings) => ({ ring: rings[0], holes: rings.slice(1), precedence: 0 })), grid);
      for (let k = 0; k < w * h; k += 1) if (wall[k] >= 0) passable[k] = 0;
    }
    const radius = Math.ceil(CLEARANCE_M / 2 / CELL_M);
    const flood = (mask) => {
      const clear = erodeCells(mask, w, h, radius);
      const reached = new Uint8Array(w * h);
      const stack = [];
      for (let k = 0; k < w * h; k += 1) {
        if (clear[k] && list[top[k]]?.class === "road" && ROAD_SOURCES.has(list[top[k]].source)) { reached[k] = 1; stack.push(k); }
      }
      while (stack.length) {
        const k = stack.pop();
        const x = k % w;
        for (const m of [x + 1 < w ? k + 1 : -1, x > 0 ? k - 1 : -1, k + w < w * h ? k + w : -1, k - w >= 0 ? k - w : -1]) {
          if (m >= 0 && clear[m] && !reached[m]) { reached[m] = 1; stack.push(m); }
        }
      }
      return dilateCells(reached, w, h, radius + Math.ceil(TOUCH_M / CELL_M));
    };
    const touchAny = flood(passable);
    const touchAsphalt = flood(passable.map((v, k) => (v && !concrete(k) ? 1 : 0)));
    for (const row of rows) {
      const shape = shapes.get(row.id);
      if (!shape) { results.push({ id: row.id, connected: false }); continue; }
      const footprint = rasterTop([{ ring: shape[0], holes: [], precedence: 0 }], grid);
      let via = null;
      for (let k = 0; k < w * h && via !== "asphalt"; k += 1) {
        if (footprint[k] !== 0 || passable[k] !== 1) continue;
        if (touchAsphalt[k]) via = "asphalt";
        else if (touchAny[k]) via = "concrete";
      }
      results.push({ id: row.id, connected: via !== null, via });
    }
  } else {
    for (const row of rows) results.push({ id: row.id, connected: false });
  }
  const why = new Map(reasons.map((r) => [r.row, r.reason]));
  const stranded = results.filter((r) => !r.connected).map((r) => ({ id: r.id, reason: why.get(r.id) ?? null }));
  const ok = new Set(results.filter((r) => r.connected).map((r) => r.id));
  const all = new Set(results.map((r) => r.id));
  return {
    rows: results,
    stranded,
    overConcrete: results.filter((r) => r.via === "concrete").map((r) => r.id),
    unexplained: stranded.filter((s) => !s.reason).map((s) => s.id),
    staleReasons: reasons.map((r) => r.row).filter((id) => ok.has(id) || !all.has(id)),
  };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
  const data = (file) => JSON.parse(readFileSync(path.join(HERE, "..", "data", file), "utf8"));
  const { wgs84ToTm } = await import("../../../src/geo/epsg5186.mjs");
  const blocked = standingMasses(data("building-forms.json"), wgs84ToTm);
  const without = opt("--without", "").split(",").filter(Boolean);
  const parking = data("ground/parking.json");
  const curation = data("ground/parcel-curation.json");
  const result = connectivity(parking, data("ground/parcels.json").parcels, { blocked, reasons: curation.unreachable, without });
  console.log(`CONNECTIVITY ${JSON.stringify({ rows: result.rows.length, connected: result.rows.filter((r) => r.connected).length, stranded: result.stranded.length, overConcrete: result.overConcrete.length, unexplained: result.unexplained.length, staleReasons: result.staleReasons.length, without })}`);
  for (const s of result.stranded) console.log(`STRANDED ${s.id}${s.reason ? `: ${s.reason}` : " (no reason)"}`);
  for (const id of result.overConcrete) console.log(`OVER CONCRETE ${id}: reaches a road only across a concrete yard`);
  for (const id of result.staleReasons) console.log(`STALE REASON ${id}: the row connects or no longer exists`);
  const out = opt("--out", null);
  if (out) {
    mkdirSync(out, { recursive: true });
    writeFileSync(path.join(out, without.length ? `connectivity-without-${without.join("_")}.json` : "connectivity.json"), `${JSON.stringify({ without, ...result }, null, 1)}\n`);
  }
  if (result.unexplained.length || result.staleReasons.length) process.exit(1);
}
