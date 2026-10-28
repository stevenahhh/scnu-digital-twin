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
| `stages/trees.mjs` | `placeTrees` (the tree inventory and the hedges on the shrub planters; runs before the ground) and `buildTrees` (species geometry, instanced tree nodes) |
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
| `lib/attachments.mjs` | facade attachments: schema checks and the balcony-stack, fin/ledge and rooftop-mast solids (blocks are drawn by `stages/buildings.mjs` with the facade atlas) |
| `pack.mjs` | after the stages: joins the Topography chunks, runs gltf-transform optimize (WebP textures, float geometry, no flatten/join), compresses with `compress.mjs`, re-encodes textures with `ktx2.mjs` and checks names and counts against the raw GLB |
| `compress.mjs` | `EXT_meshopt_compression` of the packed buffers: positions, UVs, colours and indices bit for bit (no position quantization; `reorder()` for size), normals as 8-bit octahedral (meshopt filter, `KHR_mesh_quantization`). drei's `useGLTF` decodes it. 75,860,132 B -> 23,122,984 B on the 2026-10-26 build of dev-next d7adbd4 (docs/OPTIMIZATION-FORMULA.md) |
| `ktx2.mjs` | pack step 4: every texture as KTX2 / Basis Universal ETC1S with mips (`KHR_texture_basisu`; `--normals uastc` for UASTC normal maps), so the GPU keeps them block-compressed. Needs the `basisu` CLI (`brew install basis_universal`); the dashboard transcodes with three's KTX2Loader and `public/basis/`. dev-next f4c0945 build: 24,116,320 B -> 24,836,240 B (71 textures), scene texture memory 264.9 -> 33.2 MB (추정) (docs/OPTIMIZATION-FORMULA.md) |

## Inputs

| Input | Used for |
|---|---|
| `public/uni.glb` | terrain heights, original `BLD_*` node names and outlines |
| `data/gis-buildings.json` | building footprints (lon/lat) with `name`, `floors`, `undergroundFloors`, `heightMetres`, `areaMetres`, `usability`, `structure`, `approvalDate`, `pnu`, and per record `footprintSource` / `floorsSource` |
| `data/landcover.png` | ground classes (paved, grass, tree, soil, track, court) per scene unit, from MCEE land cover and CHMv2 canopy |
| `data/ortho/vworld-satellite-z19.jpg` + `.json` | VWorld Satellite z19 tile mosaic (Web Mercator, 3584 x 2816 px, about 0.245 m/px) and its tile range: roof colours, solar panels and the road-marking photo checks only (never baked into the ground) |
| `data/materials/ground-*.webp` + `ground-materials.json` | CC0 ground tiles (Poly Haven, ambientCG; colour, OpenGL normal, ARM) with their physical sizes: the `Ground_*` and Ground materials |
| `data/chm.png` | CHMv2 canopy height (8-bit metres); tree heights in the tree inventory |
| `data/trees.json` | the tree inventory: crowns traced on the NGII 2025 sheet, heights, diameters and species types (fetch/treeInventory.mjs; see Trees) |
| `data/photo/tree-species.json` | species groups (rows and stands) read on the VR tour, polygons traced on the NGII sheet |
| `data/scnu-facades.json` | curated facade looks (class, colours, window layout, piers, bands, entrance, eave colour) and per-building entries: look, floor/height corrections, tower masses, entrance side (see Facades) |
| `data/building-forms.json` curated mass fields | `look` draws one mass in a look of its own (the F1 metal drum) and `round` replaces a mass outline with a true cylinder (centre, radius, segments, glass-slot bearings; one fixed bay per segment, radial normals): the E4 round tower, placed from the NGII 2025 roof and VR scene_e4 where the LOD4 slice is 4 m off; both carry a lookSource / roundSource (estimated) |
| `data/facade-attachments.json` | per BLD_* node, details the masses do not carry, as geometry: E8's red balcony stacks, its teal glass entrance core and green porch roof (a `roof` record recolours a form mass), B2's red fins and ledges and the blank cladding of its west and rear wings, C3's rooftop mast, A13's orange brick end towers, the E7, C3, E6 and D2 glass towers and portal, A3's orange end volumes, and `solar` rooftop arrays (gable frames on A3, tilted rows on E4) (plans from the building's outline vertices, sizes read on the SCNU VR tour and the NGII 2025 sheet; all estimated); drawn on the node's own primitives, so no material or draw call is added |
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
| `supplements` | project-authored | - | surface labels (which MCEE outline is the basketball, futsal, multi or tennis court, or the oval lawn), circles for the red roundabout of the central intersection (estimated centre, radius 10.7 m fitted to its painted rim on the NGII 2025 orthophoto) and the plaza fountain (estimated), which neither source maps, a `reclass` that paints the OSM pond west of the stadium (way 367126960, a sunken lawn on current imagery) as lawn, a `reclass` that paints the OSM tennis pitch of F3 학생테니스장 (way 366373760; its outline matches the court fence traced on the NGII 2025 photo, `objects-campus.geojson` OC0173) as an orange-tan clay court read in VR scene_f3 (a `lawn` reclass applies only to water, `clay` only to a pitch), and three estimated rows of car-park bays along the access road west of the stadium (no `amenity=parking` there in OSM) |

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
| 2 | estimated walkway | `Ground_Walkway` | 1.5 m paver strips where an estimated pedestrian path runs beside the road with no A003 sidewalk (`data/network/walkways.json`, written by `network:build`; extras note 추정 보행로). Estimated crossings in the same file are routing polygons only and are not drawn |

