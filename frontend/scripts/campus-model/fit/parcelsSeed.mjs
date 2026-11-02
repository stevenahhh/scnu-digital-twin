#!/usr/bin/env bun
// Ground parcel seed (plan campus-ground-truth-redesign todo 8, design §5): every class polygon network/surfaces.mjs
// buildSurfaces draws today becomes one parcel record in data/ground/parcels.json, ring for ring, in the same order, so
// W1 changes nothing on screen. The photo registration tables (data/photo/ground-registration.json, 17 facility moves;
// data/photo/a003-registration.json, 6 A003 corrections) are already applied by the loaders; seeding names them once in
// the parcel they moved (`source_ref`) and raises that parcel to evidence tier T1.
//
// Parcel: { id, cls, ring, holes, precedence, mesh, label, source, source_ref, evidence: { tier, refs }, paintAllowed,
// estimated, over? }. Rings are EPSG:5186 [E, N] rounded to 0.1 mm. `over` lists the earlier parcels of the
// same precedence this one is drawn over (draw order inside a precedence is the array order), so the validator can
// tell an intended layering from an accidental overlap.
//
//   bun scripts/campus-model/fit/parcelsSeed.mjs [--write] [--check]   (--check: the committed file is valid and equals
//   today's layers, every ring within 0.1 m2; exits 1 naming the parcels that differ)
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { GROUND_REGISTRATION } from "../lib/groundRegistration.mjs";
import { A003_REGISTRATION } from "../lib/a003.mjs";
import { overlapPairs, validate } from "../lib/schemas.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PARCELS_FILE = path.join(HERE, "..", "data", "ground", "parcels.json");

// design §2: T0 survey/cadastre, T1 orthophoto measurement, T4 estimate. OSM gives existence, never geometry: T4.
const TIER = { "NGII-A003": "T0", "road-zone-measured": "T0", "OSM-derived": "T4", "project-estimated": "T4" };
// design §5: parking dividers and lane paint only inside lot or road parcels.
const PAINT = new Set(["LOT", "ASPHALT"]);

const mm = (v) => Math.round(v * 1e4) / 1e4; // 0.1 mm: millimetres alone move a long rim ring by 0.27 m2
const slug = (text) => text.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 48).toUpperCase() || "X";

// registration tables -> Map(parcel source_ref -> [correction ids]): facility moves name the MCEE facility layer, A003
// corrections the walkway ufid (the layer source_ref buildSurfaces writes for each).
export function registrationRefs(groundRegistration, a003Registration) {
  const refs = new Map();
  const push = (key, id) => refs.set(key, [...(refs.get(key) ?? []), id]);
  for (const c of groundRegistration?.corrections ?? []) if (c.target === "facility") push(`MCEE class-141 facility ${c.index}`, c.id);
  for (const c of a003Registration?.corrections ?? []) push(c.ufid, c.id);
  return refs;
}

// layers: buildSurfaces().layers (rings in EPSG:5186); refs: registrationRefs(). Returns parcel records.
export function seedParcels(layers, refs = new Map()) {
  const used = new Map();
  const recorded = new Set();
  const parcels = layers.map((layer) => {
    const base = `PARCEL_${layer.cls}_${slug(layer.source_ref ?? layer.source)}`;
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    const id = n === 1 ? base : `${base}_${n}`;
    const corrections = refs.get(layer.source_ref) ?? [];
    // a correction is recorded once: in the first parcel drawn from the corrected outline
    const fresh = corrections.length && !recorded.has(layer.source_ref);
    if (fresh) recorded.add(layer.source_ref);
    const [ring, ...holes] = layer.rings.map((r) => r.map(([E, N]) => [mm(E), mm(N)]));
    const tier = fresh ? "T1" : TIER[layer.source] ?? "T4";
    return {
      id,
      cls: layer.cls,
      ring,
      holes,
      precedence: layer.precedence,
      mesh: layer.mesh,
      label: layer.label ?? null,
      source: layer.source,
      source_ref: fresh ? `${layer.source_ref}; registration ${corrections.join(", ")}` : layer.source_ref,
      evidence: { tier, refs: [layer.source_ref, ...(fresh ? corrections : [])].filter(Boolean) },
      paintAllowed: PAINT.has(layer.cls),
      estimated: tier === "T4" || layer.estimated === true,
    };
  });
  // same-precedence overlaps in today's draw order: the later parcel is drawn over the earlier one
  for (const [i, j] of overlapPairs(parcels)) (parcels[j].over ??= []).push(parcels[i].id);
  return parcels;
}

const ringArea = (ring) => Math.abs(ring.reduce((a, [x, y], i) => { const [u, v] = ring[(i + 1) % ring.length]; return a + x * v - u * y; }, 0)) / 2;

