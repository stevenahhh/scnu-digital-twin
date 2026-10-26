#!/usr/bin/env bun
// CC0 ground material tiles -> data/materials/ground-<class>-{col,nor,arm}.webp + ground-materials.json + LICENSES.md rows.
//
//   bun scripts/campus-model/fetch/groundMaterials.mjs
//
// Sources are CC0 1.0 only: Poly Haven (https://polyhaven.com/license) and ambientCG (https://ambientcg.com/license).
// Downloads are cached under .cache/materials/<asset>/ (never committed). Each class becomes three 1024 x 1024 WebP
// maps (quality 90): colour, normal (OpenGL convention) and ARM (R ambient occlusion, G roughness, B metalness; 255 AO
// and 0 metal where a source has no map). A non-square tile (Concrete034, 1.10 x 0.55 m) is repeated along its short
// side, so the square map spans physicalSizeM on both axes without stretching. Physical sizes come from the provider
// APIs (Poly Haven `dimensions` in mm, ambientCG `dimensionX` in cm); when the API has none, the plan's value is used
// and the entry is marked estimated. Nothing is written into data/materials unless every asset succeeds.
// AMBIENTCG_BASE / POLYHAVEN_API / POLYHAVEN_DL override the endpoints (used by the failure test).
import { createHash } from "node:crypto";
import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { decodePng, encodePng } from "../lib/png.mjs";
import { CACHE, DATA, TIMEOUT_MS, USER_AGENT } from "./common.mjs";

export const MATERIALS_DIR = path.join(DATA, "materials");
const MATERIALS_CACHE = path.join(CACHE, "materials");
const SIZE = 1024;
const QUALITY = 90;
const LICENCE = "CC0 1.0";

// class, provider, asset, and the plan's size (used only when the provider gives none).
export const GROUND_ASSETS = [
  { cls: "asphalt", provider: "polyhaven", asset: "asphalt_02", planSizeM: 3.0, use: "carriageway asphalt" },
  { cls: "pavers", provider: "ambientcg", asset: "PavingStones150", planSizeM: 0.9, use: "block-paver sidewalks and plazas" },
  { cls: "concrete", provider: "ambientcg", asset: "Concrete034", planSizeM: 1.1, use: "kerb stones" },
  { cls: "grass", provider: "ambientcg", asset: "Grass004", planSizeM: 1.4, use: "lawns" },
  { cls: "soil", provider: "ambientcg", asset: "Ground111", planSizeM: 2.8, use: "bare soil" },
  { cls: "asphalt-red", provider: "ambientcg", asset: "Asphalt029A", planSizeM: 2.5, use: "red bicycle lane" },
  { cls: "lot", provider: "polyhaven", asset: "concrete_floor_worn_001", planSizeM: 3.0, use: "parking lots" },
];

const env = (name, fallback) => process.env[name] ?? fallback;
const ambientBase = () => env("AMBIENTCG_BASE", "https://ambientcg.com/");
const polyApi = () => env("POLYHAVEN_API", "https://api.polyhaven.com/");

// Provider metadata -> physical tile edge in metres (and whether it had to fall back to the plan's value).
export function physicalSize(provider, info, planSizeM) {
  const raw = provider === "polyhaven" ? Number(info?.dimensions?.[0]) / 1000 : Number(info?.dimensionX) / 100;
  if (Number.isFinite(raw) && raw > 0) return { physicalSizeM: Math.round(raw * 1000) / 1000, physicalSizeSource: provider === "polyhaven" ? "Poly Haven info dimensions (mm) / 1000" : "ambientCG dimensionX (cm) / 100", estimated: false };
  return { physicalSizeM: planSizeM, physicalSizeSource: `${provider} API gives no dimension; plan value (estimated)`, estimated: true };
}

