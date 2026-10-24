# Photo-derived features (NGII 2025 orthophoto)

These are vector features read directly from the NGII 2025 orthophoto, sheet 34702020 (순천020, 0.25 m GSD,
EPSG:5186, georeferenced by the world file `0.25 / 0 / 0 / -0.25 / 243324.125 / 264485.875`).
The covered area is the model `EXTENT` from `lib/frame.mjs` (scene x -2..502, z -376..2, about 807 x 605 m).
Two generator units consume them:

- `markings.geojson`: painted road markings, used by M1 (markings).
- `objects.geojson`: street furniture and structures, used by S1 (furniture). Superseded by `objects-campus.geojson`.
- `objects-campus.geojson`: campus-wide survey of outdoor objects over every tile of `EXTENT`, used by S1. It
  contains the 31 `objects.geojson` features unchanged in position and id (`from_objects_geojson: true`), plus the
  campus-wide survey. See [objects-campus.geojson](#objects-campusgeojson-campus-wide-survey).

Both files are WGS84 (CRS84) GeoJSON with 8-decimal coordinates. Every feature carries `source: "ngii-2025-ortho"`.
Generated 2026-10-24.

## Counts

### markings.geojson (1,442 features)

| kind | detected | estimated (occluded, both ends visible) |
|---|---:|---:|
| zebra_bar | 637 | 25 |
| centre_line_yellow | 108 | 2 |
| lane_line_dashed | 73 (3 are dotted guide lines, `dotted: true`) | 0 |
| edge_line | 59 | 3 |
| lane_line_solid | 49 | 2 |
| parking_line | 54 | 0 |
| text | 36 | 0 |
| arrow | 27 | 0 |
| hatch | 13 | 0 |
| other | 354 | 0 |
| stop_line | 0 (see below) | 0 |
| speed_bump | 0 (not detected) | 0 |

The zebra bars belong to 70 `crossing_id` groups. A painted crossing that is broken by a car, a canopy or a
fused frame can be split across more than one group.

By colour, 1,225 features are white and 217 are yellow. No blue or red paint was classified: the
disabled-parking bays end up in `parking_line` or `other` as white.

### objects.geojson (31 features)

| kind | n |
|---|---:|
| plaza_structure (9 planters, 1 fountain) | 10 |
| street_lamp | 5 |
| traffic_signal_pole | 4 |
| sign_pole | 3 |
| low_wall (LineString) | 3 |
| stadium_seating | 2 |
| reviewing_stand (구령대) | 1 |
| bus_stop_shelter | 1 |
| pergola | 1 |
| fence (LineString) | 1 |
| bench, bollard | 0 (not resolvable at 0.25 m) |

**Coverage warning (objects.geojson only; superseded by objects-campus.geojson).** Small objects (poles, signals, signs, walls, fences, benches) were placed by eye **only
inside the eight `survey_windows`** listed in the file properties: main gate, central roundabout, central plaza,
sports-field stands, and four random windows. Outside those windows this file has no small objects. That is
not evidence of absence. Large structures were placed where they were looked at.

### objects-campus.geojson (campus-wide survey)

175 features: the 31 from `objects.geojson` plus 144 new ones. They were surveyed 2026-10-25 over 154 tiles of 60 x 60 m.
Each tile was looked at on the photo at full 0.25 m resolution, upsampled 3x.

| kind | total | from objects.geojson | new |
|---|---:|---:|---:|
| street_lamp | 54 | 5 | 49 |
| plaza_structure (planters, fountain, pond, parasols, outdoor steps, stepped terraces, kiosk, sculptures, gate monument) | 25 | 10 | 15 |
| fence (railings, mesh fences, ball-stop nets; LineString) | 17 | 1 | 16 |
| planter (raised beds, planter walls, tree planters, kerbed islands) | 15 | 0 | 15 |
| pergola (Polygon, or LineString with `width_m`) | 9 | 1 | 8 |
| gazebo (pavilions, 정자) | 8 | 0 | 8 |
| bus_stop_shelter (includes the school-bus canopy and court shelters) | 7 | 1 | 6 |
| traffic_signal_pole | 6 | 4 | 2 |
| low_wall | 6 | 3 | 3 |
| floodlight_pole (futsal pitch) | 6 | 0 | 6 |
| sign_pole (includes the gate billboard) | 4 | 3 | 1 |
| sports_goal | 4 | 0 | 4 |
| bench | 3 | 0 | 3 |
| stadium_seating | 2 | 2 | 0 |
| bike_rack (bicycle shelter canopies) | 2 | 0 | 2 |
| sports_hoop | 2 | 0 | 2 |
| retaining_wall | 2 | 0 | 2 |
| reviewing_stand (구령대) | 1 | 1 | 0 |
| footbridge | 1 | 0 | 1 |
| trash_station | 1 | 0 | 1 |

No CCTV poles or outdoor stages were resolvable. The 2025 photo shows the main-gate SW plaza under construction.
The SCNU letter monument there comes from VR only (`method: "vr"`, confidence 0.2).

**By method.**

| method | n | meaning |
|---|---:|---|
| by-eye-photo | 130 | placed by eye on the photo. `method_detail` keeps the older `by-eye` / `roof-blob` / `shadow-root` labels |
| data.go.kr | 42 | a data.go.kr lamp point that was looked at on the photo and kept because it lies on a footway, verge or median |
| vr | 2 | existence and position from VR, because the photo predates the object or cannot show it |
| shadow | 1 | signal mast-arm shadow |

**data.go.kr lamp points.** 52 of these points fall inside EXTENT:

- 42 kept as `street_lamp`. They are on the surrounding public roads: the stream-side road, the arterial east of
  the gate, and the commercial streets.
- 1 reused as the position of a signal pole.
- 9 rejected because they sit on roofs or on the gate carriageway. They are listed in `properties.rejected_hints`.

Kept points are **not** moved onto pole bases, because the pole roots are not resolvable at this sun height. Treat
them as metre-level positions. The VR check below shows 2-5 m offsets.

**Confidence histogram** (all 175):

| confidence | <0.2 | 0.2-0.3 | 0.3-0.4 | 0.4-0.5 | 0.5-0.6 | 0.6-0.7 | 0.7-0.8 |
|---|---:|---:|---:|---:|---:|---:|---:|
| n | 1 | 4 | 66 | 49 | 33 | 7 | 15 |

**Heights.** Every feature has `height_m` with `estimated: true` and `height_source`. Where there was no shadow or VR
evidence, `height_source` names a kind default: lamps 8 m (arterial type), signals 6.5 m, fences 1.5 m, and so on.

**VR style hints** are stored in `style` and `vr_scene`:

- reviewing stand (scene_a15): white base, three steps up to a turf terrace, a flat white canopy on seven square
  columns, and two side stairs.
- stadium seating (scene_a15): about 12 rows (+-1) of blue and yellow-orange seats.
- arterial lamps (scene_a19): grey pole with a single curved arm and an LED cobra head.
- central-plaza planters (scene_c1): square stone planters. Long dark-blue linear benches run beside them; they
  were not located individually.
- central pond (scene_c1): bronze sculpture on a planted island.

**Survey grid.** The grid is stored in `properties.survey_grid`:

- 60 m tiles (240 px) starting at crop pixel (40, 41), 14 columns x 11 rows. Tile id `Tjjii` is row `jj`,
  column `ii`.
- Each tile records `px_bbox` (crop pixels; the crop origin is `crop_origin_full_image_px`), `wgs84_bbox`,
  `in_extent_m2`, `n_objects` and a survey note.
- All 154 tiles that intersect EXTENT were surveyed.
- Map of objects per tile: `-` means surveyed with none found (forest, roofs, parking), digits are counts (9 means 9 or more).

```text
    00 01 02 03 04 05 06 07 08 09 10 11 12 13   (column; x grows east)
00   -  -  -  -  1  3  3  2  -  2  3  4  -  -
01   -  -  1  -  -  3  -  4  3  4  -  4  2  -
02   1  1  -  1  -  -  1  1  -  1  -  -  2  -
03   -  1  1  1  -  -  1  6  1  1  2  1  2  -
04   -  -  -  1  5  -  -  9  -  1  -  1  5  -
05   -  -  1  -  1  1  1  1  -  2  1  -  9  6
06   -  -  1  -  -  1  1  -  4  3  1  3  5  3
07   -  -  3  2  -  1  -  2  -  1  -  9  -  2
08   -  -  -  -  -  -  1  3  2  -  2  4  2  2
09   -  -  -  -  -  -  1  2  1  -  -  1  -  1
10   -  -  -  -  -  -  -  -  -  -  -  -  -  -   (row 10 is a 10 m strip at the south edge)
```

**What the survey can and cannot see.**

- At 0.25 m GSD with the sun at about 62°, a 4-6 m campus path lamp casts a 2-3 m shadow, about 10 px, and
  usually under tree canopy. Most campus-interior lamps are therefore **not** in this file. Only 7 campus-interior
  lamp candidates have a visible head dot and shadow (confidence 0.3).
- Benches are mostly missed: 3 candidates. The plaza linear benches are seen in VR only.
- Empty tiles prove only that nothing was resolvable. S1 still needs a rule-based fill for path lamps and benches,
  labelled as estimated.
- Structures (roofs, stands, shelters, pergolas, gazebos, planters, fences around courts) are reliable to about 1 m.

**VR check of 20 lamps.**

- Only scene_a19 (main gate, drone pano) has a fitted pose. Its yaw offset (-74.5°), position (-4.0 m E,
  -6.5 m N of the tour.xml lat/lng) and camera height (15 m) were fitted by maximising photo zebra-bar overlap
  with white paint in three views.
- The 20 checked lamps are every lamp within 175 m of that camera. That is a complete set inside the calibrated
  reach, not a random sample from the campus.
- Each lamp's base was projected with an 8 m vertical marker, and the views were looked at one by one.

| verdict | n | ids |
|---|---:|---|
| match (pole at the marker, within ~2 m) | 4 | OB0005, OC0086, OC0098, OC0100 |
| partial (pole 1-3 m away) | 4 | OB0004, OC0097, OC0132, OC0167 |
| mismatch (no pole within ~3 m) | 3 | OC0087, OC0099, OC0130 |
| unclear (canopy or clutter at the marker) | 4 | OC0110, OC0131, OC0151, OC0152 |
| occluded (behind a building or trees) | 5 | OC0077, OC0113-OC0116 |

Verdicts are stored per feature in `vr_check`. Confidence was raised by 0.15 for a match and 0.05 for a partial, and
lowered by 0.1 for a mismatch.

**Overlay check.**

- Every tile was rendered with the read-back GeoJSON drawn on the photo and looked at.
- Fixes made from that check:
  - two candidates dropped: a signal that sat on the carriageway (T0111) and a planter on a parking stall (T0210).
  - three features re-placed: the red pergola in T0403, the planted island in T0602 and a lawn shelter in T0808.
- The sheets are scratch files and are not committed: `.../scratch/OBJ/contact/sheet_01..13.jpg` (12 tiles
  each, in grid order) and `fixes.jpg`.
- VR lamp checks are in `.../scratch/OBJ/vr_lampcheck_1..3.jpg`, and the tile grid index is in
  `.../scratch/OBJ/grid_index.jpg`.
- The survey state (per-tile detections, notes, rejected hints, VR pose) is in `.../scratch/OBJ/survey_state.pkl`.

## Method

### Markings

1. **Paint mask.** The image is upsampled 4x (cubic) in tiles. The detector takes a white top-hat (1.5 m
   opening) plus a yellowness top-hat (`(R+G)/2 - B`). Inside cast shadows the contrast is normalised by the
   local background. A hysteresis threshold is applied, restricted to the carriageway: an asphalt/red-pavement
   texture mask, minus GIS footprints swept by the measured relief-lean field, minus vegetation. The sports
   track and courts are excluded.
2. **Components.** Each component is described by PCA axis, length, width, skeleton, fill, solidity, and its
   colour against a surrounding ring. Combs, where zebra bars are fused to a raised-crossing frame, are split
   with a directional opening. A comb is only accepted when the pieces have bar width and length and a
   0.7-1.25 m period.
3. **Zebra bars.** Bars are 0.35-1.0 m wide and 1.3-8.5 m long, in parallel groups of 4 or more with a period
   of 0.6-1.3 m. Measured period: median **0.903 m** (p10-p90 0.893-0.917), matching REG. Each bar is an
   oriented rectangle on the bar's own axis and extent.
   - `width_m` is a sub-pixel paint-integral estimate, median 0.43 m (p10-p90 0.31-0.57). It is **biased low**
     against REG's edge-based 0.55 m. For decals, keep the polygon centre line and length and use a 0.55 m bar
     width.
   - Four comb crossings are emitted as their painted outline polygon with `fused_frame: true`.
   - Gaps that are a whole number of periods (2-8) between visible bars are filled with `estimated: true` bars.
4. **Lines.** Thin components are chained when they are collinear (within 7°, 0.35 m across, and a gap of
   13 m or less) and of the same colour.
   - Dashed: 3 or more pieces of median length 6.5 m or less with gaps of at least 1 m.
   - Edge versus lane line: the asphalt mask is sampled 1-1.4 m to either side of the line.
   - Yellow lines that border a kerb become `edge_line`.
   - Rows of 5 or more small dots at a regular spacing become dotted `lane_line_dashed`.
   - Gaps in solid lines where 60 % or more of the gap is occluded (canopy, dark shadow, off-asphalt) get one
     `estimated: true` segment.
5. **Symbols.**
   - Low-solidity blobs: yellow becomes `hatch`; white becomes `parking_line`, as the painted outline with holes.
   - `arrow`: an elongated concave blob 2.2-7.5 m long.
   - `text`: a blob with 2 or more neighbours within 3 m.
   - Hollow convex shapes, such as the crosswalk-ahead diamonds, become `other`.
   - Blobs must sit on an asphalt-grey ring and be at least 40 grey levels brighter than it.
6. **stop_line.** The 11 stop-line candidates failed the hand check (0 of 11 were stop lines; they were single
   zebra bars, roof edges or cars). They are emitted as `other` with `method: "stop_line_unverified"`.

### Objects

- **Sun.** The thin-shadow axis was taken from the pole-shadow orientation cluster at 2.5° (image), so shadows
  fall west-north-west. The elevation comes from 100 rays cast from the shadow-side walls of 17 GIS buildings of
  known height: tan(e) = 1.879, so **elevation 62.0°** (IQR 59.3-67.4°), with **azimuth about 92-103°**.
  - The azimuth is ambiguous. A 13° peak comes from the road grid, and a long-kernel search gives 103°.
  - At azimuth 103° a solstice sun reaches at most 59.4°, so the elevation is probably a few degrees high.
  - Heights use the same shadow-length ratio that was calibrated on the buildings, so that bias largely
    cancels out.
  - Everything here is recorded as `sun_estimate` with `estimated: true`.
- **Shadow-root detection does not work at this sun height.** REG's pole-shadow roots (72 inside EXTENT) were
  hand-checked: 0 of 18 random samples were poles. They were roof edges and parapets. A re-run with the
  corrected axis and paint, building and texture filters gave 564 candidates, and 1-2 of the 18 strongest were
  poles. Neither set is shipped.
- **Shipped poles.** Poles, signals and signs were placed by eye at the sun-side root of a visible thin shadow
  (`method: "by-eye"`, confidence 0.35-0.6). Structures (stands, seating, shelter, pergola, fountain, planters)
  were outlined by eye from their roofs or seat areas (`method: "roof-blob"`).
  - Roof outlines include relief lean, up to about 0.2 m per metre of height toward the campus centre (REG
    lean field).
  - Low-wall heights come from shadow width x tan(elevation) and carry `estimated: true`.
  - Pole heights were not derivable: arm shadows and pole shadows merge, so no height is given.

## Accuracy

- **Frame round-trip:** pixel centre -> EPSG:5186 -> WGS84 (8 dp) -> EPSG:5186 gives a median of 0.4 mm and a
  maximum of 0.7 mm (20,000 random pixel centres). Crop pixels match the world-file centres exactly.
- **Painted geometry against the photo:** detected bars and lines are vectorised from the photo's own pixels,
  so they coincide with the paint to within about 1 ground pixel (0.25 m). This was checked by eye on all chip
  sheets and overlays; it was not measured numerically per feature.
- **By-eye objects:** position uncertainty is about 2-4 px (0.5-1 m) for pole roots and about 1 m for structure
  outlines, plus lean on roofs.

### Hand check (random samples, looked at one by one)

"Paint" means the feature lies on real painted marking. "Kind" means the kind label is also right. Rows marked †
were sampled before the last ring-colour gate. That gate only removes features, so these values are lower
bounds.

| kind | sampled | paint | kind |
|---|---:|---:|---:|
| zebra_bar | 30 | 30 (1.00) | 30 (1.00) |
| lane_line_dashed | 30 | 29 (0.97) | 29 (0.97) |
| parking_line | 30 | 25 (0.83) | 21 (0.70) |
| text | 30 | 22 (0.73) | 20 (0.67) |
| centre_line_yellow † | 30 | 24 (0.80) | 15 (0.50); most errors are yellow kerb no-parking lines |
| edge_line † | 30 | 21 (0.70) | about 0.70 |
| arrow | 27 (all) | 19 (0.70) | 5 (0.19); the rest are text pieces, diamonds or crossing frames |
| other † | 30 | 19 (0.63) | n/a |
| lane_line_solid † | 30 | 17 (0.57) | about 0.5; parking-bay edges are also counted |
| hatch | 13 (all) | 13 (1.00) | 2 (0.15); mostly merged yellow line networks |
| stop_line (now `other`) | 11 (all) | 5 | 0 |

### Recall (overlay windows)

| What | Found |
|---|---|
| Painted zebra crossings at the gate and roundabout | 11 of 11 |
| Overall, against REG's independently matched zebra groups | 42 of 49 have a detected bar within 3 m. The misses are about 3 distinct crossings (CW_016/way 1370042065, CW_028/CW_029/way 1390891329) plus CW_008/way 1363204547 at 3.5 m |
| White lane dashes (gate, roundabout approaches, random window 2) | About 16 of 44 (0.35). Short dashes in shade and on the 2-lane arterial in window 2 are missed |
| Roundabout chevron and channel yellow lines | Mostly missed |
| Lane arrows at the gate | About 3 of 10 |
| Raised yellow crossing at the gate | Detected only as `hatch` |
| Speed bumps | Not detected |
| Parking stalls in cast shadow | Missed |

**Use guidance for M1.**

- Trust `zebra_bar` and `lane_line_dashed`.
- Use `centre_line_yellow`, `edge_line` and `parking_line` with a check against OSM or road geometry.
- Treat `arrow`, `text`, `hatch` and `other` as "painted symbol here" polygons for photo-paint suppression, not
  as typed symbols.

## Overlays and hand-check sheets

These are scratch files and are not committed:
`/var/folders/rq/qv2klg3545dd43p09b965vkm0000gn/T/ulw-campus5.LEUM5bhB6O/scratch/DET/verify/`

- `main_gate.jpg`, `central_roundabout.jpg`, `central_plaza.jpg`, `sports_field_stands.jpg`, `random_1..4.jpg`:
  the photo, and the same photo with both GeoJSON files drawn, read back from the shipped files.
- `handcheck_<kind>.jpg`: the random chips used for the table above.

The scripts that produced the data are in `.../scratch/DET/`: `detcommon.py`, `paintmap.py`, `asphalt.py`,
`components.py`, `classify.py`, `export_markings.py`, `sun.py`, `objects.py`, `final_overlays.py`,
`handcheck.py` and `roundtrip.py`.

## Licence

Source: **국토지리정보원 (NGII), 정사영상 2025, sheet 34702020 (순천020)**, metadata 202504000734702020, made by
중앙항업㈜ for the 전남동부권역 25 cm project, 공개 grade. The features here are vectors traced from that photo.
The NGII KOGL status is still **unknown** (decision D2 in `docs/data-licences.md`). Record the attribution
below, and do not ship these files in a public build until D2 is settled:
`본 저작물은 국토지리정보원에서 작성한 '정사영상(2025)'을 이용하였습니다.` See the NGII 2025 row in `docs/data-licences.md`.