There are no polygon booleans: `stages/surfaces.mjs` conforms every polygon to the Topography triangles
(`lib/conform.mjs`) and lifts it 0.006 m per precedence step (at most 0.036 m, under the markings' 0.04 m), and
CityModel adds a polygon offset by the material's `extras.polygonOffsetRank`, smaller than the markings' own. The
materials are CC0 tiles (`data/materials/ground-materials.json`) on world-planar UVs that repeat every physical tile
size in EPSG:5186 metres, with the ground AO on TEXCOORD_1; painted surfaces get a per-surface texture at 0.05 m/texel
(track lanes, court and pitch lines 0.10 m wide). The same polygons, plus the 0.3 m edge-stone band on every A003
outline, are rasterised into the surface-class label raster (`groundInfo`) the lamp rule reads. Every albedo, relief
and roughness is an estimate (`extras.estimated`), and `asset.extras.ground.photoPixelsBaked` is `false`. After a
ground geometry change, re-bake the ground AO: `bun scripts/campus-model/bake/bake-ao.mjs --planar`.

### Kerbs, slabs and dropped kerbs (`stages/kerbs.mjs`)

Kerbs stand only on the A003 outlines (never extrapolated onto a road edge): a 0.20 m wide ribbon on the walkway
side of the outline, its outer face on the line, 0.15 m exposed (assumed, asserted under the 0.25 m legal cap) and
0.10 m buried, skipped where both sides are paved (another walkway, a plaza, a building apron). Inside the A003 rings
the walkway decals stand on a slab 0.15 m up (3 mm under the kerb top, so the stone shows), feathered to 0 over 0.5 m
at every walkway edge without a kerb. A crossing polygon (CW_001-CW_031) within 1.0 m of a kerb drops it to 0 across
the crossing plus 0.5 m each side, and kerb and slab rise from there at 1/12 (1.8 m run, then the level landing). A
0.35 m darker asphalt gutter (`Ground_Gutter`) runs on the road side of every road-facing kerb. Furniture, lamps and
the height sidecar stand on the slab (`groundHeightAt`). All of it is an estimate (`Kerbs` node extras).

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

`Trees_*` are the trees of the tree inventory `data/trees.json` at their positions on the photo. `fetch/treeInventory.mjs`
writes it offline from the NGII 2025 sheet (`.cache/ngii-ortho/`), CHMv2 (`data/chm.png`), the GIS building footprints,
the MCEE land cover cache (`.cache/mcee/`), the VR tour cube faces (`.cache/vr/`, through `fetch/tree_vr.py`, `uv run`
with numpy and Pillow) and `data/photo/tree-species.json`:

```bash
bun scripts/campus-model/fetch/treeInventory.mjs [--debug <dir>] [--out <file>]   # canopy.png / crowns.png / photo.png / grid.json in <dir>
```

- Canopy mask: on a 0.5 m grid, cells whose chromaticity is foliage, (2g - r - b) / (r + g + b) >= 0.22 (crowns read
  0.37-0.39 on the sheet, mown lawn 0.18, the slightly green asphalt 0.10, green roofs 0.09), off the building
  footprints, sports grounds and water, plus crown shade on CHMv2 canopy. Painted green surfaces that pass are dropped
  as bright, elongated bands.
- Crowns: tree tops are local maxima of CHMv2 plus the distance to the canopy edge; each canopy cell joins the top it
  reaches first inside the canopy (at most 12 m). Height: the CHMv2 maximum, or 1.5 + 2.2 x the radius where CHMv2
  (2016 imagery) has no canopy.
- Trees: a photo crown is a row or stand of round(area / spacing disc) trees of its species (spacing 5.5-7.5 m, 3 m for
  clipped conifers): its canopy cells are split by k-means and each tree stands at its cluster's centroid, moved back by
  the photo's relief lean at 0.6 x its height, with a crown reaching the 95th percentile of its cells (clamped to the
  species' crown range), so the crowns cover the canopy as the photo shows it. `scripts/perf/canopy-cover.mjs` checks
  the drawn cover against the canopy mask per area.
- Species type (`ginkgo`, `broadleaf` for zelkova and cherry, `pine`, `metasequoia`, `conifer` for clipped columnar
  evergreens): a VR group polygon of `data/photo/tree-species.json` (metasequoia rows and stands at the C1 plaza, C2/C3
  and D1; a crown whose own VR colour is listed in `exceptVr` keeps its own reading), else the colour class of the
  crowns within 9 m on the VR cube faces (each crown projected into every face that sees it, nearest crown per pixel,
  building prisms occluding; yellow is ginkgo on a street edge (zelkova elsewhere) or, when columnar, metasequoia;
  russet or red is broadleaf; dark green is pine or, when columnar, conifer), else the MCEE forest type, else the
  photo tone. Every tree records its source (`speciesSource`), its photo crown and the number of VR views.
- Near-station VR fit (`data/photo/tree-vr-fit.json`): every tree within 40 m of a station (and, where a station sees it
  unobstructed, owning 75 % of its crown in the depth buffer, every tree 40-80 m away: half weight, used only where no
  near view exists, species changed only when two far views agree, width and height moved half way within 0.8-1.3 x) whose compare-vr strip passed
  (all four faces, 38 stations; a12, b2, c5, d1 skipped) is projected into the cube faces that see it unoccluded
  (`fetch/tree_vr.py` fit mode: depth buffer of all crowns, building prisms). On the VR at that spot it reads the
  foliage colour class (yellow, ochre, red, dark, green), the crown width (the foliage run through the crown at
  mid-height, gaps of 4 px closed; a run reaching the search edge is a merged row) and the crown top (foliage above the
  centre with sky directly above it; tops of trees behind are excluded that way, and the change is capped at 1.6 x).
  Up to the 3 nearest views are combined. Species change only where every view agrees (or one view within 30 m):
  yellow or ochre and columnar -> metasequoia, yellow oval broadleaf -> ginkgo, very dark -> pine (columnar: conifer),
  red or ochre pine -> broadleaf. Deciduous crowns get their autumn colour from the reading ([palette group, shade,
  mix], reached by the VR capture date, `src/lighting/season.mjs`). Each correction lists its VR scene:face and
  distance. `data/photo/tree-vr-manual.json` adds corrections read by eye where the fit misreads a tree (scene_c1 f, r
  and l). Scrub: `tree-species.json` SG01 marks the D4 west slope; crowns there without a CHMv2 height over 5 m are
  low shrub mounds (`shrub`, `Tree_Shrub`).
- Continuous canopy: a photo crown split into 3 or more broadleaf trees is drawn as canopy masses (`Trees_canopy`: three
  thin stems under one irregular mass of seven overlapping lobes, scaled per instance along and across the run, one mass
  per 14 m of run, covering the trunks' spread plus 0.85 x the mean crown radius), not as separate round crowns; a mass
  that would come within 2 m of a VR camera keeps its trees separate.
- The build (`placeTrees`, after the ground stage) stands a trunk on open ground (surface class NATURAL), in a surveyed
  planter, in a street-tree pit (a footway cell within 1.5 m of the carriageway) or in a paved tree pit (a photo crown
  centred over plaza or footway paving with no open ground within half its radius, like the plaza rows of VR scene_c1);
  never on a car park, a court, a building, a road or roofed furniture. A crown that only overhangs paving from a lawn
  has its trunk on the lawn; a trunk elsewhere moves to the nearest allowed point within 3 m, or is left out. No crown comes within 2 m of a VR tour camera position (`scripts/perf/vr-stations.json`). Hedges
  are clipped boxes on the shrub planters and the planter walls along building fronts of the furniture survey.

Shapes are read on the VR tour: ginkgo with a smooth conical-oval crown, broadleaf with a smooth rounded mass and two
irregular lobes, pine with a red-brown bole leaning about 7 degrees under five irregular flat pads stepping up along it, metasequoia with eleven overlapping, drooping, smooth-shaded tiers on a full broad-based cone over a red-brown
trunk, columnar conifers with four tight tiers and no visible stem (lower tiers and undersides a little darker), hedges as boxes.
Each species is one node with a trunk and a crown child (`EXT_mesh_gpu_instancing`), so the draw calls do not grow
with the trees; every instance carries its own tint (the tiered conifers also drift in hue). Crown materials are per
species (`Tree_Crown`, `Tree_Ginkgo`, `Tree_Pine`, `Tree_Metasequoia`, `Tree_Conifer`, `Tree_Hedge`); the dashboard
tints the broadleaf, ginkgo and metasequoia crowns in autumn with their own palettes (`src/lighting/season.mjs`, ginkgo
and metasequoia turning first, metasequoia from yellow-green to orange-ochre crown by crown, as in the VR tour).
Positions, heights, diameters and species are estimates, not a tree survey.

Foliage cards (`lib/foliage.mjs`): every crown of ginkgo, broadleaf, pine, metasequoia, the clipped conifers and the
canopy masses also carries alpha-tested leaf-cluster cards (`Trees_<kind>_foliage`, one instanced child per species with
the crown's instancing and colours; materials `Tree_Foliage_<kind>`, alphaMode MASK at 0.5, double-sided, extras
`crownMaterial` naming the crown material whose calibration and autumn palette they share). Cards per tree: ginkgo 100
fan-leaf clusters, broadleaf 125 and canopy masses 360 leaf clusters, pine 110 near-horizontal needle tufts, metasequoia
210 sprays hanging out and 30-55 degrees down, each with a cross card through its long axis (0.7 x as wide, so a spray
seen edge-on close up is not a flat strip), conifers 56 sprays. They are sampled on the crown archetype's surface with
their centres 0.3 of a card inside it (some further in), and every card corner is pulled into the crown's horizontal
footprint, so the fitted crown still bounds the tree: cover and camera clearance are measured on the crowns. Leaf atlas: 1024 x 1024 RGBA, four tiles drawn by the generator
from signed-distance leaf, fan, needle and spray shapes (near-white, so material and instance colour give the hue);
source: self-generated by `lib/foliage.mjs`, no photo pixels and no external asset (released with the model). The
dashboard (`src/lighting/foliage.mjs`) draws the cards within about 150 m of the camera (they collapse per instance over
136-152 m) and narrows the crown to a 0.8 core under them; beyond, the solid crown alone. The cards cast the trees'
shadows (alpha-tested depth); crowns with cards cast none.

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

Two optional look fields, re-checked against the VR tour scene by scene in October 2026, cover what one tile per
building cannot. Both are absent by default, and a build without them is byte-identical to one before they existed.

- `zones`: `{ "base": { "storeys": n, "look": id } }`. The lowest `base.storeys` storeys take the tile of the `base`
  look, which is an ordinary look in the atlas. Examples: A13 웅지관 (white panel over a two-storey orange brick base),
  A6 창조관 (brick base), B7 산학협력관 (white panel base on pilotis). An optional `band`
  `{ "from": k, "storeys": n, "look": id }` gives storeys k..k+n-1 (0 = ground) another look, over or without a base:
  A1 대학본부 has an orange-yellow two-storey podium (A1-podium) under a glazed third storey (A1-band).
- `roofColour`: `#rrggbb`, read in the VR tour. It replaces the orthophoto or OSM-tag roof colour on every roof of the
  look's buildings, for tiled roofs that the photo samples as grey (A9 청운관's orange clay tiles). Extras record it as
  `roofColourSource`.

A building entry (not a look) may also carry `roof`: `{ "kind": "gable", "eaveMetres", "ridgeMetres",
"overhangMetres", "source" }`, for a small building that the LOD4 mesh and the photo give flat but the VR tour shows
pitched. `stages/buildings.mjs` replaces the flat roof of each of its form masses with a gable over the mass's
minimum-area rectangle (ridge along the long side, eaves overhanging by `overhangMetres`) and logs
`curated pitched roofs`; the pick proxy records `roofFormSource`. The building needs a `data/building-forms.json`
form. Only use: the F3 학생테니스장 hut (`BLD_SCNU_R138317`, look `F3-hut`: yellow timber walls, red gable roof, eave
2.5 m, ridge at its GIS height 3.3 m, from VR scene_f3 r; estimated).

A building entry may also lower the 12 m² drawing minimum for that one footprint: `minAreaMetres` (the smallest area
it is drawn at) with `minAreaSource` (why it stands). The build logs `small footprints included`; the global minimum
is unchanged. Only use: the 10 m² annex beside the B5 greenhouse (`BLD_SCNU_R687709`, GIS record and VWorld photo;
hidden by nearer buildings or trees in every VR scene that predicts it, so it keeps the generic annex look, estimated).

Roof types are checked. A curated `form` mass may only be `flat` (`fetch/building_forms.py` draws curated masses
flat), and a `data/building-forms.json` mass must be one of flat, gable, hipped, mono-pitch and curved. Any other value
stops the build with an error instead of quietly becoming a flat roof.

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
| `vr-floors x median` | floors x the class storey median, the floor count read in the SCNU 360 VR tour (`floorsSource` starting `VR scene_`; a valid GIS height still wins) |
| `assumed` | no height and no floors: assumed storey count x the class median |

The lineage describes the height rule; a building whose form comes from `data/building-forms.json` (VWorld LOD4
or a photo trace) keeps the lineage of its footprint while its masses carry their own `heightSource`.

The Legacy dashboard reads `heightLineage`, `footprintEstimated` and `formEstimated` from the selected node
(`src/CityModel.jsx`) and shows a 추정 caption under the building name in the microclimate panel
(`data-qa="estimate-caption"`): `높이·형태 추정` when the lineage is not `gis-height`, `높이 GIS, 형태 추정` when only the
footprint or form is estimated. VWorld and `?model=uni` have no such extras and show no caption.

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

### VR context buildings (`data/vr-context-buildings.json`)

Off-campus buildings the VR tour shows that the footprint file draws wrongly or not at all. `stages/sources.mjs`
(`applyVrContext`) applies it after `gis-buildings.json` and `vr-buildings.json`:

- `floors`: storey count, `floorsSource` and a Korean use class (`... (추정)`, for the storey median and wall tone) for a
  footprint record matched by `footprintSource` (equal, or a prefix followed by a space). Each entry must match exactly
  one record that has no floors of its own, else the build stops. An entry may also set `heightMetres` (with `heightNote`) where the
  off-campus storey median (3.95 m, set by shops) does not fit: the towers use 3.24 m, the median of the GIS 공동주택 records
  of 5+ storeys. Records changed or added by this file are `estimated: true` and so never enter the storey medians
  (`storeyMedians` skips estimated records).
- `buildings`: footprints traced by eye on the NGII 2025 orthophoto where neither GIS nor OSM has one, in the
  `gis-buildings.json` shape with `name: ""` (never `순천대학교`), so they become context masses (`stages/context.mjs`).

Records (2026-10-27, from scene_f1): 순천시문화건강센터 (OSM way/366373762, 3 storeys), its indoor pool hall (2), the
신매곡 서한이다음 2차 towers (11 OSM ways, 25 or 15 storeys by footprint size, 81 or 48.6 m) and the 4-storey blue-glass block on
중앙로 (traced). `stages/vrContextBuildings.test.mjs` checks the file; `VR_CONTEXT_FILE` points the loader and the test
at another one. `fetch/buildings.mjs` takes OSM footprints of buildings GIS lacks across the whole `BBOX` (it used to stop
30 units outside `EXTENT`), except outlines of 5,000 m2 or more that hold two or more GIS buildings (school grounds,
temple precincts tagged `building`).

`looks` entries (matched the same way as `floors`, any record) set a context mass's texture section (`residential`
punched windows or `commercial` glass band) and its wall tone (`#rrggbb`) where the use class picks the wrong look; a traced
building may carry the same `contextLook`. Records: the culture centre in light blue glass (VR scene_f1 b), the beige
office block in VR scene_a12 l (GIS record 67871, 업무시설 but punched windows) and its traced glass stair tower.

