# Campus model generator

Builds `frontend/public/campus-v2.glb`, the campus model the Legacy dashboard loads
(`src/campusModelAsset.mjs`). The original `public/uni.glb` is kept unchanged; open the dashboard
with `?model=uni` to compare.

```bash
cd frontend
bun run model:build   # regenerate public/campus-v2.glb from committed inputs (no network)
bun run model:fetch   # refresh data/ (network; the land cover step needs VITE_VWORLD_API_KEY in the env or frontend/.env)
bun scripts/campus-model/fetch/osm.mjs   # refresh data/osm-ground.json (network, no key)
bun scripts/campus-model/fetch/ortho.mjs # refresh data/ortho/ (VWorld z19 mosaic; the key is needed only for tiles missing from .cache/)
bun scripts/campus-model/fetch/lod4Facades.mjs [--debug <dir>] # refresh data/lod4-facades.json (keyless VWorld LOD4 tiles, cached in .cache/lod4/)
node --test src/campusModelAsset.test.mjs
```

## Layout

`build-campus-model.mjs` only sequences the stages, in this order:

| File | Role |
|---|---|
| `stages/sources.mjs` | uni.glb scene, heightfield, building footprints, GeoJSON layers, land cover |
| `stages/buildings.mjs` | building selection, floor/height corrections, facade looks and cells, tower masses, roof colours and solar panels from the orthophoto, building meshes and nodes |
| `stages/ground.mjs` | procedural ground layer (land cover, ground features from `osm-ground.json`), the orthophoto laid over it, ground material, Topography chunks, crosswalk stripes |
| `stages/trees.mjs` | `placeTrees` (placement masks, CHMv2-driven placement; runs before the ground) and `buildTrees` (species geometry, instanced tree nodes) |
| `lib/geometry.mjs` | plan-view ring helpers (area, centroid, point-in-ring, cleaning) |
| `lib/ortho.mjs` | the VWorld z19 mosaic in `data/ortho/` and its Web Mercator frame |
| `lib/orthoGround.mjs` | orthophoto ground composition and the photo colour calibration (see Orthophoto ground) |
| `lib/facadeAtlas.mjs` | the facade atlas: one painted tile per facade look, its emissive, normal and metallic-roughness maps (see Facades) |
| `lib/textures.mjs` | roof membrane and rooftop-equipment textures, and the detail-map builder the facade atlas shares |
| `lib/roofPhoto.mjs` | roof colour sampling and solar-panel detection (see Roof colours and solar panels) |

## Inputs

| Input | Used for |
|---|---|
| `public/uni.glb` | terrain heights, original `BLD_*` node names and outlines |
| `data/gis-buildings.json` | building footprints (lon/lat) with `name`, `floors`, `undergroundFloors`, `heightMetres`, `areaMetres`, `usability`, `structure`, `approvalDate`, `pnu`, and per record `footprintSource` / `floorsSource` |
| `data/landcover.png` | ground classes (paved, grass, tree, soil, track, court) per scene unit, from MCEE land cover and CHMv2 canopy |
| `data/ortho/vworld-satellite-z19.jpg` + `.json` | VWorld Satellite z19 tile mosaic (Web Mercator, 3584 x 2816 px, about 0.245 m/px) and its tile range: ground albedo, roof colours, solar panels |
| `data/chm.png` | CHMv2 canopy height (8-bit metres); tree placement and crown sizes |
| `data/scnu-facades.json` | curated facade looks (class, colours, window layout, piers, bands, entrance, eave colour) and per-building entries: look, floor/height corrections, tower masses, entrance side (see Facades) |
| `data/lod4-facades.json` | per SCNU footprint: the VWorld LOD4 models over it, their facade palette, wall height and roof levels with outlines (fetch/lod4Facades.mjs) |
| `data/osm-ground.json` | ground features painted into the texture (see below) |
| `docs/assets/data/road_zones_wgs84.geojson` | asphalt road surfaces |
| `docs/assets/data/walkways_wgs84.geojson` | paved walkways |
| `docs/assets/data/crosswalks_wgs84.geojson` | crosswalk stripes |

