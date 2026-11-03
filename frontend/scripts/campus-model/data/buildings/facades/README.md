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

E3 W16 is not approved: its LOD4 unroll has a large missing centre. The VR count
cannot be certified against that missing source. Do not substitute scene names
for building IDs: `scene_e5 r` mostly shows **E3**, while `scene_e5 f` shows E5.
Unmatched LOD4 mass edges outside the 0.3 m GIS containment buffer also keep the
legacy look, without moving the GIS frame to fit a photograph.
