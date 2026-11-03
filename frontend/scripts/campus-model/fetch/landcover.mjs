// Landcover classes (lib/landcover.mjs) per scene unit over EXTENT -> data/landcover.png, from
//   - the MCEE (Ministry of Climate, Energy and Environment) level-3 land-cover map, edition pinned
//     to MCEE_LAYER (editions redraw polygons), via its public GeoServer WFS, cached in .cache/mcee/
//   - CHMv2 canopy height (fetch/canopy.mjs, also written to data/chm.png): canopy at or above
//     CANOPY_TREE_METRES marks a cell TREE whatever its MCEE class.
// Roads, walkways and buildings stay hard masks in the build stages, as before.
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { EXTENT, geoToModel, modelToGeo } from "../lib/frame.mjs";
import { CANOPY_TREE_METRES, LANDCOVER, classFromMcee } from "../lib/landcover.mjs";
import { encodePng } from "../lib/png.mjs";
import { Raster } from "../lib/raster.mjs";
import { fetchCanopy, writeCanopy } from "./canopy.mjs";
import { BBOX, CACHE, DATA, TIMEOUT_MS, USER_AGENT } from "./common.mjs";

const MCEE_WFS = "https://api.mcee.go.kr/geoserver/wfs";
const MCEE_LAYER = "lv3_2025y";
const PAGE_SIZE = 1000;
const MAX_PAGES = 20;
const MCEE_CACHE = path.join(CACHE, "mcee");
// stages/ground.mjs has no WATER colour yet, so WATER cells are written as this class until it does.
const WATER_IN_PNG = LANDCOVER.PAVED;
// A scene unit (1.6 m) is sampled CANOPY_SAMPLES^2 times on the 1.19 m CHMv2 grid; it becomes TREE
// when at least CANOPY_MIN_HITS samples reach CANOPY_TREE_METRES (1 keeps crown edges).
const CANOPY_SAMPLES = 3;
const CANOPY_MIN_HITS = 1;

// MCEE geometry is EPSG:3857.
const EARTH_RADIUS = 6378137;
const mercatorToGeo = (x, y) => [
  (x / EARTH_RADIUS) * (180 / Math.PI),
  (2 * Math.atan(Math.exp(y / EARTH_RADIUS)) - Math.PI / 2) * (180 / Math.PI),
];
const geoToMercator = (lon, lat) => [
  (lon * Math.PI * EARTH_RADIUS) / 180,
  EARTH_RADIUS * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)),
];

async function fetchMceePage(startIndex) {
  const file = Bun.file(path.join(MCEE_CACHE, `${MCEE_LAYER}-${startIndex}.json`));
  if (await file.exists()) return file.json();
  const params = new URLSearchParams({
    service: "WFS",
    version: "2.0.0",
    request: "GetFeature",
    typeNames: MCEE_LAYER,
    bbox: `${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east},urn:ogc:def:crs:EPSG::4326`,
    outputFormat: "application/json",
    count: String(PAGE_SIZE),
    startIndex: String(startIndex),
  });
  const response = await fetch(`${MCEE_WFS}?${params}`, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(TIMEOUT_MS * 4),
  });
  if (!response.ok) throw new Error(`MCEE WFS ${MCEE_LAYER} startIndex ${startIndex}: HTTP ${response.status}`);
  const text = await response.text();
  const page = JSON.parse(text);
  if (!Array.isArray(page.features)) throw new Error(`MCEE WFS ${MCEE_LAYER} startIndex ${startIndex}: no features array`);
  await Bun.write(file, text);
  return page;
}

async function fetchMceeFeatures() {
  await mkdir(MCEE_CACHE, { recursive: true });
  const features = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const { features: batch } = await fetchMceePage(page * PAGE_SIZE);
    features.push(...batch);
    if (batch.length < PAGE_SIZE) return features;
  }
  throw new Error(`MCEE WFS ${MCEE_LAYER}: more than ${MAX_PAGES * PAGE_SIZE} features in the bbox`);
}

