// Land-cover classes stored in data/landcover.png (one byte per scene unit). Classes come from the
// MCEE level-3 land-cover map (fetch/landcover.mjs), with CHMv2 canopy height marking extra TREE
// cells (fetch/canopy.mjs).
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
