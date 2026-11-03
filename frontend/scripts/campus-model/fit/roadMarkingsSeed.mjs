// One-way migration: accepted evidence -> explicit, editable road-local records.
// The campus builder never imports this estimator or its photographic inputs.
import { sceneToTm, tmToScene } from "../../../src/geo/epsg5186.mjs";
import { add, dot, norm, projectArc, scale, sub, unit } from "../lib/markingFit.mjs";
import { frameAt } from "../stages/roadMarkings.mjs";
import { SCENE_UNITS_PER_METRE as U } from "../lib/frame.mjs";
import { strokePath } from "../stages/markingsRegular.mjs";

// Extract dimensions/control curves, not pre-triangulated mesh polygons.
// Template pieces share one construction, so a 40-piece word stays one word.
export function evidencePrimitives(pieces) {
  const seen = new Set(), out = [];
  for (const [i, p] of pieces.entries()) {
    if (p.construction) {
      if (seen.has(p.construction)) continue;
      seen.add(p.construction);
      out.push({ ...p.construction, kind: p.kind, colour: p.colour, legacyId: p.id, glyph: p.glyph });
      continue;
    }
    if (p.kind === "text" || p.kind.startsWith("arrow")) throw new Error(`${p.kind}: missing template construction`);
    const ring = p.rings[0];
    let centre = ring.reduce((a, q) => add(a, scale(q, 1 / ring.length)), [0, 0]);
    let forward = [0, 1], shape;
    if (p.rings.length === 1 && ring.length === 4) {
      const a = sub(ring[1], ring[0]), b = sub(ring[2], ring[1]);
      const opposite = norm(sub(add(ring[0], ring[2]), add(ring[1], ring[3])));
      if (norm(a) > 1e-8 && norm(b) > 1e-8 && Math.abs(dot(unit(a), unit(b))) < 1e-7 && opposite < 1e-7) {
        forward = unit(a);
        shape = { type: "rectangle", lengthM: norm(a) / U, widthM: norm(b) / U };
      }
    }
    if (!shape && p.rings.length === 1 && ring.length % 2 === 0) {
      const n = ring.length / 2;
      const path = ring.slice(0, n).map((q, k) => scale(add(q, ring[2 * n - 1 - k]), 0.5));
      const width = norm(sub(ring[0], ring.at(-1)));
      const reconstructed = strokePath(path, width / 2);
      if (reconstructed?.length === ring.length && reconstructed.every((q, k) => norm(sub(q, ring[k])) < 1e-7)) {
        centre = path[0];
        forward = unit(sub(path.at(-1), path[0]));
        const across = [-forward[1], forward[0]];
        shape = { type: "stroke", widthM: width / U, path: path.map(q => [dot(sub(q, centre), across) / U, dot(sub(q, centre), forward) / U]) };
      }
    }
    if (!shape) {
      // Only shaped paint regions reach this case: clipped hump bands, hatch
      // outlines and coloured surface patches. Their boundary is an editable
      // road-local region, not a sampled photo texture or a stored GLB mesh.
      shape = { type: "region", boundary: p.rings.map(r => r.map(q => [-(q[0] - centre[0]) / U, (q[1] - centre[1]) / U])) };
    }
    out.push({ centre, forward, shape, kind: p.kind, colour: p.colour, legacyId: p.id,
      refs: [`accepted fitted paint ${p.id ?? `${p.kind}/${i}`} from photo/evidence/markings.geojson + markings-extra.geojson`],
      tier: p.estimated ? "T4" : "T1" });
  }
  return out;
}