// Planar ring area in square metres (Mercator area scaled by cos^2 of the latitude).
function ringAreaM2(ring) {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) sum += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  const lat = mercatorToGeo(ring[0][0], ring[0][1])[1];
  return (Math.abs(sum) / 2) * Math.cos((lat * Math.PI) / 180) ** 2;
}

export async function buildLandcover(canopy) {
  const width = EXTENT.maxX - EXTENT.minX;
  const height = EXTENT.maxZ - EXTENT.minZ;
  const features = await fetchMceeFeatures();

  // Rasterise MCEE polygons (cell centres, even-odd holes); cells no polygon covers stay GRASS.
  const classes = new Raster(width, height);
  classes.data.fill(LANDCOVER.GRASS);
  const toUnit = ([x, y]) => {
    const [mx, mz] = geoToModel(...mercatorToGeo(x, y));
    return [mx - EXTENT.minX, mz - EXTENT.minZ];
  };
  const codes = new Map();
  for (const feature of features) {
    const { geometry, properties } = feature;
    if (!geometry) continue;
    const polygons = geometry.type === "MultiPolygon" ? geometry.coordinates : geometry.type === "Polygon" ? [geometry.coordinates] : [];
    const area = polygons.reduce((sum, rings) => sum + ringAreaM2(rings[0]) - rings.slice(1).reduce((s, hole) => s + ringAreaM2(hole), 0), 0);
    const cls = classFromMcee(properties.l3_code, area);
    codes.set(properties.l3_code, (codes.get(properties.l3_code) ?? 0) + 1);
    for (const rings of polygons) classes.fillPolygon(rings.map((ring) => ring.map(toUnit)), () => [cls, cls, cls]);
  }

  const grid = new Uint8Array(width * height);
  let canopyCells = 0;
  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      const k = row * width + col;
      grid[k] = classes.data[k * 3] === LANDCOVER.WATER ? WATER_IN_PNG : classes.data[k * 3];
      if (grid[k] === LANDCOVER.TREE) continue;
      let hits = 0;
      for (let sy = 0; sy < CANOPY_SAMPLES; sy += 1) {
        for (let sx = 0; sx < CANOPY_SAMPLES; sx += 1) {
          const [mx, my] = geoToMercator(
            ...modelToGeo(EXTENT.minX + col + (sx + 0.5) / CANOPY_SAMPLES, EXTENT.minZ + row + (sy + 0.5) / CANOPY_SAMPLES),
          );
          const px = Math.floor((mx - canopy.originX) / canopy.pixelSize);
          const py = Math.floor((canopy.originY - my) / canopy.pixelSize);
          if (px >= 0 && py >= 0 && px < canopy.width && py < canopy.height && canopy.pixels[py * canopy.width + px] >= CANOPY_TREE_METRES) hits += 1;
        }
      }
      if (hits >= CANOPY_MIN_HITS) {
        grid[k] = LANDCOVER.TREE;
        canopyCells += 1;
      }
    }
  }

  const waterCells = classes.data.reduce((n, v, i) => n + (i % 3 === 0 && v === LANDCOVER.WATER), 0);
  const counts = Object.fromEntries(Object.entries(LANDCOVER).map(([name, id]) => [name, grid.reduce((n, v) => n + (v === id), 0)]));
  console.log(
    `MCEE ${MCEE_LAYER}: ${features.length} polygons (l3 codes ${[...codes].sort().map(([c, n]) => `${c}:${n}`).join(" ")}); ` +
    `CHMv2 >= ${CANOPY_TREE_METRES} m added ${canopyCells} TREE cells; ${waterCells} MCEE WATER cells written as class ${WATER_IN_PNG}; classes ${JSON.stringify(counts)}`,
  );
  return { width, height, grid };
}

export async function writeLandcover() {
  const canopy = await fetchCanopy();
  await writeCanopy(canopy);
  const landcover = await buildLandcover(canopy);
  await Bun.write(path.join(DATA, "landcover.png"), encodePng(landcover.width, landcover.height, 1, landcover.grid));
  console.log(`landcover.png: ${landcover.width}x${landcover.height}`);
}
