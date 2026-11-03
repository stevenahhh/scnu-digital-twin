# Wall facade grids

These JSON files are the curated source records, not generated outputs. Edit the
record when the evidence changes. `fit/facadeBays.mjs` writes local proposals and
overlay chips; it never overwrites these files.

Every record is `estimated:true`. `walls` uses the IDs from `wallsOf` on
`loadTmFootprints`, with the saved `bld-node-map.json` wall snapshots checked before
use. Missing or stale snapshots fail the build. A missing grid retains the legacy
look and the node carries `facadeEstimated:true` and `facadeFallbackReason`.

`bays.offsetM` is the left edge of the first bay measured from wall A; pitch and
count do not stretch to fill the wall. Cells are `[storey][bay]`, ground first.
A null row uses `default`, except an `entrances.json` anchor supplies its ground
door cell. An explicit incompatible cell, a door without an anchor, or two
entrances sharing a bay is an error. Wall `window` gives dimensions in metres.
`overrides: [{storey, bay, cell?, window?}]` changes a single cell.

Supported kinds are `window`, `blank`, `door`, `glazing`, `louver`, `stair`, `vent`.
`accents.piers` and `accents.frames` select bay indices; `accents.band` spans the
storey. The existing facade atlas and its legacy tiles remain in use.

```bash
bun scripts/campus-model/fit/facadeBays.mjs \
  --image /private/tmp/lod4/E5.png --crop 730,14,145,64 \
  --building BLD_E5 --wall W25 --storeys 4 --vr-count 10 \
  --out /private/tmp/E5-W25-proposal
```

The crop must cover one wall and exclude image padding. Ambiguous, flat and
partly cropped rhythms fail rather than inventing bays. The row profile is
included for inspection; the storey count stays GIS/VR-derived and the proposal
divides the wall height by that count. Photographs never supply world position.

E3 W16 now has a fourteen-structural-bay pilot, compared with two independent
VR readings in `../facade-counts.json`. Its LOD4 source exists: the former fixed
40 m seam cutoff wrongly removed the long wall. The recovered photo supports
the repetitive layout, but its whole-wall end-group count is still uncertified.
The Orchestrator decision of 2026-11-03 accepts the independent VR per-wall
count for E3 only; E5 still requires its LOD4 comparison. `lod4BayCount:null`
does not misrepresent the substitute as a successful LOD4 comparison. A wide glazing
group occupies two structural bays, rather than one bay per glass pane.
Doors crossing a bay boundary retain their full anchored width; neighbouring
cells are clipped with their original UV range, not squeezed.
Do not substitute scene names for building IDs: `scene_e5 r` mostly shows
**E3**, while `scene_e5 f` shows E5.
Unmatched LOD4 mass edges outside the 0.3 m GIS containment buffer also keep the
legacy look, without moving the GIS frame to fit a photograph.

`../facade-review.json` is the authoritative building-by-building review ledger.
It records the observed scenes, the LOD4 record (including explicit absences),
and a specific reason for the remaining ungridded walls. The build copies that
reason to `facadeFallbackReason` on both selectable meshes and pick proxies.
Missing review records fail the build rather than receiving a generic reason.
The two approved grids are not evidence that the other 48 buildings match VR.
Five additional anonymous GIS campus footprints have no BLD ID or saved wall
frames. They are reviewed by their full source ID, reported separately, and
their reasons also ship in `CampusBuildings.extras.facadeReviews`. A record
being reviewed does not imply it passes the generator's minimum-area selection.

Run `bun scripts/campus-model/qa/facadeCoverage.mjs --out /private/tmp/facades.json`
to report coverage and every entrance. The door's texture centre is compared
with the canopy anchor, not the enclosing structural bay's centre. A door on an
ungridded wall is explicitly `ungridded`, with no numerical alignment claim.
This checks compiled cells, not mass exposure in the final mesh. The E3 W16
texture centre agrees with its anchor, but the merged model clips 1.560 m from
the doorway's left side: the exposed cell centre differs by 0.780 m, exceeding
0.3 m. That is a named task-27 gap, separate from the existing E3 C2 bearing
gap of +2.120 degrees. Do not report the CLI's `aligned` as a rendered pass.
