// Land-cover classes stored in data/landcover.png (one byte per scene unit). Classes come from the
// MCEE level-3 land-cover map (fetch/landcover.mjs), with CHMv2 canopy height marking extra TREE
// cells (fetch/canopy.mjs).
import { readFileSync } from "node:fs";
import { sceneToTm } from "../../../src/geo/epsg5186.mjs";
import { splitByLine } from "./partition.mjs";

// The lane 8 curation manifest is the authoritative selection seed.
export const D4_MATERIAL_SCOPE = JSON.parse(readFileSync(new URL("../data/materials/d4-materials.json", import.meta.url), "utf8")).scopedBindings;

// Convex scene-space polygon, split exactly at the EPSG:5186 scope. Outside
// pieces retain their caller's material; no centroid-only boundary assignment.
export function splitD4GroundPolygon(polygon) {
  const [west, south, east, north] = D4_MATERIAL_SCOPE.bbox;
  const tm = polygon.map(p => sceneToTm(...p));
  if (tm.every(([e,n]) => e < west) || tm.every(([e,n]) => e > east) ||
      tm.every(([e,n]) => n < south) || tm.every(([e,n]) => n > north)) {
    return { inside: null, outside: [polygon] };
  }
  const outside = [];
  let inside = polygon;
  for (const line of [
    p => sceneToTm(...p)[0] - west, p => east - sceneToTm(...p)[0],
    p => sceneToTm(...p)[1] - south, p => north - sceneToTm(...p)[1],
  ]) {
    if (!inside) break;
    const parts = splitByLine(inside, line);
    if (parts.outside) outside.push(parts.outside);
    inside = parts.inside;
  }
  return { inside, outside };
}

export function d4NaturalTile(landcover) {
  return landcover === LANDCOVER.SOIL ? "d4-soil" : "d4-grass";
}

export const LANDCOVER = Object.freeze({
  PAVED: 0,
  GRASS: 1,
  TREE: 2,
  SOIL: 3,
  TRACK: 4,
  COURT: 5,
  WATER: 6,
});

// Canopy at or above this height (metres, CHMv2) counts as TREE whatever the MCEE class says.
export const CANOPY_TREE_METRES = 3;

// Georeference of data/chm.png (fetch/canopy.mjs writes the CHMv2 window CHM_WINDOW of tile
// 1321121212): EPSG:3857 metres of the top-left pixel corner and the pixel size, read from the tile's
// GeoTIFF header so the build needs no network access.
export const CHM_GEOREF = Object.freeze({ originX: 14190062.541359024, originY: 4160688.400347028, pixelSize: 1.19432856695596 });

// MCEE sports grounds (l3 622) at least this large are running tracks/fields; smaller ones are courts.
export const TRACK_MIN_AREA_M2 = 3000;

// MCEE level-3 code (l3_code) -> landcover class. areaM2 splits 622 into TRACK or COURT.
export function classFromMcee(l3Code, areaM2) {
  switch (String(l3Code)) {
    case "311":
    case "321":
    case "331":
      return LANDCOVER.TREE;
    case "423":
      return LANDCOVER.GRASS;
    case "622":
      return areaM2 >= TRACK_MIN_AREA_M2 ? LANDCOVER.TRACK : LANDCOVER.COURT;
    case "154":
      return LANDCOVER.PAVED;
    case "711":
    case "712":
      return LANDCOVER.WATER;
    case "623":
      return LANDCOVER.SOIL;
    default:
      return LANDCOVER.GRASS;
  }
}
