# Campus model generator

Builds `frontend/public/campus-v2.glb`, the campus model the Legacy dashboard loads
(`src/campusModelAsset.mjs`). The original `public/uni.glb` is kept unchanged; open the dashboard
with `?model=uni` to compare.

```bash
cd frontend
bun run model:build   # regenerate public/campus-v2.glb from committed inputs (no network)
bun run model:fetch   # refresh data/ (network; the land cover step needs VITE_VWORLD_API_KEY in the env or frontend/.env)
bun scripts/campus-model/fetch/osm.mjs   # refresh data/osm-ground.json (network, no key)
node --test src/campusModelAsset.test.mjs
```

## Layout

`build-campus-model.mjs` only sequences the stages, in this order:

| File | Role |
|---|---|
| `stages/sources.mjs` | uni.glb scene, heightfield, building footprints, GeoJSON layers, land cover |
| `stages/buildings.mjs` | building selection, facade/roof materials, building meshes and nodes |
| `stages/ground.mjs` | ground texture (land cover, ground features from `osm-ground.json`), ground material, Topography chunks, crosswalk stripes |
| `stages/trees.mjs` | species geometry, placement masks, CHMv2-driven placement, instanced tree nodes |
| `lib/geometry.mjs` | plan-view ring helpers (area, centroid, point-in-ring, cleaning) |

## Inputs

| Input | Used for |
|---|---|
| `public/uni.glb` | terrain heights, original `BLD_*` node names and outlines |
| `data/gis-buildings.json` | building footprints (lon/lat) with `name`, `floors`, `undergroundFloors`, `heightMetres`, `areaMetres`, `usability`, `structure`, `approvalDate`, `pnu`, and per record `footprintSource` / `floorsSource` |
| `data/landcover.png` | ground classes (paved, grass, tree, soil, track, court) per scene unit, classified from VWorld satellite tiles |
| `data/chm.png` | CHMv2 canopy height (8-bit metres); tree placement and crown sizes |
| `data/osm-ground.json` | ground features painted into the texture (see below) |
| `docs/assets/data/road_zones_wgs84.geojson` | asphalt road surfaces |
| `docs/assets/data/walkways_wgs84.geojson` | paved walkways |
| `docs/assets/data/crosswalks_wgs84.geojson` | crosswalk stripes |

`fetch-sources.mjs` caches satellite tiles in `.cache/` (ignored by git); only the derived
`landcover.png` is committed. The API key is read at run time and never written to any output.

### Ground features (`data/osm-ground.json`)

`fetch/osm.mjs` writes one JSON file with three sections, each under its own licence:

| Section | Source | Licence | Painted as |
|---|---|---|---|
| `osm` | OpenStreetMap `api.openstreetmap.org/api/0.6/map` for the bbox (split into quadrants if the API refuses the area): `leisure=stadium/track/pitch/sports_centre/playground`, `sport=*`, surface `amenity=parking`, `area:highway`, `highway=pedestrian` + `area=yes`, `place=square`, `natural=water`, `landuse=basin` | ODbL 1.0, © OpenStreetMap contributors | ponds (water with a stone rim), plazas (2 m pavers), parking (asphalt with 2.5 x 5 m bay lines); pitches only where no MCEE outline covers them; the stadium selects the track outline |
| `facilities` | MCEE `lv3_2025y` class 141 (문화·체육·휴양시설) polygons, same WFS and cache as the land cover | KOGL Type 1 | the running track (8 lanes of 1.22 m with lane lines, red D-zones, football pitch with markings) fitted to the outline inside the OSM stadium; courts and the plaza's oval lawn where a label applies |
| `supplements` | project-authored | - | surface labels (which MCEE outline is the basketball, futsal, multi or tennis court, or the oval lawn), estimated circles for the red roundabout of the central intersection and the plaza fountain, which neither source maps, a `reclass` that paints the OSM pond west of the stadium (way 367126960, a sunken lawn on current imagery) as lawn, and three estimated rows of car-park bays along the access road west of the stadium (no `amenity=parking` there in OSM) |

The supplement positions and sizes are estimates. Replace them once OSM maps those features.

