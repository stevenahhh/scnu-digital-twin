#!/usr/bin/env bun
// Ground parcel seed (plan campus-ground-truth-redesign todo 8, design §5): every class polygon network/surfaces.mjs
// buildSurfaces draws today becomes one parcel record in data/ground/parcels.json, ring for ring, in the same order, so
// the seed changes nothing on screen. The photo registration tables (data/photo/evidence/ground-registration.json, 17 facility moves;
// data/photo/evidence/a003-registration.json, 6 A003 corrections) are already applied by the loaders; seeding names them once in
// the parcel they moved (`source_ref`) and raises that parcel to evidence tier T1.
//
// Parcel: { id, cls, ring, holes, precedence, mesh, label, source, source_ref, evidence: { tier, refs }, paintAllowed,
// estimated, over? }. Rings are EPSG:5186 [E, N] rounded to 0.1 mm. `over` lists the earlier parcels of the
// same precedence this one is drawn over (draw order inside a precedence is the array order), so the validator can
// tell an intended layering from an accidental overlap.
//
//   bun scripts/campus-model/fit/parcelsSeed.mjs [--write] [--check] [--check-curation]   (--check: the committed file is
//   valid and its seeded parcels equal today's layers, every ring within 0.1 m2; --check-curation also rebuilds the
//   paint supports, paintExcluded and kerbLines and requires them unchanged; exits 1 naming the parcels that differ)
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { GROUND_REGISTRATION } from "../lib/groundRegistration.mjs";
import { A003_REGISTRATION } from "../lib/a003.mjs";
import { PAINT_CLASSES, SUPPORT_PRECEDENCE, designClass, paintViolations, supportParcels } from "../lib/parcels.mjs";
import { overlapPairs, validate } from "../lib/schemas.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PARCELS_FILE = path.join(HERE, "..", "data", "ground", "parcels.json");

// design §2: T0 survey/cadastre, T1 orthophoto measurement, T4 estimate. OSM gives existence, never geometry: T4.
const TIER = { "NGII-A003": "T0", "road-zone-measured": "T0", "OSM-derived": "T4", "project-estimated": "T4" };

// layer keys the parcel record carries itself; everything else (walkway, surface, paint, pattern, uvFrame, ...) is how
// the stage draws it and goes to `render` unchanged
const ROW_PARCEL_M = 0.3;
const OWN = new Set(["cls", "mesh", "label", "precedence", "source", "source_ref", "estimated", "rings"]);
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
    const render = Object.fromEntries(Object.entries(layer).filter(([k]) => !OWN.has(k)));
    const cls = designClass({ id, cls: layer.cls, mesh: layer.mesh, render });
    return {
      id,
      cls: layer.cls,
      class: cls,
      ring,
      holes,
      precedence: layer.precedence,
      mesh: layer.mesh,
      label: layer.label ?? null,
      source: layer.source,
      source_ref: fresh ? `${layer.source_ref}; registration ${corrections.join(", ")}` : layer.source_ref,
      evidence: { tier, refs: [layer.source_ref, ...(fresh ? corrections : [])].filter(Boolean) },
      // design §5: parking dividers and lane paint only inside lot or road parcels
      paintAllowed: PAINT_CLASSES.has(cls),
      estimated: tier === "T4" || layer.estimated === true,
      ...(Object.keys(render).length ? { render } : {}),
    };
  });
  return layerOver(parcels);
}

// same-precedence overlaps in draw order: the later parcel is drawn over the earlier one (recomputed for the whole list)
export function layerOver(parcels) {
  for (const p of parcels) delete p.over;
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

// Today's ground layers, built exactly as stages/ground.mjs built them before todo 9 (and their outlines).
export async function currentLayers() {
  return (await currentSurfaces()).layers;
}
export async function currentSurfaces() {
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
  });
}

