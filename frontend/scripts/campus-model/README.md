# Campus model generator

Builds `frontend/public/campus-v2.glb`, the campus model the Legacy dashboard loads
(`src/campusModelAsset.mjs`). The original `public/uni.glb` is kept unchanged; open the dashboard
with `?model=uni` to compare.

```bash
cd frontend
bun run model:build   # regenerate public/campus-v2.glb from committed inputs (no network)
bun run model:fetch   # refresh data/ (network; the land cover step needs VITE_VWORLD_API_KEY in the env or frontend/.env)
node --test src/campusModelAsset.test.mjs
```

## Layout

`build-campus-model.mjs` only sequences the stages, in this order:

| File | Role |
|---|---|
| `stages/sources.mjs` | uni.glb scene, heightfield, building footprints, GeoJSON layers, land cover |
| `stages/buildings.mjs` | building selection, facade/roof materials, building meshes and nodes |
| `stages/ground.mjs` | ground texture, ground material, Topography chunks, crosswalk stripes |
| `stages/trees.mjs` | species geometry, placement masks, instanced tree nodes |
| `lib/geometry.mjs` | plan-view ring helpers (area, centroid, point-in-ring, cleaning) |

## Inputs

| Input | Used for |
|---|---|
| `public/uni.glb` | terrain heights, original `BLD_*` node names and outlines |
| `data/gis-buildings.json` | building footprints (lon/lat) with `name`, `floors`, `undergroundFloors`, `heightMetres`, `areaMetres`, `usability`, `structure`, `approvalDate`, `pnu`, and per record `footprintSource` / `floorsSource` |
| `data/landcover.png` | ground classes (paved, grass, tree, soil, track, court) per scene unit, classified from VWorld satellite tiles |
| `docs/assets/data/road_zones_wgs84.geojson` | asphalt road surfaces |
| `docs/assets/data/walkways_wgs84.geojson` | paved walkways |
| `docs/assets/data/crosswalks_wgs84.geojson` | crosswalk stripes |

`fetch-sources.mjs` caches satellite tiles in `.cache/` (ignored by git); only the derived
`landcover.png` is committed. The API key is read at run time and never written to any output.

### Building footprints and heights

The intended source is 국토교통부 GIS건물통합정보 (data.go.kr 15083092, KOGL Type 1; VWorld catalog
`ds_id=20171128DS00010`, `AL_D010_46_*.zip`). Its file download needs a VWorld login, so
`fetch/buildings.mjs` can't fetch it, and no reader for it exists yet. Until it does,
`gis-buildings.json` comes from:

| Field | Source |
|---|---|
| footprints | © OpenStreetMap contributors, ODbL 1.0 (`api.openstreetmap.org/api/0.6/map` for the bbox). Buildings inside OSM's `amenity=university` campus polygon get the name prefix `순천대학교` |
| floors | SCNU campus registry floor directory (`POST w1.scnu.ac.kr/SCNU/campus/list.do`), only when it lists floors 1..N; else OSM `building:levels`; else none |
| height, structure, approval date | OSM `height`, `building:material`, `start_date` when tagged (none are tagged in the bbox today); `pnu` is empty |

The build data contains no VWorld records (`vworld-buildings.json` is no longer used). If
`gis-buildings.json` is missing, `stages/sources.mjs` falls back to a local, uncommitted
`vworld-buildings.json` with a warning. That fallback exists only for local development.

`model:fetch` logs one line per building with its OSM id and floors source. `model:build` logs
the footprint, floors and height source of every modelled building.

Height rule (`heightOf` in `stages/buildings.mjs`), giving the roof-slab height in metres:

- A source height is used when it gives 2.5-6.5 m per floor, or when floors are unknown.
- Otherwise height = floors x 4.4 m for SCNU buildings, or floors x 3.8 m for others. These are
  the medians of building-register height/floors in the bbox: 4.39 m over 26 SCNU buildings and
  3.76 m over 153 buildings. A building is SCNU when its name starts with `순천대학교` or its
  footprint touches a `BLD_*` outline.
- The minimum is 3.5 m. The 0.9 m parapet is added as geometry on top of flat roofs.
- A `BLD_*` node without floors keeps its `uni.glb` outline height. Other campus buildings
  without floors get the 3.5 m minimum.

All of these heights are estimates, not measurements. Node extras carry `heightSource`.

OSM outlines are traced from imagery and sit about 3 m off the cadastral frame of `uni.glb`.
The build shifts all footprints by the median centroid offset of one-to-one `BLD_*` matches and
logs the shift. A `BLD_*` node takes the OSM outline only when the matched area is within 15 %
of its `uni.glb` outline; otherwise it keeps the `uni.glb` outline, and `BLD_D4` always keeps it.

## What the model contains

- `BLD_*` nodes: every building id from `uni.glb`, rebuilt with estimated heights from floor
  counts (see above), procedural facades (concrete ribbon windows, brick, beige render, glass curtain wall,
  greenhouse), flat roofs with parapets and rooftop equipment, and window glow used at night.
  `BLD_D4` keeps its original outline because its bounding-box centre anchors the traffic frame.
- `CampusBuildings`: other university buildings from the footprint file (named `순천대학교`, or
  unnamed ones inside the campus next to a campus road). Off-campus buildings are left out; their lots are
  painted as plain ground.
- `Topography`: chunked terrain using `uni.glb`'s ground heights (structures in the old terrain
  mesh are filtered out), textured with land cover, roads, walkways and curbs.
- `Crosswalks`: zebra stripes from the crosswalk polygons.
- `Trees_*`: instanced broadleaf, round and pine trees placed by Poisson sampling over
  satellite tree cover, kept off buildings, roads and walkways.

## Frame

All geometry is in `uni.glb`'s scene frame (0.6242 units per metre, +x east, +z south). Footprint
and GeoJSON coordinates are shifted by the constant offset between the cadastral footprints and
`uni.glb` (see `lib/frame.mjs`), so the existing traffic simulation and `CityModel` recentering
stay aligned. `src/campusModelAsset.test.mjs` checks the building ids and that `BLD_D4` has not
moved.
