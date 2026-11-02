// Shared validators for the curated campus-model data files. validate(kind, doc) -> { ok, errors[] }; every error
// string starts with the id of the record it is about (a node id, or the kind name for file-level errors), so a
// failing build points straight at the entry to fix. Run as a CLI: `bun lib/schemas.mjs <kind> <file>` exits 1 and
// prints the errors to stderr when the file is invalid.
import { readFileSync } from "node:fs";

const isPair = (value) => Array.isArray(value) && value.length === 2 && value.every(Number.isFinite);
const isText = (value) => typeof value === "string" && value.length > 0;

// data/bld-node-map.json: uni.glb BLD_* node -> GIS 건물통합정보 record (design §3, §11).
function bldNodeMap(doc) {
  if (!doc || typeof doc !== "object" || !Array.isArray(doc.entries)) return ["bldNodeMap: entries must be an array"];
  const errors = [];
  const nodes = new Map();
  const records = new Map();
  doc.entries.forEach((entry, index) => {
    if (!entry || typeof entry !== "object") {
      errors.push(`entries[${index}]: entry must be an object`);
      return;
    }
    const id = isText(entry.nodeId) ? entry.nodeId : `entries[${index}]`;
    const fail = (message) => errors.push(`${id}: ${message}`);
    if (!/^BLD_/.test(entry.nodeId ?? "")) fail("nodeId must be a BLD_* node id");
    else if (nodes.has(id)) fail(`nodeId repeats ${nodes.get(id)}`);
    else nodes.set(id, `entries[${index}]`);
    if (entry.gis === null || entry.gis === undefined) {
      // A curated null says on purpose that the node has no GIS record of its own (the reason names why).
      if (entry.curated !== true) fail("gis is null: no GIS footprint with IoU >= 0.5; curate it (gis, curated:true, reason)");
    } else if (typeof entry.gis !== "object" || !isText(entry.gis.footprintSource)) {
      fail("gis.footprintSource must be a non-empty string");
    } else {
      if (!(entry.gis.pnu === null || isText(entry.gis.pnu))) fail("gis.pnu must be a string or null");
      const other = records.get(entry.gis.footprintSource);
      if (other) fail(`GIS record "${entry.gis.footprintSource}" is also mapped to ${other}`);
      else records.set(entry.gis.footprintSource, id);
    }
    if (!isPair(entry.gisCentreTm) && entry.gis) fail("gisCentreTm must be [E, N]");
    if (!isPair(entry.uniCentreScene)) fail("uniCentreScene must be [x, z]");
    if (!(entry.iou === null || (Number.isFinite(entry.iou) && entry.iou >= 0 && entry.iou <= 1))) fail("iou must be a number in [0, 1] or null");
    if (typeof entry.curated !== "boolean") fail("curated must be a boolean");
    else if (entry.curated && !isText(entry.reason)) fail("curated:true needs a one-line reason");
    else if (!entry.curated && entry.gis && !(entry.iou >= 0.5)) fail("uncurated match needs iou >= 0.5");
  });
  return errors;
}

const KINDS = { bldNodeMap };

export function validate(kind, doc) {
  const check = KINDS[kind];
  const errors = check ? check(doc) : [`${kind}: unknown kind (known: ${Object.keys(KINDS).join(", ")})`];
  return { ok: errors.length === 0, errors };
}

if (import.meta.main) {
  const [kind, file] = process.argv.slice(2);
  let doc;
  try {
    doc = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    console.error(`${kind}: cannot read ${file}: ${error.message}`);
    process.exit(1);
  }
  const { ok, errors } = validate(kind, doc);
  for (const error of errors) console.error(error);
  if (!ok) process.exit(1);
  console.log(`${kind}: ok (${file})`);
}
