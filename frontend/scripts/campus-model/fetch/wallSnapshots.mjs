// Explicit snapshot refresh. Ordinary consumers validate these saved frames, never regenerate them.
import { readFileSync, writeFileSync } from "node:fs";
import { loadTmFootprints } from "../lib/footprints.mjs";
import { wallsOf } from "../lib/anchors.mjs";

const file = new URL("../data/bld-node-map.json", import.meta.url);
const nodeMap = JSON.parse(readFileSync(file, "utf8"));
const footprints = await loadTmFootprints(nodeMap);
const entries = nodeMap.entries.map(entry => ({ ...entry, walls: wallsOf(entry.nodeId, footprints[entry.nodeId]) }));
const named = new Set(entries.map(entry => entry.nodeId));
const additionalWalls = Object.fromEntries(Object.entries(footprints).filter(([id]) => !named.has(id))
  .map(([id, fp]) => [id, wallsOf(id, fp)]));
writeFileSync(file, `${JSON.stringify({ ...nodeMap, entries, additionalWalls }, null, 2)}\n`);
const short = Object.values(footprints).flatMap((fp, i) => wallsOf(Object.keys(footprints)[i], fp)).filter(w => w.lengthM < 1);
console.log(JSON.stringify({ snapshots: Object.keys(footprints).length, shortWalls: short.map(w => ({ id: w.id, lengthM: w.lengthM })), bearingToleranceDeg: 2 }));