`fetch/ortho.mjs` (also run by `fetch-sources.mjs`) caches the z19 WMTS tiles over EXTENT in `.cache/`
(ignored by git) and writes them, unresampled, into the committed mosaic `data/ortho/`. VWorld data is
stored and baked by the project owner's consent of 2026-10-24 (D1 in `docs/data-licences.md`; attribution
`출처: 브이월드`, also written to the GLB's `asset.extras.orthophoto`). The API key is read at run time and
never written to any output.

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

### Orthophoto ground (`lib/orthoGround.mjs`)

The `Topography` texture is the VWorld z19 orthophoto resampled into the scene frame: 3276 x 2457 px over
EXTENT, 0.2465 m per texel (`PX` 6.5 in `stages/ground.mjs`; `pack.mjs` caps textures at 4096 px so it
keeps that size, about 0.76 MB as WebP). The procedural ground above (land cover, walkways, roads, ground
features) is still painted, at the same resolution, and every pixel records the surface class it was painted
as (natural ground, light paving, asphalt, painted sports surfaces, off-campus lots). The photo replaces it
everywhere except where the photo would double what the model draws itself:

- under every modelled footprint plus a margin of 0.6 m + 3 % of the building's height (roof edges and
  facades lean outward in the photo);
- under a modelled tree crown (+0.4 m) in the open, and wherever the photo shows vegetation on a surface
  painted as paving or asphalt (street trees over roads, walkways and plazas, where the model has no tree).
  Inside groves (crowns cover at least 60 % of the ground within 8 m) the photo canopy stays, so the gaps
  between modelled crowns look like canopy;
- the photo's cast shadows on open ground (taken in the morning, shadows fall west-north-west; the
  dashboard casts its own for its clock) are relit, grown by 2 px over the penumbra.

A filled pixel takes the local mean photo colour of its surface class around it (5 m, then 20 m, then the
whole raster) times the procedural layer's luminance detail; a relit shadow pixel takes the same lit colour
times the photo's own high-pass luminance, so markings inside a shadow survive. Edges are feathered over
2 px. Off-campus lots keep the photo. Colour: a white balance from bright, nearly grey pixels (membranes
read cyan in the mosaic) and a lift of the linear value by the power 1/1.5 towards albedo (the mosaic
crushes mid-tones; lawn 0.17, asphalt 0.20, paving 0.27, white membranes 0.77 after the lift). The mean
albedo of the photo ground (linear 0.25) matches the procedural ground it replaces (0.24). The build logs
the share of each fill. All of it is an estimate derived from imagery, not a measured albedo.

### Roof colours and solar panels (`lib/roofPhoto.mjs`)

Every modelled roof is sampled in the orthophoto every 0.25 m inside its footprint, 1 m clear of the
outline. Samples in cast shadow, on photovoltaic modules (dark slate blue in this mosaic) or under tree
crowns (green and rough, unlike a smooth painted green roof) are left out; the roof colour is the
per-channel median of the rest, calibrated like the ground. A roof with fewer than 30 % usable samples
(hidden by crowns, in shadow, outside the mosaic) keeps the light membrane unless an OSM roof tag
(`data/osm-roof-tags.json`) colours it. Every roof, `BLD_*` nodes and the merged `CampusBuildings` roof alike,
carries its colour as `COLOR_0` on the one `Roof_Membrane` material, so no roof adds a draw call or a material.
(`BLD_*` roofs had their own `Roof_Photo_<rgb>` material variants until 2026-10-24. The dashboard tints material
colours at night and on hover, which mixes a material's colour towards the tint but multiplies a vertex colour by
it, so the vertex-coloured campus roofs rendered darker than `BLD_*` roofs of the same colour.) Node extras carry `roofColour`,
`roofSurface` (light, grey, dark, green) and `roofColourSource`.

