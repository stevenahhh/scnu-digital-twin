# Road sections and junctions

`fit/roadSections.mjs` proposes records. It does not publish markings and never
overwrites `road-sections.json` or `junctions.json`. Todo 23 owns the generator;
todo 24 owns campus-wide curation. Photo pixels and chip sheets stay outside Git.

From the repository root, run tests through `frontend/scripts/lab/lab-test.mjs`.
From `frontend/`, run the estimator through the heavy-command wrapper:

```sh
/Users/gahn/.cache/scnu-heavy/scnu-heavy bun scripts/campus-model/fit/roadSections.mjs \
  --segment RD_093 \
  --out /private/tmp/road-sections.proposals.json \
  --chips /private/tmp/road-section-chips
bun scripts/campus-model/lib/schemas.mjs roadSections /private/tmp/road-sections.proposals.json
```

The input is `backend/simulation/data/road_segments.geojson`, using each
feature's `properties.epsg5186` paths. `pathIndex` separates branches of a
MultiLineString. Distances start at each path's first vertex. Positive lateral
offset is left of the directed path. Sections are ordered, non-overlapping
`fromM`/`toM` intervals. Optional `splitAtM` lists internal boundaries on path 0.
Widths, kerb offsets, lane counts and other unreviewed values remain estimates.

`validate("roadSections", document)` accepts a segment-keyed object:

```json
{
  "RD_093": {
    "sections": [{
      "pathIndex": 0,
      "fromM": 0,
      "toM": 20,
      "lanes": [{"dir": "fwd", "widthM": 3.25}, {"dir": "bwd", "widthM": 3.25}],
      "centre": {"type": "yellow_solid", "widthM": 0.15},
      "edges": {"left": "none", "right": "none"},
      "lateralOffsetM": 0,
      "kerbOffsetsM": {"left": 3.25, "right": 3.25},
      "kerbNoParking": {"left": false, "right": false},
      "humps": [],
      "evidence": {"tier": "T4", "refs": ["illustrative example, not surveyed"], "photoSupport": null},
      "estimated": true,
      "reason": "Illustrative schema record only; not campus curation."
    }]
  }
}
```

Centre types are `none`, `yellow_solid`, `yellow_double`, `yellow_dashed`.
Edge types are `none`, `white_solid`, `white_dashed`, `yellow_solid`,
`yellow_dashed`. A hump has `atM`, `lengthM`, `heightM`, and `bands`.
`dashPhaseM`, if supplied, is nonnegative.

The estimator samples profiles every 0.5 m, excludes the building/crown/shadow
mask, and requires 60% visible-length yellow support. Two separated peaks in
the one-metre transverse profile indicate a double line. Lesser support does
not prove absence: a section may need splitting, a better centreline, or VR
review. All-hidden input is T4 with null support, never a zero measurement.
Arrow and text detections become `markingCandidates` with along-path and
signed lateral coordinates. Their direction or text is not guessed from blobs.
Chip sheets show the photo beside the masked photo and the proposed reference
line in cyan, including when no painted centre line is proposed.

`validate("junctions", document)` accepts a network-node-keyed object. Each
node has `approaches`; each approach has:

- `segment`, `pathIndex` (default 0), and `end: "from" | "to"`.
- `stopLineSetbackM` (null or distance from that endpoint).
- `crossing` (null or `{widthM, offsetM, zebraPeriodM, barWidthM}`).
- `arrows: [{type, lane, atM}]` and `text: [{text, lane, atM}]`.
  Arrow types: `straight`, `left`, `right`, `straight_left`, `straight_right`,
  `uturn`. Lane indices are zero-based.
- `humps`, `signalArms: [{bearingDeg, lengthM}]`,
  `yieldTriangles: [{points}]`, and `guideLines: [{points}]`.
  Points are EPSG:5186; angles are clockwise from north.
- `evidence`, `estimated`, and a `reason` for T4.

`road-parcels.json` is a separate reviewed ground-boundary seed. It is applied
after legacy support ids are allocated, preserving parking references. A
replaced support becomes `source: "photo-curated"`; its old name is only a
compatibility key. Final paint exclusions are recomputed against the complete
parcel map so a newly reviewed road can restore previously excluded bars.

The initial road-parcel curation corrects the E3 arc island's east flank and
the missing road under three existing zebra bars near TM (244084,263874).
The other legacy support hulls are not claimed to be reviewed road records.
