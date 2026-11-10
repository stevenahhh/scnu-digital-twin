// Geometry-only copy of a packed campus GLB for qa/topology/blender_topology.py: meshopt is decoded and every
// texture is dropped (Blender's glTF importer reads neither EXT_meshopt_compression nor KHR_texture_basisu), so the
// file Blender opens carries exactly the packed vertices and indices.
// Run from frontend: bun scripts/campus-model/qa/topology/strip.mjs <in.glb> <out.glb>
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error("usage: strip.mjs <in.glb> <out.glb>");
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder });
const document = await io.read(input);
const root = document.getRoot();
for (const texture of root.listTextures()) texture.dispose();
for (const name of ["EXT_meshopt_compression", "KHR_texture_basisu"]) {
  root.listExtensionsUsed().find((e) => e.extensionName === name)?.dispose();
}
await io.write(output, document);
console.log(`STRIPPED ${input} -> ${output}`);
