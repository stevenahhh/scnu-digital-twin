#!/usr/bin/env bun
// Packs the generator's raw GLB (scripts/campus-model/.build/campus-v2.raw.glb) into the shipped
// public/campus-v2.glb: meshopt geometry compression with mesh quantization, WebP textures capped at
// 2048 px. Node, mesh and material structure is left alone (no flatten, join, palette or simplify),
// so every BLD_* root node and mesh name the dashboard selects by survives packing. Quantization
// moves each mesh's offset/scale onto its node's translation/scale; the meshes stay in scene space.
// gltfpack is not used: its default quantization inserts dequantization parent nodes.
//
//   bun run model:pack                  raw -> public/campus-v2.glb, then verify names and counts
//   bun run model:precompress           also write public/campus-v2.glb.br (q11) and .glb.gz
import { spawnSync } from "node:child_process";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, constants as zlib, gzipSync } from "node:zlib";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.resolve(HERE, "../..");
export const RAW_OUTPUT = path.join(HERE, ".build", "campus-v2.raw.glb");
export const PACKED_OUTPUT = path.join(FRONTEND, "public", "campus-v2.glb");
const EXPECTED_BUILDINGS = 29;

const OPTIMIZE_ARGS = [
  "--flatten", "false",
  "--join", "false",
  "--palette", "false",
  "--simplify", "false",
  "--compress", "meshopt",
  "--texture-compress", "webp",
  "--texture-size", "2048",
];

async function readDocument(file) {
  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder });
  return io.read(file);
}

const sortedNames = (list) => list.map((item) => item.getName()).sort();

// The packed file must hold exactly the raw file's nodes and meshes, by name, with WebP textures only.
async function verify(rawFile, packedFile) {
  const [raw, packed] = await Promise.all([readDocument(rawFile), readDocument(packedFile)]);
  const rawRoot = raw.getRoot();
  const root = packed.getRoot();
  const nodes = root.listNodes();
  const buildings = nodes.filter((node) => node.getName().startsWith("BLD_"));
  const textures = root.listTextures();
  const failures = [];
  if (nodes.length !== rawRoot.listNodes().length) failures.push(`${nodes.length} nodes, raw has ${rawRoot.listNodes().length}`);
  if (sortedNames(nodes).join("\n") !== sortedNames(rawRoot.listNodes()).join("\n")) failures.push("node names differ from the raw GLB");
  if (sortedNames(root.listMeshes()).join("\n") !== sortedNames(rawRoot.listMeshes()).join("\n")) failures.push("mesh names differ from the raw GLB");
  if (buildings.length !== EXPECTED_BUILDINGS) failures.push(`${buildings.length} BLD_* nodes, expected ${EXPECTED_BUILDINGS}`);
  const rootBuildings = root.listScenes()[0].listChildren().filter((node) => node.getName().startsWith("BLD_"));
  if (rootBuildings.length !== buildings.length) failures.push(`${buildings.length - rootBuildings.length} BLD_* nodes are no longer scene roots`);
  for (const node of buildings) {
    if (node.getMesh()?.getName() !== node.getName()) failures.push(`${node.getName()} lost its same-named mesh`);
  }
  const nonWebp = textures.filter((texture) => texture.getMimeType() !== "image/webp");
  if (nonWebp.length) failures.push(`${nonWebp.length} textures are not image/webp`);
  if (failures.length) throw new Error(`campus-v2.glb pack check failed:\n  ${failures.join("\n  ")}`);
  return { nodes: nodes.length, buildings: buildings.length, meshes: root.listMeshes().length, textures: textures.length };
}

function optimize(rawFile, packedFile) {
  const cli = path.join(FRONTEND, "node_modules", ".bin", "gltf-transform");
  const result = spawnSync(cli, ["optimize", rawFile, packedFile, ...OPTIMIZE_ARGS], { stdio: ["ignore", "inherit", "pipe"], encoding: "utf8" });
  // quantize warns once per primitive whose tiled TEXCOORD_0 leaves [0, 1]; those stay float and are fine.
  const stderr = (result.stderr ?? "").split("\n").filter((line) => line && !line.includes("Skipping TEXCOORD_0; out of [0,1] range"));
  if (stderr.length) process.stderr.write(`${stderr.join("\n")}\n`);
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`gltf-transform optimize exited with ${result.status}`);
}

function precompress(file) {
  const bytes = readFileSync(file);
  const br = brotliCompressSync(bytes, { params: { [zlib.BROTLI_PARAM_QUALITY]: 11, [zlib.BROTLI_PARAM_SIZE_HINT]: bytes.length } });
  const gz = gzipSync(bytes, { level: 9 });
  writeFileSync(`${file}.br`, br);
  writeFileSync(`${file}.gz`, gz);
  return { br: br.length, gz: gz.length };
}

const rawBytes = statSync(RAW_OUTPUT, { throwIfNoEntry: false })?.size;
if (!rawBytes) throw new Error(`${path.relative(FRONTEND, RAW_OUTPUT)} is missing; run bun run model:build`);
optimize(RAW_OUTPUT, PACKED_OUTPUT);
const counts = await verify(RAW_OUTPUT, PACKED_OUTPUT);
const packedBytes = statSync(PACKED_OUTPUT).size;
console.log(
  `campus-v2.glb packed: ${rawBytes} B raw -> ${packedBytes} B, ${counts.nodes} nodes, ${counts.buildings} BLD nodes, ` +
  `${counts.meshes} meshes, ${counts.textures} webp textures`,
);
if (process.argv.includes("--precompress")) {
  const sizes = precompress(PACKED_OUTPUT);
  console.log(`campus-v2.glb precompressed: ${sizes.br} B .br (q11), ${sizes.gz} B .gz`);
}