`osm.lines` (same OSM licence) holds open ways for the arterial east of the campus (Jungang-ro, outside the
measured road zones): `arterial` centrelines (`highway=trunk/primary/secondary`), `connector` side roads that
share a node with an arterial, and marked `crossing` ways. The ground stage paints the arterial as asphalt
between the nearest measured A003 walkways on each side, with an estimated marking layout (yellow centre line,
dashed lanes every 3.25 m); junction mouths are traced until they meet a road zone; marked crossings on that
asphalt become 4 m zebra crossings in the `Crosswalks` mesh (width estimated).

### Trees

`Trees_*` instances follow CHMv2 canopy cover: crowns are centred on unblocked cells whose canopy
height is at least 3 m (`CANOPY_TREE_METRES`), in random order. Each crown gets an estimated radius
of 1 + 0.25 x the local canopy height (2-5.5 m) and keeps its mean radius (`CROWN_SPACING` 1.0) from
the others. `model:build` logs how much of the canopy the crowns cover and fails above 12,000
instances. The broadleaf, round and pine archetypes and their mix are unchanged.

### Building footprints and heights

`gis-buildings.json` is built from 국토교통부 GIS건물통합정보 (data.go.kr 15083092, KOGL Type 1; VWorld
catalog `ds_id=20171128DS00010`). Its download needs a VWorld login, so place the zip by hand in
`.cache/gis/` (gitignored), e.g. `.cache/gis/AL_D010_12_20261009.zip` (code 12 = 전남광주통합특별시,
both shapefile sets in it are read). `model:fetch` then runs `fetch/gis_buildings.py` through
`uv run --no-project --with pyproj==3.8.0` (needs `uv` on PATH). The helper streams the shapefiles
straight from the zip, transforms EPSG:5186 (from the `.prj`) to EPSG:4326, and keeps buildings whose
every vertex lies inside the bbox (lon 127.4715-127.4880, lat 34.9640-34.9765). The newest
`AL_D010_*.zip` in `.cache/gis/` is used. The output is byte-identical across runs for the same zip
and the same OSM/registry responses.