// The road-marking pieces the build draws inside EXTENT (stages/markings.mjs + the parking rows), with the buildings they
// need: the input of the paint curation. Returns the parking plan too, for the row parcels. Row and line records prove
// the pavement under them, so their pieces count as detected paint here even where the divider itself is estimated.
export async function currentPaint() {
  const { loadInputs } = await import("../stages/sources.mjs");
  const { loadFurniture } = await import("../stages/furniture.mjs");
  const { buildBuildings } = await import("../stages/buildings.mjs");
  const { loadMarkings, inMarkingExtent } = await import("../stages/markings.mjs");
  const { loadParking, parkingPlan } = await import("../stages/parking.mjs");
  const { GlbBuilder } = await import("../lib/glb.mjs");
  const inputs = await loadInputs();
  const { selectableBuildings, campusBuildings } = await buildBuildings({ glb: new GlbBuilder(), inputs, detailedStructures: loadFurniture().detailedStructures });
  const markings = await loadMarkings({ inputs, buildings: [...selectableBuildings, ...campusBuildings] });
  const centre = (r) => r.reduce((a, q) => [a[0] + q[0] / r.length, a[1] + q[1] / r.length], [0, 0]);
  const doc = loadParking();
  const plan = parkingPlan(doc);
  const inside = (p) => inMarkingExtent(centre(p.rings[0]));
  return { doc, paint: markings.pieces.filter(inside), parking: plan.pieces.filter(inside).map((p) => ({ ...p, estimated: false })) };
}

// A parking row whose paint lies off road and lot parcels gets its own lot parcel: the row's footprint (0.3 m wider), under
// the A003 sidewalks like any lot, with the row as its evidence. This replaces the convex hulls of loose paint (todo 9) for
// stall paint.
export function parkingRowParcels(parking, pieces, parcels, toTm) {
  const badRecords = new Set(paintViolations(pieces, parcels, toTm).map((v) => v.piece.split("@")[0].split("/").slice(0, 2).join("/")));
  const out = [];
  for (const lot of parking.lots) {
    for (const row of lot.rows) {
      if (!badRecords.has(row.id)) continue;
      const [p, q] = row.backLine.abs;
      const length = Math.hypot(q[0] - p[0], q[1] - p[1]);
      const a = [(q[0] - p[0]) / length, (q[1] - p[1]) / length];
      const b = (row.dividerBearingDeg ?? 0) * (Math.PI / 180);
      const d = Number.isFinite(row.dividerBearingDeg) ? [Math.sin(b), Math.cos(b)] : [-a[1] * row.side, a[0] * row.side];
      const at = (s, t) => [mm(p[0] + a[0] * s + d[0] * t), mm(p[1] + a[1] * s + d[1] * t)];
      const [s0, s1, t0, t1] = [-ROW_PARCEL_M, length + ROW_PARCEL_M, -ROW_PARCEL_M, row.depthM + ROW_PARCEL_M];
      out.push({
        id: `PARCEL_${row.id.replace(/[^A-Z0-9]+/g, "_")}`, cls: "LOT", class: "lot", ring: [at(s0, t0), at(s1, t0), at(s1, t1), at(s0, t1)], holes: [], precedence: SUPPORT_PRECEDENCE.lot,
        mesh: "Ground_Lot", label: null, source: "parking-record", source_ref: `parking row ${row.id}`, evidence: { tier: row.evidence.tier, refs: [row.id] }, paintAllowed: true, estimated: true, curated: "todo 12",
      });
    }
  }
  return out;
}