Solar panels: the panel samples of each footprint part are gridded along its longest edge (1.5 m + 3 % of
the height clear of the outline, which drops glazed facades leaning in), closed and opened by one cell and
split into components; a component counts as an array when it is at least 12 m2, 1.2 m thick, fills 45 %
of its box, borders shadow on at most 30 % of its rim (deep-shadow fringes read slate blue too), and is
clearly blue, or textured by a module grid, or one of at least three rows. Arrays are tiled with 1.0 x
1.65 m modules (ASSUMED 60-cell size) tilted 15 degrees towards the roof axis closest to south, 0.35 m above
the slab. Modules live in the `Roof_Equipment` primitive: its material is an atlas (`equipmentAtlas` in
`lib/textures.mjs`) whose left half is the old plain plant metal and whose right half is a module (dark
blue cells, roughness 0.2; aluminium frame), so panels add no draw call; they reuse the roof's AO chart.
`PANEL_REVIEW` in `stages/buildings.mjs` lists roofs whose detected modules were rejected by eye on the
mosaic (BLD_D4 and BLD_D2: glazed skylights and wing ends; BLD_B3: facade and gutter shade along the north
parapet). Node extras carry `solarPanelModules`. Module positions, counts, tilt
and size are estimates.

### Trees

`Trees_*` instances follow CHMv2 canopy cover: crowns are centred on unblocked cells whose canopy
height is at least 3 m (`CANOPY_TREE_METRES`), in random order. Each crown gets an estimated radius
of 1 + 0.25 x the local canopy height (2-5.5 m) and keeps its mean radius (`CROWN_SPACING` 1.0) from
the others. `model:build` logs how much of the canopy the crowns cover and fails above 12,000
instances. The broadleaf, round and pine archetypes and their mix are unchanged.

### Facades (`data/scnu-facades.json`, `lib/facadeAtlas.mjs`)

Every wall of every building is drawn with one material, `Facade_Atlas`. Its colour texture (2048 px wide, as
tall as the looks in use need) holds one tile per facade look, four bays wide and four storey rows tall: two
upper-storey rows with the same colours and different lit windows, the ground storey with a plinth band, and the
ground storey with an entrance in its middle two bays. The emissive (window glow), normal and metallic-roughness
maps are at half resolution. A wall edge holds a whole number of bays (its length over the look's bay, the bay
stretched to fit) and a mass its whole number of storeys (its floor count), so the window rows follow the floors.
Every cell of up to four bays and one storey maps into one row of the tile, so the texture never wraps; the tile's
8 px gutters repeat its own content for filtering. Upper cells pick a row and an orientation at random, for
lit-window variety at night. The entrance is on the wall facing the entry's `entranceBearing`, else on the
longest wall; buildings with an entry get a 2.2 m canopy slab over the doors. The parapet takes the look's eave
colour per vertex (`COLOR_0`), so tiled and painted eaves cost no material. `CampusBuildings` draws all its walls
with one primitive.

Looks are curated per building from the SCNU 360 VR tour panoramas (`vr.scnu.ac.kr/360vr`, `scene_<code>`;
viewed as a visual reference only, nothing is copied or linked) and checked against the VWorld LOD4 facade
photos. A look gives the pattern (punched windows, ribbon windows, curtain wall, greenhouse), the wall texture
(brick, render, panel, concrete, stone, metal), wall, trim, glass, frame and spandrel colours, window size and count
per bay, piers, floor bands, accent spandrels or window surrounds, a glazed ground storey, entrance canopy and sign
colours, and the eave colour. Buildings without an entry take the greenhouse look (온실), the annex look
(부속 시설, `(추정)` or under 150 m²) or a plain render look. Colours, window layouts and canopies are estimates, not
measurements. Node extras carry `facadeLook`, `facadeClass` and `facadeSource`.