### Lattice masts (`data/lattice-masts.json`, `stages/masts.mjs`)

Free-standing telecom masts the VR shows off campus: a square four-leg lattice tapering from `baseWidthMetres` to
`topWidthMetres`, panels of about 2.5 m with a ring beam and X braces on every face, `bands` alternating obstruction
colours (odd, so the first colour is at both ends), an antenna platform with six panel antennas at `platformAt` of the
height and a lightning rod. A mast stands on the roof of the context mass whose outline holds `at` (on a light core block
`plinthMetres` tall when given), else on the ground.
One node per mast, `Context_Mast_<id>` (`Context_Far_Mast_<id>` beyond `CONTEXT_REACH`), not selectable. Record: the
21 m red-and-white mast on a 3 m core block on the KBS 순천방송국 building, placed by intersecting its bearings from
scene_a19, a17 and b1 and sized from its elevation in a19 and a17, checked on the a17 strip (추정). `stages/masts.test.mjs` checks the data and the mesh.

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

## Transport network (`network/`)

`bun run network:build` (`network/buildNetwork.mjs`) composes the separated pedestrian/vehicle network the simulation
routes on, from the same ground inputs: `sidewalks.mjs` (NGII A003 strips and centrelines, fills the `SW_` placeholders),
`crossings.mjs` (CW polygons), `roads.mjs` (vehicle centrelines from the road zones, `ND_` ids, OSM perimeter roads),
`fallback.mjs` (estimated shared paths only where A003 is missing), `connectors.mjs` (building entrances, gates, car
parks), `photoCrossings.mjs` (painted zebras of the orthophoto that no CW polygon covers), `walkways.mjs` (estimated
paths redrawn off the carriageway, estimated walkway strips and estimated crossings, 추정) and `preview.mjs`
(vector-only PNG). It writes `backend/simulation/data/{campus_transport_network,walkable_polygons,road_polygons,
sidewalk_gaps}.geojson` and `data/network/walkways.json`. No offset-buffer sidewalks: every sidewalk comes from an A003
outline, every estimate carries `estimated: true`.

