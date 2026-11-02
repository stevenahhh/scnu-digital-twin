#!/usr/bin/env bun
// Building forms of every modelled campus building: masses (outer ring, courtyard rings, base and top height, roof),
// voids and photo checks, from the VWorld LOD4 building models and the NGII 2025 orthophoto.
//
//   bun scripts/campus-model/fetch/buildingForms.mjs [--keep <dir>]   -> data/building-forms.json
//       --keep <dir>: also write the polygon step's input.json and output.json there (for building_forms.py work)
//
// Inputs: the building selection of stages/buildings.mjs (selectOnly: footprints, ids, floors, before any form), the
// keyless VWorld LOD4 tiles over it (fetch/lod4Facades.mjs decoders, cached in .cache/lod4/; consent D1), the NGII
// sheet in .cache/ngii-ortho/ (licence decision D2; never committed) and the relief-lean field of the registration study.
// The polygon work runs in fetch/building_forms.py (shapely, numpy, OpenCV through `uv run`, like fetch/gis_buildings.py);
// its header describes the method. Output rings are lon/lat (EPSG:4326, the same frame as gis-buildings.json); the
// generator maps them with geoToModel, like the footprints and the LOD4 tower outlines. Heights are metres above the
// building's lowest ground. Everything in the file is an estimate derived from VWorld's models and the photo.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { geoToModel, modelToGeo, SCENE_UNITS_PER_METRE } from "../lib/frame.mjs";
import { buildBuildings } from "../stages/buildings.mjs";
import { loadFurniture } from "../stages/furniture.mjs";
import { loadInputs } from "../stages/sources.mjs";
import { openSheet } from "../lib/ngiiSheet.mjs";
import { DATA } from "./common.mjs";
import { cached, LAT0, LON0, leafTiles, MX, MY, parseB3dm, tileModels } from "./lod4Facades.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT = path.join(DATA, "building-forms.json");
const U = SCENE_UNITS_PER_METRE;
const PYTHON = ["uv", "run", "--no-project", "--with", "shapely==2.2.0", "--with", "numpy==2.5.4", "--with", "opencv-python-headless==5.0.0.93", "python", "-I"];
// Relief lean of roofs in the NGII mosaic, fitted on 609 roof corners of 132 GIS footprints in the registration study
// (.omo/ulw-research/20261023-181400/qa/results/registration.json, gis_buildings.transform.lean_field_m_per_m_height):
// lean = height x (L0 + LE (E - E0) / 100 + LN (N - N0) / 100) per TM axis.
const LEAN_FIELD = { E: [-0.02, -0.01285, -0.00121], N: [-0.0549, -0.01201, -0.06335], E0N0: [243835.0182316025, 263760.97123001737] };

// EPSG:5186 (Korea 2000 / Central Belt 2010), as in bake/markings-gate.mjs.
const A_AXIS = 6378137;
const FLATTENING = 1 / 298.257222101;
const E2 = FLATTENING * (2 - FLATTENING);
const EP2 = E2 / (1 - E2);
const LAT_ORIGIN = (38 * Math.PI) / 180;
const LON_ORIGIN = (127 * Math.PI) / 180;
const meridian = (phi) => A_AXIS * (
  (1 - E2 / 4 - (3 * E2 ** 2) / 64 - (5 * E2 ** 3) / 256) * phi
  - ((3 * E2) / 8 + (3 * E2 ** 2) / 32 + (45 * E2 ** 3) / 1024) * Math.sin(2 * phi)
  + ((15 * E2 ** 2) / 256 + (45 * E2 ** 3) / 1024) * Math.sin(4 * phi)
  - ((35 * E2 ** 3) / 3072) * Math.sin(6 * phi));
function toKorea2000(lon, lat) {
  const phi = (lat * Math.PI) / 180;
  const sin = Math.sin(phi);
  const cos = Math.cos(phi);
  const n = A_AXIS / Math.sqrt(1 - E2 * sin * sin);
  const t = (sin / cos) ** 2;
  const c = EP2 * cos * cos;
  const a = ((lon * Math.PI) / 180 - LON_ORIGIN) * cos;
  const east = 200000 + n * (a + ((1 - t + c) * a ** 3) / 6 + ((5 - 18 * t + t * t + 72 * c - 58 * EP2) * a ** 5) / 120);
  const north = 600000 + meridian(phi) - meridian(LAT_ORIGIN) + n * (sin / cos) * (a * a / 2 + ((5 - t + 9 * c + 4 * c * c) * a ** 4) / 24
    + ((61 - 58 * t + t * t + 600 * c - 330 * EP2) * a ** 6) / 720);
  return [east, north];
}

