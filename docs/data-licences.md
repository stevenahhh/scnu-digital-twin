# Data licences and shipping decisions

Decision log for every input that feeds the campus model (`frontend/public/campus-v2.glb`), its
generator (`frontend/scripts/campus-model/`) and the dashboards. Work unit U01 of
`.omo/ulw-research/20261023-181400/BUILD-PLAN.md`.

- Recorded: **2026-10-24**
- Re-check due: after **2026-10-30**, when the revised VWorld terms take effect, and whenever SPACEN replies.
- This is an engineering record, not legal advice. Anything marked *unverified* has not been read first-hand.

## Decisions

| ID | Question | Decision | Date | Basis | Unblocks when |
|---|---|---|---|---|---|
| **D1** | May VWorld-derived data (stored API responses, classified satellite pixels, LOD4 conversions) be committed or shipped? | **Yes, by consent recorded 2026-10-24.** The project owner reports consent (2026-10-24) to copy and store VWorld data to build this model, so VWorld-derived data may be baked and committed. First use: building names and attributes from the 2D data API `LT_C_BLDGINFO` and `LT_C_SPBD` in `scripts/campus-model/data/scnu-building-names.json`. Second use (2026-10-24, same consent): the VWorld Satellite z19 WMTS tiles over the model extent, stored as `scripts/campus-model/data/ortho/vworld-satellite-z19.jpg` and baked into the `Topography` ground texture, the per-building roof colours and the solar-panel modules of `campus-v2.glb` (row in Current inputs). Third use (2026-10-24, same consent): the photo-textured VWorld LOD4 3D building models (keyless 3D Tiles `facility_LOD4/Jeollanam-do/Suncheon-si`), sampled for per-building facade palettes, wall heights and roof levels with their outlines in `scripts/campus-model/data/lod4-facades.json` (no meshes or textures are stored there), and register floor counts and heights from `LT_C_BLDGINFO` matched by building name; both feed the facade looks, floor corrections and tower masses of `campus-v2.glb` (rows in Current inputs). The API key still never goes into any file. | 2026-10-24 (was **No** until then) | Owner-reported consent of 2026-10-24 under VWorld terms Art. 19 ④ and ⑥ (prior approval); the clauses below still bind any use the consent does not cover | Keep the consent document with the project records; re-check after the 2026-10-30 terms revision. |
| **D2** | Does the NGII 12 cm orthophoto (sheets 34702009/010/019/020) carry a 공공누리 (KOGL) mark? | **Unknown.** U44 stays gated. | 2026-10-24 | The NGII copyright policy grants free use only to KOGL-marked works and requires prior consultation for unmarked ones. data.go.kr 15059919 says "이용허락범위 제한 없음", but no per-file mark has been seen. | Someone downloads a sheet from 국토정보플랫폼 (login required) and sees a KOGL Type 1 mark in the file or its listing. Then record D2 = yes with the date. |

Consequences of D1 = no (the position before the 2026-10-24 consent; kept for the record):

- `frontend/scripts/campus-model/data/vworld-buildings.json` and `data/landcover.png` are VWorld
  derivatives that are already committed. `campus-v2.glb` bakes both. They are flagged here and
  are to be replaced by U13 (GIS건물통합정보) and U14 (MCEE + CHMv2) rather than re-attributed.
  Removing them from the repository and its history is a separate, deliberate decision; this
  unit does not make it.
- The gitignored `.cache/` VWorld z18/z19 tiles may be used only locally for the
  satellite-vs-render QA comparison. Never commit or bake them.
- VWorld LOD4 3D Tiles must not be converted, baked or streamed into Legacy.
- The VWorld dashboard keeps using the official WebGL SDK for live display, with the attribution
  in the table below.

## VWorld terms: current vs revised (read 2026-10-24)

Sources: notice brdIde 34515, "[공지] 브이월드 이용약관 개정 및 재동의 안내" (registered
2026-09-28), with its three attachments: `이용약관_현행.pdf` (25 pp.), `이용약관_개정.pdf`
(26 pp.) and `신·구조문대비표.pdf` (5 pp., 공간정보산업진흥원 디지털플랫폼처, 2026-09-29).
They are linked from `https://www.vworld.kr/v4po_brdnotice_s002.do` (POST `brdIde=34515`).
Current terms took effect 2023-08-18.

