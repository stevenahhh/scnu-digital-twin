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

## markings-extra.geojson (M2 completion pass)

`markings-extra.geojson` adds the painted markings that `markings.geojson` misses, and lists the ones it gets
wrong. It does not repeat features that are already right in `markings.geojson`: use both files together, after
applying the corrections. The schema is the same (WGS84, 8 decimals, `kind`, `colour`, `width_m`, `length_m`,
`source: "ngii-2025-ortho"`, `estimated`), with three more fields:

- `method`: `detect` (a paint component from the detector, kept after review) or `trace` (picked or outlined
  on the tile sheet by eye, then snapped to the paint where the paint is resolvable).
- `confidence`: 0.3-0.7.
- `tile`: the survey tile it was reviewed in.

Generated 2026-10-25.

### Counts (915 features)

| kind | n | geometry |
|---|---:|---|
| lane_line_dashed | 195 | one polygon per dash. `dotted: true` marks guide dots |
| parking_line | 162 | painted stall outline polygon, with holes |
| kerb_no_parking | 125 | yellow line along the kerb (LineString with `width_m`) |
| text | 91 | outlined glyph polygons (one per glyph or glyph cluster) |
| zebra_bar | 90 | bars of crossings that `markings.geojson` misses |
| centre_line_yellow | 56 | LineString. `dashed: true` marks short pieces |
| disabled_parking | 37 | blue bay outline (traced by eye, about 0.3 m) |
| speed_bump | 28 | yellow-striped raised crossings and hump bars |
| chevron | 24 | yellow channelising island outlines |
| stop_line | 24 | |
| hatch | 21 | yellow hatched medians and boxes |
| arrows | 28 | `arrow_straight` 17, `arrow_straight_left` 4, `arrow_left` 3, `arrow_right` 3, `arrow_uturn` 1 |
| edge_line, diamond, lane_line_solid, give_way_line, bike_lane_blue, give_way | 34 | 10, 8, 6, 5, 4, 1 |

By method: 591 `detect` and 324 `trace`.

### Corrections to markings.geojson

These are in `properties.corrections` (480 entries): `{id, was, action, kind?, reason}`.

- `delete` (279): the feature is not paint. They are roof edges, kerb stones, cars, shadows, crossing-frame
  artefacts or field rows. This includes most of the `other` features.
- `kind` (201): the feature is paint with the wrong kind. Mostly yellow `centre_line_yellow` / `edge_line`
  features that are kerb no-parking lines, `other` features that are lane dashes, stop lines, text, diamonds or
  parking lines, and the 27 `arrow` features (with the arrow type).

The ids were checked on chip sheets: every `arrow`, `hatch` and unverified stop line, every `other`, every
off-road or vegetated feature, and the yellow lines that the kerb test flagged.

### Method

1. **Detection.** Each survey tile was upsampled 4x (cubic). The detector takes a white top-hat (1.5 m opening,
   with the background floored by a 2.25 m median) plus a yellowness and a blueness top-hat, normalised inside
   cast shadows. A hysteresis threshold of 21/32 grey levels is applied.
   - The support is all of EXTENT except vegetation and GIS footprints, minus A003 walkways. Lots on
     asphalt-coloured footprints got a separate pass.
   - White and yellow paint are labelled separately.
   - Thin faint lines come from a Hessian ridge detector on the top-hat images.
2. **Candidate review.** Components that did not overlap `markings.geojson` were gated by ring colour, contrast
   and colour. The roughly 1,700 survivors were looked at on chip sheets and given a kind.
3. **Tile review.** All 154 tiles were looked at on 3x sheets, with both files drawn on the photo.
   - Missing marks were added by picking the nearest paint component, or by thresholding the top-hat inside a
     drawn polygon. That is how stall grids, crossings, text, arrows and stop lines were added.
   - Blue bays and some raised crossings were outlined by eye.
   - `properties.tiles_checked` records the kinds checked and a note per tile. `properties.misses_logged` lists
     the paint that was seen but not captured.
4. **Final pass.** Every exported feature was looked at once more on chip sheets (28 sheets), and wrong ones
   were dropped or re-kinded. Zebra bars were kept only when at least 80 % of their axis lies on paint.

### Verification