| Field | Source (zip present) |
|---|---|
| footprints | GIS건물통합정보 shape; `footprintSource` = `GIS건물통합정보 <shp> record <n>` |
| `name` | DBF `A24` 건물명 + `A25` 동명. Buildings named 순천대학교, on the same PNU as one, or inside OSM's `amenity=university` polygon get the prefix `순천대학교`, plus the SCNU registry code (e.g. `D4`) when a registry point falls inside the footprint |
| `floors` / `undergroundFloors` | `A26` 지상층수 / `A27` 지하층수; where `A26` is missing, the SCNU registry floor directory (`floorsSource` = `SCNU registry <code>`), else none |
| `heightMetres` | `A16` 높이 (building-register value; 0 when blank or overflowed) |
| `usability`, `structure`, `approvalDate`, `pnu` | `A9` 주용도, `A11` 구조, `A13` 사용승인일, `A2` PNU |
| `areaMetres` | area of the footprint polygon (not the register's `A12` 건축면적) |
| buildings GIS lacks | OSM footprint when less than 30 % of it lies under GIS footprints (sampled on a 1 m grid); `footprintSource` = `OSM way/<id> (not in GIS건물통합정보)`, floors as in the OSM fallback |

Without the zip, `model:fetch` falls back to OSM for every footprint:

| Field | Source (no zip) |
|---|---|
| footprints | © OpenStreetMap contributors, ODbL 1.0 (`api.openstreetmap.org/api/0.6/map` for the bbox). Buildings inside OSM's `amenity=university` campus polygon get the name prefix `순천대학교` |
| floors | SCNU campus registry floor directory (`POST w1.scnu.ac.kr/SCNU/campus/list.do`), only when it lists floors 1..N; else OSM `building:levels`; else none |
| height, structure, approval date | OSM `height`, `building:material`, `start_date` when tagged (none are tagged in the bbox today); `pnu` is empty |

The build data contains no VWorld records (`vworld-buildings.json` is no longer used). If
`gis-buildings.json` is missing, `stages/sources.mjs` falls back to a local, uncommitted
`vworld-buildings.json` with a warning. That fallback exists only for local development.

`model:fetch` logs one line per building with its footprint and floors source, then the totals.
`model:build` logs the footprint, floors and height source of every modelled building.

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

OSM outlines are traced from imagery and sit about 3 m off the cadastral frame of `uni.glb`;
GIS건물통합정보 outlines follow the cadastral frame. The build shifts all footprints by the median centroid offset of one-to-one `BLD_*` matches and
logs the shift. A `BLD_*` node takes the OSM outline only when the matched area is within 15 %
of its `uni.glb` outline; otherwise it keeps the `uni.glb` outline, and `BLD_D4` always keeps it.

### SCNU building names (`data/scnu-building-names.json`)

The register names in GIS건물통합정보 (`A24`/`A25`) are often missing on campus or attached to the wrong
footprint (for example "41동 학생생활관(진리관)" on the C2 친환경농업센터 footprint). A curated table,
keyed by `footprintSource`, sets the name of every SCNU record. `fetch/scnuNames.mjs` applies it
(`model:fetch` does so automatically; `bun scripts/campus-model/fetch/scnuNames.mjs` re-applies an
edited table to the committed `gis-buildings.json`). Every record in `gis-buildings.json` then has a
`nameSource`, and the SCNU records also have `status`, `label`, `nodeId` and the original `registerName`.

Name order: an SCNU registry point (`w1.scnu.ac.kr/SCNU/campus/list.do`) inside the footprint, or
within 2 m of it; then an OSM building name; then VWorld `LT_C_SPBD` `buld_nm_dc` or `LT_C_BLDGINFO`
`dong_nm`; then the register name. Registry matches cite the SCNU 360 VR tour scene that has the
same code (`vr.scnu.ac.kr/360vr/tour.xml`, `scene_<code>`; visual reference only, nothing links to
it). A small structure with none of these names is named after the building it serves, from the
VWorld z19 imagery (for example "B6 제1중앙공급실 부속 시설"); such names have a `nameSource` starting
with `estimated:`, and their labels end in `(추정)`.

`status`:

| Status | Meaning | Build |
|---|---|---|
| `standing` | named, visible on current imagery | modelled; the name labels a selectable node |
| `unresolved` | visible, no name from any source | modelled, no label (listed in the table with its centroid) |
| `demolished` | absent from the VWorld z19 imagery and the VR tour (car park west of B7, the B7 site, the old 학군단 lot, lawns) | not modelled |

Named campus buildings stay merged in `CampusBuildings` for drawing. Each one also gets a pick
proxy: a root node `BLD_SCNU_<registry code>`, or `BLD_SCNU_R<GIS record>` / `BLD_SCNU_W<OSM way>`
when there is no code or the name is an estimate. The proxy holds a plain prism of the footprint in
the `Pick_Proxy` material, with extras `pickProxy`, `label` and `nameSource`. The dashboard keeps
proxies invisible, so they add no draw calls. Raycasts still hit them, so clicking one or its label
selects it, and a selected or hovered proxy shows as a translucent highlight. The ids never reuse a
`uni.glb` or `common_elemetns.json` `BLD_*` id. A footprint that a `uni.glb` `BLD_*` node already
covers gets no proxy. That node keeps its own label. Records under 12 m² are not modelled.

## What the model contains

- `BLD_*` nodes: every building id from `uni.glb`, rebuilt with estimated heights from floor
  counts (see above), procedural facades (concrete ribbon windows, brick, beige render, glass curtain wall,
  greenhouse), flat roofs with parapets and rooftop equipment, and window glow used at night.
  `BLD_D4` keeps its original outline because its bounding-box centre anchors the traffic frame.
- `CampusBuildings`: other university buildings from the footprint file (named `순천대학교`, or
  unnamed ones inside the campus next to a campus road). Off-campus buildings are left out; their lots are
  painted as plain ground.
- `Topography`: chunked terrain using `uni.glb`'s ground heights (structures in the old terrain
  mesh are filtered out), textured with land cover, roads, walkways, curbs and the ground features above (track,
  courts, plazas, parking, ponds, roundabout).
- `Crosswalks`: zebra stripes from the crosswalk polygons.
- `Trees_*`: instanced broadleaf, round and pine trees placed over CHMv2 canopy (see Trees above),
  kept off buildings, roads and walkways.

## Frame

All geometry is in `uni.glb`'s scene frame (0.6242 units per metre, +x east, +z south). Footprint
and GeoJSON coordinates are shifted by the constant offset between the cadastral footprints and
`uni.glb` (see `lib/frame.mjs`), so the existing traffic simulation and `CityModel` recentering
stay aligned. `src/campusModelAsset.test.mjs` checks the building ids and that `BLD_D4` has not
moved.