export function seedRoadMarkings(primitives, humpRecords, context) {
  const sections = {}, junctions = {};
  const linear = new Set(["centre_line_yellow", "lane_line_solid", "lane_line_dashed", "edge_line", "kerb_no_parking", "speed_bump"]);
  for (const [index, p] of [...primitives, ...humpRecords].entries()) {
    const point = sceneToTm(...p.centre);
    let nearest = null;
    for (const segment of context.segments) for (const [pathIndex, path] of segment.paths.entries()) {
      // Persist a station just inside the path, so Node/V8 and Bun/JSC's
      // one-ULP hypot difference cannot put an endpoint past its own length.
      // The sub-micrometre remainder is retained in alongOffsetM below.
      const atM = Math.min(Math.round(projectArc(path.line, point) * 1e6) / 1e6, Math.floor(path.lengthM * 1e6) / 1e6);
      const frame = frameAt(path.line, atM, segment.id);
      const distance = norm(sub(point, frame.centre));
      if (!nearest || distance < nearest.distance) nearest = { segment, pathIndex, path, atM, frame, distance };
    }
    if (!nearest) throw new Error("road marking seed: no road paths");
    const { segment, pathIndex, path, atM, frame, distance } = nearest;
    const delta = sub(point, frame.centre);
    const centre = tmToScene(...point);
    const roadDirection = unit(sub(tmToScene(...add(point, frame.forward)), centre));
    const record = {
      id: `${segment.id}/mark/${String(index).padStart(4, "0")}`,
      order: index,
      association: { role: "coordinate-reference-only", verified: false, distanceM: distance },
      atM, lateralOffsetM: dot(delta, [-frame.forward[1], frame.forward[0]]),
      alongOffsetM: dot(delta, frame.forward),
      yawRad: Math.atan2(p.forward[1], p.forward[0]) - Math.atan2(roadDirection[1], roadDirection[0]),
      shape: p.shape, kind: p.kind, colour: p.colour,
      ...(p.legacyId ? { legacyId: p.legacyId } : {}), ...(p.glyph ? { glyph: p.glyph } : {}),
      estimated: true,
      evidence: { tier: p.tier ?? "T1", refs: p.refs },
      reason: `Accepted evidence seed; nearest road association ${distance.toFixed(3)} m is estimated, not curated connectivity.`,
    };
    if (!sections[segment.id]) sections[segment.id] = { sections: segment.paths.map((path, i) => ({
      pathIndex: i, fromM: 0, toM: path.lengthM,
      paintSource: "details", absenceAssessed: false,
      lanes: [{ dir: "fwd", widthM: segment.widthM || 6 }],
      centre: { type: "none", widthM: 0.15 }, edges: { left: "none", right: "none" },
      lateralOffsetM: 0, kerbOffsetsM: { left: (segment.widthM || 6) / 2, right: (segment.widthM || 6) / 2 },
      kerbNoParking: { left: false, right: false }, humps: [], details: [],
      estimated: true, evidence: { tier: "T4", refs: [`road_segments ${segment.id}`] },
      reason: "Migration seed; marking-specific fitted geometry retained as road-local details until section curation.",
    })) };
    if (linear.has(p.kind) || p.shape.type === "hump") sections[segment.id].sections[pathIndex].details.push(record);
    else {
      const node = [...context.junctionPoints].sort((a, b) => norm(sub(a.point, point)) - norm(sub(b.point, point)))[0];
      if (!node) throw new Error(`${record.id}: no junction node`);
      junctions[node.id] ??= { approaches: [] };
      const end = atM < path.lengthM / 2 ? "from" : "to";
      let approach = junctions[node.id].approaches.find(a => a.segment === segment.id && a.pathIndex === pathIndex && a.end === end);
      if (!approach) {
        approach = { segment: segment.id, pathIndex, end, stopLineSetbackM: null, crossing: null,
          arrows: [], text: [], humps: [], signalArms: [], yieldTriangles: [], guideLines: [], details: [],
          evidence: { tier: "T4", refs: [`road_segments ${segment.id}; transport node ${node.id}`] },
          estimated: true, reason: "Nearest junction association is a migration estimate; local paint geometry is retained." };
        junctions[node.id].approaches.push(approach);
      }
      approach.details.push(record);
    }
  }
  return { sections, junctions };
}

if (import.meta.main) {
  const { readFileSync, writeFileSync } = await import("node:fs");
  const { loadInputs } = await import("../stages/sources.mjs");
  const { buildBuildings } = await import("../stages/buildings.mjs");
  const { loadFurnitureSurvey } = await import("../stages/furniture.mjs");
  const { buildGround } = await import("../stages/ground.mjs");
  const { GlbBuilder } = await import("../lib/glb.mjs");
  const { loadMarkings } = await import("./markingEvidence.mjs");
  const { buildHumps, loadSpeedBumps } = await import("./humpEvidence.mjs");
  const { roadContext } = await import("../lib/roadSections.mjs");
  const { EXTENT } = await import("../lib/frame.mjs");
  const { SURFACE_CLASS } = await import("../lib/surfaceClass.mjs");
  const inputs = await loadInputs();
  const glb = new GlbBuilder();
  const { selectableBuildings, campusBuildings } = await buildBuildings({ glb, inputs, detailedStructures: loadFurnitureSurvey().detailedStructures });
  const evidence = await loadMarkings({ inputs, buildings: [...selectableBuildings, ...campusBuildings] });
  const { groundInfo } = await buildGround({ glb, inputs });
  const humps = buildHumps({ features: await loadSpeedBumps(), onRoad: ([x, z]) => {
    const i = Math.floor((x - EXTENT.minX) * groundInfo.px), j = Math.floor((z - EXTENT.minZ) * groundInfo.px);
    return i >= 0 && j >= 0 && i < groundInfo.width && j < groundInfo.height &&
      [SURFACE_CLASS.ASPHALT, SURFACE_CLASS.LOT].includes(groundInfo.labels[j * groundInfo.width + i]);
  } });
  const primitives = evidencePrimitives(evidence.pieces);
  const humpRecords = humps.humps.map(h => ({
    centre: h.centre, forward: h.u, shape: { type: "hump", lengthM: 3.6, heightM: 0.1, widthM: h.widthM },
    kind: "speed_bump", colour: "yellow", legacyId: h.id, refs: [`photo/evidence/markings-extra.geojson ${h.id}`], tier: "T4",
  }));
  const docs = seedRoadMarkings(primitives, humpRecords, roadContext());
  for (const [name, doc] of [["road-sections", docs.sections], ["junctions", docs.junctions]]) {
    const file = new URL(`../data/ground/${name}.json`, import.meta.url);
    const text = `${JSON.stringify(doc, null, 2)}\n`;
    if (process.argv.includes("--check")) {
      if (readFileSync(file, "utf8") !== text) throw new Error(`${name}: seed is stale`);
    } else if (process.argv.includes("--write")) writeFileSync(file, text);
    else throw new Error("pass --write or --check");
  }
  console.log(`ROAD_SEED ${JSON.stringify({ pieces: evidence.pieces.length, records: primitives.length, humps: humpRecords.length,
    shapes: Object.fromEntries([...new Set(primitives.map(p => p.shape.type))].map(t => [t, primitives.filter(p => p.shape.type === t).length])) })}`);
}
