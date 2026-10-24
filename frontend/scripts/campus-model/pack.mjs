#!/usr/bin/env bun
// Packs the generator's raw GLB (scripts/campus-model/.build/campus-v2.raw.glb) into the shipped
// public/campus-v2.glb in two steps:
//   1. Terrain join: the Topography_* chunk primitives (one shared Ground material, identity transforms,
//      one attribute layout) are merged into a single Topography_joined primitive under the Topography
//      parent, which takes ~107 draw calls back. Nothing else is joined: BLD_* nodes, trees, crosswalks
//      and OuterTerrain (a different Ground material with COLOR_0 and no UVs) keep their structure.
//      The dashboard finds terrain by the parent name (traffic) and the /^Topography/ mesh name (camera).
//   2. gltf-transform optimize: meshopt geometry compression with mesh quantization, WebP textures capped
//      at 2048 px, with no flatten, join, palette or simplify, so every BLD_* root node and mesh name the
//      dashboard selects by survives packing. Quantization moves each mesh's offset/scale onto its node's
//      translation/scale; the meshes stay in scene space.
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
const JOINED_OUTPUT = path.join(HERE, ".build", "campus-v2.joined.glb");
const EXPECTED_BUILDINGS = 29;
const TERRAIN_PARENT = "Topography";
const TERRAIN_CHUNK = /^Topography_/;
const TERRAIN_JOINED = "Topography_joined";
const TRIANGLES = 4;

const OPTIMIZE_ARGS = [
  "--flatten", "false",
  "--join", "false",
  "--palette", "false",
  "--simplify", "false",
  "--compress", "meshopt",
  "--texture-compress", "webp",
  "--texture-size", "2048",
];

async function createIO() {
  await MeshoptDecoder.ready;
  return new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder });
}

async function readDocument(file) {
  return (await createIO()).read(file);
}

const isIdentity = (node) => node.getMatrix().every((value, index) => value === (index % 5 === 0 ? 1 : 0));

// Merges every Topography_* chunk primitive into one indexed primitive on a new Topography_joined child.
// Throws instead of joining when a chunk breaks an assumption the merge relies on.
function joinTerrain(document) {
  const root = document.getRoot();
  const parent = root.listNodes().find((node) => node.getName() === TERRAIN_PARENT);
  if (!parent) throw new Error(`terrain join: no ${TERRAIN_PARENT} node in the raw GLB`);
  const chunks = parent.listChildren();
  const primitives = chunks.map((chunk) => {
    const mesh = chunk.getMesh();
    const problem = !TERRAIN_CHUNK.test(chunk.getName()) ? "is not a Topography_* chunk"
      : chunk.listChildren().length ? "has children"
      : !isIdentity(chunk) ? "has a non-identity transform"
      : mesh?.listPrimitives().length !== 1 ? "does not hold exactly one primitive"
      : mesh.listParents().filter((user) => user.propertyType === "Node").length !== 1 ? "shares its mesh"
      : null;
    if (problem) throw new Error(`terrain join: ${chunk.getName()} ${problem}`);
    return mesh.listPrimitives()[0];
  });
  if (primitives.length < 2) throw new Error(`terrain join: ${primitives.length} terrain chunks, nothing to join`);

  const [first] = primitives;
  const material = first.getMaterial();
  const semantics = first.listSemantics().sort();
  for (const [index, primitive] of primitives.entries()) {
    const name = chunks[index].getName();
    if (primitive.getMaterial() !== material) throw new Error(`terrain join: ${name} uses another material`);
    if (primitive.getMode() !== TRIANGLES || !primitive.getIndices()) throw new Error(`terrain join: ${name} is not indexed triangles`);
    if (primitive.listTargets().length) throw new Error(`terrain join: ${name} has morph targets`);
    if (primitive.listSemantics().sort().join() !== semantics.join()) throw new Error(`terrain join: ${name} has other attributes`);
    for (const semantic of semantics) {
      const attribute = primitive.getAttribute(semantic);
      const reference = first.getAttribute(semantic);
      if (attribute.getType() !== reference.getType() || attribute.getArray().constructor !== reference.getArray().constructor
        || attribute.getNormalized() !== reference.getNormalized()) throw new Error(`terrain join: ${name} ${semantic} has another layout`);
    }
  }

  const vertexCount = primitives.reduce((sum, primitive) => sum + primitive.getAttribute("POSITION").getCount(), 0);
  const indexCount = primitives.reduce((sum, primitive) => sum + primitive.getIndices().getCount(), 0);
  const buffer = first.getAttribute("POSITION").getBuffer();
  const joined = document.createPrimitive().setMode(TRIANGLES).setMaterial(material);
  for (const semantic of semantics) {
    const reference = first.getAttribute(semantic);
    const array = new (reference.getArray().constructor)(vertexCount * reference.getElementSize());
    let offset = 0;
    for (const primitive of primitives) {
      const source = primitive.getAttribute(semantic).getArray();
      array.set(source, offset);
      offset += source.length;
    }
    joined.setAttribute(semantic, document.createAccessor(`${TERRAIN_JOINED}_${semantic}`)
      .setType(reference.getType()).setNormalized(reference.getNormalized()).setArray(array).setBuffer(buffer));
  }
  const indices = new (vertexCount > 0xffff ? Uint32Array : Uint16Array)(indexCount);
  let indexOffset = 0;
  let vertexOffset = 0;
  for (const primitive of primitives) {
    const source = primitive.getIndices().getArray();
    for (let i = 0; i < source.length; i += 1) indices[indexOffset + i] = source[i] + vertexOffset;
    indexOffset += source.length;
    vertexOffset += primitive.getAttribute("POSITION").getCount();
  }
  joined.setIndices(document.createAccessor(`${TERRAIN_JOINED}_indices`).setType("SCALAR").setArray(indices).setBuffer(buffer));

  const mesh = document.createMesh(TERRAIN_JOINED).addPrimitive(joined);
  parent.addChild(document.createNode(TERRAIN_JOINED).setMesh(mesh));
  for (const [index, primitive] of primitives.entries()) {
    const accessors = [primitive.getIndices(), ...primitive.listAttributes()];
    const chunkMesh = chunks[index].getMesh();
    chunks[index].dispose();
    chunkMesh.dispose();
    primitive.dispose();
    for (const accessor of accessors) if (accessor.listParents().every((user) => user.propertyType === "Root")) accessor.dispose();
  }
  return { chunks: chunks.length, vertices: vertexCount, triangles: indexCount / 3 };
}

