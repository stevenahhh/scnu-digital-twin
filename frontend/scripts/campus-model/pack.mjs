#!/usr/bin/env bun
// Packs the generator's raw GLB (scripts/campus-model/.build/campus-v2.raw.glb) into the shipped
// a .build candidate in four steps (only the QA gate publishes to public):
//   1. Terrain join: the Topography_* chunk primitives (one shared Ground material, identity transforms,
//      one attribute layout) are merged into a single Topography_joined primitive under the Topography
//      parent, which takes ~107 draw calls back. Nothing else is joined: BLD_* nodes, trees, crosswalks
//      and OuterTerrain (a different Ground material with COLOR_0 and no UVs) keep their structure.
//      The dashboard finds terrain by the parent name (traffic) and the /^Topography/ mesh name (camera).
//   2. gltf-transform optimize: WebP textures capped at 4096 px, float (unquantized) geometry, with no
//      flatten, join, instance, palette or simplify, so every BLD_* root node and mesh name the
//      dashboard selects by, and every editable object node (lib/objectNodes.mjs), survives packing. Each object
//      mesh carries its own constant _OBJECT_ID, so dedup never merges two objects' meshes. Geometry is not quantized: meshopt quantization rounds positions to
//      14 bits of each mesh's extent (about 5 cm over the campus, vertically too), coarser than the 6 mm lift steps
//      between the Ground_* layers and the 3 mm between a raised walkway decal and its kerb top (stages/surfaces.mjs,
//      stages/kerbs.mjs); the layers would z-fight (plan uhf-ground-roads-routing: no size limit applies).
//   3. compress.mjs: EXT_meshopt_compression without position quantization (positions, UVs and colours bit for bit),
//      normals as 8-bit octahedral (docs/OPTIMIZATION-FORMULA.md, 2026-10-26 pass). drei's useGLTF decodes it.
//   4. ktx2.mjs: every WebP texture re-encoded as KTX2 / Basis Universal (KHR_texture_basisu: ETC1S for colour, data and
//      normal maps; ktx2.mjs --normals uastc is the measured alternative), so the GPU keeps textures block-compressed (docs/OPTIMIZATION-FORMULA.md, round 2).
//      The dashboard decodes them with three's KTX2Loader and the transcoder in public/basis/.
// gltfpack is not used: its default quantization inserts dequantization parent nodes.
//
//   bun run model:pack --candidate-dir <.build/candidate-...>
//   Public files and precompression are owned by qa/candidate.mjs after QA passes.
import { spawnSync } from "node:child_process";
import { statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
import { compressFile } from "./compress.mjs";
import { compressTexturesFile } from "./ktx2.mjs";
import { candidatePaths, CandidateGateError } from "./qa/candidate.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.resolve(HERE, "../..");
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== "--candidate-dir") {
  throw new CandidateGateError("CANDIDATE_REQUIRED", "pack requires --candidate-dir; publishing and precompression require the candidate QA gate");
}
const candidate = candidatePaths(args[1]);
export const RAW_OUTPUT = candidate.raw;
export const PACKED_OUTPUT = candidate.packed;
const JOINED_OUTPUT = candidate.joined;
const EXPECTED_BUILDINGS = 29;
const TERRAIN_PARENT = "Topography";
const TERRAIN_CHUNK = /^Topography_/;
const TERRAIN_JOINED = "Topography_joined";
const TRIANGLES = 4;
// Materials that must carry the baked AO (building atlas: stages/buildings.mjs; ground: stages/ground.mjs).
const AO_MATERIALS = ["Facade_Atlas", "Facade_Atlas_D4", "Roof_Membrane", "Roof_Parapet", "Roof_Equipment", "Ground_Asphalt"];