// Seed + curation: the seeded parcels, a support parcel under photo-detected paint the seed left on natural ground or on
// an estimated paving parcel, the paint the photo shows on surveyed non-road ground listed in paintExcluded, and the
// open A003 kerb lines (outline cuts with no area) in kerbLines.
export async function curatedDoc(refs) {
  const { sceneToTm } = await import("../../../src/geo/epsg5186.mjs");
  const surfaces = await currentSurfaces();
  const seeded = seedParcels(surfaces.layers, refs);
  const { doc: parking, paint, parking: parkingPieces } = await currentPaint();
  const toTm = ([x, z]) => sceneToTm(x, z);
  const rowParcels = parkingRowParcels(parking, parkingPieces, seeded, toTm);
  const { parcels: supports, rejected } = supportParcels([...paint, ...parkingPieces], [...seeded, ...rowParcels], toTm);
  const parcels = layerOver([...seeded, ...rowParcels, ...supports]);
  return {
    note: "Ground parcel map (design §5): the one ground class map stages/ground.mjs, kerbs.mjs, tactile.mjs and surfaces.mjs read (plan campus-ground-truth-redesign todo 9). Seeded by fit/parcelsSeed.mjs from the network/surfaces.mjs layers in draw order (rings EPSG:5186 [E, N] metres, `render` = how the stage draws it, `class` = the design §5 class), then curated: PARCEL_LOT_*_R* records (source parking-record) lie under parking rows of data/ground/parking.json that the seed leaves off road and lot ground, PARCEL_SUPPORT_* records lie under photo-detected paint the seed left on natural ground or estimated paving (paint proves pavement), paintExcluded lists paint the photo shows on surveyed non-road ground (not drawn), kerbLines are the open A003 kerb lines. source_ref names the registration corrections (data/photo/evidence/ground-registration.json, a003-registration.json) applied to that parcel; tier T4 and support parcels are estimates (추정).",
    parcels,
    kerbLines: surfaces.outlines.filter((o) => !o.closed).map((o) => ({ ufid: o.ufid, surface: o.surface, line: o.line.map(([E, N]) => [mm(E), mm(N)]) })),
    paintExcluded: rejected.map((r) => r.piece),
    paintExcludedDetail: rejected,
  };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const refs = registrationRefs(JSON.parse(readFileSync(GROUND_REGISTRATION, "utf8")), JSON.parse(readFileSync(A003_REGISTRATION, "utf8")));
  // --check compares the seeded parcels with today's layers (no markings needed, runs on the lab); --write and
  // --check-curation also rebuild the paint curation, which needs the photo markings gate (Mac caches)
  const curate = args.includes("--write") || args.includes("--check-curation");
  const doc = curate ? await curatedDoc(refs) : { ...JSON.parse(readFileSync(PARCELS_FILE, "utf8")), parcels: seedParcels(await currentLayers(), refs) };
  const { parcels } = doc;
  const { ok, errors } = curate ? validate("parcels", doc) : { ok: true, errors: [] };
  const count = (key) => parcels.reduce((acc, p) => ({ ...acc, [p[key]]: (acc[p[key]] ?? 0) + 1 }), {});
  const tiers = parcels.reduce((acc, p) => ({ ...acc, [p.evidence.tier]: (acc[p.evidence.tier] ?? 0) + 1 }), {});
  console.log(`PARCELS ${JSON.stringify({ parcels: parcels.length, tiers, classes: count("class"), supports: parcels.filter((p) => p.source === "photo-paint-support").length, parkingRows: parcels.filter((p) => p.source === "parking-record").length, paintExcluded: doc.paintExcluded.length, kerbLines: doc.kerbLines.length, corrections: parcels.reduce((n, p) => n + (p.evidence.tier === "T1" && p.source !== "photo-paint-support" ? p.evidence.refs.length - 1 : 0), 0), layered: parcels.filter((p) => p.over).length, overEntries: parcels.reduce((n, p) => n + (p.over?.length ?? 0), 0), valid: ok })}`);
  for (const error of errors.slice(0, 20)) console.error(error);
  if (!ok) process.exit(1);
  if (args.includes("--check")) {
    // the committed file is valid and its seeded parcels (supports aside) still equal today's layers
    const committed = JSON.parse(readFileSync(PARCELS_FILE, "utf8"));
    const fileCheck = validate("parcels", committed);
    const curated = (p) => p.source === "photo-paint-support" || p.source === "parking-record";
    const seededOnly = (list) => list.filter((p) => !curated(p));
    const { errors: diffs, worst } = compareToLayers(seededOnly(committed.parcels), seededOnly(parcels).map((p) => ({ cls: p.cls, precedence: p.precedence, rings: [p.ring, ...p.holes] })));
    const raw = compareToLayers(seededOnly(committed.parcels), await currentLayers());
    const curation = !curate || JSON.stringify([committed.paintExcluded, committed.kerbLines, committed.parcels.filter(curated)]) === JSON.stringify([doc.paintExcluded, doc.kerbLines, parcels.filter(curated)]);
    console.log(`PARCELS CHECK ${JSON.stringify({ valid: fileCheck.ok, seedDiffs: diffs.length, layerDiffs: raw.errors.length, worstAreaDiffM2: Number(raw.worst.toExponential(3)), seedWorstM2: worst, curationCurrent: curate ? curation : "not checked" })}`);
    for (const e of [...fileCheck.errors, ...diffs, ...raw.errors].slice(0, 20)) console.error(e);
    if (!fileCheck.ok || diffs.length || raw.errors.length || !curation) process.exit(1);
  }
  if (args.includes("--write")) {
    await Bun.write(PARCELS_FILE, `${JSON.stringify(doc, null, 1)}\n`);
    console.log(`wrote ${PARCELS_FILE}`);
  }
}