// parcels vs layers, in order: errors (id-named) and the largest ring area difference in m2.
export function compareToLayers(parcels, layers, toleranceM2 = 0.1) {
  const errors = [];
  let worst = 0;
  if (parcels.length !== layers.length) errors.push(`parcels: ${parcels.length} parcels, ${layers.length} current layers`);
  parcels.slice(0, layers.length).forEach((parcel, i) => {
    const rings = [parcel.ring, ...parcel.holes];
    if (rings.length !== layers[i].rings.length) return errors.push(`${parcel.id}: ${rings.length} rings, layer has ${layers[i].rings.length}`);
    if (parcel.cls !== layers[i].cls || parcel.precedence !== layers[i].precedence) errors.push(`${parcel.id}: class/precedence differ from layer ${i}`);
    rings.forEach((ring, k) => {
      const diff = Math.abs(ringArea(ring) - ringArea(layers[i].rings[k]));
      worst = Math.max(worst, diff);
      if (ring.length !== layers[i].rings[k].length || diff > toleranceM2) errors.push(`${parcel.id}: ring ${k} differs (${ring.length} vs ${layers[i].rings[k].length} vertices, area diff ${diff.toFixed(4)} m2)`);
    });
  });
  return { errors, worst };
}

// Today's ground layers, built exactly as stages/ground.mjs builds them.
export async function currentLayers() {
  const { buildSurfaces, loadEstimatedWalkways, loadGroundFeatures, loadWalkways } = await import("../network/surfaces.mjs");
  const { loadInputs } = await import("../stages/sources.mjs");
  const { loadFurniture } = await import("../stages/furniture.mjs");
  const { buildBuildings } = await import("../stages/buildings.mjs");
  const { GlbBuilder } = await import("../lib/glb.mjs");
  const inputs = await loadInputs();
  const { selectableBuildings, campusBuildings, offCampusLots } = await buildBuildings({ glb: new GlbBuilder(), inputs, detailedStructures: loadFurniture().detailedStructures });
  return buildSurfaces({
    inputs,
    walkways: await loadWalkways(),
    groundFeatures: await loadGroundFeatures(),
    offCampusLots,
    buildings: [...selectableBuildings, ...campusBuildings],
    crosswalks: inputs.crosswalks,
    estimatedWalkways: (await loadEstimatedWalkways()).strips,
    warn: () => {},
  }).layers;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const refs = registrationRefs(JSON.parse(readFileSync(GROUND_REGISTRATION, "utf8")), JSON.parse(readFileSync(A003_REGISTRATION, "utf8")));
  const layers = await currentLayers();
  const parcels = seedParcels(layers, refs);
  const doc = {
    note: "Ground parcel map (design §5), seeded by fit/parcelsSeed.mjs from network/surfaces.mjs buildSurfaces layers in draw order, rings EPSG:5186 [E, N] in metres. Not yet read by any stage (W1 seed). source_ref names the registration corrections (ground-registration.json, a003-registration.json) applied to that parcel; tier T4 parcels are estimates (추정).",
    parcels,
  };
  const { ok, errors } = validate("parcels", doc);
  const tiers = parcels.reduce((acc, p) => ({ ...acc, [p.evidence.tier]: (acc[p.evidence.tier] ?? 0) + 1 }), {});
  console.log(`PARCELS ${JSON.stringify({ parcels: parcels.length, tiers, corrections: parcels.reduce((n, p) => n + (p.evidence.tier === "T1" ? p.evidence.refs.length - 1 : 0), 0), layered: parcels.filter((p) => p.over).length, valid: ok })}`);
  for (const error of errors.slice(0, 20)) console.error(error);
  if (!ok) process.exit(1);
  if (args.includes("--check")) {
    const committed = JSON.parse(readFileSync(PARCELS_FILE, "utf8"));
    const fileCheck = validate("parcels", committed);
    const { errors: diffs, worst } = compareToLayers(committed.parcels, parcels.map((p) => ({ cls: p.cls, precedence: p.precedence, rings: [p.ring, ...p.holes] })));
    const raw = compareToLayers(committed.parcels, layers);
    console.log(`PARCELS CHECK ${JSON.stringify({ valid: fileCheck.ok, seedDiffs: diffs.length, layerDiffs: raw.errors.length, worstAreaDiffM2: Number(raw.worst.toExponential(3)), seedWorstM2: worst })}`);
    for (const e of [...fileCheck.errors, ...diffs, ...raw.errors].slice(0, 20)) console.error(e);
    if (!fileCheck.ok || diffs.length || raw.errors.length) process.exit(1);
  }
  if (args.includes("--write")) {
    await Bun.write(PARCELS_FILE, `${JSON.stringify(doc, null, 1)}\n`);
    console.log(`wrote ${PARCELS_FILE}`);
  }
}