const OPTIMIZE_ARGS = [
  "--flatten", "false",
  "--join", "false",
  "--instance", "false",
  "--palette", "false",
  "--simplify", "false",
  "--compress", "false",
  "--texture-compress", "webp",
  "--texture-size", "4096",
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
  // BLD_SCNU_* are the generator's pick proxies for named campus buildings; the rest are uni.glb's ids.
  const uniBuildings = buildings.filter((node) => !node.getName().startsWith("BLD_SCNU_"));
  const textures = root.listTextures();
  const failures = [];
  if (nodes.length !== rawRoot.listNodes().length) failures.push(`${nodes.length} nodes, raw has ${rawRoot.listNodes().length}`);
  if (sortedNames(nodes).join("\n") !== sortedNames(rawRoot.listNodes()).join("\n")) failures.push("node names differ from the raw GLB");
  if (sortedNames(root.listMeshes()).join("\n") !== sortedNames(rawRoot.listMeshes()).join("\n")) failures.push("mesh names differ from the raw GLB");
  if (uniBuildings.length !== EXPECTED_BUILDINGS) failures.push(`${uniBuildings.length} uni.glb BLD_* nodes, expected ${EXPECTED_BUILDINGS}`);
  // BLD_* nodes sit directly under a collection node (extras.collection, lib/glb.mjs groupRoots) or the scene, never
  // inside another object, so the dashboard's selection still resolves the BLD_* node itself.
  const topLevel = (node) => node.getParentNode() === null || node.getParentNode().getExtras()?.collection === true;
  const nestedBuildings = buildings.filter((node) => !topLevel(node));
  if (nestedBuildings.length) failures.push(`${nestedBuildings.length} BLD_* nodes are nested inside non-collection nodes`);
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
  if (!root.listExtensionsUsed().some((extension) => extension.extensionName === "EXT_meshopt_compression")) {
    failures.push("EXT_meshopt_compression is not used");
  }
  // The baked AO must be attached: stages/buildings.mjs and stages/ground.mjs leave it out with a warning when the baked
  // PNG's layout tag does not match this build (a stale bake after a geometry change), which silently shipped flat buildings.
  for (const name of AO_MATERIALS) {
    const material = root.listMaterials().find((candidate) => candidate.getName() === name);
    if (!material) failures.push(`material ${name} is missing`);
    else if (!material.getOcclusionTexture()) failures.push(`${name} has no occlusionTexture: re-bake the AO (scripts/campus-model/bake/README.md)`);
  }
  const nonKtx2 = textures.filter((texture) => texture.getMimeType() !== "image/ktx2");
  if (nonKtx2.length) failures.push(`${nonKtx2.length} textures are not image/ktx2`);
  if (failures.length) throw new Error(`campus-v2.glb pack check failed:\n  ${failures.join("\n  ")}`);
  return { nodes: nodes.length, buildings: uniBuildings.length, proxies: buildings.length - uniBuildings.length, meshes: root.listMeshes().length, textures: textures.length };
}

function optimize(rawFile, packedFile) {
  const cli = path.join(FRONTEND, "node_modules", ".bin", "gltf-transform");
  const result = spawnSync(cli, ["optimize", rawFile, packedFile, ...OPTIMIZE_ARGS], { stdio: ["ignore", "inherit", "pipe"], encoding: "utf8" });
  const stderr = (result.stderr ?? "").split("\n").filter((line) => line && !line.includes("Skipping TEXCOORD_0; out of [0,1] range"));
  if (stderr.length) process.stderr.write(`${stderr.join("\n")}\n`);
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`gltf-transform optimize exited with ${result.status}`);
}

const rawBytes = statSync(RAW_OUTPUT, { throwIfNoEntry: false })?.size;
if (!rawBytes) throw new Error(`${path.relative(FRONTEND, RAW_OUTPUT)} is missing; run bun run model:build`);
const terrain = await writeJoinedTerrain(RAW_OUTPUT, JOINED_OUTPUT);
console.log(
  `campus-v2.glb terrain join: ${terrain.chunks} Topography_* chunks -> 1 ${TERRAIN_JOINED} primitive ` +
  `(${terrain.vertices} vertices, ${terrain.triangles} triangles), ${statSync(JOINED_OUTPUT).size} B before optimize`,
);
optimize(JOINED_OUTPUT, PACKED_OUTPUT);
const optimizedBytes = statSync(PACKED_OUTPUT).size;
await compressFile(PACKED_OUTPUT, PACKED_OUTPUT);
const meshoptBytes = statSync(PACKED_OUTPUT).size;
const ktx2 = await compressTexturesFile(PACKED_OUTPUT, PACKED_OUTPUT);
const counts = await verify(JOINED_OUTPUT, PACKED_OUTPUT, terrain);
const packedBytes = statSync(PACKED_OUTPUT).size;
console.log(
  `campus-v2.glb packed: ${rawBytes} B raw -> ${optimizedBytes} B optimized -> ${meshoptBytes} B meshopt -> ${packedBytes} B KTX2 (${ktx2.length} textures, ${ktx2.filter((row) => row.mode === "UASTC").length} UASTC), ${counts.nodes} nodes, ${counts.buildings} BLD nodes, ${counts.proxies} BLD_SCNU pick proxies, ` +
  `${counts.meshes} meshes, ${counts.textures} ktx2 textures`,
);
