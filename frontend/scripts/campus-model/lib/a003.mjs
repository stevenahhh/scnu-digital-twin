// NGII A003 sidewalk outlines (docs/assets/data/walkways_wgs84.geojson, CC BY, kept as delivered) with the photo
// registration of data/photo/a003-registration.json applied: where the NGII 2025 orthophoto shows a kerb off the A003
// line, vertices are moved (`move`: original vertex indices, dE/dN metres in EPSG:5186) or a vertex is added on a
// straight segment (`insert`: after an original vertex index, at an absolute EPSG:5186 point). Every reader of the A003
// outlines (ground, kerbs, network, markings, lights, trees) goes through readA003 so they all see the same kerb.
// Corrected vertices are estimates (추정): the feature gets `registration` naming the entries applied.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { tmToWgs84, wgs84ToTm } from "../../../src/geo/epsg5186.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const A003_FILE = path.resolve(HERE, "../../../..", "docs", "assets", "data", "walkways_wgs84.geojson");
export const A003_REGISTRATION = path.join(HERE, "..", "data", "photo", "a003-registration.json");

const shifted = ([lon, lat], dE, dN) => {
  const [E, N] = wgs84ToTm(lon, lat);
  return tmToWgs84(E + dE, N + dN);
};

// fc: the A003 FeatureCollection; registration: { corrections: [...] }. Returns a new FeatureCollection.
export function applyRegistration(fc, registration) {
  const byUfid = new Map();
  for (const c of registration?.corrections ?? []) {
    if (!byUfid.has(c.ufid)) byUfid.set(c.ufid, []);
    byUfid.get(c.ufid).push(c);
  }
  const used = new Set();
  const features = fc.features.map((f) => {
    const list = byUfid.get(f.properties?.ufid);
    if (!list) return f;
    const multi = f.geometry.type === "MultiLineString";
    const lines = (multi ? f.geometry.coordinates : [f.geometry.coordinates]).map((line) => line.map((p) => [...p]));
    for (const c of list.filter((x) => x.op === "move")) {
      const line = lines[c.line];
      for (const i of c.vertices) {
        if (!line?.[i]) throw new Error(`a003-registration ${c.id}: ${c.ufid} line ${c.line} has no vertex ${i}`);
        line[i] = shifted(line[i], c.dE, c.dN);
      }
      used.add(c.id);
    }
    for (const c of list.filter((x) => x.op === "insert").sort((a, b) => b.after - a.after)) {
      const line = lines[c.line];
      if (!line?.[c.after + 1]) throw new Error(`a003-registration ${c.id}: ${c.ufid} line ${c.line} has no segment after vertex ${c.after}`);
      line.splice(c.after + 1, 0, tmToWgs84(c.E, c.N));
      used.add(c.id);
    }
    return {
      ...f,
      properties: { ...f.properties, registration: list.map((c) => c.id) },
      geometry: { ...f.geometry, coordinates: multi ? lines : lines[0] },
    };
  });
  const unused = (registration?.corrections ?? []).filter((c) => !used.has(c.id));
  if (unused.length) throw new Error(`a003-registration: ${unused.map((c) => c.id).join(", ")} name no A003 feature`);
  return { ...fc, features };
}

export function readA003(file = A003_FILE, registrationFile = A003_REGISTRATION) {
  return applyRegistration(JSON.parse(readFileSync(file, "utf8")), JSON.parse(readFileSync(registrationFile, "utf8")));
}
