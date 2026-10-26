// Schema and id checks for data/vr-buildings.json (VR-only buildings, see README "VR-only buildings").
// VR_BUILDINGS_FILE checks another file with the same rules.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FILE = process.env.VR_BUILDINGS_FILE ?? path.join(SCRIPT, "data", "vr-buildings.json");
const VR_CACHE = path.join(SCRIPT, ".cache", "vr");

function uniBuildingIds() {
  const glb = readFileSync(path.resolve(SCRIPT, "../../public/uni.glb"));
  const json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString("utf8"));
  return new Set(json.nodes.map((node) => node.name).filter((name) => name?.startsWith("BLD_")));
}
const UNI = uniBuildingIds();
const NAMED = new Set(
  JSON.parse(readFileSync(path.join(SCRIPT, "data", "scnu-building-names.json"), "utf8")).records.map((r) => r.nodeId).filter(Boolean),
);
// The cache is gitignored; scene names are checked against it only where it exists.
const SCENES = existsSync(VR_CACHE) ? new Set(readdirSync(VR_CACHE)) : null;

const isPoint = (p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);

function validateRecords(records) {
  const errors = [];
  const seen = new Set();
  const codes = new Set();
  records.forEach((r, i) => {
    const at = `record ${i} (${r.nodeId ?? "no nodeId"})`;
    const fail = (message) => errors.push(`${at}: ${message}`);
    if (!(r.code === null || (typeof r.code === "string" && /^[A-Z]\d+$/.test(r.code)))) fail("code must be a registry code or null");
    if (typeof r.name !== "string" || !r.name.startsWith("순천대학교 ")) fail("name must start with 순천대학교");
    if (typeof r.label !== "string" || r.label.length === 0 || r.label.startsWith("순천대학교")) fail("label missing or starts with 순천대학교");
    if (typeof r.nodeId !== "string" || !/^BLD_SCNU_([A-Z]\d+|V\d+)$/.test(r.nodeId)) fail("nodeId must be BLD_SCNU_<code> or BLD_SCNU_V<n>");
    if (r.code && r.nodeId !== `BLD_SCNU_${r.code}`) fail("nodeId must be BLD_SCNU_<code> when the record has a code");
    if (r.status !== "standing") fail("status must be standing");
    if (!Number.isInteger(r.floors) || r.floors < 1) fail("floors must be >= 1 (a whole storey count)");
    const scene = /^VR (scene_[a-z0-9]+) storey count \(estimated\)$/.exec(r.floorsSource ?? "")?.[1];
    if (!scene) fail("floorsSource must read 'VR scene_<id> storey count (estimated)'");
    if (r.heightMetres !== 0) fail("heightMetres must be 0 (height comes from floors x median)");
    if (!Number.isInteger(r.undergroundFloors)) fail("undergroundFloors must be an integer");
    if (typeof r.usability !== "string" || !r.usability.endsWith("(추정)")) fail("usability must end in (추정)");
    if ("areaMetres" in r) fail("areaMetres is computed by the loader, not stored");
    if (!Array.isArray(r.polygons) || r.polygons.length === 0) fail("polygons missing");
    (r.polygons ?? []).forEach((polygon, p) => (polygon ?? []).forEach((ring, k) => {
      if (!Array.isArray(ring) || ring.length < 4 || !ring.every(isPoint)) return fail(`ring ${k} of polygon ${p} needs >= 4 [lon, lat] points`);
      const [first, last] = [ring[0], ring.at(-1)];
      if (first[0] !== last[0] || first[1] !== last[1]) fail(`ring ${k} of polygon ${p} is not closed`);
    }));
    if (typeof r.footprintSource !== "string" || !r.footprintSource.includes("(estimated)")) fail("footprintSource must say (estimated)");
    if (typeof r.nameSource !== "string" || r.nameSource.length === 0) fail("nameSource missing");
    if (r.estimated !== true) fail("estimated must be true");
    if (!(typeof r.confidence === "number" && r.confidence >= 0 && r.confidence <= 1)) fail("confidence must be 0-1");
    if (!Array.isArray(r.vrScenes) || r.vrScenes.length === 0 || !r.vrScenes.every((s) => /^scene_[a-z0-9]+$/.test(s))) fail("vrScenes must list scene ids");
    if (r.registerName !== null) fail("registerName must be null");
    if (SCENES) {
      for (const s of new Set([scene, ...(r.vrScenes ?? [])].filter(Boolean))) if (!SCENES.has(s)) fail(`${s} is not a cached VR scene`);
    }
    for (const id of [r.nodeId, r.code && `BLD_${r.code}`].filter(Boolean)) {
      if (UNI.has(id)) fail(`collides with uni.glb ${id}`);
    }
    if (NAMED.has(r.nodeId)) fail(`collides with scnu-building-names.json ${r.nodeId}`);
    if (seen.has(r.nodeId)) fail(`duplicate nodeId ${r.nodeId}`);
    seen.add(r.nodeId);
    if (r.code && codes.has(r.code)) fail(`duplicate code ${r.code}`);
    codes.add(r.code);
  });
  return errors;
}

const fixture = (overrides = {}) => ({
  code: null,
  name: "순천대학교 시험 건물",
  label: "시험 건물 (추정)",
  nodeId: "BLD_SCNU_V900",
  status: "standing",
  floors: 2,
  floorsSource: "VR scene_d4 storey count (estimated)",
  heightMetres: 0,
  undergroundFloors: 0,
  usability: "교육연구시설 (추정)",
  polygons: [[[[127.476, 34.97], [127.4761, 34.97], [127.4761, 34.9701], [127.476, 34.97]]]],
  footprintSource: "NGII 2025 orthophoto trace (estimated) + VR scene_d4",
  nameSource: "estimated: test fixture",
  estimated: true,
  confidence: 0.5,
  vrScenes: ["scene_d4"],
  registerName: null,
  ...overrides,
});

test(`every record in ${path.basename(FILE)} passes the schema and id checks`, () => {
  const data = JSON.parse(readFileSync(FILE, "utf8"));
  assert.ok(Array.isArray(data.buildings), "buildings must be an array");
  assert.ok(Array.isArray(data.sources) && data.sources.length > 0, "sources missing");
  assert.deepEqual(validateRecords(data.buildings), []);
});

test("an open ring is rejected", () => {
  const open = fixture({ polygons: [[[[127.476, 34.97], [127.4761, 34.97], [127.4761, 34.9701], [127.4762, 34.9702]]]] });
  assert.deepEqual(validateRecords([fixture()]), []);
  assert.ok(validateRecords([open]).some((e) => e.includes("ring 0 of polygon 0 is not closed")));
});

test("an id already used by uni.glb or the names table is rejected", () => {
  assert.ok(validateRecords([fixture({ nodeId: "BLD_D4" })]).some((e) => e.includes("collides with uni.glb BLD_D4")));
  const named = [...NAMED][0];
  assert.ok(validateRecords([fixture({ nodeId: named })]).some((e) => e.includes(`collides with scnu-building-names.json ${named}`)));
});
