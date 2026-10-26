# common/data

`common_elemetns.json` (misspelled on purpose: it is a live cross-domain contract) holds the shared element ids:
zones, `BLD_` buildings, `RD_` road segments, `ND_` intersections, `CW_` crossings, and the `SW_` sidewalk placeholder
list (`sidewalk_placeholders`, NGII A003 `ufid`s, filled later). `metadata.id_scheme` states what each prefix means;
`backend/simulation/README.md` ("ID 체계") documents the scheme and `backend/simulation/data/road_segments.geojson` resolves
each `RD_` id to geometry. Changes are add-only: never delete, renumber or rename an id, and keep the backend copy
`backend/simulation/data/source/common_elemetns.json` identical (`frontend/scripts/campus-model/network/roadIds.mjs`
writes both).