**Precision.** 30 random features per kind (all of them for kinds with fewer than 10) were sampled after the
final pass and looked at one by one. "Paint" means the feature lies on real paint; "kind" means the kind label is
also right.

| kind | sampled | paint | kind |
|---|---:|---:|---:|
| lane_line_dashed | 30 | 28 | 27 |
| text | 30 | 28 | 28 |
| parking_line | 30 | 26 | 26 |
| speed_bump | 28 | 26 | 26 |
| zebra_bar | 30 | 25 | 25 |
| kerb_no_parking | 30 | 23 | 23 |
| stop_line | 24 | 22 | 19 |
| centre_line_yellow | 30 | 22 | 18 |
| small kinds (arrows, diamonds, blue, give-way, solid lane) | 35 | 32 | 27 |

Overall that is 252 of 267 on paint (0.94) and 229 of 267 with the right kind (0.86). The 95 % target is met
only by `lane_line_dashed` and `text`. The weak kinds are:

- `centre_line_yellow`: ridge lines on kerbs, crossing frames and shadows.
- `kerb_no_parking`: kerb stones and median edges that read as yellow.
- `stop_line`: lane-end lines and parking lines labelled as stop lines.

**Recall.** In 8 tiles (the 4 survey windows and the 4 random windows), every visible painted mark was counted
by eye on the read-back overlay, with both files drawn.

| tile | visible | covered | share |
|---|---:|---:|---:|
| T0512 main gate | about 65 | about 50 | 0.77; most lane arrows are missed |
| T0407 roundabout | about 45 | about 40 | 0.89 |
| T0306 plaza | about 2 | 0 | |
| T0609 stands | about 6 | about 4 | |
| T0310 random 1 | about 12 | about 10 | |
| T0112 random 2 | about 45 | about 41 | 0.91 |
| T0005 random 3 | about 14 | about 11 | |
| T0903 random 4 | 0 | 0 | forest |
| **total** | **about 189** | **about 156** | **about 0.83** |

The 90 % recall target is **not** met. The known shortfalls are:

- Lane arrows at the gate approaches, shaded stall grids, and faint dotted edge lines.
- Zebra crossings on light paving or fused into frames: a few dozen bars.
- Speed-limit digits under canopy.

### Use guidance

- Apply `corrections` to `markings.geojson` first, then add these features.
- Trust `lane_line_dashed`, `text`, `parking_line`, `speed_bump` and `disabled_parking` as drawn.
- Check `centre_line_yellow`, `kerb_no_parking` and `stop_line` against the road geometry, as with the line
  kinds of `markings.geojson`.

The overlay sheets are scratch files and are not committed:
`/var/folders/rq/qv2klg3545dd43p09b965vkm0000gn/T/ulw-campus5.LEUM5bhB6O/scratch/M2/`

- `final/`: every tile, in pairs, plus the 8 recall tiles.
- `precision/`: the sampled chips.
- `full/`: the final per-feature review.
- `review_state.json`, `chip_decisions.json`, `full_decisions.json` and `misses.json`: the review state.

### M3 additions (2026-10-25)

M3 brought both files into the model (`stages/markings.mjs`) and appended 651 hand traces to
`markings-extra.geojson` (`method: "trace"`, `note` starting "M3 trace", ids MX00915 and up; same schema). They were
placed on the 4x photo and fitted to its paint:

- main gate (T0512): the striped raised crossing (white bars on the yellow table, 0.91 m period), the island stop and
  lane lines, junction guide dashes (dashed-line fit), lane arrows and the yellow median hatching;
- roundabout (T0407): the white rim dashes, the yellow ladder strip (two rails and 1.17 m rungs), a yellow kerb line
  and a zebra in deep building shadow (grey top-hat fit, 10 bars);
- the 16 striped humps and raised crossings that M2 outlined as one polygon, re-traced as their white and yellow
  bands, clipped to the painted table; three hatched medians as rails and rungs; blue bays as their blue fill (with
  holes) and white symbol; stall rows in shade or with parked cars cut out; faint yellow centre dashes and dots.

Pieces of one fitted model share `properties.group` (`hump ...`, `median ...`, `bay ...`, `ladder ...`, `trim ...`,
`guide ...`, `zebra ...`). `markings-gate.json` (written by `bake/markings-gate.mjs`) holds every candidate's
measured paint support and the chip-review verdicts (`review`: 186 "not paint", 28 "paint"); see the Road markings
section of the generator README for how the stage uses them and for the drawn/rejected counts.

