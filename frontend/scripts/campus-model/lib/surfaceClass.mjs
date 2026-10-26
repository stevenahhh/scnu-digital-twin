// Surface classes of the ground label raster (network/surfaces.mjs `labelRaster`, kept in groundInfo.labels): the lamp
// rule in stages/lights.mjs reads ASPHALT from it. Values 0-4 are the classes the old procedural ground raster wrote and
// keep their meaning; 5-8 were added with the modelled ground (plan uhf-ground-roads-routing todo 8).
export const SURFACE_CLASS = Object.freeze({
  NATURAL: 0,
  PAVING: 1,
  ASPHALT: 2,
  PAINTED: 3,
  LOT: 4,
  BICYCLE: 5,
  SPORTS: 6,
  KERB: 7,
  TACTILE: 8,
});