// The sheet header (one strip of uncompressed RGB) and an affine map from model metres (east, north) to sheet pixels,
// fitted on a 9 x 9 grid over the campus (residual under 0.06 px).
async function sheetInfo() {
  const sheet = openSheet();
  sheet.close();
  if (sheet.dataOffset === null) throw new Error(`${sheet.path}: expected the pixel data in one contiguous block`);
  const { a, d: e, c, f } = sheet.tfw;
  const exact = (east, north) => {
    const [x, y] = toKorea2000(...modelToGeo(east * U, -north * U));
    return [(x - c) / a, (y - f) / e];
  };
  const rows = [];
  const targets = [];
  for (let i = 0; i <= 8; i += 1) for (let j = 0; j <= 8; j += 1) {
    rows.push([i * 100, j * 75, 1]);
    targets.push(exact(i * 100, j * 75));
  }
  const solve = (k) => {
    const m = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
    rows.forEach((r, n) => {
      for (let p = 0; p < 3; p += 1) {
        m[p][3] += r[p] * targets[n][k];
        for (let q = 0; q < 3; q += 1) m[p][q] += r[p] * r[q];
      }
    });
    for (let i = 0; i < 3; i += 1) {
      for (let r = 0; r < 3; r += 1) {
        if (r === i) continue;
        const factor = m[r][i] / m[i][i];
        for (let q = i; q < 4; q += 1) m[r][q] -= factor * m[i][q];
      }
    }
    return m.map((r, i) => r[3] / r[i]);
  };
  const col = solve(0);
  const row = solve(1);
  const residual = Math.max(...rows.map((r, n) => Math.hypot(col[0] * r[0] + col[1] * r[1] + col[2] - targets[n][0], row[0] * r[0] + row[1] * r[1] + row[2] - targets[n][1])));
  if (residual > 0.1) throw new Error(`sheet affine residual ${residual.toFixed(3)} px`);
  return { tif: sheet.path, offset: sheet.dataOffset, width: sheet.width, height: sheet.height, col, row, metresPerPixel: a, originTm: [c, f] };
}

const keyOf = (b) => b.nodeName ?? (b.nodeId && b.label ? b.nodeId : b.footprintSource);

