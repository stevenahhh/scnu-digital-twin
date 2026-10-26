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
bun scripts/campus-model/fetch/buildingForms.mjs [--keep <dir>] # refresh data/building-forms.json (LOD4 tiles + the NGII sheet in .cache/ngii-ortho/; needs uv)
node --test src/campusModelAsset.test.mjs
```

## Layout

`build-campus-model.mjs` only sequences the stages, in this order:

| File | Role |
|---|---|
| `stages/sources.mjs` | uni.glb scene, heightfield, building footprints, GeoJSON layers, land cover |
| `stages/buildings.mjs` | building selection, floor/height corrections, building forms (masses, courtyards, raised parts, pitched roofs; see Building forms), facade looks and cells, tower masses, roof colours and solar panels from the orthophoto, building meshes and nodes |
| `stages/markings.mjs` | road markings: both photo marking files merged (corrections applied), each candidate checked against the surveyed ground and the paint gate (`data/photo/markings-gate.json`), duplicates removed, estimated crossings where canopy hides the paint, and the `Road_Markings` decal mesh on the Topography triangles (see Road markings) |
| `stages/ground.mjs` | the class polygons of the modelled ground (`network/surfaces.mjs`), the surface-class label raster the lamp rule reads, the natural Ground material, Topography chunks and the surface the decals and markings lie on (`topographySurface`) (see Modelled ground) |
| `stages/surfaces.mjs` | the `Ground_*` decal meshes (asphalt, pavers, lots, aprons, painted sports/water surfaces) on the Topography triangles with CC0 tiles and world-planar UVs (see Modelled ground) |
| `stages/trees.mjs` | `placeTrees` (placement masks, CHMv2-driven placement; runs before the ground) and `buildTrees` (species geometry, instanced tree nodes) |
| `stages/furniture.mjs` | `loadFurniture` (the surveyed outdoor objects and the footprints trees keep out of; runs before the trees) and `buildFurniture` (the merged `Furniture` / `Furniture_Glass` nodes and the estimated benches; runs after the ground) (see Street furniture) |
| `stages/lights.mjs` | `placeLamps` (surveyed lamps plus estimated ones along the walkway outlines), `buildLights` (`Lamps_heads`, `Lamps_pools`) and the lamp poles drawn into `Furniture` |
| `lib/solids.mjs` | the solid-modelling kit the furniture and lamps share (boxes, beams, poles, prisms, cones; flat-shaded, oriented by geometry) |
| `lib/geometry.mjs` | plan-view ring helpers (area, centroid, point-in-ring, cleaning) |
| `lib/ortho.mjs` | the VWorld z19 mosaic in `data/ortho/`, its Web Mercator frame, the photo colour calibration and the vegetation/shadow tests (roof colours and the markings checks only) |
| `lib/conform.mjs` | splits flat decal triangles along the Topography grid so markings and ground layers follow the terrain |
| `lib/surfaceClass.mjs` | the surface classes of the ground label raster |
| `network/surfaces.mjs` | the ground class polygons in EPSG:5186 with precedence and provenance, and the label raster (`--stats`, `--preview <png>`) |
| `lib/facadeAtlas.mjs` | the facade atlas: one painted tile per facade look, its emissive, normal and metallic-roughness maps (see Facades) |
| `lib/textures.mjs` | roof membrane and rooftop-equipment textures, and the detail-map builder the facade atlas shares |
| `lib/roofPhoto.mjs` | roof colour sampling and solar-panel detection (see Roof colours and solar panels) |

## Inputs

| Input | Used for |
|---|---|
| `public/uni.glb` | terrain heights, original `BLD_*` node names and outlines |
| `data/gis-buildings.json` | building footprints (lon/lat) with `name`, `floors`, `undergroundFloors`, `heightMetres`, `areaMetres`, `usability`, `structure`, `approvalDate`, `pnu`, and per record `footprintSource` / `floorsSource` |
| `data/landcover.png` | ground classes (paved, grass, tree, soil, track, court) per scene unit, from MCEE land cover and CHMv2 canopy |
| `data/ortho/vworld-satellite-z19.jpg` + `.json` | VWorld Satellite z19 tile mosaic (Web Mercator, 3584 x 2816 px, about 0.245 m/px) and its tile range: roof colours, solar panels and the road-marking photo checks only (never baked into the ground) |
| `data/materials/ground-*.webp` + `ground-materials.json` | CC0 ground tiles (Poly Haven, ambientCG; colour, OpenGL normal, ARM) with their physical sizes: the `Ground_*` and Ground materials |
| `data/chm.png` | CHMv2 canopy height (8-bit metres); tree placement and crown sizes |
| `data/scnu-facades.json` | curated facade looks (class, colours, window layout, piers, bands, entrance, eave colour) and per-building entries: look, floor/height corrections, tower masses, entrance side (see Facades) |
| `data/lod4-facades.json` | per SCNU footprint: the VWorld LOD4 models over it, their facade palette, wall height and roof levels with outlines (fetch/lod4Facades.mjs) |
| `data/building-forms.json` | per modelled campus building: its masses (outer and courtyard rings, base and top heights, parapet, roof type and pitched-roof triangles, columns), voids, relief lean and photo IoU, from the VWorld LOD4 meshes and the NGII 2025 orthophoto (fetch/buildingForms.mjs; see Building forms) |
| `data/osm-ground.json` | ground features drawn as class polygons (see below) |
| `docs/assets/data/road_zones_wgs84.geojson` | asphalt road surfaces |
| `docs/assets/data/walkways_wgs84.geojson` | A003 sidewalk outlines (closed rings along kerb and back edge, some open lines): paved areas and kerbs |
| `docs/assets/data/crosswalks_wgs84.geojson` | digitised crosswalk polygons: only where a crossing the photo shows no zebra for gets estimated bars |
| `data/photo/markings.geojson`, `markings-extra.geojson` | painted road markings traced from the NGII 2025 orthophoto, detection and completion pass (see `data/photo/README.md`): the `Road_Markings` mesh |
| `data/photo/markings-gate.json` | paint support of every marking candidate on the NGII sheet and the chip-review verdicts (`bake/markings-gate.mjs`; see Road markings) |
| `data/photo/objects-campus.geojson` | outdoor objects surveyed on the NGII 2025 orthophoto over every tile of EXTENT (see `data/photo/README.md`): street lamps, signals, signs, walls, fences, planters, benches, shelters, pergolas, gazebos, the stands and the 구령대, sports equipment, the footbridge and the plaza structures (see Street furniture) |

`fetch/ortho.mjs` (also run by `fetch-sources.mjs`) caches the z19 WMTS tiles over EXTENT in `.cache/`
(ignored by git) and writes them, unresampled, into the committed mosaic `data/ortho/`. VWorld data is
stored by the project owner's consent of 2026-10-24 (D1 in `docs/data-licences.md`; attribution `출처: 브이월드`)
and read only for the roof colours and the markings checks; no mosaic pixel is baked into the ground. The API key is
read at run time and never written to any output.

### Ground features (`data/osm-ground.json`)

`fetch/osm.mjs` writes one JSON file with three sections, each under its own licence:

| Section | Source | Licence | Painted as |
|---|---|---|---|
| `osm` | OpenStreetMap `api.openstreetmap.org/api/0.6/map` for the bbox (split into quadrants if the API refuses the area): `leisure=stadium/track/pitch/sports_centre/playground`, `sport=*`, surface `amenity=parking`, `area:highway`, `highway=pedestrian` + `area=yes`, `place=square`, `natural=water`, `landuse=basin` | ODbL 1.0, © OpenStreetMap contributors | ponds (water with a stone rim), plazas (2 m pavers), parking (asphalt with 2.5 x 5 m bay lines); pitches only where no MCEE outline covers them; the stadium selects the track outline |
| `facilities` | MCEE `lv3_2025y` class 141 (문화·체육·휴양시설) polygons, same WFS and cache as the land cover | KOGL Type 1 | the running track (8 lanes of 1.22 m with lane lines, red D-zones, football pitch with markings) fitted to the outline inside the OSM stadium; courts and the plaza's oval lawn where a label applies |
| `supplements` | project-authored | - | surface labels (which MCEE outline is the basketball, futsal, multi or tennis court, or the oval lawn), circles for the red roundabout of the central intersection (estimated centre, radius 10.7 m fitted to its painted rim on the NGII 2025 orthophoto) and the plaza fountain (estimated), which neither source maps, a `reclass` that paints the OSM pond west of the stadium (way 367126960, a sunken lawn on current imagery) as lawn, and three estimated rows of car-park bays along the access road west of the stadium (no `amenity=parking` there in OSM) |

The supplement positions and sizes are estimates. Replace them once OSM maps those features.

`osm.lines` (same OSM licence) holds open ways for the arterial east of the campus (Jungang-ro, outside the
measured road zones): `arterial` centrelines (`highway=trunk/primary/secondary`), `connector` side roads that
share a node with an arterial, and marked `crossing` ways. The ground stage paints the arterial as plain asphalt
between the nearest measured A003 walkways on each side; junction mouths are traced until they meet a road zone.
Its lane lines, centre lines and crossings are the photo's own (see Road markings). The OSM crossing ways lie up
to 3 m off the painted zebras at the main gate, so they only decide where an estimated crossing goes.

### Modelled ground (`network/surfaces.mjs`, `stages/surfaces.mjs`)

No photo pixel is baked into the ground (plan uhf-ground-roads-routing todo 10; the former orthophoto composite is
gone). The ground is vector polygons in EPSG:5186, each with a precedence, a source (`NGII-A003`, `road-zone-measured`,
`OSM-derived`, `project-estimated`) and a source reference (A003 `ufid`, OSM way id, road-zone index):

| Precedence | Class | Mesh | Polygons |
|---|---|---|---|
| 0 | natural | `Topography` | the whole EXTENT: land-cover colour map (0.5 m/texel) under the CC0 grass relief tile |
| 1 | painted | `Ground_Sports` | OSM pitches, the MCEE facility outlines with their project surface labels, the running track, water |
| 2 | paving | `Ground_Pavers` / `Ground_Apron` | OSM plazas; stone rims of water, lawn facilities and the fountain |
| 3 | asphalt | `Ground_Asphalt` | the 96 road zones and the arterial/connector strips traced from the OSM centrelines to the surveyed edges |
| 4 | lot | `Ground_Lot` | OSM parking, the estimated supplement bays, off-campus lots; the roundabout over the road |
| 5 (5.5) | A003 | `Ground_Pavers` / `Ground_Asphalt` (`Ground_Bicycle`) | the 42 closed A003 walkway rings by `qual`/`scls` (the bicycle lanes are open outlines only, so no red lane polygon yet) |
| 6 | apron | `Ground_Apron` | the 2.2 m band centred on every building outline |

There are no polygon booleans: `stages/surfaces.mjs` conforms every polygon to the Topography triangles
(`lib/conform.mjs`) and lifts it 0.006 m per precedence step (at most 0.036 m, under the markings' 0.04 m), and
CityModel adds a polygon offset by the material's `extras.polygonOffsetRank`, smaller than the markings' own. The
materials are CC0 tiles (`data/materials/ground-materials.json`) on world-planar UVs that repeat every physical tile
size in EPSG:5186 metres, with the ground AO on TEXCOORD_1; painted surfaces get a per-surface texture at 0.05 m/texel
(track lanes, court and pitch lines 0.10 m wide). The same polygons, plus the 0.3 m edge-stone band on every A003
outline, are rasterised into the surface-class label raster (`groundInfo`) the lamp rule reads. Every albedo, relief
and roughness is an estimate (`extras.estimated`), and `asset.extras.ground.photoPixelsBaked` is `false`. After a
ground geometry change, re-bake the ground AO: `bun scripts/campus-model/bake/bake-ao.mjs --planar`.

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
- Otherwise height = floors x a storey median. There is no storey constant: `storeyMedians` derives the
  medians at build time from the GIS건물통합정보 records (`gis-buildings.json`) that have both a height and a
  floor count and 2.5-5 m per floor, grouped by use: `dormitory` (use or name matches 공동주택, 기숙사, 생활관 or
  관사), `education` (use 교육연구시설) and `other`. A class with fewer than 5 records takes the `other`
  median. With the committed data: education 4.08 m (n = 27), dormitory 3.3 m (n = 29), other 3.95 m
  (n = 487); `model:build` logs them as `storey medians: ...`. SCNU buildings use the education median, or
  the dormitory median when their name says dormitory; other buildings use the other median. A building is
  SCNU when its name starts with `순천대학교` or its footprint touches a `BLD_*` outline.
- The minimum is 3.5 m. The 0.9 m parapet is added as geometry on top of flat roofs.
- A `BLD_*` node without floors keeps its `uni.glb` outline height. Other campus buildings
  with neither a height nor floors get an assumed storey count (6 for dormitories, 3 for SCNU buildings, 1
  otherwise) x their class median.
- An entry's `tower` adds a taller mass on the part: the convex hull of the named VWorld LOD4 roof levels,
  clipped to the footprint, standing on the part's roof (A1 대학본부, 8 floors on a 3-floor podium; A5 진리관, 12
  floors on the 2-floor A4 annex; A6 창조관, 11 floors on 6). The podium's parapet leaves out the stretches under
  the tower. `useRecordFootprint` lets a `uni.glb` node take the register footprint around it when its own outline
  leaves most of the building out (BLD_A4, whose outline missed the 진리관 tower).

All of these heights are estimates, not measurements. Node extras carry `heightSource` (the human-readable
reason) and, on every `BLD_*` node and `BLD_SCNU_*` proxy, `heightLineage` with `storeyMetresUsed` (the
storey median used, or null):

| `heightLineage` | Meaning |
|---|---|
| `gis-height` | the GIS건물통합정보 height, which passed the 2.5-5 m per floor window |
| `curated:scnu-facades` | a `heightMetres` override in `data/scnu-facades.json` |
| `uni.glb-outline` | a `BLD_*` node with no floor data kept its `uni.glb` outline height |
| `floors x median` | floors x the class storey median |
| `vr-floors x median` | reserved: storey count read in the SCNU 360 VR tour x the class median |
| `assumed` | no height and no floors: assumed storey count x the class median |

The lineage describes the height rule; a building whose form comes from `data/building-forms.json` (VWorld LOD4
or a photo trace) keeps the lineage of its footprint while its masses carry their own `heightSource`.

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

### VR-only buildings (`data/vr-buildings.json`)

Some buildings stand in the SCNU 360 VR tour (`vr.scnu.ac.kr/360vr/tour.xml`, visual reference only) but have no
GIS건물통합정보 footprint, or only a demolished one. `data/vr-buildings.json` holds them: `stages/sources.mjs`
(`loadVrBuildings`) appends its records after the GIS records, so they go through the same selection, height rule
and pick-proxy path. An empty `buildings` list builds a byte-identical model. `VR_BUILDINGS_FILE` points the
loader and `stages/vrBuildings.test.mjs` at another file.

The file has `description`, `sources` and `buildings`. Each record follows the `gis-buildings.json` shape:

| Field | Value |
|---|---|
| `code` | SCNU registry code (`D5`), or null for an uncoded building |
| `name` | `순천대학교 <code> <name>` |
| `label` | dashboard label; an estimated name ends in `(추정)` |
| `nodeId` | `BLD_SCNU_<code>`, or `BLD_SCNU_V<n>` without a code; never a `uni.glb` or `scnu-building-names.json` id |
| `status` | `standing` |
| `floors`, `floorsSource` | storeys counted on the VR facade; `VR scene_<id> storey count (estimated)` |
| `heightMetres` | 0: the height comes from floors x the class storey median |
| `undergroundFloors` | 0 unless the VR shows a basement storey |
| `usability` | use class ending in `(추정)`, e.g. `교육연구시설 (추정)` (picks the storey median) |
| `polygons` | polygons -> rings -> `[lon, lat]` (WGS84), each ring closed with at least 4 points |
| `footprintSource` | `NGII 2025 orthophoto trace (estimated) + VR scene_<id>` |
| `nameSource` | registry match text, or `estimated: ...` for an uncoded building |
| `estimated` | always `true` |
| `confidence` | 0-1 |
| `vrScenes` | the VR scenes that show the building |
| `registerName` | null |

`areaMetres` is not stored: the loader computes it from the first ring. A pick proxy from this file carries
`footprintEstimated: true` and `footprintSource` in its extras. No VR image, thumbnail or NGII raster pixel is
committed; only the traced vectors are.

Records (2026-10-26): D5 학군단, A13 웅지관, A3 천연물신약연구소 and C5 어린이집, each placed where the SCNU campus
registry (`w1.scnu.ac.kr/SCNU/campus/list.do`, its `cpLat`/`cpLng` point) and the photo agree. A record whose outline
holds a `uni.glb` node is matched into that node like a GIS record (A13: `BLD_Dormitory_Building.004` takes its name,
floors and look; the node keeps its outline and id, and no `BLD_SCNU_A13` proxy is made). The sweep over the 42 exterior
VR scenes found no uncoded VR-only building: the a4 round blue-band wing belongs to the A4 GIS footprint, and the small
green-roofed building in scene_d5 is a private house off campus (GIS record 453102), so there is no `BLD_SCNU_V<n>` record.
A record looks up its `data/scnu-facades.json` entry by label, then by name (the label drops the code), and its
`usability` picks the storey median (dormitory for 웅지관).

### Building forms (`data/building-forms.json`)

A campus building is not one prism. `fetch/buildingForms.mjs` gives every modelled building (the selection of
`stages/buildings.mjs`, read with `selectOnly`) a list of masses from the VWorld LOD4 building models, checked
against the NGII 2025 orthophoto, and `stages/buildings.mjs` builds them. The polygon work runs in
`fetch/building_forms.py` (shapely, numpy and OpenCV through `uv run`, pinned in the script, like `fetch/gis_buildings.py`);
its header describes the method. A run takes about 35 s; it reads the LOD4 tiles from `.cache/lod4/` (keyless, fetched
when missing) and the NGII sheet from `.cache/ngii-ortho/` (not committed, D2).

- Ownership: a LOD4 model belongs to the footprints it covers; one shared by several buildings (E3/E4/E5, C1/C1.001,
  A1/A2, C2/B6, the three 향림관 nodes) is split between them by nearest footprint.
- Masses: the up-facing LOD4 triangles grouped into flat roof pieces by height (0.25 m) and into sloped roof
  surfaces (triangles sharing an edge; touching surfaces merge only where their heights meet, so a stair-tower cap
  is not merged into the gable beside it); thin strips (under 0.65 m wide) are parapet tops and set the parapet
  height of the roof beside them; pieces under 6 m2 (plant) or 1 m high (steps) are dropped. From the highest down,
  each piece minus everything higher is a mass, so the masses are disjoint in plan and each has one roof; gaps under
  1.2 m left between neighbouring masses go to the flat mass beside them, so no crack opens between wings.
  Down-facing triangles at least 2 m above the local terrain, with neither a roof nor an enclosed section of the mesh
  (a horizontal slice through the wall triangles, welded within 6 cm) below them, are soffits: the mass over one
  starts there (pilotis, through-passages, bridges, canopies, eave overhangs, which keep their own roof triangles),
  and small closed sections under it are its columns.
- Kinds and floors: main, wing, podium and tower masses, rooftop cores (small masses rising at most 8 m over the lower
  roof beside them), raised masses and canopies (over soffits), annexes; floors from each mass's height over the
  building's storey (its main roof over the curated floor count, or over the curated tower's storeys when the main
  mass is that tower, as for A4/A5 and A6). Roofs: flat with the LOD4 parapet, or gable, hipped, mono-pitch or
  curved from the azimuths of the LOD4 roof triangles, which the file keeps (clipped to the mass).
- Voids: courtyards (the open part, at least 1.5 m wide, of holes in the union of the masses: open to the sky),
  light wells (masses at least 4 m below all their neighbours) and passages (raised masses at least 2.5 m above the
  ground).
- Photo check: roofs in the orthophoto are displaced by relief lean (0.1-0.3 m per metre of height on campus). The
  lean is fitted per candidate (LOD4 masses, curated form, traced outline, current footprint) around the
  registration field of the study (maximum IoU, at most 0.12 m/m off it). The photo roof outline is a
  marker-controlled watershed on the NGII sheet, seeded 2 m inside where the candidates agree and 5 m outside them,
  on textured vegetation as background; IoU is counted outside cast shadows. Small LOD4 masses the photo does not
  show are dropped.
- Source: the LOD4 masses when their IoU is at least 0.70 or within 0.05 of the current footprint's; for a building
  LOD4 predates, the curated `form` of its `data/scnu-facades.json` entry (B7: masses traced on the NGII sheet and
  moved back by the lean, storeys, pilotis, podium and east wing from VR scene_b7); otherwise, for a footprint with
  IoU under 0.8, an outline traced on the photo (the watershed roof, moved back by the lean, as a rotated rectangle or
  a 0.4 m polygon) when it beats the footprint (and marginal one-prism LOD4 masses) by 0.05 in a second, symmetric
  measurement; otherwise the current footprint (flagged).

The 2026-10-25 run: 63 modelled buildings, 41 from LOD4, 1 curated (B7), 11 from photo-traced outlines (small annexes whose
GIS rings sit 1-3 m off the roofs), 10 keep their footprint (A12.001 and the stand-side Dormitory_Building.004 are newer
than the LOD4 survey; the rest are small annexes); 23 voids (1 courtyard, 7 light wells, 15 passages). The median IoU of
the 56 named buildings is 0.8615 (0.878 over the 41 from LOD4, 0.8815 over the 40 that are not annexes (`부속 시설`,
`(추정)`) or greenhouses; per building in `.omo/ulw-research/20261023-181400/qa/results/building-forms.md`).
`campus-v2.glb` is 4,837,336 B with both AO atlases re-baked. `bench.mjs --quality low` counts 817 / 45 / 795 draw calls
against 821 / 46 / 799 for the c224c39 model in the same harness; the traffic-simulation layer draws 690 / 18 / 672 of
them there (backends stubbed), so the rest of the scene is 127 / 27 / 123 against the 131 / 28 / 127 of the sections below.

In `stages/buildings.mjs` the masses of a building with a LOD4 or traced form replace its footprint parts; the
other stages read them as parts too (`outer`, `holes`, `heightMetres`). Heights are measured from the building's
lowest ground, so all its masses stand on one level. Neighbouring masses share walls, so a wall is drawn only where it
is exposed: per edge, the stretches outside every other solid (masses and parts of all buildings), and up each
stretch the heights none of them covers. Storeyed masses get facade cells there on the building's storey grid, so
window rows run on, above lower wings and on courtyard and light-well walls; a core's walls that stand on the ground
(a stair or lift core flush with the facade) get cells on the same grid, and its walls above a lower roof, canopy
fascias, gables above the eave line of pitched roofs, soffits under raised masses and columns are plain walls in the
eave colour on the `Roof_Parapet` primitive. Flat roofs carry the LOD4 parapet (0.9 m where LOD4 has none) where no taller mass abuts;
pitched and curved roofs are the LOD4 triangles on `Roof_Membrane`. Each roof takes its own photo colour, sampled
where the lean puts it in the photo, and solar modules are searched there and moved back. No form adds a material or a
primitive, so the draw calls stay those of the footprint model. Node extras carry `formSource`, `formMasses`,
`formMassKinds`, `formVoids`, `formRoofs`, `formPhotoIoU`, `formLean`, `lod4Models` and `formEstimated` (what in the form is
estimated, part by part).

Contracts kept: every `BLD_*` id and the pick proxies stay (a proxy is one prism per mass). `BLD_D4` anchors the traffic
frame with its bounding-box centre, so its walls carry two 1 cm triangles 2 m under the terrain that make the new
form's box symmetric about the `uni.glb` centre. Low masses of another `uni.glb` node (under 6 m, or under a third of
its tallest mass up to 10 m) that lie mostly more than 2 m outside its own outline (the entrance wings of A1, B3 and
C3, annexes of B4, B7's two-storey east wing) are drawn with `CampusBuildings`, so the node's box stays within the
3-unit check of `campusModelAsset.test.mjs`. The photo mask of
the ground stage sweeps every mass along the building's fitted lean to its own roof height and keeps courtyards open,
and trees may stand in courtyards.

Limits: LOD4 shows the campus before B7, A12.001 and Dormitory_Building.004 were built; B7 has the curated form above,
the other two keep their outlines and heights. Glass atrium and skylight roofs that LOD4 models as thin frames (D4,
E5) are read as parapets, so the atrium is drawn open down to its floor. Storey heights come from the curated floor
counts over the LOD4 roofs; seven buildings come out at 4.7-5.4 m per storey (halls, labs, B2, D3, C2, A7, the
stand). Masses, heights and voids are estimates derived from VWorld's models and the photo, not survey data.

## What the model contains

- `BLD_*` nodes: every building id from `uni.glb`, rebuilt from their building forms where LOD4 or the photo gives
  one (wings, stepped levels, courtyards, rooftop cores, raised parts and pitched or curved roofs; see Building forms),
  else from estimated heights from floor counts (see above), per-building facade looks on the facade atlas (see
  Facades), tower masses where VWorld LOD4 shows one, flat roofs with parapets in the eave colour, rooftop equipment,
  roof colours from the orthophoto and the solar panels it shows (estimates), and window glow used at night.
  `BLD_D4` keeps its bounding-box centre (anchor triangles, see Building forms) because it anchors the traffic frame.
- `CampusBuildings`: other university buildings from the footprint file (named `순천대학교`, or
  unnamed ones inside the campus next to a campus road). Off-campus buildings are left out; their lots are
  painted as plain ground.
- `Topography`: chunked terrain using `uni.glb`'s ground heights (structures in the old terrain
  mesh are filtered out), natural ground (land-cover colours under the CC0 grass relief; see Modelled ground).
- `Ground_Asphalt`, `Ground_Pavers`, `Ground_Lot`, `Ground_Apron`, `Ground_Sports`: the modelled ground surfaces
  as decal meshes on the terrain (see Modelled ground).
- `Road_Markings`: the painted road markings the orthophoto shows, one decal mesh on the terrain (see Road markings).
- `Trees_*`: instanced broadleaf, round and pine trees placed over CHMv2 canopy (see Trees above),
  kept off buildings, roads, walkways and the roofed street furniture.
- `Furniture`, `Furniture_Glass`, `Lamps_heads`, `Lamps_pools`: every surveyed outdoor object, the lamps and the
  estimated path lamps and benches (see Street furniture).

## Road markings (`stages/markings.mjs`)

Two files list the painted markings of the NGII 2025 orthophoto, the same photograph as the VWorld z19 mosaic (registered
to it within 5 mm; methods, hand checks and recall in `data/photo/README.md`):

- `data/photo/markings.geojson`, the detection pass;
- `data/photo/markings-extra.geojson`, the completion pass: paint the first pass missed (`method` detect or trace)
  and `properties.corrections`, the first-pass ids that are not paint (`delete`, 279) or carry the wrong kind
  (`kind`, 201). M3 (2026-10-25) appended 651 hand traces (`note` "M3 trace: ..."): the gate's raised crossing,
  island lines, guide dashes and arrows, the roundabout rim dashes and ladder strip, striped humps and hatched medians
  re-traced as their bands, blue bays as fill and symbol, shaded stall rows and a zebra in deep shadow. Pieces of one
  fitted model share a `group`.

`markingCandidates()` applies the corrections, then turns both files into candidates with their drawn pieces. A
candidate is drawn only when the photo backs it:

1. context: left out when its centroid lies inside a modelled building or an A003 sidewalk, a polygon is mostly
   surrounded by vegetation, the photo shows a cast shadow beside it on the side away from the morning sun, or a solid
   lane, edge or centre line lies off the road;
2. paint gate: `bake/markings-gate.mjs` measures, on the NGII sheet itself (`.cache/ngii-ortho`; the VWorld rendition
   washes yellow out to grey), the share of each candidate's drawn area that is white, yellow and blue paint (top-hats
   over a 1.5 m grey opening, kept at half maximum of the local peak, read over the core of each piece) and writes
   `data/photo/markings-gate.json` (`[white, yellow, blue, fingerprint]` per id). The stage draws a candidate when the
   share of its own colour reaches `GATE_SUPPORT` (0.6). A polygon whose label colour fails but whose paint the photo
   shows white or yellow is drawn in that colour; zebra bars of a crossing whose bars mostly pass need 0.3 (shade halves
   their contrast); the pieces of one `group` are drawn together on their mean support (each at least 0.3). The
   file's `review` section overrides the masks for ids judged by eye on 4x chip sheets: `not paint` (kerb stones,
   car roofs, outlines filled across their gaps, pieces superseded by a re-trace) or `paint` (hand traces of faint or
   shaded paint). The stage refuses to build when an entry's fingerprint no longer matches the geometry it draws, so
   editing either markings file means `bun scripts/campus-model/bake/markings-gate.mjs` (and a new look at any
   reviewed id whose geometry changed);
3. duplicates: accepted candidates of one colour covering the same 0.1 m cells (half the smaller one's area) keep one:
   the larger when it contains the smaller three times over, else the better supported.

A rejected candidate is not drawn (the modelled ground carries no photo paint). The 2026-10-25 build: 2,734 candidates, 2,059 drawn (24 estimated crossing
bars), 213 rejected by the paint gate, 177 by eye, 188 duplicates, 97 left out by context:

| kind | drawn | gate | by eye | duplicate | context |
|---|---:|---:|---:|---:|---:|
| zebra_bar | 739 (22 est.) | 11 | 11 | 6 | 0 |
| lane_line_dashed | 287 | 11 | 3 | 52 | 1 |
| speed_bump (bands of striped humps and raised crossings) | 213 | 48 | 5 | 0 | 2 |
| parking_line | 152 | 23 | 89 | 57 | 16 |
| text | 124 | 0 | 2 | 17 | 1 |
| kerb_no_parking | 122 (2 est.) | 38 | 7 | 2 | 17 |
| hatch | 109 | 9 | 8 | 7 | 1 |
| centre_line_yellow | 93 | 23 | 2 | 2 | 19 |
| disabled_parking | 68 | 35 | 27 | 8 | 7 |
| stop_line | 37 | 3 | 1 | 4 | 1 |
| chevron | 28 | 1 | 0 | 1 | 0 |
| lane_line_solid | 23 | 3 | 11 | 14 | 15 |
| edge_line | 14 | 5 | 11 | 1 | 16 |
| arrows, diamonds, give-way, bike box | 50 | 3 | 0 | 13 | 1 |

Geometry:

| Candidate | Drawn as |
|---|---|
| `zebra_bar` | each bar at its detected centre and length, along its crossing's mean axis, 0.50 m wide (estimated; see below). markings.geojson groups bars by `crossing_id`; completion-pass bars are linked within 2 m and 15°. A crossing fused to a painted frame (`fused_frame`) is its outline polygon |
| LineStrings | line kinds stroked 0.15 m wide (stop lines at their detected width within 0.3-0.6 m); `double` yellow lines as two 0.15 m lines 0.15 m either side of the centreline, or as one line on it when only that reading is on paint; `dotted` guide lines as their dots |
| Polygons (arrows, text, hatching, chevrons, stall outlines, dashes, humps, blue bays) | the painted outline with its holes |
| `other` | left out |

The bar width is below the photo's resolution. Folding the bar profiles of 25 crossings over the 0.903 m period,
the second harmonic shows the bars wider than the gaps in 73-92 % of them; the duty of 0.52-0.58 gives 0.47-0.52 m
bars, drawn at 0.50 m with 0.40 m gaps.

Crossings: the OSM crossing ways and the digitised crosswalk polygons never draw stripes. One that matches a drawn
zebra is drawn from the photo alone; the build logs how far the OSM way lies off it. One without a drawn zebra whose
area the photo shows mostly under canopy gets estimated bars (0.903 m period, 0.50 m bars; OSM ways 4.57 m wide after
REG's translation, polygons trimmed by their median 1.45 m overrun; 0.50 m bars are assumed, the period measured).
Under a cast shadow alone, or on open asphalt, no zebra was detected and it stays undrawn.

The mesh: every piece is triangulated and split along the Topography grid lines and diagonals wherever a flat
triangle would leave the terrain by more than 5 mm, so each triangle lies on one terrain triangle
(`topographySurface` in `stages/ground.mjs` reproduces the chunk triangulation), 4 cm above it, with the
terrain's interpolated normals. Packed positions are 14-bit over the campus (about 5 cm steps), so CityModel draws
the material with a polygon offset; it casts no shadow and takes no pointer raycasts. One `Road_Marking` material
with a white/yellow/blue palette texture as base colour and emissive map (no vertex colours): the dashboard lights
every emissive map at night, so the paint stays faintly visible after dark (`KHR_materials_emissive_strength` 0.18).
One mesh, one draw call: 2,137 pieces, 45,391 triangles; `campus-v2.glb` is 4,168,048 B (4,051,068 B before M3) and
`bench.mjs --quality low` still counts 131 / 28 / 127 draw calls. Positions, widths and estimated crossings are
estimates traced from imagery, not survey data.

## Street furniture (`stages/furniture.mjs`, `stages/lights.mjs`)

`data/photo/objects-campus.geojson` is the campus-wide survey of outdoor objects on the NGII 2025 orthophoto: 175
objects over all 154 tiles of EXTENT, each with its method, confidence and an estimated `height_m` with its
`height_source` (survey method, coverage and limits in `data/photo/README.md`). Every object is built at its
surveyed position. Shapes, colours and heights come from the SCNU 360 VR tour, which is a visual reference only:
nothing is copied from it and nothing links to it.

| Survey kind | Built as |
|---|---|
| `street_lamp` | see Lamps below |
| `traffic_signal_pole` | 6.6 m pole, horizontal mast arm over the OSM arterial (1.5 m past its centreline, 3.5-9 m), two four-lens heads; one lens per face is lit at night (red or green) through `Lamps_heads` |
| `sign_pole` | 2.8 m post with a sign plate facing the nearest carriageway; the gate billboard (VR scene_a19) is a 3.6 m board on two legs |
| `low_wall`, `retaining_wall`, `planter` (lines) | walls along the line, 0.3-0.4 m thick, top following the ground; the stone retaining wall carries a railing |
| `planter` (polygons), `plaza_structure/planter` | kerbed beds with a lawn or soil top; the 3 x 3 plaza squares are 0.15 m high (VR scene_c1 shows them almost flush, not the survey's 0.5 m) |
| `fence` | posts and rails; mesh fences and ball-stop nets add a translucent net panel |
| `bench` | slatted benches facing the paved side; the long white court bench is one backless bench |
| `bus_stop_shelter` | posts, roof in the surveyed colour, glass back and side panes, bench; court shelters without glass; the 447 m² school-bus canopy as posts every 5 m and a translucent roof |
| `pergola` | posts every 3 m along both edges, edge beams, cross slats every 0.55 m or a solid roof where the photo shows one (polygons: posts along the outline) |
| `gazebo` | raised floor, posts, cone or pyramid roof over the surveyed roof outline |
| `bike_rack` | mono-pitch canopy (translucent or blue) on posts, hoop stands every 0.9 m |
| `reviewing_stand` (구령대) | VR scene_a15: white single-storey base with teal doors and windows toward the track, turf terrace in four tiers, a flat canopy (green roof as in the photo, white fascia and soffit) on seven square columns, teal railings, two side stairs rising outward. The 구령대 is also the GIS record `A15 운동장 본부석`; the buildings stage keeps its label and pick proxy but no longer draws its generic mass |
| `stadium_seating` | VR scene_a15: white front wall, `seat_rows` (12) terraced concrete rows rising away from the field, orange-yellow seats between stair aisles (both ends and every ~22 m) with blue seats spelling `@SCNU` (south stand) and `SCNU` (north stand) over rows 1-10 as in VR scene_a15, back wall and blue top railing |
| `sports_goal`, `sports_hoop`, `floodlight_pole` | football (7.32 x 2.44 m) and futsal (3 x 2 m) goals facing their partner, with nets; hoop stands facing each other; 8 m floodlights aimed at the pitch |
| `footbridge`, `trash_station` | deck between the abutment heights with railings; a row of blue bins |
| `plaza_structure` | fountain (coping ring, water, pedestal and bowl), central pond (coping wall, planted island with plinth and bronze sculpture per VR scene_c1; the water stays the photo's), parasols, kiosk, sculptures; outdoor steps and stepped terraces as steps fitted to the terrain slope |

Positions: points are pole roots placed on the photo, or data.go.kr points the survey kept; lines are wall, fence,
bench and pergola axes; polygons are roof or seat outlines traced on the photo. Those outlines include the photo's
relief lean, so every roofed object is moved back by the lean field fitted in REG (`registration.json`,
`gis_buildings.transform.lean_field_m_per_m_height`; 0.01-0.7 m here) before it is built. Every object takes its
base from the drawn terrain surface (`topographySurface`).

Decisions taken against the survey, logged by the build and listed in the `Furniture` node extras:

- OC0111, the survey point of the SCNU letter monument, is left out: the monument is built once, as `RS-GATE-A19`
  (`gate_sign`) in `data/photo/rest-spaces.geojson`, placed by the bearings and depression of VR scene_a19 (l face)
  about 13 m further south at the plaza's road edge. The 2025 photo shows that corner of the plaza under construction,
  so the position is VR-only and estimated (confidence 0.4). `B.gate_sign` builds a white letter slab and name band
  on a planted stone bed from the feature's `length_m`, `depth_m`, `height_m`, `plinth_m`, `colour` and `bandColour`;
  the lettering itself is not modelled. Objects of `rest-spaces.geojson` are counted as estimated in the node extras.
- OB0010 was surveyed as a white roofed pergola. VR scene_a19 shows no roof there, only the stepped arc of the
  finished plaza, and the photo shows a curved edge with a thin shadow, so it is built as a two-tier curved step.
- Parasols and the kiosk get 2.4 m instead of the generic 0.5 m `plaza_structure` default.
- Steps are built only where the terrain climbs at least 0.6 m across the outline (OC0096, OC0169). OC0071, OC0085
  and OC0105 lie on flat terrain in `uni.glb`, so their steps stay in the photo texture.

### Lamps

Every `street_lamp` of the survey is a lamp: the poles placed on the photo and the data.go.kr 순천시_가로등 points
the survey kept on footways, verges and medians. The data.go.kr points it rejected (on roofs, on the gate
carriageway) are gone, and `data/streetlights.json` is no longer read. A surveyed pole that falls inside a modelled
building footprint is moved 0.6 m outside the nearest footprint edge (the build logs it; OC0084).

Types (estimated from VR scene_a19 and the campus panoramas): `arterial` (8 m galvanised pole, single curved arm, LED
cobra head 2.1 m out) for data.go.kr points and lamps by the arterial; `campusRoad` (the same shape at 6 m) for lamps
beside a carriageway; `path` (4 m dark post-top lantern) elsewhere. Arms point at the nearest carriageway (OSM
centrelines or road-zone edges).

Estimated lamps fill campus paths and roads the photo cannot resolve (4-6 m poles under canopy cast 2-3 m shadows).
They walk the A003 walkway outlines (`walkways_wgs84.geojson`: closed rings are the kerb plus the back edge of a
sidewalk, filled even-odd per feature; open lines are cut outlines), one candidate every 27 m (the measured
data.go.kr spacing), 0.45 m inside the paved side. A candidate is kept only on campus (within 60 m of a campus
building, outside off-campus lots, 20 m or more from the public arterial), off every road (road zones, crosswalks,
asphalt outside the walkways), at least 1 m from buildings, 1.5 m from surveyed objects, 13.5 m from surveyed lamps
and 20 m from other estimated lamps. Bicycle lanes get none. Where the outer side of the outline is road, the lamp is
a `campusRoad` lamp facing it; otherwise a `path` lantern. The build fails if an estimated lamp lands on a road zone,
a crosswalk or in a building.

`Lamps_heads` merges every luminaire and the signal lenses into one primitive (`Lamp_Head`, emissive mask: dark
housing, warm lens, red/green/amber signal lenses). `Lamps_pools` is the instanced ground disc under each lit head
(radius 7.5 / 5.5 / 4.5 m by type), drawn by CityModel at night only. The node extras list every lamp as
`[id, type, height m, estimated, x, z]`.

### Estimated benches

The photo resolves 3 benches. VR scene_c1 shows long dark-blue box benches beside the tree pits on both long sides of
the central pond; they are placed from VR (4 per side, 7 m apart, 4.5 m outside the pond). Elsewhere one bench every
54 m along the walkway outlines, 0.9 m outside the paved edge on lawn (the surface class 1.2 m further out must be
lawn too), facing the path, on campus, off roads and buildings, 1.5 m from objects and lamps and 30 m from other
benches. All are flagged estimated in the build log and the node extras (`estimatedBenches`).

### Draw calls and size

`Furniture` is one opaque primitive with vertex colours (it casts shadows, so 2 draw calls with the shadow pass),
`Furniture_Glass` one translucent primitive that casts none (1 draw call), and `Lamps_heads` stays one primitive.
`scripts/perf/bench.mjs --quality low` measures 131 / 28 / 127 draw calls (overview / d4 / oblique15) against 128 / 27 /
124 before, with 0 console errors; `campus-v2.glb` grows from 3,578,368 B to 4,051,068 B (about 46,000 furniture
triangles). Packed positions are 14-bit over the campus (about 5 cm steps), so no
part is thinner than 6 cm. CityModel keeps both furniture meshes out of pointer raycasts. Every position is from the
photo or a rule, and every shape and height an estimate: none of it is survey data.

## Frame

All geometry is in `uni.glb`'s scene frame (0.6242 units per metre, +x east, +z south). Footprint
and GeoJSON coordinates are shifted by the constant offset between the cadastral footprints and
`uni.glb` (see `lib/frame.mjs`), so the existing traffic simulation and `CityModel` recentering
stay aligned. `src/campusModelAsset.test.mjs` checks the building ids and that `BLD_D4` has not
moved.