Clauses that bind this project (current text, quoted):

| Clause | Text | Revised (2026-10-30) |
|---|---|---|
| Art. 13 ① 10 | 오픈플랫폼에서 허용하지 않는 방식으로 서비스를 접근하는 경우 (prohibited act) | unchanged |
| Art. 13 ① 4 | 운영기관의 동의 없이 영리를 목적으로 서비스를 이용하는 행위 | **deleted**. Art. 20 ③ still bars commercial activity without prior consent. |
| Art. 13 ① 22 (new) | - | **new**: 「공간정보의 구축 및 관리 등에 관한 법률」 제16조, 제21조에 따른 측량성과를 국외로 반출하는 행위 |
| Art. 13 ⑧ | 오픈API체계를 이용하여 … 독립프로그램을 개발하여 이용약관에 위배되지 않는 한 배포할 수 있습니다 | unchanged |
| Art. 13 ⑨ | 결과물, 오픈플랫폼 지도서비스 등 캡처화면에는 운영기관이 별도로 정하는 방법에 따라 오픈플랫폼을 이용하여 만든 것임을 표기해야 합니다 | unchanged |
| Art. 13 ⑩ | 서비스에 포함되어 있는 일체의 내용을 삭제하거나 변경할 수 없습니다 | unchanged |
| Art. 14 ④ 5 | 오픈플랫폼에서 제공하는 3차원 공간정보는 관계법령에 따라 공개제한 공간정보로 운영기관의 승낙 없이 무단으로 복제ㆍ유출하는 경우 (ground for terminating the key contract) | unchanged |
| Art. 18 ⑩ | 오픈플랫폼이 제공하는 방법 이외의 다른 경로를 통해서 서비스에 접근하거나 콘텐츠를 다운로드 받아서는 안됩니다 | unchanged |
| Art. 19 ④ | 서비스를 이용하여 얻는 정보를 사전승낙 없이 복사, 복제, 변경, 번역, 출판, 방송, 기타 등의 방법으로 사용하거나 이를 타인에게 제공할 수 없습니다 | unchanged |
| Art. 19 ⑥ | 오픈플랫폼에서 제공되는 데이터는 사전승낙 없이 데이터를 무단으로 저장하지 못합니다 | unchanged |

Other changes in the revision, none of which affects D1: new definitions "지도서비스" and
"다운로드 서비스" (Art. 2 ① 8, 15); change notices by member e-mail with reply-to-object
(Art. 4); staged sanctions (correction request -> restriction -> expulsion) and a formal objection
procedure (Art. 6).

Notes:

- The effective date in the comparison table's 부칙 is **2026-10-29**. The revised terms PDF and
  the notice both say **2026-10-30**. Treat 2026-10-30 as authoritative and ask SPACEN if it matters.
- The research files cite these rules as "Art. 14/18/19". The exact clauses are listed above.
  The "no storage / no copying" rules are Art. 19 ④ and ⑥, and "no other route" is Art. 18 ⑩.
- New Art. 13 ① 22 (no export of 측량성과 abroad) could matter if VWorld-derived files sit in a
  repository hosted outside Korea. Whether VWorld 2D data counts as 측량성과 under 공간정보관리법
  Art. 16/21 is *unverified*. That is question (d) in the e-mail.
- The VWorld copyright policy (`/v4po_prcint_a006.do`, effective 2023-08-18) allows free use only
  of works fully owned by MOLIT **and** marked KOGL Type 1. Unmarked material needs prior
  consultation. No KOGL mark was found on LT_C_BLDGINFO responses, WMTS tiles or LOD4 tiles.

## Inputs

"Ships" means committed to git or contained in a built asset served to users. "Local" means
gitignored or kept on a developer machine only.

### Current inputs (dev-next 8da07bb)