`fetch/lod4Facades.mjs` walks the keyless VWorld 3D Tiles tileset `facility_LOD4/Jeollanam-do/Suncheon-si` to its
finest b3dm tiles over the SCNU footprints (cached in `.cache/lod4/`, gitignored) and decodes each model
(CESIUM_RTC centre, WEB3D_quantized_attributes positions). Most textures are Crunch-compressed; crnlib as built
for Cesium 1.80 (zlib licence) is fetched once from unpkg into the cache to transcode them and is never committed.
Per footprint it writes the models, the colour modes of the wall texels, the wall height and the roof levels with
their outlines. `--debug <dir>` writes unrolled facade images (perimeter x height, 0.25 m/px) for inspection.
Stored and used under consent D1 (`출처: 브이월드`).

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

- A curated entry in `data/scnu-facades.json` wins. On campus the register attributes of GIS건물통합정보 sit on
  the wrong footprints: C2 carried 41동 진리관's 12 floors and 35.7 m, C3 40동 창조관's 11 floors and 32.3 m, A6
  4동 정보전산원's 4 floors, A2 37동 공동실험실습관's 6 floors, and E2, E6 and E8 each other's. VWorld
  `LT_C_BLDGINFO` names the building each register record belongs to (`dong_nm`), so the entries take floors and
  height from the record with the building's own name, checked against the VWorld LOD4 roof levels
  (`data/lod4-facades.json`) and the VR views. `model:build` lists every correction.
- A source height is used when it gives 2.5-5 m per floor (2.5-6.5 m until 2026-10-24; the build logs what the
  old limit would have given), or when floors are unknown.
- Otherwise height = floors x 4.4 m for SCNU buildings, or floors x 3.8 m for others. These are
  the medians of building-register height/floors in the bbox: 4.39 m over 26 SCNU buildings and
  3.76 m over 153 buildings. A building is SCNU when its name starts with `순천대학교` or its
  footprint touches a `BLD_*` outline.
- The minimum is 3.5 m. The 0.9 m parapet is added as geometry on top of flat roofs.
- A `BLD_*` node without floors keeps its `uni.glb` outline height. Other campus buildings
  without floors get the 3.5 m minimum.
- An entry's `tower` adds a taller mass on the part: the convex hull of the named VWorld LOD4 roof levels,
  clipped to the footprint, standing on the part's roof (A1 대학본부, 8 floors on a 3-floor podium; A5 진리관, 12
  floors on the 2-floor A4 annex; A6 창조관, 11 floors on 6). The podium's parapet leaves out the stretches under
  the tower. `useRecordFootprint` lets a `uni.glb` node take the register footprint around it when its own outline
  leaves most of the building out (BLD_A4, whose outline missed the 진리관 tower).

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
  counts (see above), per-building facade looks on the facade atlas (see Facades), tower masses where VWorld
  LOD4 shows one, flat roofs with parapets in the eave colour, rooftop equipment, roof colours from the
  orthophoto and the solar panels it shows (estimates), and window glow used at night.
  `BLD_D4` keeps its original outline because its bounding-box centre anchors the traffic frame.
- `CampusBuildings`: other university buildings from the footprint file (named `순천대학교`, or
  unnamed ones inside the campus next to a campus road). Off-campus buildings are left out; their lots are
  painted as plain ground.
- `Topography`: chunked terrain using `uni.glb`'s ground heights (structures in the old terrain
  mesh are filtered out), textured with the VWorld z19 orthophoto at 0.2465 m per texel, with the procedural
  layer (land cover, roads, walkways, curbs and the ground features above) filling in under buildings and
  tree crowns (see Orthophoto ground).
- `Crosswalks`: zebra stripes from the crosswalk polygons.
- `Trees_*`: instanced broadleaf, round and pine trees placed over CHMv2 canopy (see Trees above),
  kept off buildings, roads and walkways.

## Frame

All geometry is in `uni.glb`'s scene frame (0.6242 units per metre, +x east, +z south). Footprint
and GeoJSON coordinates are shifted by the constant offset between the cadastral footprints and
`uni.glb` (see `lib/frame.mjs`), so the existing traffic simulation and `CityModel` recentering
stay aligned. `src/campusModelAsset.test.mjs` checks the building ids and that `BLD_D4` has not
moved.
