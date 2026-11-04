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
Unreviewed LOD4 mass edges outside the 0.3 m GIS containment buffer keep the
legacy look. A reviewed `surfaceEdges` entry may name the exact registered
source edge with EPSG:5186 `A`, `B` and a source identity. Both endpoints must
match within 1 mm; this does not widen the automatic buffer or move GIS walls.
Bay positions and pitch remain wall-local and are not stretched to the mass.
Reviewed overhangs receive end caps rather than uncovered strips.

Set `outside:"legacy"` for a partial count whose prefix or suffix is not
observed. Those intervals retain the building's existing material rather than
being invented blank walls. Their pixels do not count as an applied grid.

`../facade-review.json` is the authoritative building-by-building review ledger.
It records the observed scenes, the LOD4 record (including explicit absences),
and a specific reason for the remaining ungridded walls. The build copies that
reason to `facadeFallbackReason` on both selectable meshes and pick proxies.
Missing review records fail the build rather than receiving a generic reason.
Each newly curated wall includes an independently read LOD4 or VR bay count
and identifies the counted image interval. A partial wall grid does not
certify the building's other faces. Blank auditorium or gable walls explicitly
use `blank` cells rather than inventing repeated windows.
Five additional anonymous GIS campus footprints have no BLD ID or saved wall
frames. They are reviewed by their full source ID, reported separately, and
their reasons also ship in `CampusBuildings.extras.facadeReviews`. A record
being reviewed does not imply it passes the generator's minimum-area selection.

Run `bun scripts/campus-model/qa/facadeCoverage.mjs --built --out /private/tmp/facades.json`
to report coverage and every entrance. The door's texture centre is compared
with the canopy anchor, not the enclosing structural bay's centre. A door on an
ungridded wall is explicitly `ungridded`, with no numerical alignment claim.
`--built` also rejects any requested wall or reviewed source-edge binding
absent from the generated GLB's applied lists. A partial application cannot hide
another missing binding. A JSON grid alone is not a successful application.

The E3 ground entrance is recessed in VR. Its wall record explicitly opens
the projecting masonry using `recesses` (`entrance`, `backM`, `depthM`, `hM`).
The canopy anchor and 3.6 m door width are unchanged. The cut leaves the rear
door plane, side piers and upper wall intact and only applies within the
recorded ground-storey volume.

Run `bun scripts/campus-model/qa/facadeMesh.mjs` to check the actual compressed
GLB. It joins only edge-connected triangles with continuous texture
coordinates, because exposure can split one doorway into several quads.
A missing piece, a gap or an adjacent wall tile cannot extend that patch.
The complete exposed patch centre must be within 0.3 m of SD-E5-C1.
The same probe still rejects the unmodified attempt-1 GLB. The separate
SD-E5-C2 bearing gap of +2.120 degrees remains recorded, not reclassified.

Source-only commits do not update the tracked GLB or AO binaries. Keep generated
outputs local and associate their hashes with the source commit. Before the
artifact-aware tests, rebuild from the current source (from `frontend/`):

```bash
bun scripts/campus-model/build-campus-model.mjs
bun scripts/campus-model/bake/bake-ao.mjs
bun scripts/campus-model/bake/bake-ao.mjs --planar
bun run model:build
```

The raw build supplies geometry to the deterministic AO bake; the final build
packs those maps. A clean source archive must repeat this sequence, not copy
uncommitted AO maps into its inputs. The asset tests intentionally reject stale
generated files rather than skipping or trusting a compiled grid.