| Input | Source | Licence | Attribution string | What ships | What stays local | Status |
|---|---|---|---|---|---|---|
| `scripts/campus-model/data/vworld-buildings.json` | VWorld 2D data API `LT_C_BLDGINFO` | VWorld terms (Art. 19 ④⑥) | n/a | **Removed** from the repository (U13); nothing VWorld-derived is baked any more | `fetch/buildings.mjs` can still read it for local comparison only | Replaced by `gis-buildings.json` (GIS건물통합정보 with OSM for missing buildings, row below). |
| `scripts/campus-model/data/gis-buildings.json` | 국토교통부 GIS건물통합정보, `AL_D010_12_20261009.zip` (data.go.kr 15083092, file `국토교통부_GIS건물통합정보`; downloaded through VWorld catalog `ds_id=20171128DS00010`), clipped to the campus bbox by `fetch/gis_buildings.py`: footprints, `A16` height, `A26`/`A27` floors, use, structure, approval date, PNU. Floors where GIS has none: SCNU campus registry floor directory. Footprints of the few buildings GIS lacks (5 on 2026-10-24): OpenStreetMap, marked `OSM way/<id> (not in GIS건물통합정보)` per record | GIS: KOGL Type 1 (출처표시). OSM records: ODbL 1.0 (the GLB is a Produced Work; the extract is a derivative database offered under ODbL). Floor counts are facts | `본 저작물은 국토교통부에서 작성하여 공공누리 제1유형으로 개방한 'GIS건물통합정보'를 이용하였으며, 해당 저작물은 공공데이터포털(www.data.go.kr)에서 무료로 내려받을 수 있습니다.` and `© OpenStreetMap contributors (ODbL 1.0)` | Footprints and heights baked into `campus-v2.glb`; the clipped extract (1,989 records) is committed | Full regional zip in gitignored `.cache/gis/` | **Allowed** with both attributions. KOGL mark: the data.go.kr 15083092 listing (read 2026-10-24) states "이용허락범위: 공공저작물 : 출처표시 (제 1유형)"; the zip itself contains only the `.shp/.shx/.dbf/.prj/.fix` files of two shapefile sets, with no licence notice, mark or zip comment. Heights are building-register values (`A16`) where present (621 of 1,989 records); otherwise the build estimates them from floors (see the README height rule). Estimates must not be labelled as measurements. |
| `scripts/campus-model/data/scnu-building-names.json` | Curated per-record names of the SCNU buildings in `gis-buildings.json` (2026-10-24): SCNU campus registry `w1.scnu.ac.kr/SCNU/campus/list.do` (code, name, point), SCNU 360 VR tour scene titles `vr.scnu.ac.kr/360vr/tour.xml`, OSM building names, VWorld 2D data API `LT_C_BLDGINFO` (`bld_nm`, `dong_nm`, `grnd_flr`) and `LT_C_SPBD` (`buld_nm_dc`), and a look at VWorld z19 imagery to mark demolished footprints and name small annexes (estimates) | Registry and VR titles are facts published by SCNU; OSM names ODbL 1.0; VWorld attributes stored under the D1 consent of 2026-10-24 | `© OpenStreetMap contributors`; `출처: 브이월드` for the VWorld-derived names | Names, `nameSource`, status and node ids, applied to `gis-buildings.json` and baked as `BLD_SCNU_*` node extras and labels in the GLB | Raw API responses and imagery crops (scratch only) | Allowed (D1 consent). No VR panorama pixels are used. |
| `scripts/campus-model/data/streetlights.json` | 공공데이터포털 `전남광주통합특별시 순천시_가로등_20210901` (data.go.kr 15064740, CSV file data, 순천시 디지털정책과, 데이터 기준일 2021-09-01), clipped to the campus bbox by `fetch/streetlights.mjs`: lamp positions only | data.go.kr file data, free of charge (비용부과 무료). The listing's 이용허락범위 field did not render in a text fetch on 2026-10-24, so no KOGL type is recorded; public data provided under 공공데이터법 is free to use and the source is attributed here | `출처: 공공데이터포털(www.data.go.kr) 전남광주통합특별시 순천시_가로등` | Since S1 (2026-10-25) the generator no longer reads this file: the 42 points inside the model extent that the NGII photo survey kept (`data/photo/objects-campus.geojson`, `method: "data.go.kr"`) are baked as lamps in `Lamps_heads` / `Furniture`; the 9 it rejected (roofs, gate carriageway) are not. Before S1, 241 lamp positions were baked into `Lamps_*` instanced meshes in the GLB, plus the clipped extract | Full city CSV | **In use since U43.** Positions are the city's records; lamp geometry, height and glow are project-authored. Check the 이용허락범위 field on the listing before a public release. |
| `scripts/campus-model/data/landcover.png` + `chm.png` | MCEE 세분류 토지피복지도 `lv3_2025y` WFS (classes), CHMv2 canopy height tile 1321121212 (tree mask at >= 3 m) | KOGL Type 1; CC BY 4.0 | MCEE KOGL Type 1 string and `Meta and WRI 2026, CHMv2; source imagery (c) 2016 Vantor` (see planned-inputs rows) | Rasterised classes and the tree mask, baked into the `Topography` texture and tree placement | Raw WFS GeoJSON and the full CHM tile (`.cache/`) | Allowed (U14). The class raster itself holds no VWorld pixels; since 2026-10-24 the ground texture also bakes the VWorld orthophoto (`data/ortho/`, D1, row below), with these classes only steering where the procedural layer fills in. |
| `scripts/campus-model/.cache/` (887 files, 13 MB) | VWorld Satellite z18/z19, Esri World Imagery z18 | VWorld terms; Esri standard layer forbids offline export | - | nothing (gitignored) | QA reference (`qa/ref/sat-z18.jpg`, `sat-z19.jpg`) and the tile cache of `fetch/ortho.mjs` | Local only. Since 2026-10-24 the z19 tiles over the model extent are mosaicked into `data/ortho/` under D1 (next row); the z18 tiles stay local QA input. The Esri tiles must never be committed or baked. |
| `scripts/campus-model/data/ortho/vworld-satellite-z19.jpg` + `.json` (2,638,415 B + tile range) | VWorld WMTS `Satellite` z19 (`api.vworld.kr/req/wmts/1.0.0/{key}/Satellite/19/{y}/{x}.jpeg`), tiles x 447793-447806, y 207719-207729 (154 tiles, cached 2026-10-23), mosaicked without resampling by `fetch/ortho.mjs` (JPEG q92) | VWorld terms; stored and baked by the owner-reported consent of 2026-10-24 (**D1**) | `출처: 브이월드` (Art. 13 ⑨); also in `campus-v2.glb` `asset.extras.orthophoto`. The Legacy dashboard does not display it yet (open item) | The mosaic (committed); in `campus-v2.glb` the 3276 x 2457 `Topography` ground texture (0.2465 m/px; photo with procedural fills under buildings and tree crowns, relit cast shadows, white balance and albedo lift), the per-building roof colours (`Roof_Photo_*` variants, CampusBuildings `COLOR_0`) and the rooftop solar-panel modules (`Roof_Equipment`). All are estimates derived from imagery, not measurements | The tiles (`.cache/vworld-satellite-19-*.jpeg`); the key (environment or `frontend/.env`, never written) | **In use since 2026-10-24** (BUILD-PLAN U44, with VWorld instead of NGII). Re-check with the revised terms of 2026-10-30. |
| `scripts/campus-model/data/photo/markings.geojson`, `objects.geojson`, `objects-campus.geojson` (+ `README.md`) | 국토지리정보원 (NGII) 정사영상 2025, sheet 34702020 (순천020), 0.25 m GSD, EPSG:5186, metadata 202504000734702020 (전남동부권역 25cm, 공개 grade); painted markings vectorised from the photo and street objects/structures placed from it by eye (2026-10-24) | NGII public work; KOGL mark **not confirmed** (same open question as **D2**) | `본 저작물은 국토지리정보원에서 작성한 '정사영상(2025)'을 이용하였습니다.` (switch to the KOGL Type 1 template if D2 = yes) | Vector features only (WGS84 GeoJSON, 1,442 markings and 31 objects); no image pixels. Since 2026-10-25 also the `Road_Markings` decal mesh of `campus-v2.glb`, built from `markings.geojson` by `stages/markings.mjs` (geometry only; the ground texture under it stays VWorld pixels, D1). Since S1 (2026-10-25) also the `Furniture`, `Furniture_Glass`, `Lamps_heads` and `Lamps_pools` meshes, built from the 175 objects of `objects-campus.geojson` by `stages/furniture.mjs` and `stages/lights.mjs` (positions from the survey; shapes and heights estimated) | The sheet TIF/TFW/XML (`.cache/ngii-ortho/`, gitignored) and the scratch detection scripts | **Added for generator use (not yet committed); gated by D2 before a public release.** Feature geometry and heights are estimates traced from imagery, not surveyed measurements. |
| VWorld WebGL SDK 3.0 (`index-vworld.html`, `VWorldRenderer.jsx`) | Live VWorld map, imagery and native 3D buildings (`MODEL_NAME`) | VWorld terms, display through the official API (Art. 13 ⑧) | `출처: 브이월드` / VWorld logo, in the form the operator specifies (Art. 13 ⑨) | Code only; nothing VWorld-derived is stored | API key in `frontend/.env` (never committed) | Allowed. Keep the attribution visible on the map. |
| VWorld LOD4 3D Tiles (TDServer `facility_LOD4/Jeollanam-do/Suncheon-si`, keyless) | VWorld | Art. 14 ④ 5 (공개제한 공간정보), Art. 18 ⑩, Art. 19 ④⑥; stored and used under the owner-reported consent of 2026-10-24 (**D1**) | `출처: 브이월드` | `scripts/campus-model/data/lod4-facades.json` (per SCNU footprint: model names, wall-texel colour modes, wall height, roof levels with convex outlines; no meshes or textures), and in `campus-v2.glb` the tower outlines of A1, A5 and A6 and facade colours checked against the photos. Since 2026-10-25 also `scripts/campus-model/data/building-forms.json` (row below): plan rings, heights, parapets, soffits and columns derived from the LOD4 mesh geometry of 41 campus buildings, and the LOD4 roof triangles of their pitched and curved roofs; and in `campus-v2.glb` the building masses built from them (no LOD4 textures) | The finest b3dm tiles over the campus (`scripts/campus-model/.cache/lod4/`, gitignored) and crnlib as built for Cesium 1.80 (zlib licence, fetched from unpkg into the same cache to transcode the Crunch textures) | In use since 2026-10-24 under D1 (`fetch/lod4Facades.mjs`); since 2026-10-25 converted into Legacy building geometry under the same owner consent (`fetch/buildingForms.mjs`). Consent question (c) to SPACEN stays open as a re-check of that conversion. |
| `scripts/campus-model/data/building-forms.json` | Per modelled campus building (2026-10-25, `fetch/buildingForms.mjs` + `fetch/building_forms.py`): masses (outer and courtyard rings, base and top heights, parapets, roof type, pitched-roof triangles, columns under raised parts) sliced from the VWorld LOD4 meshes; roof outlines of 11 small annexes traced on the NGII 2025 orthophoto sheet 34702020 (lean-corrected); the curated B7 form (masses traced on that sheet and lean-corrected, kept in the B7 entry of `data/scnu-facades.json`; storeys, pilotis, podium and low east wing estimated by eye from SCNU VR scene_b7, row below); per building the relief lean and the photo IoU of its roof outline measured on that sheet | LOD4 geometry: VWorld terms, under **D1**. NGII-traced outlines and the IoU check: NGII public work, KOGL mark **not confirmed** (**D2**), like `data/photo/` | `출처: 브이월드`; `본 저작물은 국토지리정보원에서 작성한 '정사영상(2025)'을 이용하였습니다.` | The JSON (vector rings and heights only; no textures, no image pixels) and the building masses of `campus-v2.glb` | The LOD4 tiles and the NGII sheet (`.cache/`, gitignored) | **In use since 2026-10-25.** All masses, heights and voids are estimates derived from VWorld's models and the photo, not survey data. |
| `frontend/public/uni.glb` (2,450,440 B) | Pre-existing project asset; provenance not recorded | *unverified* | *unknown* | Terrain heights, `BLD_*` names and outlines baked into `campus-v2.glb`; the file itself also ships | - | Open: record who made it and from what data. |
| `docs/assets/data/road_zones_wgs84.geojson`, `walkways_wgs84.geojson`, `crosswalks_wgs84.geojson` | Uploaded 2026-08 ("Add files via upload", "Add crosswalk polygon geometry"); provenance not recorded. A003 walkway codes suggest the NGII 연속수치지형도 schema (*unverified*). | *unverified*. KOGL Type 1 (출처표시) if from NGII 연속수치지형도 | If NGII: the KOGL Type 1 template below with 국토지리정보원 | Baked into `campus-v2.glb` and committed | - | Open: confirm the origin. If they were traced from VWorld imagery or the VWorld WFS, D1 applies. |
| `frontend/public/campus-v2.glb` (3,540,968 B on 2026-10-24) | Generated from all rows above | Inherits the most restrictive input, currently VWorld (D1) | - | Ships (Legacy default) | - | Ships VWorld derivatives under D1: building names, and since 2026-10-24 the orthophoto ground texture, roof colours, solar-panel modules, register floor corrections, LOD4 tower outlines and facade colours checked against the LOD4 photos; since 2026-10-25 the building masses derived from the LOD4 meshes and the outlines traced on the NGII photo, B7's curated form included (`data/building-forms.json`). |
| `common/data/common_elemetns.json` | Project-authored element IDs and geometry | Project | - | Ships | - | Provenance of its geometry not checked in this unit. |

