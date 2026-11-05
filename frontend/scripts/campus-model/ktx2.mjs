#!/usr/bin/env bun
// Post-pack texture compression for public/campus-v2.glb (docs/OPTIMIZATION-FORMULA.md, round 2, candidate "KTX2").
// Every WebP texture becomes a KTX2 / Basis Universal texture (KHR_texture_basisu) with a full mip chain, so the GPU
// keeps it block-compressed (about 1/4 to 1/8 of the RGBA8 the WebP decodes to). Per slot:
//   colour (baseColor, emissive)                    ETC1S, sRGB metrics
//   data (occlusion, metallic-roughness)            ETC1S, linear metrics
//   normal                                          `normals` option: "etc1s" (default) or "uastc" (UASTC + RDO + zstd)
// Needs the basisu CLI (Basis Universal 2.x: `brew install basis_universal`). The dashboard transcodes with three's
// KTX2Loader and the transcoder served from public/basis/ (no CDN).
//
//   bun scripts/campus-model/ktx2.mjs <in.glb> <out.glb> [--normals uastc|etc1s]
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { KHRTextureBasisu } from "@gltf-transform/extensions";
import sharp from "sharp";
import { createMeshoptIO } from "./compress.mjs";

// ETC1S normals measured the same Q as UASTC (0.2475 both) at 4.7 MB less (docs/OPTIMIZATION-FORMULA.md, round 2),
// so UASTC stays an option, not the default.
export const KTX2_DEFAULTS = Object.freeze({ normals: "etc1s" });
const COLOUR_SLOTS = new Set(["baseColorTexture", "emissiveTexture"]);

export function textureSlots(document, texture) {
  return [...new Set(document.getGraph().listParentEdges(texture).map((edge) => edge.getName()).filter((name) => name !== "textures"))];
}

// basisu arguments for a texture used in `slots` (pure; ktx2.test.mjs checks it).
export function basisuArgs(slots, { normals = KTX2_DEFAULTS.normals, d4 = false } = {}) {
  const args = ["-ktx2", "-mipmap"];
  const normal = slots.includes("normalTexture");
  // D-04/D-49: the D4 atlas and CC0 tiles keep their native detail. Scope is
  // resolved from material ownership, never from a campus-wide option. Normal maps
  // stay UASTC; the rest is max-quality ETC1S, since all-UASTC D4 maps pushed
  // campus-v2.glb to 162 MB, past GitHub's 100 MB file limit.
  if (d4 && normal) return [...args, "-uastc", "-uastc_rdo_l", "2", "-linear", "-normal_map"];
  if (d4) return [...args, "-etc1s", "-q", "255", ...(!slots.every(slot => COLOUR_SLOTS.has(slot)) ? ["-linear"] : [])];
  if (normal && normals === "uastc") return [...args, "-uastc", "-uastc_rdo_l", "2", "-linear", "-normal_map"];
  args.push("-etc1s");
  if (!slots.every((slot) => COLOUR_SLOTS.has(slot))) args.push("-linear");
  if (normal) args.push("-normal_map");
  return args;
}

function basisuAvailable() {
  const probe = spawnSync("basisu", ["-version"], { encoding: "utf8" });
  return probe.status === 0 || /Basis Universal/.test(`${probe.stdout}${probe.stderr}`);
}

export async function compressTextures(document, options = {}) {
  if (!basisuAvailable()) throw new Error("ktx2: basisu CLI not found (brew install basis_universal)");
  const work = mkdtempSync(path.join(tmpdir(), "campus-ktx2-"));
  const rows = [];
  try {
    for (const [index, texture] of document.getRoot().listTextures().entries()) {
      if (texture.getMimeType() === "image/ktx2") continue;
      const slots = textureSlots(document, texture);
      const png = path.join(work, `t${index}.png`);
      const ktx = path.join(work, `t${index}.ktx2`);
      writeFileSync(png, await sharp(Buffer.from(texture.getImage())).png().toBuffer());
      const owners = document.getGraph().listParentEdges(texture)
        .map(edge => edge.getParent()).filter(parent => parent.propertyType === "Material");
      const d4 = owners.length > 0 && owners.every(material =>
        material.getExtras().scope?.buildingId === "BLD_D4" || material.getName().endsWith("_D4"));
      const args = basisuArgs(slots, { ...options, d4 });
      const result = spawnSync("basisu", [...args, "-file", png, "-output_file", ktx], { encoding: "utf8" });
      if (result.status !== 0) throw new Error(`ktx2: basisu failed on texture ${index} (${slots.join(",")}): ${(result.stdout ?? "").slice(-300)}`);
      const bytes = new Uint8Array(readFileSync(ktx));
      rows.push({ index, slots, mode: args.includes("-uastc") ? "UASTC" : "ETC1S", before: texture.getImage().byteLength, after: bytes.byteLength });
      texture.setImage(bytes).setMimeType("image/ktx2");
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  document.createExtension(KHRTextureBasisu).setRequired(true);
  for (const extension of document.getRoot().listExtensionsUsed()) if (extension.extensionName === "EXT_texture_webp") extension.dispose();
  return rows;
}

export async function compressTexturesFile(input, output, options = {}) {
  const io = await createMeshoptIO();
  const document = await io.read(input);
  const rows = await compressTextures(document, options);
  await io.write(output, document);
  return rows;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [input, output] = process.argv.slice(2);
  const at = process.argv.indexOf("--normals");
  if (!input || !output) throw new Error("usage: bun scripts/campus-model/ktx2.mjs <in.glb> <out.glb> [--normals uastc|etc1s]");
  const rows = await compressTexturesFile(input, output, at > 0 ? { normals: process.argv[at + 1] } : {});
  const sum = (key) => rows.reduce((total, row) => total + row[key], 0);
  console.log(`ktx2: ${rows.length} textures, ${sum("before")} B WebP -> ${sum("after")} B KTX2 (${rows.filter((r) => r.mode === "UASTC").length} UASTC); ${input} -> ${output}`);
}
