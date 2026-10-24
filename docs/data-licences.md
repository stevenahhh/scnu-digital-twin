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
| **D1** | May VWorld-derived data (stored API responses, classified satellite pixels, LOD4 conversions) be committed or shipped? | **No.** It stays blocked until SPACEN gives written consent. | 2026-10-24 | VWorld terms Art. 19 ④ and ⑥, Art. 18 ⑩, Art. 14 ④ 5 (current text, unchanged in the 2026-10-30 revision; see below) | A written SPACEN reply grants consent for the named data and use. Record it here with its date. |
| **D2** | Does the NGII 12 cm orthophoto (sheets 34702009/010/019/020) carry a 공공누리 (KOGL) mark? | **Unknown.** U44 stays gated. | 2026-10-24 | The NGII copyright policy grants free use only to KOGL-marked works and requires prior consultation for unmarked ones. data.go.kr 15059919 says "이용허락범위 제한 없음", but no per-file mark has been seen. | Someone downloads a sheet from 국토정보플랫폼 (login required) and sees a KOGL Type 1 mark in the file or its listing. Then record D2 = yes with the date. |

Consequences of D1 = no:

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
| `scripts/campus-model/data/vworld-buildings.json` | VWorld 2D data API `LT_C_BLDGINFO` | VWorld terms (Art. 19 ④⑥) | n/a | **Removed** from the repository (U13); nothing VWorld-derived is baked any more | `fetch/buildings.mjs` can still read it for local comparison only | Replaced by `gis-buildings.json` (OSM footprints + SCNU floor counts, rows below). |
| `scripts/campus-model/data/gis-buildings.json` | Footprints: OpenStreetMap (`api.openstreetmap.org/api/0.6/map`, bbox of the campus). Floor counts: SCNU campus registry floor directory (`w1.scnu.ac.kr/SCNU/campus/list.do`), else OSM `building:levels` | Footprints ODbL 1.0; the GLB is a Produced Work, so attribution is required and the extract itself (a derivative database) is offered under ODbL. Floor counts are facts (numbers), not copied text or images | `© OpenStreetMap contributors (ODbL 1.0)` | Footprints and floor-rule heights baked into `campus-v2.glb`; the extract is committed under ODbL | - | Allowed with attribution. GIS건물통합정보 (KOGL Type 1) replaces it if the user downloads the zip (needs a VWorld login). Heights are estimates (floors x 4.4 m SCNU / 3.8 m other; 6 / 3 floors assumed where no floor count exists). |
| `scripts/campus-model/data/landcover.png` + `chm.png` | MCEE 세분류 토지피복지도 `lv3_2025y` WFS (classes), CHMv2 canopy height tile 1321121212 (tree mask at >= 3 m) | KOGL Type 1; CC BY 4.0 | MCEE KOGL Type 1 string and `Meta and WRI 2026, CHMv2; source imagery (c) 2016 Vantor` (see planned-inputs rows) | Rasterised classes and the tree mask, baked into the `Topography` texture and tree placement | Raw WFS GeoJSON and the full CHM tile (`.cache/`) | Allowed (U14). No VWorld satellite pixels are used any more. |
| `scripts/campus-model/.cache/` (887 files, 13 MB) | VWorld Satellite z18/z19, Esri World Imagery z18 | VWorld terms; Esri standard layer forbids offline export | - | nothing (gitignored) | QA reference only (`qa/ref/sat-z18.jpg`, `sat-z19.jpg`) | Local only. Never commit or bake. Delete it, or re-source from NGII if D2 becomes yes. |
| VWorld WebGL SDK 3.0 (`index-vworld.html`, `VWorldRenderer.jsx`) | Live VWorld map, imagery and native 3D buildings (`MODEL_NAME`) | VWorld terms, display through the official API (Art. 13 ⑧) | `출처: 브이월드` / VWorld logo, in the form the operator specifies (Art. 13 ⑨) | Code only; nothing VWorld-derived is stored | API key in `frontend/.env` (never committed) | Allowed. Keep the attribution visible on the map. |
| VWorld LOD4 3D Tiles (TDServer `facility_LOD4/.../Suncheon-si`) | VWorld | Art. 14 ④ 5 (공개제한 공간정보), Art. 18 ⑩, Art. 19 ④⑥ | - | nothing | nothing (visual reference by eye through the official SDK only) | **Blocked by D1.** Consent question (c). |
| `frontend/public/uni.glb` (2,450,440 B) | Pre-existing project asset; provenance not recorded | *unverified* | *unknown* | Terrain heights, `BLD_*` names and outlines baked into `campus-v2.glb`; the file itself also ships | - | Open: record who made it and from what data. |
| `docs/assets/data/road_zones_wgs84.geojson`, `walkways_wgs84.geojson`, `crosswalks_wgs84.geojson` | Uploaded 2026-08 ("Add files via upload", "Add crosswalk polygon geometry"); provenance not recorded. A003 walkway codes suggest the NGII 연속수치지형도 schema (*unverified*). | *unverified*. KOGL Type 1 (출처표시) if from NGII 연속수치지형도 | If NGII: the KOGL Type 1 template below with 국토지리정보원 | Baked into `campus-v2.glb` and committed | - | Open: confirm the origin. If they were traced from VWorld imagery or the VWorld WFS, D1 applies. |
| `frontend/public/campus-v2.glb` (4,728,476 B) | Generated from all rows above | Inherits the most restrictive input, currently VWorld (D1) | - | Ships (Legacy default) | - | Ships VWorld derivatives until U13/U14 land. |
| `common/data/common_elemetns.json` | Project-authored element IDs and geometry | Project | - | Ships | - | Provenance of its geometry not checked in this unit. |