Build order after a ground or network change: `bun run network:build` (network and `data/network/walkways.json`), then
`bun run model:build`, `bun scripts/campus-model/bake/bake-ao.mjs`, `bun scripts/campus-model/bake/bake-ao.mjs --planar`
(re-bake after ground geometry changes) and `bun run model:build` again.

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
- `Kerbs`, `Ground_Gutter`: kerb ribbons, dropped kerbs and gutters on the A003 outlines (see Kerbs, slabs and dropped kerbs).
- `Road_Markings`: the painted road markings the orthophoto shows, one decal mesh on the terrain (see Road markings).
- `Trees_*`: instanced ginkgo, broadleaf, pine, metasequoia and columnar conifer trees at the crowns of the tree
  inventory, and the hedges (see Trees above), on open ground, planters and tree pits (never on car parks, courts or roads).
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
  fitted model share a `group`. The west main-gate raised crossing (MX01747 and its bands, 2026-10-26) is the east
  one (MX00611) moved onto the photo by template matching on the NGII sheet (shift -22.75 m E, -1.92 m N, NCC 0.95;
  band layout 추정). The yellow kerbs of the main-gate islands (MX00593-MX00601) carry kind `island_kerb`: the islands
  are structures, not carriageway paint, so they are logged and never drawn.

`markingCandidates()` applies the corrections, then turns both files into candidates with their drawn pieces. A
candidate is drawn only when the photo backs it:

1. context: left out when it is an `island_kerb`, its centroid lies inside a modelled building or an A003 sidewalk, a polygon is mostly
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

Geometry. The gate measures the detected pieces themselves (their fingerprints), so it stays the existence check;
what is drawn is regular geometry fitted to the accepted pieces (`stages/markingsRegular.mjs`, fitters in
`lib/markingFit.mjs`, templates in `lib/markingGlyphs.mjs`; unit tests beside them):

