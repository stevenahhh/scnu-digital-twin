#!/usr/bin/env bun
// Vector-only network preview PNG (no photo pixels, so outputs may be committed as PR images): polygons grey (road,
// lot, sidewalk, plaza shades), crossing polygons white, sidewalk edges blue, crossing edges white with a dark rim,
// vehicle edges dark grey, estimated edges amber dashed, sample points red. Simulation frame (metres east/north of
// the D4 anchor), north up.
//
//   renderPreview({ layers, edges, nodes, points, out, widthPx = 2000, window })
//     layers  [{ class: road|lot|sidewalk|crossing|plaza|walkway_estimated (tan, under the roads), rings }]
//     edges   [{ kind, points, estimated? }]   nodes [{ p }]   points [[x, z]]
//     window  null (fit everything), a WINDOWS name, or "x,z,widthM,heightM"
//   bun scripts/campus-model/network/preview.mjs --network <geojson> [--polygons <dir>] [--points <geojson>] --out <png>
//       [--window <name>] [--width <px>]
import path from "node:path";
import { sceneToTm, tmToSimulation } from "../../../src/geo/epsg5186.mjs";
import { encodePng } from "../lib/png.mjs";
import { Raster } from "../lib/raster.mjs";

const fromScene = (x, z) => {
  const p = tmToSimulation(...sceneToTm(x, z));
  return [p.x, p.z];
};
// Centres as scripts/perf/compare-satellite.mjs WINDOWS (scene units), sizes in metres.
export const WINDOWS = {
  "d4-block": { centre: fromScene(46.5, -266.6), widthM: 240, heightM: 150 },
  "main-gate": { centre: fromScene(450, -160), widthM: 240, heightM: 150 },
  "central-lawn": { centre: fromScene(260, -230), widthM: 240, heightM: 150 },
  "east-woodland": { centre: fromScene(355, -185), widthM: 240, heightM: 150 },
};

const POLYGON_COLOURS = { road: [178, 178, 178], lot: [160, 160, 168], sidewalk: [214, 214, 206], plaza: [226, 222, 210], crossing: [252, 252, 252], walkway_estimated: [214, 186, 140] };
const BACKGROUND = [238, 240, 232];
const EDGE_STYLE = {
  sidewalk: { colour: [30, 90, 210], thick: 1 },
  crosswalk: { colour: [255, 255, 255], rim: [30, 30, 30], thick: 1 },
  vehicle: { colour: [55, 55, 60], thick: 1 },
  estimated: { colour: [235, 150, 20], thick: 1, dash: true },
  connector: { colour: [40, 150, 70], thick: 1 },
};
const VEHICLE_KINDS = new Set(["allowed_road", "vehicle_lane", "vehicle_gate", "parking_connection"]);
const styleOf = (edge) => {
  if (edge.estimated) return EDGE_STYLE.estimated;
  if (edge.kind === "sidewalk") return EDGE_STYLE.sidewalk;
  if (edge.kind === "crosswalk") return EDGE_STYLE.crosswalk;
  if (VEHICLE_KINDS.has(edge.kind)) return EDGE_STYLE.vehicle;
  return EDGE_STYLE.connector;
};

function resolveWindow(window, extent) {
  if (!window) return extent;
  const named = WINDOWS[window];
  if (named) return [named.centre[0] - named.widthM / 2, named.centre[1] - named.heightM / 2, named.centre[0] + named.widthM / 2, named.centre[1] + named.heightM / 2];
  const parts = String(window).split(",").map(Number);
  if (parts.length === 4 && parts.every(Number.isFinite)) return [parts[0] - parts[2] / 2, parts[1] - parts[3] / 2, parts[0] + parts[2] / 2, parts[1] + parts[3] / 2];
  throw new Error(`preview: unknown window ${window} (names: ${Object.keys(WINDOWS).join(", ")}, or x,z,widthM,heightM)`);
}