// Shape check of data/materials/ground-materials.json; returns a list of problems (empty = valid).
export function validateManifest(manifest) {
  const problems = [];
  if (!Array.isArray(manifest?.materials)) return ["materials is not an array"];
  for (const m of manifest.materials) {
    const where = m?.cls ?? "?";
    for (const key of ["cls", "asset", "source_url", "licence", "md5"]) if (typeof m[key] !== "string" || !m[key]) problems.push(`${where}: ${key} missing`);
    if (m.licence !== LICENCE) problems.push(`${where}: licence ${m.licence}`);
    if (!(m.physicalSizeM > 0.5 && m.physicalSizeM <= 5)) problems.push(`${where}: physicalSizeM ${m.physicalSizeM} outside (0.5, 5]`);
    for (const map of ["col", "nor", "arm"]) if (m.files?.[map] !== `ground-${m.cls}-${map}.webp`) problems.push(`${where}: files.${map}`);
  }
  return problems;
}

async function get(url, fetchImpl, what) {
  let response;
  try {
    response = await fetchImpl(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    throw new Error(`${what}: ${url}: ${error.cause?.code ?? error.message}`);
  }
  if (!response.ok) throw new Error(`${what}: ${url}: HTTP ${response.status}`);
  return response;
}

// Provider metadata for one asset (sizes, download URLs, authors, MD5s where the API has them).
export async function assetInfo(entry, fetchImpl = fetch) {
  if (entry.provider === "polyhaven") {
    const info = await (await get(`${polyApi()}info/${entry.asset}`, fetchImpl, entry.asset)).json();
    const files = await (await get(`${polyApi()}files/${entry.asset}`, fetchImpl, entry.asset)).json();
    const pick = (key) => files[key]?.["1k"]?.jpg;
    const maps = { col: pick("Diffuse"), nor: pick("nor_gl"), arm: pick("arm") };
    for (const [map, file] of Object.entries(maps)) if (!file?.url) throw new Error(`${entry.asset}: Poly Haven has no 1k ${map} JPEG`);
    return { info, maps, authors: Object.keys(info.authors ?? {}).join(", "), page: `https://polyhaven.com/a/${entry.asset}` };
  }
  const body = await (await get(`${ambientBase()}api/v2/full_json?id=${entry.asset}&include=dimensionsData,downloadData`, fetchImpl, entry.asset)).json();
  const info = body.foundAssets?.find((a) => a.assetId === entry.asset);
  if (!info) throw new Error(`${entry.asset}: ambientCG API has no such asset`);
  return { info, zip: `${ambientBase()}get?file=${entry.asset}_1K-JPG.zip`, authors: "ambientCG", page: `https://ambientcg.com/view?id=${entry.asset}` };
}

const md5 = (bytes) => createHash("md5").update(bytes).digest("hex");

async function cachedDownload(url, file, fetchImpl, what, expectedMd5) {
  if (await Bun.file(file).exists()) {
    const bytes = await Bun.file(file).bytes();
    if (!expectedMd5 || md5(bytes) === expectedMd5) return bytes;
  }
  const bytes = new Uint8Array(await (await get(url, fetchImpl, what)).arrayBuffer());
  if (expectedMd5 && md5(bytes) !== expectedMd5) throw new Error(`${what}: ${url}: MD5 ${md5(bytes)} != API ${expectedMd5}`);
  await Bun.write(file, bytes);
  return bytes;
}

// JPEG bytes -> raw pixels at `width` x `height` (Bun.Image resize, decoded through PNG).
async function rawImage(bytes, width, height) {
  const png = await new Bun.Image(bytes).resize(width, height).png().bytes();
  return decodePng(png);
}

// Square SIZE x SIZE RGB from a source whose aspect is 1:1 or an integer ratio (repeated along its short side).
async function squareMap(bytes, aspect) {
  const repeat = Math.max(1, Math.round(aspect));
  const img = await rawImage(bytes, SIZE, SIZE / repeat);
  const out = new Uint8Array(SIZE * SIZE * 3);
  for (let y = 0; y < SIZE; y += 1) {
    const sy = y % img.height;
    for (let x = 0; x < SIZE; x += 1) {
      const s = (sy * img.width + x) * img.channels;
      out.set(img.channels >= 3 ? [img.pixels[s], img.pixels[s + 1], img.pixels[s + 2]] : [img.pixels[s], img.pixels[s], img.pixels[s]], (y * SIZE + x) * 3);
    }
  }
  return out;
}

const toWebp = (rgb) => new Bun.Image(encodePng(SIZE, SIZE, 3, rgb)).webp({ quality: QUALITY }).bytes();

async function buildAsset(entry, fetchImpl) {
  const meta = await assetInfo(entry, fetchImpl);
  const size = physicalSize(entry.provider, meta.info, entry.planSizeM);
  const dir = path.join(MATERIALS_CACHE, entry.asset);
  await mkdir(dir, { recursive: true });
  let sources;
  let md5s;
  let sourceUrl;
  let aspect = 1;
  if (entry.provider === "polyhaven") {
    sources = {};
    md5s = [];
    for (const [map, file] of Object.entries(meta.maps)) {
      sources[map] = await cachedDownload(file.url, path.join(dir, path.basename(file.url)), fetchImpl, entry.asset, file.md5);
      md5s.push(md5(sources[map]));
    }
    sourceUrl = Object.values(meta.maps).map((f) => f.url).join(" , ");
    const [dx, dy] = meta.info.dimensions ?? [1, 1];
    aspect = dx / dy;
  } else {
    const zipFile = path.join(dir, `${entry.asset}_1K-JPG.zip`);
    const zip = await cachedDownload(meta.zip, zipFile, fetchImpl, entry.asset);
    md5s = [md5(zip)];
    sourceUrl = meta.zip;
    const unzip = Bun.spawnSync(["unzip", "-o", "-q", zipFile, "-d", dir]);
    if (unzip.exitCode !== 0) throw new Error(`${entry.asset}: unzip failed: ${unzip.stderr}`);
    const names = await readdir(dir);
    const find = (suffix) => names.find((n) => n.endsWith(`_1K-JPG_${suffix}.jpg`));
    const read = async (suffix) => (find(suffix) ? Bun.file(path.join(dir, find(suffix))).bytes() : null);
    const [col, nor, rough, ao, metal] = await Promise.all(["Color", "NormalGL", "Roughness", "AmbientOcclusion", "Metalness"].map(read));
    if (!col || !nor || !rough) throw new Error(`${entry.asset}: zip lacks Color/NormalGL/Roughness (${names.join(", ")})`);
    sources = { col, nor, rough, ao, metal };
    const dims = [Number(meta.info.dimensionX), Number(meta.info.dimensionY)];
    aspect = dims[0] > 0 && dims[1] > 0 ? dims[0] / dims[1] : 1;
  }
  const maps = { col: await toWebp(await squareMap(sources.col, aspect)), nor: await toWebp(await squareMap(sources.nor, aspect)) };
  if (sources.arm) {
    maps.arm = await toWebp(await squareMap(sources.arm, aspect));
  } else {
    const rough = await squareMap(sources.rough, aspect);
    const ao = sources.ao ? await squareMap(sources.ao, aspect) : null;
    const metal = sources.metal ? await squareMap(sources.metal, aspect) : null;
    const arm = new Uint8Array(SIZE * SIZE * 3);
    for (let i = 0; i < SIZE * SIZE; i += 1) {
      arm[i * 3] = ao ? ao[i * 3] : 255;
      arm[i * 3 + 1] = rough[i * 3];
      arm[i * 3 + 2] = metal ? metal[i * 3] : 0;
    }
    maps.arm = await toWebp(arm);
  }
  const entryJson = {
    cls: entry.cls,
    use: entry.use,
    asset: entry.asset,
    provider: entry.provider === "polyhaven" ? "Poly Haven" : "ambientCG",
    page: meta.page,
    authors: meta.authors,
    source_url: sourceUrl,
    licence: LICENCE,
    md5: md5s.join(","),
    ...size,
    sourceAspect: Math.round(aspect * 1000) / 1000,
    files: { col: `ground-${entry.cls}-col.webp`, nor: `ground-${entry.cls}-nor.webp`, arm: `ground-${entry.cls}-arm.webp` },
  };
  return { entry: entryJson, maps };
}

const SECTION_START = "<!-- ground-materials:start (written by fetch/groundMaterials.mjs) -->";
const SECTION_END = "<!-- ground-materials:end -->";
function licenceSection(materials, date) {
  const rows = materials.map((m) =>
    `| \`${m.files.col}\`, \`${m.files.nor}\`, \`${m.files.arm}\` | [${m.asset}](${m.page}) (${m.provider}) | ${m.authors} | ${m.physicalSizeM.toFixed(2)} m${m.estimated ? " (estimated)" : ""} | ${m.source_url} | \`${m.md5.split(",").join("`, `")}\` |`);
  return [
    SECTION_START,
    "",
    "## Ground material tiles (plan uhf-ground-roads-routing, todo 4)",
    "",
    `CC0 1.0 tiles from Poly Haven (https://polyhaven.com/license) and ambientCG (https://ambientcg.com/license), downloaded ${date}`,
    "by `fetch/groundMaterials.mjs` and converted to 1024 x 1024 WebP (quality 90): colour, normal (GL) and ARM (R AO, G",
    "roughness, B metal; AO 255 and metal 0 where a source has none). MD5s are of the downloaded files (Poly Haven, checked",
    "against its files API) or of the ambientCG 1K-JPG zip. Tile sizes come from the provider APIs; the manifest is",
    "`ground-materials.json`.",
    "",
    "| File | Asset | Authors | Tile size | Source file | MD5 of the source |",
    "|---|---|---|---|---|---|",
    ...rows,
    "",
    SECTION_END,
  ].join("\n");
}

export async function writeGroundMaterials({ fetchImpl = fetch } = {}) {
  const built = [];
  for (const entry of GROUND_ASSETS) {
    try {
      built.push(await buildAsset(entry, fetchImpl));
    } catch (error) {
      throw new Error(`ground material ${entry.cls} (${entry.asset}) failed: ${error.message}`);
    }
    console.log(`ground material ${entry.cls}: ${entry.asset} ok`);
  }
  const date = new Date().toISOString().slice(0, 10);
  const manifest = { generated: date, licence: LICENCE, size: SIZE, webpQuality: QUALITY, materials: built.map((b) => b.entry) };
  const problems = validateManifest(manifest);
  if (problems.length) throw new Error(`ground-materials.json invalid: ${problems.join("; ")}`);
  // Everything succeeded: only now touch data/materials.
  for (const { entry, maps } of built) for (const [map, bytes] of Object.entries(maps)) await Bun.write(path.join(MATERIALS_DIR, entry.files[map]), bytes);
  await Bun.write(path.join(MATERIALS_DIR, "ground-materials.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  const licencesPath = path.join(MATERIALS_DIR, "LICENSES.md");
  const licences = await Bun.file(licencesPath).text();
  const section = licenceSection(manifest.materials, date);
  const start = licences.indexOf(SECTION_START);
  const end = licences.indexOf(SECTION_END);
  const next = start >= 0 && end > start
    ? licences.slice(0, start) + section + licences.slice(end + SECTION_END.length)
    : `${licences.trimEnd()}\n\n${section}\n`;
  await Bun.write(licencesPath, next);
  console.log(`ground materials: ${built.length} classes, ${built.length * 3} WebP maps, ground-materials.json and LICENSES.md section written`);
}

if (import.meta.main) {
  try {
    await writeGroundMaterials();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