| Candidate | Drawn as |
|---|---|
| lines (lane, centre, edge, kerb, stall and give-way lines) | the fragments of one line (same kind and colour, ends facing each other, a gap of at most 3 m, or 13.5 m for dashed lines, i.e. one hidden dash) chained in order and fitted as straight runs (robust Huber line, 90 % of the points within 0.10 m, none beyond 0.30 m) joined by tangent circular arcs sized to the paint at the bend; straight runs of parallel lines within 8 m and 3° share one direction. A straight run is exactly straight; the detected points lie within 0.12 m (p95; at most 0.24 m) of the fitted path. Widths are the statute ones (`LINE_WIDTH_M_BY_KIND`, 추정) |
| dashed lines | statute dashes along the fitted line (white lane line 3 m paint / 5 m gap, yellow 3 m / 3 m: 경찰청 교통노면표시 설치·관리 업무편람 표 2-1, 도로교통법 시행규칙 별표 6), phased on the detected dashes (circular mean of their centres); where at least four detected dashes give a period more than 15 % off the statute one, the photo's period and median dash; dashes are laid only over the detected extent |
| short dense dashes (junction guide lines) | where every photo dash of a line is short (median 0.4-1.2 m, longest 1.5 m) the photo's own pattern: with 3 or more dashes spaced at most 4 m the median dash and start-to-start spacing laid along the line, else the detected dashes as they are (a6, a4/a10, a19, b7: 0.7-1.0 m dashes); the statute 3 m / 5 m stays everywhere else |
| `double` yellow lines | two lines 0.15 m either side of the fitted centreline (0.30 m between centres, 추정), or one line where only that reading is on paint |
| stop lines | the detected rectangle, straight, squared to the lane line it closes (within 25°), width clamped into 0.30-0.45 m |
| `zebra_bar` | per crossing ONE oriented rectangle: bar groups whose rectangles overlap at the same axis, or that lie in one row less than 3 m apart along the walk (a median or a car splits the detected bars), are one crossing; every crossing row has its own bar grid, period (0.88-0.93 m) and phase fitted to its own detected bars (the main-gate west row repeats at 0.914 m, its east neighbour at 0.900 m); adjacent rows share one grid only where their own grids agree (period within 5 mm, bars within 0.1 m); a "stop line" inside a crossing rectangle is a bar read twice and is left out; equal 0.50 m bars at the measured 0.903 m period along the walk axis, phase from the detected bars, length the median detected bar, axis set to the road line's when within 5°. A crossing fused to a painted frame (`fused_frame`) is its outline with straightened edges |
| arrows, diamond, give-way triangle, chevrons, wheelchair and bicycle symbols | templates at the detected centre and size. An arrow lies along its lane (the road direction where the blob's axis is within 25° of it) and points the way that lane's traffic goes (the centre line, else the OSM road axis, on the driver's left); a generic `arrow` takes the best of straight / left / right (추정). A wheelchair symbol stands upright along one of its bay's directions, the one that covers the painted symbol best |
| `text` | one marking per lane block, read for the approaching driver: lines across the lane, the first line farthest, syllables upright to the driver and 2.5 times as long as wide (statute road-marking font proportions, 추정), composed from their jamo (`lib/markingGlyphs.mjs`). `data/photo/markings-text.json` lists the read markings with their blobs and source: at the main gate the SCNU VR tour (scene_b1 face r, scene_a19 face f) shows 국립/순천대학교 and 환영/합니다 on the inbound carriageway and 안녕히/가세요 and 국립/순천대학교 on the outbound one; by A10 인재관 (scene_a10 faces d and b) the yellow 주차금지; on the photo the speed numbers 30 and 50. Every other block (blobs of one lane within 1.5 m) is the most likely statute text for its size, 서행 or 천천히 (경차 in a parking stall), logged 추정 |
| stall frames and other line-kind outlines (a rail with its dividers, an L) | straight strokes at the statute width: along each dominant direction of the outline, every band of at least 1 m of paint becomes one stroke over its longest run |
| hatch stripes, hump bands, blue bays, other painted areas | their rectangle when they fill it (72 %), else their outline with the edges snapped to its dominant directions and to its group's (bands of one hump, fill and frame of one bay) |
| bay symbols | every blue bay gets its white symbol unless a wheelchair template is already drawn there: a wheelchair (장애인 전용), or the P of a parking or PM bay named in `data/photo/markings-bays.json`; a blue piece longer than 6.5 m is a row of 3.4 m bays (or the file's `cells`); upright for the driver entering from the aisle: the file's bearing (read on the 4x chip or the VR view), else the end that meets a kerb, sidewalk or building is the back, else 추정. Small white blobs of a painted symbol inside the bay give way to the template |
| VR-only templates | `data/photo/markings-vr.json`: markings the VR shows that the photo predates (the light-blue bus-stop box at the main gate, VR scene_a19 face b; the hatched median of the f1 arterial): a template at the read centre and bearing, a fifth palette colour `light_blue`, estimated (추정), no paint gate |
| green bands | the green bands across the E7 red carriageway (`green_band`, a fourth palette colour); the gate measures no green, so they are drawn on the chip review |
| `dotted` guide lines | their `dots` squares |
| `other` | left out |

Standard instances (supersedes the table above where they differ). Every piece of paint is one instance of a
standard template of `lib/markingStandards.mjs` (경찰청 교통노면표시 설치·관리 매뉴얼 2019.3, 업무편람 2023/2024,
도로교통법 시행규칙 별표 6, 주차장법 시행규칙 제3조; each template names its page) with a placement evidence id:
- lines: every straight run and every arc of a fitted line is its own instance at the template width (0.15 m; stop
  line 0.40 m), dashes are the template's (lane 3 m / 5 m, centre 3 m / 3 m, guide and give-way 0.5 m / 0.5 m; short
  dense photo dashes take the guide-line template), whole dashes only, the joint between two offset runs left as a gap;
- crosswalks (532): 0.45 m bars, 0.45 m gaps, the 폭원 snapped to 4, 6 or 8 m (3 m below 3.5 m), bars trimmed from
  the ends only, and no crossing covering another (the longest standard length that keeps clear);
- arrows at 5.0 m (road) or 2.0 m (lot and ramp), the medians of the two size groups of the photo arrows; diamond,
  give-way triangle and chevron at their template sizes; road text in the 그림 2-2 letterform (Wanted Sans outlines,
  `data/road-text-glyphs.json` from `fetch/road_text_glyphs.py`) at 0.75 x 2.0 m per syllable times a scale of
  0.5-2 in 0.25 steps; hatches as one region (traced stripes within 1.2 m joined, convex hull) with a 0.15 m border
  and 0.45 m stripes at 45 degrees every 1.35 m;
- parking: the stall rows read on the NGII photo (`bake/parking-rows.mjs` -> `data/photo/parking-lots.json`,
  by-eye rejections in `data/photo/parking-review.json`) drawn by `lib/parkingRows.mjs`: one straight run per row,
  bays of 2.5 m (일반형) or 2.6 m (확장형, photo pitch 2.55 m or more) and 3.3 m (장애인전용, blue in the photo, with a
  1.6 m blue square and the wheelchair), front and back lines, dividers between their inner edges (no overlap),
  back-to-back rows sharing one back line, the row centred on the photo row; the Ground_Lot surface under every row
  (`network/surfaces.mjs`). The traced stall frames, blue bays, hump bands and the old gap-filling dividers are not drawn;
- no two instances share ground (`stages/markingsStandard.mjs`): the weaker one (crosswalk > stall row > stop line >
  symbols and text > lines > hatch) gives way, a straight line by a cut, anything else whole; the build logs each.
`Road_Markings` carries the records (`markingInstances`: id, template, evidence, colour, placement) and every vertex
its record index in v (`(index + 0.5) / markingInstanceCapacity`); the context ground's lines get records too.
`scripts/qa/markings-audit.mjs` reads them back and fails on a marking without template or evidence, a dimension more
than 2 cm off its template, a straight run more than 2 cm off its line, any overlap (2 cm lattice), a stall outside its
lot or off Ground_Lot, uneven stall spacing (5 cm) and a lot whose stall count differs from the photo's.

Nothing regular is kept on a modelled building or an A003 sidewalk (a point counts as on one only when it and four
points 0.3 m around it are), and fitted lines of one colour covering the same paint (half the shorter within 0.25 m)
are drawn once.

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
terrain's interpolated normals. CityModel draws the material with a polygon offset (positions were 14-bit, about
5 cm steps, before the modelled ground; they are float since then, see pack.mjs); it casts no shadow and takes no pointer raycasts. One `Road_Marking` material
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
| `plaza_structure` | fountain (coping ring, water, pedestal and bowl), central pond (OC0081, outline traced on the NGII sheet: a 26.9 x 13.2 m pool with semicircular ends; 0.6 m granite coping, a `Furniture_Water` surface over the painted pool floor (glossy and alpha-blended, pale green; the dashboard adds a fresnel alpha and a stronger sky reflection, `src/lighting/water.mjs`), a planted island of rounded clipped shrubs round the plinth and bronze sculpture, four ring fountains with upright nozzles; VR scene_c1 b), parasols, kiosk, sculptures; outdoor steps and stepped terraces as steps fitted to the terrain slope |

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
- OC0102, the survey's single 7.7 x 8.8 m soil bed in the E8 courtyard, is left out: VR scene_e8 f and the NGII 2025
  photo show two L-shaped brick hedge beds beside the entrance walk and two hedge strips at the wing walls, built as
  `RS0018` and `RS0018A-C` (`planter`, shrub fill, 0.5 m brick kerb). The paving between them is a `paving`
  supplement of `data/osm-ground.json` (pattern `tiles`: grey pavers with staggered blue-grey squares and terracotta
  centres, precedence 5.8 on Ground_Sports, label PAVING; the entrance walk a `plain` one on Ground_Pavers; not a walkable plaza layer of the transport network). All
  estimated.
- OB0010 was surveyed as a white roofed pergola. VR scene_a19 shows no roof there, only the stepped arc of the
  finished plaza, and the photo shows a curved edge with a thin shadow, so it is built as a two-tier curved step.
- Parasols and the kiosk get 2.4 m instead of the generic 0.5 m `plaza_structure` default.
- Steps are built only where the terrain climbs at least 0.6 m across the outline (OC0096, OC0169). OC0071, OC0085
  and OC0105 lie on flat terrain in `uni.glb`, so their steps stay in the photo texture.

### Context buildings (`stages/context.mjs`)

Every off-campus GIS건물통합정보 footprint of 12 m2 or more is drawn as a cheap context mass instead of a flat lot:
inside `EXTENT` on the drawn ground, outside it on the OuterTerrain mesh (`meshHeightAt`), up to `CONTEXT_REACH`
(290 units, about 465 m) from the EXTENT centre as shadow casters; farther masses go into `Context_Far_*` tiles that
CityModel keeps from casting shadows (the shadow camera is fitted to the campus). Height: the GIS source height when it gives 2.5-5 m per storey, else floors x the
storey median, else one storey (all 추정). The footprint is extruded from 0.3 m below its lowest ground point to its
highest ground point + height, with a flat roof and no attachments. One 96 x 32 texture (residential windows,
commercial glass band, plain roof) maps one section per wall bay of about 3.2 m with v counting storeys; the GIS use
class picks the section and a vertex colour per building the wall tone. All masses of one 200 m tile are one primitive
with the one `Context_Building` material. Nodes are `Context_Buildings_<i>_<j>` with extras
`{ context: true, selectable: false }`: no `BLD_` id, so CityModel never selects them.

### Context ground (`stages/contextGround.mjs`)

The streets around the campus outside `EXTENT`, out to the context buildings, on the OuterTerrain mesh. Source: the
OSM arterial and connector centrelines of `data/osm-ground.json` (the ways `network/surfaces.mjs` traces inside
`EXTENT`), fitted as straight runs and arcs (`lib/markingFit.mjs fitPath`). OSM gives no widths or lane counts here,
so:

- lane count: only where the same road (OSM name and class) carries gate-accepted paint inside `EXTENT`
  (`stages/markings.mjs` pieces): per 10 m section, one yellow centre line with white lane lines on both sides counts
  (whites left + 1) + (whites right + 1), and the road takes the smallest count (mid-block; junction approaches add
  turn lanes); a yellow line alone in two or more sections is one lane each way. No paint, no lane count.
- carriageway: lanes x 3.25 m clamped to the asphalt traced inside `EXTENT` where the lane count is known, else a
  half-width per highway class (`ROAD_CLASS`, 추정); narrowed where a building footprint is closer.
- sidewalks raised 0.15 m on primary, secondary and tertiary ways (class width, 추정), cut at junction mouths and
  buildings, with plain concrete kerb faces; markings only on roads with a lane count: the yellow centre line (double
  at 4 lanes or more) and white dashed lane lines at the statute 3 m / 5 m (`DASH_BY_KIND`), left out near junctions.
- photo paint beyond `EXTENT`: the arterial at VR scene_f1 (`PAINT_BEYOND_EXTENT` in `stages/markings.mjs`, x 502-540,
  z -45-20) is traced on the NGII sheet like the campus paint (candidates in `markings-extra.geojson`, measured by the
  paint gate) and drawn here at the marking lift instead of the statute lines, which stay out of that window. The
  hatched median is a VR-only template (`hatched_median`): band and axis fitted to its yellow paint on the sheet,
  stripe pitch and lean read in VR scene_f1 face d (추정; the 0.25 m sheet does not resolve the stripes).
- materials: the CC0 asphalt and concrete tiles and the campus-speckle paver textures already in the model (no new
  images, no photo pixels) and the shared `Road_Marking` palette.

One node per 200 m tile: `Ground_Context_<i>_<j>`, or `Context_Far_Ground_<i>_<j>` beyond `CONTEXT_REACH`. Ground_*
materials cast no shadow, and CityModel does not let `Context_Far_*` nodes (ground and building tiles) receive shadows:
they lie outside the shadow camera. The stage runs last and adds nodes only; it is not part of the road network,
routing or walkable sets, and the campus ground nodes stay byte-identical.

### Lamps

Every `street_lamp` of the survey is a lamp: the poles placed on the photo and the data.go.kr 순천시_가로등 points
the survey kept on footways, verges and medians. `data/streetlights.json` is no longer read.

**Pole bases (all standing poles: lamps, signal, sign and floodlight poles).** `fetch/poleRoots.mjs` writes
`data/photo/pole-roots.json` and `loadFurniture` puts each pole there:

- Review sheets (`fetch/pole_review_sheets.py`): NGII 2025 chips around every seed with metre ticks. In this photo a pole
  shows as a thin pole image leaning away from the photo nadir (relief) plus a thin shadow running west; its base is
  where the two meet. The verdicts are in `data/photo/pole-review.json`: `seed` (base at the seed), `root` (base at an
  offset in metres), `head` (floodlight head; base = head minus the relief lean `leanOffset` for the estimated
  height), `reject` (no pole there).
- The shadow detector (`lib/poleShadow.mjs`) searches 1 m around each by-eye base for the sun-side end of a pole
  shadow. Within 0.5 m of the by-eye base the pole goes to the detected root (`shadow-root`) and `residualM` is the
  distance between the two; otherwise the by-eye base is kept (`by-eye-root`, `residualM` 0.25 m estimated; floodlight
  heads 0.5 m). Seeds with no visible base stay where the survey put them (`unresolved`, metre-level).
- Round 2 (`data/photo/pole-sources.json`) tried every other source on the 49 unresolved poles and moves a pole only when
  one resolves its base to 0.5 m or better: the detector over 3.5 m around the seed (reviewed by eye), the VWorld z19
  mosaic (it is the same 2025 photo, so not independent), Esri z18 (another epoch, but it does not register to the sheet
  within 0.5 m), two-ray VR fixes from the resected stations (rays crossing at 20 degrees or more, both showing the pole
  base) and shadow tip plus estimated height. None qualified; each unresolved record carries `estimated`, `attempts`
  (method, result, reason), `seedUncertaintyM` and `confidence`, and `pole-roots.json` has `residualStats`.
- Round 3 adds other-year aerials: the 순천시 airmap WMS (2013, 2015, 2017 at 10 cm, 2018-2024 at 12 cm; keyless, EPSG:5186;
  kept outside the repository) is registered to the sheet around each pole on painted-feature windows (sigma 0.01-0.19 m
  where it registers), and the base is read by eye on every registered epoch: each flight has its own sun and nadir, so
  a pole hidden in 2025 can show its shadow root or the foot of its relief-leaning image in another year. A pole moves
  (`epoch-root`) when at least two independent epochs agree within 0.5 m and the base lies within 0.5 m of their mean
  (`pole-sources.json` `resolved`: offset from the seed in EPSG:5186 metres, picks, registration, residual). Two did
  (OC0054, OC0130); Kakao skyview HD and the city's 2025 layer are the 2025 photo again. `epoch-root` counts as a photo
  base for `checkPoles`.
- The 67 lamps the old rule placed every 27 m along the A003 walkway outlines were seeds too
  (`data/photo/pole-seeds-rule.json`); none shows a pole on the photo, so none is drawn.
- `checkPoles` (stages/lights.mjs) is the placement contract. A pole whose base the photo shows, or whose seed the photo
  shows on a median or island (review `site`), stays out of buildings (moved up to 4 m outside the footprint edge): the
  carriageway raster paints medians, islands and narrow footways as asphalt, and the photo outranks it. Every other pole
  also stays off carriageways (asphalt outside the A003 paved area), moved up to 8 m (its seed's own uncertainty) to the
  kerb line plus 0.3 m. Moves are logged; a pole that cannot move, or two poles closer than 1 m, fails the build.

Types (estimated from VR scene_a19 and the campus panoramas): `arterial` (8 m galvanised pole, single curved arm, LED
cobra head 2.1 m out) for data.go.kr points and lamps by the arterial; `campusRoad` (the same shape at 6 m) for lamps
beside a carriageway; `path` (4 m dark post-top lantern) elsewhere. Arms point at the nearest carriageway (OSM
centrelines or road-zone edges).

`Lamps_heads` merges every luminaire and the signal lenses into one primitive (`Lamp_Head`, emissive mask: dark
housing, warm lens, red/green/amber signal lenses). `Lamps_pools` is the instanced ground disc under each lit head
(radius 7.5 / 5.5 / 4.5 m by type), drawn by CityModel at night only. The node extras list every lamp as
`[id, type, height m, pole verdict, x, z]`.

### Rest spaces (`data/rest-space-catalogue.json`, `data/photo/rest-spaces.geojson`)

Pavilions, shelters, benches, walls and planters seen in the SCNU 360 VR tour are parametric kinds of
`data/rest-space-catalogue.json`. Each type names its builder in `stages/furniture.mjs` and gives its dimensions in
metres with an allowed range, plus a `dimsSource` (KDS 34 50 15, vendor envelopes, VR or photo reading). Every value
is an estimate (추정). Instances come from two places:

- `data/photo/rest-spaces.geojson`, the second furniture input, is read after the survey (`REST_SPACES_FILE`
  overrides it in tests). It holds one feature group per VR sighting of `data/photo/rest-spaces-reconciliation.json`
  decided `missing`. Each feature cites its VR scene, face and columns, its `photo_support` and `confidence`, and how
  its position was found. Roofs and walls the photo shows are traced on it (within 0.25 m). VR-only positions keep
  `confidence` <= 0.4 and skip the relief-lean shift.
- Survey objects the VR shows as a catalogue kind are retyped (`RETYPED`, with builder props): OC0078 and OC0120 as
  `pavilion_hip`, OC0121 as `pavilion_octagon`, OC0119 as `terminal_shelter`, OC0153 as `canopy_shelter_row`.

The `Furniture` node extras list every rest space (`restSpaces`) and a per-kind summary (`restSpaceKinds`): its label
ending in (추정), count, `estimated: true`, `dimsSource`, VR scenes and photo support. A whole-set duplicate audit
(`duplicateAudit`) runs on every build. It checks survey objects, rest spaces, lamps and the plaza benches for pairs of
the same class closer than 3 m, where roofed kinds count as one class, plaza structures go by subtype and the rest by
kind. The build logs the pair count, which is 0. The two crossing bars of the X-shaped pergola (OC0064, OC0065) are
listed as one compound. `data/photo/restSpaces.test.mjs` checks the provenance, the catalogue ranges, the 3 m rule
against the survey and the coverage of the reconciliation table.

### VR landscape (steps, the A1 pond, lawn paths, red surfacing)

The 12 landscape rows of `data/photo/rest-spaces-reconciliation.json` decided `missing` carry an `applied` verdict
(`built`, `mapped` to an existing node, `markings_lane` for road paint the markings stage owns, or `not_on_campus`; see
`data/photo/README.md`). The built ones are real
geometry, every value an estimate (추정):

- `terraced_steps` (`RS-LS-C1STEPS`, `-D4STEPS`, `-E7STAIR`, `-D1STAIR`): a bottom edge traced on the NGII sheet and
  flights read from the VR (risers counted, rise and tread estimated), with landings, hedge planters on kerbs (rounded clipped hedges),
  `masses` (rounded clipped shrub masses on the bank beside the flights, s x t boxes whose bank level runs over
  `rise_m`; C1 from VR scene_c1 f and the NGII sheet) and handrails. The flights rise by their own risers from the lowest ground on the edge, because the terrain is smoothed
  under most approaches; steps and landings are solids down to the ground. A landing may slope back to the ground
  (`landing_to_ground`, the D4 forecourt). The survey's `outdoor_steps` and `stepped_terrace` keep the terrain rule.
- `pond_basin` (`RS-LS-A1POND`): stone coping, translucent spray jets and a rock; the water is the OSM pond of the
  ground stage, whose old reclass to a sunken lawn is withdrawn (VR scene_a1 shows water).
- `plaza_structure/sculpture` (`RS-LS-E4STONE`, the 공과대학 sign stone) and `bike_rack` (`RS-LS-D3PMRACK`, the blue
  kick-scooter rack at the bay MX00361).
- `data/osm-ground.json` paving supplements: the B4 lawn path and square (`plain`, Ground_Pavers), and the red
  non-slip surfacing of the E4 junction and of the carriageway past E7 (`red`: Ground_Bicycle's red asphalt tile at
  precedence 5.8, label ASPHALT, under the markings).

### Plaza and walk paving (VR patterns, `data/paving-patterns.json`)

The paving of every walk and plaza the 42 exterior VR scenes show was read from their cube faces (module size, bond,
colours, accents, border bands) into `data/paving-patterns.json`; `lib/pavingPatterns.mjs` draws each pattern as one
seamless colour tile and a joint-relief tile (80 px per metre, no photo pixel). Every value is an estimate (추정).

- `Ground_Pavers` (A003 block-paver and existing walkways, OSM plazas, plain supplements) and `Ground_Walkway` take
  `campus-speckle`, the light grey 0.2 m pavers in stack bond with a regular accent grid (3 x 3 dark blocks with a beige
  centre every 1.6 m, alternate rows shifted, single terracotta pavers every 0.8 m; VR scene_a2 and others; no random
  accents) that most VR scenes show
  (the CC0 PavingStones150 tile is no longer used there). Geometry and labels of the walkable layers are unchanged.
- Plazas whose paving differs are `catalogue` paving supplements of `data/osm-ground.json` (`Ground_Plaza`, precedence
  5.8, label PAVING): an outline traced on the NGII 2025 sheet (or an OSM pedestrian area), a pattern laid along an
  `axis`, and optional `borders` drawn inside the outline at 5.85. A restyle stays out of the label raster (label
  null): kerbs, the walkway slab, lamps and the network see the same ground as before. A plaza the walkable layers
  lack (`walkable: true`: the C1 brick forecourt, the E1 slab forecourt, the A9, D4 and E7 plazas, the F1 forecourt,
  the A1 and west B7 pink walks, each over 69-98 % natural ground before) is labelled PAVING at the base paving
  precedence, so it claims natural ground only, never a road, walkway or apron.
- `water` supplements are pools on a plaza: painted water at 5.95 (above the paving) with an optional stone `rim`
  band outside the outline (the C1 central-plaza pool, outline of the survey pond OC0081).

| VR scene(s) | place | pattern |
|---|---|---|
| c1 d/r/b, e1 f/r/d | central plaza (OSM way/1364516955) | plaza-mottled, slate border; pool water with a slate rim |
| c1 f | forecourt below the library steps | brick-herringbone, grey border |
| e1 f | slab forecourt south of the central plaza | slab-grey |
| a9, a10 | A9 tree plaza | dorm-blue (terracotta squares on a 1.2 m grid) |
| d4 f/d | D4 entrance plaza | d4-stripes |
| e7 f/d | E7 front plaza | e7-white |
| a19 l/f | SW gate plaza (road-edge strip; the rest was under construction on the sheet) | gate-bands |
| b2 f, b1 l | B2 forecourt (OSM way/1364237870) | slab-grey |
| f1 f | F1 forecourt, with the lawn island RS-LS-F1ISLAND | slab-grey |
| d2 f/r | D2 planted courtyard | slab-grey, slate border |
| b7 l/d/r, a1 l | pink-red walks around B7 and north of the A1 fountain pond | pink-paver |

### Outline check (shelters, fences, walls, planters)

Every bus shelter, fence, low, retaining and garden wall and planter outline of the survey and of
`data/photo/rest-spaces.geojson` (55) was drawn over its NGII 2025 chip and checked by eye
(`data/photo/outline-review.json`). 47 lie on their photo feature within about 1 m; 5 are moved onto it (`shift`,
offset in metres east/south: planters OC0073, OC0117, OC0156 and the court shelters OC0163, OC0164); 3 are left out:
the photo shows nothing there (bus shelter OC0057, planter OC0154 on the court surface) or the bed is another
planter's (OC0155 duplicates OC0156). Every shift is a
by-eye estimate (추정). The survey has no bollards (not resolvable at 0.25 m), so none are drawn.

### Signal heads

Where the NGII photo shows a signal's mast arm (its thin dark line or west-cast shadow, read on 4x chips:
`data/photo/signal-arms.json`, OB0000, OB0001, OB0003, OC0045) the arm takes that bearing and length. Otherwise each
signal pole controls the approach whose centreline is nearest (the `data/network/roads.json` edges and the OSM
arterial/connector lines, within 25 m): the mast arm reaches from the pole to that centreline (3.5-9 m) and the heads
face the traffic in its near lanes (right-hand traffic: the heads look back along the lanes whose kerb is the pole's).
The `Furniture` extras list each signal as `[id, centreline id, RD_ id, heads facing bearing, arm m]`.

### VR-located lamps (`data/photo/vr-lamps.geojson`)

Lamps the SCNU 360 VR tour shows and the photo survey missed. The VR gives existence (scene, face, column); the base is
the sun-side root of the pole's shadow on the NGII 2025 photo (by eye, 0.25 m). Two-station bearings from the resected
VR stations (`scripts/perf/vr_lamp_bearings.py`) are kept in `vrFix`; with only two rays they have no redundancy, so they
are not used for the position. One lamp so far (VRL001, scene_b7). Height estimated (추정).

### Gate structures (`data/photo/gate-structures.geojson`)

The NGII 2025 photo shows three yellow-kerbed islands across the main-gate approach and a blue panelled canopy over
the lanes between the middle and south islands (traced on a 4x chip with a 1 m grid). Each island is its photo axis
buffered by its width with rounded ends (`traffic_island`: 0.15 m kerb, yellow kerb and rim, concrete top); the canopy
(`gate_canopy`) is the photo roof outline moved back by the relief lean, on four posts. Its height (7.5 m) comes from
its west-cast shadow (추정); its colours are the photo's. VR scene_a19 looks down this road from 73 m away, but the
canopy can't be resolved there. Every size is an estimate (추정).

### Plaza benches

The photo resolves 3 benches. VR scene_c1 shows long dark-blue box benches beside the tree pits on both long sides of
the central pond; they are placed from VR (4 per side, 7 m apart, 4.5 m outside the pond) and flagged estimated in the
build log and the node extras (`estimatedBenches`). The benches the old rule put every 54 m along the walkway outlines
are gone: neither the photo nor the VR shows them.

### Draw calls and size

`Furniture` is one opaque primitive with vertex colours (it casts shadows, so 2 draw calls with the shadow pass),
`Furniture_Glass` one translucent primitive that casts none (1 draw call), and `Lamps_heads` stays one primitive.
`scripts/perf/bench.mjs --quality low` measures 131 / 28 / 127 draw calls (overview / d4 / oblique15) against 128 / 27 /
124 before, with 0 console errors; `campus-v2.glb` grows from 3,578,368 B to 4,051,068 B (about 46,000 furniture
triangles). Packed positions were 14-bit over the campus then (about 5 cm steps; float since the modelled ground), so
no part is thinner than 6 cm. CityModel keeps both furniture meshes out of pointer raycasts. Every position is from the
photo or a rule, and every shape and height an estimate: none of it is survey data.

## VR comparison (`scripts/perf/compare-vr.mjs`)

A local QA harness, not part of the build or the product. With the dev server running it renders the Legacy model
from each exterior station of the SCNU 360 VR tour (`scripts/perf/vr-stations.json`: 42 stations, their estimated
positions, heights and the yaw refined against the renders) with four 90-degree cameras and puts each render next to
the cached VR cube face of the same direction:

```bash
cd frontend
bun x vite --host 127.0.0.1 --port 5182          # any free port; pass it as --url
bun scripts/perf/compare-vr.mjs --scene scene_d4 [--scene ...] | --all [--out <dir>] [--prefix after-] [--url http://127.0.0.1:5182/] [--port 9353]
bun scripts/perf/vr-manifest.mjs --before <dir> --after <dir> --out <dir>   # exit 1 when any of the 42 scenes lacks a pair
```

Per scene it writes `<prefix><scene>-<face>-side.png` (render | VR face) and `<prefix><scene>-strip.png` (VR row over
render row). The VR faces come from the gitignored `.cache/vr/`; every output goes under `.omo/` only. VR imagery is
compared, never committed, shipped or linked from the dashboard. `vr-manifest.mjs` checks that every station has a
before strip, an after strip and four after side images (valid PNGs) and writes `MANIFEST.json` / `MANIFEST.md`.
Stations are estimated (20-40 m nominal error before refinement), so a comparison shows agreement in degrees and
metres, never an exact match.

## Frame

All geometry is in `uni.glb`'s scene frame (0.6242 units per metre, +x east, +z south). Footprint
and GeoJSON coordinates are shifted by the constant offset between the cadastral footprints and
`uni.glb` (see `lib/frame.mjs`), so the existing traffic simulation and `CityModel` recentering
stay aligned. `src/campusModelAsset.test.mjs` checks the building ids and that `BLD_D4` has not
moved.
