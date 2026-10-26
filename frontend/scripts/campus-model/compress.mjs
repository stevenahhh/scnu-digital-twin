#!/usr/bin/env bun
// Post-pack geometry compression for public/campus-v2.glb (docs/OPTIMIZATION-FORMULA.md, candidate "meshopt").
// pack.mjs calls compressGeometry() after gltf-transform optimize; it also runs alone on any packed GLB:
//
//   bun scripts/campus-model/compress.mjs <in.glb> <out.glb>
//
// EXT_meshopt_compression with the QUANTIZE encoder method and no quantize() pass: every accessor keeps its
// component type (float positions, normals and UVs stay float), so the 6 mm lift steps between the Ground_* layers
// and the 3 mm walkway-to-kerb gaps are kept bit for bit (see pack.mjs: 14-bit quantization made them z-fight).
// The meshopt codec is lossless on what it is given; reorder() first sorts each primitive's vertices and triangles for
// transmission size (gltf-transform's web default), which changes their order but not the triangles drawn.
// The dashboard decodes it with the meshopt decoder drei's useGLTF already sets on its GLTFLoader.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTMeshoptCompression } from "@gltf-transform/extensions";
import { reorder } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";

export async function createMeshoptIO() {
  await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
  return new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    "meshopt.decoder": MeshoptDecoder,
    "meshopt.encoder": MeshoptEncoder,
  });
}

export async function compressGeometry(document) {
  await document.transform(reorder({ encoder: MeshoptEncoder, target: "size" }));
  document.createExtension(EXTMeshoptCompression).setRequired(true)
    .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  return document;
}

export async function compressFile(input, output) {
  const io = await createMeshoptIO();
  const document = await io.read(input);
  await compressGeometry(document);
  await io.write(output, document);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) throw new Error("usage: bun scripts/campus-model/compress.mjs <in.glb> <out.glb>");
  await compressFile(input, output);
  console.log(`compress: ${input} -> ${output}`);
}