### Planned inputs (BUILD-PLAN waves 1-8)

| Input | Source | Licence | Attribution string | What ships | What stays local | Status |
|---|---|---|---|---|---|---|
| GIS건물통합정보 (U13) | 국토교통부, data.go.kr 15083092; `AL_D010_46_*` / `AL_D010_12_*` via VWorld download catalog `ds_id=20171128DS00010` | KOGL Type 1 (출처표시), per the data.go.kr listing | `본 저작물은 국토교통부에서 작성하여 공공누리 제1유형으로 개방한 'GIS건물통합정보'를 이용하였으며, 해당 저작물은 공공데이터포털(www.data.go.kr)에서 무료로 내려받을 수 있습니다.` | Clipped footprints and heights baked into the GLB, plus the clipped extract | Full regional zip | Allowed once the KOGL mark is confirmed inside the zip (U13 acceptance). The file comes through the VWorld download service, but it is a MOLIT KOGL work, so the copyright policy's free-use clause applies. |
| MCEE 세분류 토지피복지도 `lv3_2025y` (U14) | 기후에너지환경부 WFS `api.mcee.go.kr/geoserver/wfs` | KOGL Type 1 | `본 저작물은 기후에너지환경부에서 작성하여 공공누리 제1유형으로 개방한 '세분류 토지피복지도(2025)'를 이용하였으며, 해당 저작물은 환경공간정보서비스(aid.mcee.go.kr)에서 무료로 이용할 수 있습니다.` | Rasterised `landcover.png` and the baked ground classes | Raw GeoJSON (`.cache/mcee/`) | Allowed. Pin the edition year. |
| CHMv2 canopy height, tile 1321121212 (U14, U2x trees) | Meta and WRI, AWS Open Data `dataforgood-fb-data/forests/v2/` | CC BY 4.0 | `Meta and WRI 2026, CHMv2; source imagery (c) 2016 Vantor` (CC BY 4.0) | `chm.png` window and per-instance tree heights (estimated, about ±3 m per pixel) | Full tile | Allowed with attribution. |
| Copernicus DEM GLO-30, tile `N34_00_E127_00` (outer terrain ring) | ESA / Copernicus, AWS `copernicus-dem-30m` | Copernicus DEM free licence (ESA licence annex not read first-hand) | `produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved` (DOI 10.5270/ESA-c5d3d65) | Derived outer-ring mesh | Raw tile window | Allowed with the verbatim string. Whether redistributing a derived mesh is allowed is *unverified* (read the annex). |
| NGII 정사영상 12 cm (U44) | 국토지리정보원, data.go.kr 15059919 / 15067667, 국토정보플랫폼 | **D2 unknown**: free under KOGL Type 1 only if marked | If marked: `본 저작물은 국토지리정보원에서 작성하여 공공누리 제1유형으로 개방한 '정사영상'을 이용하였으며, 해당 저작물은 국토정보플랫폼(map.ngii.go.kr)에서 무료로 내려받을 수 있습니다.` | Nothing until D2 = yes | Downloaded sheets (`gen/.cache/ngii/`) | **Gated by D2.** |
| NGII 연속수치지형도 1:5,000 | 국토지리정보원, data.go.kr 15059721 | 공공저작물 출처표시 제1유형 (listing) | KOGL Type 1 template with 국토지리정보원 and '연속수치지형도' | Derived road edges, parking, stairs, walls, lawn | Raw SHP | Allowed with attribution. |
| Poly Haven / ambientCG materials (U42) | api.polyhaven.com, ambientcg.com | CC0 | none required; credit in `gen/data/materials/LICENSES.md` | Downscaled maps in the GLB | Originals | Allowed. |
| OSM | api.openstreetmap.org | ODbL 1.0 | `© OpenStreetMap contributors (ODbL 1.0)` | Building footprints since U13 (see current inputs) | Raw map XML | Allowed with attribution; keep the extract under ODbL. |
| 임상도 1:5,000 (VWorld dsId 30136) | 산림청 | CC BY-NC-ND | - | **Nothing**: ND forbids derivatives | Reference only | Do not bake. |
| Wikimedia Commons "Suncheon National University.JPG" | hyolee2, 2012-05-29 | CC BY-SA 3.0 | `hyolee2, CC BY-SA 3.0, via Wikimedia Commons` | Only if shown as an image, with share-alike | - | Reference only by default. |
| SCNU campus registry, VR tour, web photos | 순천대학교 | All rights reserved (site footer) | - | Only floor counts (facts) feed the height rule; no text, images or geometry are copied | Modelling reference | Do not ship registry content itself. |
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