async function writeJoinedTerrain(rawFile, joinedFile) {
  const io = await createIO();
  const document = await io.read(rawFile);
  const terrain = joinTerrain(document);
  await io.write(joinedFile, document);
  return terrain;
}

const sortedNames = (list) => list.map((item) => item.getName()).sort();

// The packed file must hold exactly the joined file's nodes and meshes, by name, with WebP textures only,
// and the Topography parent must hold the single joined terrain primitive with every triangle.
async function verify(rawFile, packedFile, terrain) {
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
  const terrainChildren = nodes.find((node) => node.getName() === TERRAIN_PARENT)?.listChildren() ?? [];
  const terrainPrimitives = terrainChildren[0]?.getMesh()?.listPrimitives() ?? [];
  if (terrainChildren.length !== 1 || terrainChildren[0].getName() !== TERRAIN_JOINED) {
    failures.push(`${TERRAIN_PARENT} has ${terrainChildren.length} children, expected only ${TERRAIN_JOINED}`);
  } else if (terrainPrimitives.length !== 1 || terrainPrimitives[0].getMaterial()?.getName() !== "Ground") {
    failures.push(`${TERRAIN_JOINED} is not one Ground primitive`);
  } else if (terrainPrimitives[0].getIndices().getCount() / 3 !== terrain.triangles) {
    failures.push(`${TERRAIN_JOINED} has ${terrainPrimitives[0].getIndices().getCount() / 3} triangles, the chunks had ${terrain.triangles}`);
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
const terrain = await writeJoinedTerrain(RAW_OUTPUT, JOINED_OUTPUT);
console.log(
  `campus-v2.glb terrain join: ${terrain.chunks} Topography_* chunks -> 1 ${TERRAIN_JOINED} primitive ` +
  `(${terrain.vertices} vertices, ${terrain.triangles} triangles), ${statSync(JOINED_OUTPUT).size} B before optimize`,
);
optimize(JOINED_OUTPUT, PACKED_OUTPUT);
const counts = await verify(JOINED_OUTPUT, PACKED_OUTPUT, terrain);
const packedBytes = statSync(PACKED_OUTPUT).size;
console.log(
  `campus-v2.glb packed: ${rawBytes} B raw -> ${packedBytes} B, ${counts.nodes} nodes, ${counts.buildings} BLD nodes, ` +
  `${counts.meshes} meshes, ${counts.textures} webp textures`,
);
if (process.argv.includes("--precompress")) {
  const sizes = precompress(PACKED_OUTPUT);
  console.log(`campus-v2.glb precompressed: ${sizes.br} B .br (q11), ${sizes.gz} B .gz`);
}