export async function writeBuildingForms() {
  const inputs = await loadInputs();
  const silent = { log: console.log, warn: console.warn };
  console.log = () => {};
  console.warn = () => {};
  let selection;
  try {
    selection = await buildBuildings({ glb: null, inputs, detailedStructures: loadFurniture().detailedStructures, selectOnly: true });
  } finally {
    Object.assign(console, silent);
  }
  const { selectableBuildings, campusBuildings } = selection;
  const toMetres = ([x, z]) => [Number((x / U).toFixed(3)), Number((-z / U).toFixed(3))];
  const toGeo = ([east, north]) => modelToGeo(east * U, -north * U).map((v) => Number(v.toFixed(8)));
  const fromGeo = ([lon, lat]) => toMetres(geoToModel(lon, lat));
  // A curated form (data/scnu-facades.json entry `form`, lon/lat like this file) for a building LOD4 does not show.
  const curatedOf = (b) => {
    const form = b.entry?.form;
    if (!form) return null;
    return {
      source: form.source,
      masses: form.masses.map((m) => ({ ...m, outer: m.outer.map(fromGeo), holes: (m.holes ?? []).map((h) => h.map(fromGeo)), columns: (m.columns ?? []).map((c) => c.map(fromGeo)) })),
    };
  };
  const buildings = [...selectableBuildings, ...campusBuildings].map((b) => {
    const ring = b.parts.flatMap((p) => p.outer).map(toMetres);
    const [e0, e1] = [Math.floor(Math.min(...ring.map((p) => p[0])) - 14), Math.ceil(Math.max(...ring.map((p) => p[0])) + 14)];
    const [n0, n1] = [Math.floor(Math.min(...ring.map((p) => p[1])) - 14), Math.ceil(Math.max(...ring.map((p) => p[1])) + 14)];
    const values = [];
    for (let j = n0; j <= n1; j += 1) for (let i = e0; i <= e1; i += 1) values.push(Number((inputs.heightAt(i * U, -j * U) / U).toFixed(3)));
    return {
      key: keyOf(b),
      label: b.label ?? b.displayName ?? null,
      footprintSource: b.footprintSource,
      floors: Math.max(0, ...b.parts.map((p) => p.floors || 0)),
      // A curated tower (data/scnu-facades.json `tower`): its storeys set the storey height when LOD4's main mass is it.
      tower: b.parts.map((p) => p.tower).filter(Boolean).map((t) => ({ floors: t.floors, heightMetres: t.heightMetres }))[0] ?? null,
      parts: b.parts.map((p) => ({
        outer: p.outer.map(toMetres),
        holes: p.holes.map((h) => h.map(toMetres)),
        heightMetres: p.heightMetres,
        floors: p.floors || null,
        groundMetres: Math.min(...p.outer.map(([x, z]) => inputs.heightAt(x, z))) / U,
      })),
      terrain: { e0, n0, w: e1 - e0 + 1, h: n1 - n0 + 1, values },
      curated: curatedOf(b),
    };
  });

  // LOD4 models over the selection, in the same model metres (unshifted, as the generator places them).
  const lonlat = buildings.flatMap((b) => b.parts.flatMap((p) => p.outer)).map(toGeo);
  const bbox = {
    west: Math.min(...lonlat.map((p) => p[0])), east: Math.max(...lonlat.map((p) => p[0])),
    south: Math.min(...lonlat.map((p) => p[1])), north: Math.max(...lonlat.map((p) => p[1])),
  };
  const models = [];
  for (const uri of await leafTiles(bbox)) {
    for (const model of await tileModels(parseB3dm(await cached(uri, true)))) {
      const positions = new Array(model.local.length);
      for (let i = 0; i < model.local.length; i += 3) {
        const [x, z] = geoToModel(model.local[i] / MX + LON0, model.local[i + 1] / MY + LAT0);
        positions[i] = Number((x / U).toFixed(3));
        positions[i + 1] = Number((-z / U).toFixed(3));
        positions[i + 2] = Number(model.local[i + 2].toFixed(3));
      }
      models.push({ name: model.name, positions, indices: Array.from(model.indices) });
    }
  }
  const photo = await sheetInfo();
  console.log(`building forms: ${buildings.length} buildings, ${models.length} LOD4 models; photo ${path.basename(photo.tif)}`);

  const keepAt = process.argv.indexOf("--keep");
  const work = keepAt > 0 ? path.resolve(process.argv[keepAt + 1]) : await mkdtemp(path.join(tmpdir(), "building-forms-"));
  try {
    const input = path.join(work, "input.json");
    const output = path.join(work, "output.json");
    await Bun.write(input, JSON.stringify({ models, buildings, photo, leanField: { ...LEAN_FIELD, originTm: photo.originTm, metresPerPixel: photo.metresPerPixel } }));
    const child = Bun.spawn([...PYTHON, path.join(HERE, "building_forms.py"), input, output], { stdout: "inherit", stderr: "inherit" });
    if ((await child.exited) !== 0) throw new Error(`building_forms.py exited with ${child.exitCode}`);
    const result = JSON.parse(await Bun.file(output).text());
    const geoRing = (ring) => ring.map(toGeo);
    const named = new Map(buildings.map((b) => [b.key, b]));
    const records = result.buildings.map((r) => ({
      key: r.key,
      label: named.get(r.key)?.label ?? null,
      footprintSource: named.get(r.key)?.footprintSource ?? null,
      source: r.source,
      lod4Models: r.lod4Models,
      ...(r.storeyMetres ? { storeyMetres: r.storeyMetres } : {}),
      lean: r.lean,
      leanPrior: r.leanPrior,
      iou: r.iou,
      flags: r.flags,
      masses: r.masses.map((m) => ({
        ...m,
        outer: geoRing(m.outer),
        holes: m.holes.map(geoRing),
        ...(m.triangles ? { triangles: m.triangles.map((t) => t.map(([e, n, h]) => [...toGeo([e, n]), h])) } : {}),
        ...(m.columns ? { columns: m.columns.map(geoRing) } : {}),
      })),
      voids: r.voids.map((v) => ({ ...v, ring: geoRing(v.ring) })),
      ...(r.droppedMasses ? { droppedMasses: r.droppedMasses } : {}),
    }));
    const file = {
      description: "Building forms of the modelled campus buildings: per building a list of masses (outer ring, courtyard rings, base and top in metres above the building's lowest ground, parapet, roof type, pitched-roof triangles, columns under raised parts), the voids they leave (courtyards open to the sky, light wells, passages under raised masses), the relief lean of its roof in the NGII 2025 orthophoto and the photo IoU of the roof outline (lean-corrected). source: the VWorld LOD4 mesh, or the current footprint when LOD4 has no model or its outline disagrees with the photo. Rings are lon/lat (EPSG:4326). Estimates derived from VWorld's LOD4 models and the photo, not survey data.",
      sources: [
        "VWorld 3D building models, 3D Tiles facility_LOD4/Jeollanam-do/Suncheon-si (keyless; stored under consent D1 of 2026-10-24; 출처: 브이월드)",
        "NGII 2025 orthophoto sheet 34702020, 0.25 m (국토지리정보원; read locally, not committed; licence decision D2)",
        "Current footprints: data/gis-buildings.json (GIS건물통합정보, KOGL Type 1; OSM ODbL where GIS lacks one) and uni.glb outlines",
      ],
      method: "fetch/building_forms.py (header)",
      buildings: records,
    };
    await Bun.write(OUTPUT, `${JSON.stringify(file, null, 1)}\n`);
    const lod4 = records.filter((r) => r.source.startsWith("VWorld LOD4"));
    const ious = records.map((r) => r.iou.final).filter((v) => v !== null).sort((x, y) => x - y);
    console.log(`building forms: ${lod4.length} of ${records.length} from LOD4, ${records.reduce((n, r) => n + r.voids.length, 0)} voids; median photo IoU ${ious[ious.length >> 1]} -> ${path.relative(process.cwd(), OUTPUT)}`);
    return file;
  } finally {
    if (keepAt < 0) await rm(work, { recursive: true, force: true });
  }
}

if (import.meta.main) await writeBuildingForms();
