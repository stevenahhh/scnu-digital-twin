# Campus model generator

Builds `frontend/public/campus-v2.glb`, the campus model the Legacy dashboard loads
(`src/campusModelAsset.mjs`). The original `public/uni.glb` is kept unchanged; open the dashboard
with `?model=uni` to compare.

```bash
cd frontend
bun run model:build   # regenerate public/campus-v2.glb from committed inputs (no network)
bun run model:fetch   # refresh data/ (network + VITE_VWORLD_API_KEY in the env or frontend/.env)
node --test src/campusModelAsset.test.mjs
```

## Layout

`build-campus-model.mjs` only sequences the stages, in this order:

| File | Role |
|---|---|
| `stages/sources.mjs` | uni.glb scene, heightfield, VWorld buildings, GeoJSON layers, land cover |
| `stages/buildings.mjs` | building selection, facade/roof materials, building meshes and nodes |
| `stages/ground.mjs` | ground texture, ground material, Topography chunks, crosswalk stripes |
| `stages/trees.mjs` | species geometry, placement masks, instanced tree nodes |
| `lib/geometry.mjs` | plan-view ring helpers (area, centroid, point-in-ring, cleaning) |

## Inputs

| Input | Used for |
|---|---|
| `public/uni.glb` | terrain heights, original `BLD_*` node names and outlines |
| `data/vworld-buildings.json` | VWorld `LT_C_BLDGINFO` footprints, floor counts, heights |
| `data/landcover.png` | ground classes (paved, grass, tree, soil, track, court) per scene unit, classified from VWorld satellite tiles |
| `docs/assets/data/road_zones_wgs84.geojson` | asphalt road surfaces |
| `docs/assets/data/walkways_wgs84.geojson` | paved walkways |
| `docs/assets/data/crosswalks_wgs84.geojson` | crosswalk stripes |

`fetch-sources.mjs` caches satellite tiles in `.cache/` (ignored by git); only the derived
`landcover.png` is committed. The API key is read at run time and never written to any output.

## What the model contains

- `BLD_*` nodes: every building id from `uni.glb`, rebuilt with real VWorld heights and floor
  counts, procedural facades (concrete ribbon windows, brick, beige render, glass curtain wall,
  greenhouse), flat roofs with parapets and rooftop equipment, and window glow used at night.
  `BLD_D4` keeps its original outline because its bounding-box centre anchors the traffic frame.
- `CampusBuildings`: other university buildings from VWorld (named `순천대학교`, or unnamed ones
  inside the campus next to a campus road). Off-campus buildings are left out; their lots are
  painted as plain ground.
- `Topography`: chunked terrain using `uni.glb`'s ground heights (structures in the old terrain
  mesh are filtered out), textured with land cover, roads, walkways and curbs.
- `Crosswalks`: zebra stripes from the crosswalk polygons.
- `Trees_*`: instanced broadleaf, round and pine trees placed by Poisson sampling over
  satellite tree cover, kept off buildings, roads and walkways.

## Frame

All geometry is in `uni.glb`'s scene frame (0.6242 units per metre, +x east, +z south). VWorld
and GeoJSON coordinates are shifted by the constant offset between the cadastral footprints and
`uni.glb` (see `lib/frame.mjs`), so the existing traffic simulation and `CityModel` recentering
stay aligned. `src/campusModelAsset.test.mjs` checks the building ids and that `BLD_D4` has not
moved.