### G1 additions (2026-10-25)

Browser QA at the main gate (T0510) still showed photo paint where no piece was drawn. Five hand traces, fitted to
the paint's half-maximum edges on the sheet: the two stop lines across the inbound and outbound lanes (MX01742,
MX01744, 0.5 m wide), a lane line ending on the outbound one (MX01745) and two lane dashes (MX01743, half in tree
shadow, and MX01746). MX01746 replaces MK00926, a white dash that `markings.geojson` read as a yellow centre line
(white support 0.71, yellow 0), now deleted by a correction.

### VR rest-space reconciliation (2026-10-25)

24 VR sightings (the 17 rest-space sightings of the VR station survey plus 7 garden and plaza items) against this survey: 7 match, 0 retype, **16 missing**, 1 not a rest space (#17, scene_f2: EV charging bays); 28 further landscape items (steps, sculptures, signs) are listed in the JSON only. Machine copy: `rest-spaces-reconciliation.json`.

Method: each sighting is a ray from its VR station (`scripts/perf/vr-stations.json`, refined yaw where present) at the face bearing plus the column angle of the sighting's middle column, 10-120 m long; a sighting on the nadir face (d) is a strip under the station, offset by its column. Surveyed objects of kind pergola, gazebo, bus_stop_shelter, bench, planter, low_wall, plaza_structure or fence within 8 m of it are candidates. `match`: a candidate of a kind that already stands for what the VR shows (the nearest one; two of that kind within 8 m set `ambiguous`). `retype`: only a candidate whose survey kind the VR corrects. `missing`: none. `not_rest_space`: a re-read of the VR face shows the sighting is no rest space at all (nothing is placed). The photo column says whether the NGII 2025 photo shows a roof, wall or planter at the ray. Stations placed by ortho-match carry a nominal 40 m error, so a `missing` there can also be a station error; the reason says so. Nothing here changes the model: a later stage applies the decisions and creates the `RS` instances.

| # | scene / face / cols | kind seen | bearing | candidates within 8 m | decision | reason | typeId | photo | instance |
|---|---|---|---:|---|---|---|---|---|---|
| 1 | scene_a2 / d / 0-700 | bench: benches on paved path | nadir | none | missing | no surveyed object within 8 m of the ray | bench | no | RS0001 |
| 2 | scene_a4 / r / 1100-2048 | shelter: long bus-terminal shelter (continues into b col 0-900) | 253.2 | OC0139 fence 0.1 m | missing | only fence within 8 m, none of a kind that stands for a terminal_shelter | terminal_shelter | yes | RS0002 |
| 3 | scene_a5 / r / 1450-1650 | pavilion: green octagonal gazebo/umbrella in garden | 345.2 | OC0120 gazebo 1.1 m | match OC0121 (ambiguous) | the survey's round dark-green roofed gazebo OC0121 (style matches the green octagonal roof) lies in the same walled garden; the ray passes 1.1 m from OC0120 (blue pyramid roof, claimed by sighting 4) and OC0121 sits 2.4 m from the garden ray at 329 deg: the ortho-match station (nominal 40 m error) cannot separate the two, the roof styles do | pavilion_octagon | yes | - |
| 4 | scene_a5 / d / 1300-1900 | pavilion: blue square hip-roof 정자 next to garden | nadir | OC0120 gazebo 0.8 m | match OC0120 | blue pyramid-roof gazebo OC0120 ('blue pyramid-roof gazebo in the walled garden') lies 0.8 m from the nadir strip; same object and roof colour | pavilion_hip | yes | - |
| - | scene_a5 / r / 400-2048 | garden: walled garden with lawn | 329.1 | OC0120 gazebo 0.1 m; OC0121 gazebo 2.4 m | missing | only gazebo within 8 m, none of a kind that stands for a garden_wall | garden_wall | yes | RS0003 |
| 5 | scene_a6 / l / 500-1550 | shelter: row of blue-canopy covered shelters (bike/walkway) | 177.2 | none | missing | no surveyed object within 8 m of the ray | canopy_shelter_row | yes | RS0004 |
| - | scene_a6 / l / 600-1500 | garden: tree plaza | 178.6 | none | missing | no surveyed object within 8 m of the ray | planter | yes | RS0005 |
| 6 | scene_a9 / f / 600-2048 | bench: paved plaza with tree planters and benches (also r, d) | 164.7 | none | missing | no surveyed object within 8 m of the ray | bench | no | RS0006 |
| - | scene_a9 / r / 0-2048 | garden: tree-planter plaza | 238.4 | none | missing | no surveyed object within 8 m of the ray | planter | yes | RS0007 |
| 7 | scene_a10 / f / 0-1500 | bench: tree-planter plaza with benches | 222 | OC0169 plaza_structure 0.1 m | missing | only plaza_structure within 8 m, none of a kind that stands for a bench | bench | no | RS0008 |
| 8 | scene_a10 / f / 1700-2048 | shelter: blue-white striped awning (also d) | 276.7 | none | missing | no surveyed object within 8 m of the ray | awning | yes | RS0009 |
| - | scene_a16 / f / 1280-2048 | garden: hedge lettering 진리 정의 창조 on slope (into r col 0-400) | 149 | OC0158 fence 5.1 m; OC0173 fence 6.9 m; OC0161 fence 7.7 m | missing | only fence within 8 m, none of a kind that stands for a planter | planter | yes | RS0010 |
| 9 | scene_f3 / f / 1950-2048 | shelter: red-roof tennis-court hut (into r col 0-500) | 271.6 | none | missing | no surveyed object within 8 m of the ray | hut | no | RS0011 |
| 10 | scene_a19 / b / 250-500 | shelter: bus stop shelter | 71.6 | OB0009 bus_stop_shelter 1.6 m | match OB0009 | bus_stop_shelter OB0009 lies 1.6 m from the ray (17 m out) | bus_stop_shelter | yes | - |
| 11 | scene_c1 / l / 200-900 | bench: bench rows under trees on library plaza | 173.8 | OC0081 plaza_structure 0.6 m | missing | only plaza_structure within 8 m, none of a kind that stands for a bench | bench | no | RS0012 |
| 12 | scene_c1 / b / 1000-1900 | bench: benches around pond plaza | 131.2 | OC0094 low_wall 0.6 m; OB0024 low_wall 0.7 m; OC0081 plaza_structure 1.7 m; OB0021 plaza_structure 3.3 m; OB0011 plaza_structure 5.2 m | match estimateBenches (stages/furniture.mjs, 8 plaza benches beside the pond, VR scene_c1) | the build already places estimated box benches (4 per long side) beside the oval pond OC0081 from VR scene_c1; the ray at 131 deg crosses the pond's south-east side where they stand. No surveyed bench is needed | bench | yes | - |
| 13 | scene_d2 / r / 1050-1300 | shelter: small roofed shelter/pergola with bench on central planted island | 142.7 | none | missing | no surveyed object within 8 m of the ray | pergola | no | RS0013 |
| 14 | scene_d4 / l / 1250-1450 | pavilion: 정자 (brown hip roof) beside path, left of D4 plaza | 218.6 | OC0078 gazebo 0.1 m | match OC0078 | gazebo OC0078 lies 0.1 m from the ray (29 m out) | pavilion_hip | yes | - |
| - | scene_e5 / b / 1000-1900 | garden: lawn garden with topiary shrubs | 78.1 | none | missing | no surveyed object within 8 m of the ray | planter | yes | RS0014 |
| - | scene_e7 / f / 400-1400 | garden: paved plaza with tree planter | 207.6 | OC0137 planter 0.1 m; OC0138 pergola 0.9 m | match OC0137 | planter OC0137 lies 0.1 m from the ray (25 m out) | planter | yes | - |
| - | scene_e8 / f / 500-1600 | garden: courtyard plaza with planters | 273.8 | OC0102 planter 1.1 m | match OC0102 | planter OC0102 lies 1.1 m from the ray (30 m out) | planter | yes | - |
| 15 | scene_f1 / l / 550-800 | shelter: bus stop shelter | 146.2 | none | missing | no surveyed object within 8 m of the ray | bus_stop_shelter | no | RS0015 |
| 16 | scene_f1 / d / 500-1400 | bench: two benches on sidewalk | nadir | none | missing | no surveyed object within 8 m of the ray | bench | no | RS0016 |
| 17 | scene_f2 / d / 1400-1900 | not a rest space: two green-painted EV charging bays (re-read; first noted as a green-roof hut/booth) | nadir | none | not_rest_space | the green patch is the 전기차 충전 구역 marking with wheel stops and a charger cabinet, not a roof | - | no | - |

#### Applied (todo 25, 2026-10-26)

The table above is the first pass. Applying it against the photo changed nine rows (the JSON keeps the first-pass
reason and adds `applied`, `reason_applied`, `vr_confirmed`): 7 placed as new features in `rest-spaces.geojson`
(10 features with the gate sign of todo 14), 5 retypes of survey objects the VR shows as a catalogue kind, 9 matches, 3 not rest spaces.
The first pass tested candidates by their vertices and left out `bike_rack`, which hid OC0119 and OC0153.

| # | scene | outcome |
|---|---|---|
| 1 | scene_a2 d | RS0001 three timber benches, placed from face d once the station was resected on A2's entrance and disabled bays (the ortho-match pin stood 155 m west) |
| 2 | scene_a4 r | retype OC0119 bus_stop_shelter -> terminal_shelter (the long school-bus canopy) |
| 3 | scene_a5 r | retype OC0121 gazebo -> pavilion_octagon (cantilever parasol, three tiers, deck and bench) |
| 4 | scene_a5 d | retype OC0120 gazebo -> pavilion_hip (grey panels, blue trim) |
| - | scene_a5 r | RS0003 garden_wall, white coping line traced on the photo |
| 5 | scene_a6 l | retype OC0153 bike_rack -> canopy_shelter_row (striped hoods) |
| - | scene_a6 l | match RS0007: the 'tree plaza' is the scene_a9 plaza |
| 6 | scene_a9 f | RS0006 bench, RS0007 gravel tree pit, RS0007W brick planter wall on the plaza's south edge |
| 7 | scene_a10 f | match RS0006: same plaza (the scene_a10 station stands 8 m from its corner) |
| 8 | scene_a10 f/d | match OC0153: the 'striped awning' is the bike-shelter row seen from above; no awning instance |
| - | scene_a16 f | not a rest space: the hedge lettering is a planting |
| 9 | scene_f3 r | match BLD_SCNU_R138317: the hut is the registered building F3 학생테니스장 부속 시설(마동), so no rest-space feature (its VR look, yellow timber and a red gable roof, is a follow-up for the building looks) |
| 10 | scene_a19 b | match OB0009 |
| 11 | scene_c1 l | match estimateBenches: the box benches beside the tree pits are the 8 plaza benches already drawn (VR reading 5.8 m from one) |
| 12 | scene_c1 b | match estimateBenches |
| 13 | scene_d2 r | RS0013 open shelter (flat grey roof, bench), roof traced on the photo in the planted courtyard (the station's earlier yaw 44.3 was 95 deg off) |
| 14 | scene_d4 l | retype OC0078 gazebo -> pavilion_hip (brown roof) |
| - | scene_e5 b | not a rest space: a lawn garden with topiary is a planting |
| - | scene_e7 f, scene_e8 f | match OC0137, OC0102 |
| 15 | scene_f1 l | RS0015 bus stop shelter, roof traced at the east bus bay |
| 16 | scene_f1 d | RS0016, RS0016B long benches, face d registered on the lane diamonds and the footway kerb |
| 17 | scene_f2 d | not a rest space (EV charging bays) |

### VR rest spaces (`rest-spaces.geojson`)

The rest spaces the VR shows and this survey lacks (`rest-spaces-reconciliation.json`, decision `missing`) are 9 features
for 7 sightings (plus the A19 gate sign of todo 14). Every dimension and position is an estimate (추정).

| id | kind | VR scene / face | position | photo | confidence |
|---|---|---|---|---|---|
| RS0003 | garden_wall (white coping, timber lattice) | scene_a5 / r | white coping line traced on the photo | wall | 0.6 |
| RS0006 | bench (orange timber) | scene_a9 / f | 1.1 m in front of RS0007W, where the VR bearing meets it | none | 0.4 |
| RS0007 | planter (3 x 3 m gravel tree pit) | scene_a9 / f | VR bearing and depression angle from the station | none | 0.4 |
| RS0007W | low_wall (red brick, 0.7 m) | scene_a9 / f | south edge of the paved plaza on the photo | wall | 0.5 |
| RS0013 | bus_stop_shelter / court_shelter (flat grey roof) | scene_d2 / r | grey panel roof traced in the planted courtyard | roof | 0.6 |
| RS0001 | bench x 3 (timber, 1.5 m) | scene_a2 / d | face d from the resected station (about 1 m); benches under tree shade on the photo | none | 0.4 |
| RS0015 | bus_stop_shelter | scene_f1 / l | roof traced at the east bus bay | roof | 0.6 |
| RS0016, RS0016B | bench (long, timber) | scene_f1 / d | face d registered on the lane diamonds and the footway kerb (about 1 m) | none | 0.4 |

Tolerance: traced outlines sit within 0.25 m of the photo; the planter wall RS0007W is visible only at its west end
(about 0.3 m). Duplicates: no feature lies within 3 m of a survey object of its class, no roofed rest space stands inside a building footprint (GIS or VR-only; the f3 tennis hut is the building BLD_SCNU_R138317), and the build's whole-set audit
(survey, rest spaces, lamps, estimated benches) finds no pair. Retypes, matches, not-rest-space and deferred decisions are
in the applied table above.

### VR landscape rows (2026-10-26)

The 12 landscape rows of `rest-spaces-reconciliation.json` decided `missing` were located on the NGII 2025 sheet and
in the VR cube faces and carry `applied` (`verdict`, `features`, `supplements`, `nodes`, `evidence`). Features are
`RS-LS-*` in `rest-spaces.geojson` with `photo_support` `outline` (footprint or bottom edge traced on the sheet);
surfaces are paving supplements of `../osm-ground.json`. Every dimension is an estimate (추정).

| scene / face | VR item | verdict | model |
|---|---|---|---|
| scene_a1 l | fountain pond | built | RS-LS-A1POND: coping, 2 jets, rock; water = OSM way/367126960 (the lawn reclass withdrawn) |
| scene_b1 f | stepped plaza in front of the museum | mapped | OC0096 stepped_terrace (the ortho-match station put the ray past it) |
| scene_b4 f | straight paved path across the lawn | built | three plain paving supplements: path, 8 x 8 m square, path to the road |
| scene_c1 f | stepped approach to the library | built | RS-LS-C1STEPS: 14 + 5 risers, centre and side hedges, tile landing, terrace |
| scene_c3 d | crosswalk and disabled bay | markings lane | road paint: the crossing and blue bay under the station (MK00796, MK00797, MX00231, MX01310, MX01311) are in the markings data but not drawn by the paint gate; left to the markings lane |
| scene_d1 l | outdoor stair | built | RS-LS-D1STAIR: 2 x 9 risers south of D1 (the station record is about 150 m off D1) |
| scene_d3 d | blue PM bay | built | RS-LS-D3PMRACK rack; the bay paint MX00361 is rejected by the paint gate (blue support 0.579 < 0.6): markings-lane follow-up |
| scene_d4 f | stepped entrance plaza | built | RS-LS-D4STEPS: 4 risers across the passage, forecourt sloping back to the drive |
| scene_e4 r | round planter / sculpture on the red plaza | built | RS-LS-E4STONE sign stone; red surfacing supplement of the junction |
| scene_e7 d | outdoor stair | built | RS-LS-E7STAIR: 6 + 7 + 6 risers, two landings |
| scene_e7 r | red path with crosswalk | built | red surfacing supplement of the carriageway; crossings are markings (the raised yellow crossing under the station is not in the markings data) |
| scene_f1 b | statue by the glass building | not on campus | the 순천시문화건강센터 plaza east of the arterial, outside the campus outline and EXTENT |

## VR site detail (`site-detail.geojson`)

Ground-level detail the VR stations show within about 40 m of the camera and the model lacked, for everything that is
not a tree (trees lane) and not carriageway paint (markings lane): clipped hedges and shrub masses, kerbed lawn islands
and tree pits, car-park stall rows and wheel stops, and one entrance stair. 47 features at 14 of the 38 strip stations
(a12, b2, c5 and d1 are left out), drawn by `stages/furniture.mjs` (`hedge`, `stall_row`, `planter`, `terraced_steps`).
Every position and dimension is an estimate (추정); each feature names its VR scene and face.

Method: for each station an NGII chip of +-40 m around the station (0.25 m, x3) was compared with the VR cube faces and
the nadir face turned north-up and scaled to the chip, and with the model render of the same faces (compare-vr). An
item the photo shows (`photo_support` `outline`) is traced on the chip; an item under canopy or too small for the photo
(`none`) is placed from the nadir face registered on a feature both show (a blue bay, the kerbs, the road edge), about
2-4 m. Stall rows give the aisle-end line, the stall count, the side and, where the photo shows the dividers skewed,
`divider_bearing_deg`; standard sizes: stall 2.5 x 5.0 m (주차장법 시행규칙 제3조), divider 0.1 m, wheel stop
1.6 x 0.15 x 0.12 m 0.9 m in from the stall back, clipped hedge 0.8 m wide and 1.0 m tall unless the VR reads otherwise.
Rows the markings data already paints carry `dividers: false` (only wheel stops are added). Hedge and planter features
are not shrub planters for the trees stage (no `fill: "shrub"`), so the trees lane's hedges are unchanged.

| station | VR shows, model lacked | built |
|---|---|---|
| scene_e6 | planted island with clipped masses between E6 and its car park; 10 + 12 stalls on bare asphalt | SD-E6-01..08: two stall rows (skewed as on the photo), the lawn island on a 0.15 m kerb, five clipped masses |
| scene_e3 | clipped topiary on the lawns either side of the approach road | SD-E3-01..08 (nadir face, about 3 m) |
| scene_e5 | lawn garden with topiary masses | SD-E5-01, 02, 04 |
| scene_e7 | clipped shrub bed along the E7 front | SD-E7-01 |
| scene_e8 | stall rows of the E8 car park, yellow-black wheel stops | SD-E8-01 (wheel stops), SD-E8-02 (under the canopy) |
| scene_d2 | entrance stair to D2 between two clipped beds | SD-D2-01 (12 risers), SD-D2-02, 03 |
| scene_d3 | stall row under the trees and a kerbed island with tree grates | SD-D3-01, 02 (registered on the PM bay) |
| scene_d5 | wheel stops along the D5 stall row | SD-D5-01 (17 stops; dividers already painted) |
| scene_c2 | six stalls nose-in to C2's front | SD-C2-01 |
| scene_b4 | clipped shrub masses on the lawn by the path | SD-B4-01..03 |
| scene_b7 | two boxed stall rows of the B7 car park | SD-B7-01, 02 |
| scene_a4 | nine boxed school-bus bays | SD-A4-01 (outlines; the bay lettering is paint) |
| scene_a6 | stall rows along A6 | SD-A6-01, 02 |
| scene_a10 / a9 | clipped hedge on the plaza's north bed; square tree pits | SD-A10-01, SD-A10-P1..P7 (pits at the tree inventory's trunks) |
| scene_f2 | two stall rows of the concrete car park between F1 and F2 | SD-F2-01, 02 |

The other stations show nothing of this class the model lacks within 40 m, or only items left for other lanes: the
drone stations 001 and 002 (100 m up), the sports fields a15 and a16 (the hedge lettering 진리 정의 창조 on the a16 slope is
a follow-up: it needs letter-shaped geometry), road junctions a17 and a19 and b1, f1 and f3 (already modelled), and a1,
a2, a3, a5, a8, a13, b3, c1, c3, d4, e1 and e4, where the remaining differences are trees or paint. The clipped shrub
balls on the e2 lawn are left out: that nadir face could not be registered on the photo within 3 m.

## Licence

Source: **국토지리정보원 (NGII), 정사영상 2025, sheet 34702020 (순천020)**, metadata 202504000734702020, made by
중앙항업㈜ for the 전남동부권역 25 cm project, 공개 grade. The features here are vectors traced from that photo.
The NGII KOGL status is still **unknown** (decision D2 in `docs/data-licences.md`). Record the attribution
below, and do not ship these files in a public build until D2 is settled:
`본 저작물은 국토지리정보원에서 작성한 '정사영상(2025)'을 이용하였습니다.` See the NGII 2025 row in `docs/data-licences.md`.