### Planned inputs (BUILD-PLAN waves 1-8)

| Input | Source | Licence | Attribution string | What ships | What stays local | Status |
|---|---|---|---|---|---|---|
| GIS건물통합정보 (U13) | 국토교통부, data.go.kr 15083092; `AL_D010_12_20261009.zip` (전남광주통합특별시) via VWorld download catalog `ds_id=20171128DS00010` | KOGL Type 1 (출처표시), per the data.go.kr listing | `본 저작물은 국토교통부에서 작성하여 공공누리 제1유형으로 개방한 'GIS건물통합정보'를 이용하였으며, 해당 저작물은 공공데이터포털(www.data.go.kr)에서 무료로 내려받을 수 있습니다.` | Clipped footprints and heights baked into the GLB, plus the clipped extract | Full regional zip | **In use since U13** (see `gis-buildings.json` above). The KOGL Type 1 mark is on the data.go.kr listing ("공공저작물 : 출처표시 (제 1유형)", read 2026-10-24); no mark or notice is inside the zip. The file comes through the VWorld download service, but it is a MOLIT KOGL work, so the copyright policy's free-use clause applies. |
| MCEE 세분류 토지피복지도 `lv3_2025y` (U14) | 기후에너지환경부 WFS `api.mcee.go.kr/geoserver/wfs` | KOGL Type 1 | `본 저작물은 기후에너지환경부에서 작성하여 공공누리 제1유형으로 개방한 '세분류 토지피복지도(2025)'를 이용하였으며, 해당 저작물은 환경공간정보서비스(aid.mcee.go.kr)에서 무료로 이용할 수 있습니다.` | Rasterised `landcover.png` and the baked ground classes | Raw GeoJSON (`.cache/mcee/`) | Allowed. Pin the edition year. |
| CHMv2 canopy height, tile 1321121212 (U14, U2x trees) | Meta and WRI, AWS Open Data `dataforgood-fb-data/forests/v2/` | CC BY 4.0 | `Meta and WRI 2026, CHMv2; source imagery (c) 2016 Vantor` (CC BY 4.0) | `chm.png` window and per-instance tree heights (estimated, about ±3 m per pixel) | Full tile | Allowed with attribution. |
| Copernicus DEM GLO-30, tile `N34_00_E127_00` (outer terrain ring) | ESA / Copernicus, AWS `copernicus-dem-30m` | Copernicus DEM free licence (ESA licence annex not read first-hand) | `produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved` (DOI 10.5270/ESA-c5d3d65) | `scripts/campus-model/data/cop30.png` + `cop30.json` (180 x 144 px window, lon 127.455-127.505, lat 34.950-34.990, read by `fetch/terrain.mjs`; the JSON carries the attribution string) and the derived `OuterTerrain` ring mesh baked into the GLB | Cached COG header and tile (`.cache/cop30/`) | **In use since U24** with the verbatim string. Whether redistributing a derived mesh is allowed is *unverified* (read the annex). |
| NGII 정사영상 12 cm (U44) | 국토지리정보원, data.go.kr 15059919 / 15067667, 국토정보플랫폼 | **D2 unknown**: free under KOGL Type 1 only if marked | If marked: `본 저작물은 국토지리정보원에서 작성하여 공공누리 제1유형으로 개방한 '정사영상'을 이용하였으며, 해당 저작물은 국토정보플랫폼(map.ngii.go.kr)에서 무료로 내려받을 수 있습니다.` | Nothing until D2 = yes | Downloaded sheets (`gen/.cache/ngii/`) | **Gated by D2.** Since 2026-10-24 U44 bakes the VWorld z19 mosaic under D1 instead (Current inputs); the NGII sheets remain the replacement if that consent ends. |
| NGII 연속수치지형도 1:5,000 | 국토지리정보원, data.go.kr 15059721 | 공공저작물 출처표시 제1유형 (listing) | KOGL Type 1 template with 국토지리정보원 and '연속수치지형도' | Derived road edges, parking, stairs, walls, lawn | Raw SHP | Allowed with attribution. |
| Poly Haven materials (U42) | Poly Haven, CC0 assets `red_brick_03`, `concrete_wall_004`, `rough_plaster_03`, `concrete_floor_painted` (1k `nor_gl` and `arm` JPEGs from `https://api.polyhaven.com/files/<asset>`, for example https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/red_brick_03/red_brick_03_nor_gl_1k.jpg) | CC0 1.0, https://polyhaven.com/license (read 2026-10-24: "Our assets are all licensed as CC0") | none required; authors credited in `frontend/scripts/campus-model/data/materials/LICENSES.md` | 256 px WebP tiles in `scripts/campus-model/data/materials/` (committed), combined into per-style facade/roof normal and metallic-roughness maps in `campus-v2.glb` | The 1k originals (scratch only) | **In use since U42.** Per-file URLs, MD5s and the conversion step are listed in `data/materials/LICENSES.md`. No ambientCG files are used. |
| OSM | api.openstreetmap.org | ODbL 1.0 | `© OpenStreetMap contributors (ODbL 1.0)` | Building footprints since U13 (see current inputs). Since G1 also ground features in `scripts/campus-model/data/osm-ground.json` (stadium, pitches, parking, plazas, ponds), painted into the `Topography` texture. That file also carries MCEE `lv3_2025y` class-141 outlines (KOGL Type 1, attribution as in the MCEE row) and project-authored labels and estimated shapes (roundabout, fountain), each in its own section | Raw map JSON | Allowed with attribution; keep the extract under ODbL. |
| 임상도 1:5,000 (VWorld dsId 30136) | 산림청 | CC BY-NC-ND | - | **Nothing**: ND forbids derivatives | Reference only | Do not bake. |
| Wikimedia Commons "Suncheon National University.JPG" | hyolee2, 2012-05-29 | CC BY-SA 3.0 | `hyolee2, CC BY-SA 3.0, via Wikimedia Commons` | Only if shown as an image, with share-alike | - | Reference only by default. |
| SCNU campus registry, VR tour, web photos | 순천대학교 | All rights reserved (site footer) | - | Only floor counts (facts) feed the height rule, and since 2026-10-24 the facade looks in `scripts/campus-model/data/scnu-facades.json` (colours, window layouts and storey counts estimated by eye from the VR panoramas), and since 2026-10-25 the shapes, colours and heights of the street furniture in `stages/furniture.mjs` / `stages/lights.mjs` (the 구령대, stands, lamps, signals, plaza structures, estimated by eye from the VR panoramas; positions come from the NGII photo survey), and the storey count, pilotis, two-storey podium and low east wing of the B7 form (`form` of its `scnu-facades.json` entry, estimated by eye from scene_b7; its plan is traced on the NGII photo); no text, images or geometry are copied, and nothing links to the tour | Modelling reference (QA screenshots stay in a local scratch directory) | Do not ship registry content or panorama images. |
| Esri World Imagery, Google, Kakao, Naver maps | Commercial providers | Storage/derivation forbidden by their terms | - | Nothing | Nothing beyond the existing QA cache | Do not use for baked assets. |