export function renderPreviewPng({ layers = [], edges = [], nodes = [], points = [], widthPx = 2000, window = null }) {
  const all = [...layers.flatMap((l) => l.rings.flat()), ...edges.flatMap((e) => e.points)];
  if (!all.length && !window) throw new Error("preview: nothing to draw");
  const fit = all.length ? [Math.min(...all.map((p) => p[0])) - 10, Math.min(...all.map((p) => p[1])) - 10, Math.max(...all.map((p) => p[0])) + 10, Math.max(...all.map((p) => p[1])) + 10] : null;
  const [minX, minY, maxX, maxY] = resolveWindow(window, fit);
  const scale = widthPx / (maxX - minX);
  const heightPx = Math.max(1, Math.ceil((maxY - minY) * scale));
  const raster = new Raster(widthPx, heightPx);
  raster.fillPolygon([[[0, 0], [widthPx, 0], [widthPx, heightPx], [0, heightPx]]], () => BACKGROUND);
  const px = ([x, y]) => [(x - minX) * scale, (maxY - y) * scale];
  const order = ["plaza", "walkway_estimated", "lot", "road", "sidewalk", "crossing"];
  for (const cls of order) {
    for (const layer of layers.filter((l) => l.class === cls)) raster.fillPolygon(layer.rings.map((r) => r.map(px)), () => POLYGON_COLOURS[cls]);
  }
  const dot = (x, y, colour, r) => {
    for (let dx = -r; dx <= r; dx += 1) for (let dy = -r; dy <= r; dy += 1) raster.set(Math.round(x) + dx, Math.round(y) + dy, colour);
  };
  const line = (a, b, colour, thick, dash = false) => {
    const [x0, y0] = px(a);
    const [x1, y1] = px(b);
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
    for (let s = 0; s <= steps; s += 1) {
      if (dash && Math.floor(s / 6) % 2 === 1) continue;
      dot(x0 + ((x1 - x0) * s) / steps, y0 + ((y1 - y0) * s) / steps, colour, thick);
    }
  };
  const ordered = [...edges].sort((a, b) => (styleOf(a) === EDGE_STYLE.vehicle ? 0 : 1) - (styleOf(b) === EDGE_STYLE.vehicle ? 0 : 1));
  for (const e of ordered) {
    const style = styleOf(e);
    if (style.rim) for (let i = 0; i + 1 < e.points.length; i += 1) line(e.points[i], e.points[i + 1], style.rim, style.thick + 1);
    for (let i = 0; i + 1 < e.points.length; i += 1) line(e.points[i], e.points[i + 1], style.colour, style.thick, style.dash);
  }
  for (const n of nodes) {
    const [x, y] = px(n.p);
    dot(x, y, [20, 20, 20], 1);
  }
  for (const p of points) {
    const [x, y] = px(p);
    dot(x, y, [220, 30, 30], 2);
  }
  return { png: encodePng(widthPx, heightPx, 3, raster.data), width: widthPx, height: heightPx };
}

export async function renderPreview({ out, ...options }) {
  const { png, width, height } = renderPreviewPng(options);
  await Bun.write(out, png);
  return { out, width, height };
}

// Layers and edges of a transport-network GeoJSON plus its sibling polygon files (walkable / road).
export async function networkPreviewInput(networkPath, polygonsDir = path.dirname(networkPath)) {
  const network = JSON.parse(await Bun.file(networkPath).text());
  const layers = [];
  for (const name of ["road_polygons.geojson", "walkable_polygons.geojson"]) {
    const file = Bun.file(path.join(polygonsDir, name));
    if (!(await file.exists())) continue;
    const fc = JSON.parse(await file.text());
    for (const f of fc.features) {
      const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
      for (const rings of polys) layers.push({ class: f.properties.class, rings });
    }
  }
  const edges = network.features.filter((f) => f.properties.feature_type === "edge" && f.geometry?.type === "LineString").map((f) => ({ kind: f.properties.kind, points: f.geometry.coordinates, estimated: Boolean(f.properties.estimated) }));
  return { layers, edges };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const arg = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
  const networkPath = arg("--network");
  const out = arg("--out");
  if (!networkPath || !out) {
    console.error("usage: preview.mjs --network <geojson> [--polygons <dir>] [--points <geojson>] --out <png> [--window <name>] [--width <px>]");
    process.exit(2);
  }
  if (!(await Bun.file(networkPath).exists())) {
    console.error(`preview.mjs: network not found: ${networkPath}`);
    process.exit(2);
  }
  const input = await networkPreviewInput(path.resolve(networkPath), arg("--polygons") ? path.resolve(arg("--polygons")) : undefined);
  let points = [];
  if (arg("--points")) {
    const fc = JSON.parse(await Bun.file(arg("--points")).text());
    points = fc.features.filter((f) => f.geometry?.type === "Point").map((f) => f.geometry.coordinates);
  }
  const r = await renderPreview({ ...input, points, out: path.resolve(out), window: arg("--window"), widthPx: Number(arg("--width") ?? 2000) });
  console.log(`preview ${r.out} ${r.width}x${r.height}: ${input.layers.length} polygons, ${input.edges.length} edges, ${points.length} points`);
}