UI rule: tree heights, radiation, MRT and similar values derived from these sources are estimates.
Attribution and labels must not call them measurements.

## SPACEN consent inquiry

- Recipient: 공간정보산업진흥원 브이월드 고객센터, vworld@spacen.or.kr (tel. 1661-0115)
- **Status: NOT SENT (as of 2026-10-24).** The project owner must send it. When it goes out,
  record the date here. When a reply arrives, record its date and outcome, and update D1.
- Sent on: _not sent_
- Reply received on: _none_

> **[NOT SENT - draft]**
>
> 제목: [문의] 브이월드 데이터의 저장·가공 및 대학 디지털트윈 모델 반영 가능 여부 (순천대학교 캠퍼스 디지털트윈)
>
> 안녕하세요, 브이월드 운영기구 담당자님.
>
> 저는 국립순천대학교 [소속 학과/연구실]의 [이름]입니다. 순천대학교 캠퍼스 디지털트윈
> 프로토타입(교내 연구·교육용 [비영리 여부 확인 후 기재])을 개발하면서 브이월드 오픈API를
> 사용하고 있습니다. 이용약관 제19조 제4항·제6항, 제18조 제10항, 제14조 제4항 제5호에
> 따라 아래 이용이 사전 승낙 대상인지, 승낙이 가능하다면 절차와 조건은 무엇인지 여쭙고자
> 합니다. 2026년 10월 30일 시행되는 개정 이용약관 기준으로도 답변 부탁드립니다.
>
> (a) 건축물정보(LT_C_BLDGINFO) 저장본
> 캠퍼스 범위(경도 127.4715~127.4880, 위도 34.9640~34.9765)에서 2D 데이터 API로 조회한
> 건물 외곽선·높이·층수를 JSON 파일(약 188 KB)로 저장했습니다. 이를 바탕으로 캠퍼스 3차원
> 모델(glTF)을 생성해 소스 저장소에 커밋해 두었습니다. 이 저장본과 그로부터 생성한 모델을
> 계속 보관·배포할 수 있는지 문의드립니다. 승낙이 어렵다면 삭제하고 공공누리 제1유형인
> 국토교통부 GIS건물통합정보로 대체하겠습니다.
>
> (b) 위성영상(WMTS Satellite) 활용
> Satellite WMTS 타일(z18~z19)을 분류해 만든 토지피복 이미지를 모델 지면 텍스처에 반영하는
> 것(굽기, bake)이 가능한지 여쭙니다. 위성영상 타일 자체를 지면 텍스처로 쓰는 것도 같은 질문입니다.
> 승낙이 어려우면 화면 표출은 공식 지도 API를 통해서만 하고, 저장·가공은 하지 않겠습니다.
>
> (c) 3차원 건물모델(LOD4) 변환
> 캠퍼스 내 건물 약 34동의 LOD4 3D 모델(3D Tiles)을 자체 뷰어용 glTF로 변환해 사용하는 것이
> 가능한지 문의드립니다. 약관상 공개제한 공간정보에 해당하는 것으로 이해하고 있으며, 현재는
> 변환·저장하지 않고 공식 WebGL API로만 표출하고 있습니다.
>
> (d) 개정 약관 제13조 제1항 제22호(측량성과 국외 반출 금지)
> 브이월드 2D 데이터와 그 가공물이 이 조항의 측량성과에 해당하는지 여쭙니다. 해당한다면 국외에
> 서버를 둔 소스 저장소(예: GitHub)에 보관하는 것도 반출에 해당하는지 알려주시기 바랍니다.
>
> 이용 범위가 허용된다면 지켜야 할 출처 표기 방식(제13조 제9항)과 신청 서식이 있는지도
> 안내 부탁드립니다. 승낙 여부는 서면(전자우편)으로 받을 수 있으면 좋겠습니다.
>
> 감사합니다.
>
> [이름] / [소속] / [연락처] / [전자우편]
> [브이월드 회원 ID: 기재 시 확인 후 입력]
