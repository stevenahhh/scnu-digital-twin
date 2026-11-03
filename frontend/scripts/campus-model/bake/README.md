# Building ambient-occlusion bake

`bake-ao.mjs` bakes contact darkening (under parapets, between wings, at the ground line) for the
campus buildings into one 8-bit grey atlas, `../data/ao-buildings.png`. The dashboard applies it as
the glTF `occlusionTexture` (three.js `aoMap`, UV channel 1), so it costs one texture fetch per
fragment and nothing per frame. The values come from a geometric simulation of the generated model
(estimated), not from a measurement.

## How it fits together

1. `stages/buildings.mjs` gives every facade and roof primitive (`Facade_*`, `Roof_Membrane`,
   `Roof_Parapet`, `Roof_Equipment`) a `TEXCOORD_1` into the atlas. Each wall ring is unrolled into
   charts of (distance along the ring, depth below the wall top), cut at a corner after 80 m; each
   roof and roof-equipment top is a chart of its XZ bounding box. The charts are shelf-packed into
   2048 x 2048 with 4 px gutters at the finest texel size that fits (currently about 0.35 m/texel,
   about 73 % of the atlas). The layout is deterministic, and its hash is written to the raw GLB as
   `asset.extras.aoLayout`.
2. `bake-ao.mjs` reads the raw GLB, rasterises the target primitives in UV1 space and, for each
   covered texel, casts 64 stratified cosine-weighted hemisphere rays of 3 m. The occluders are the
   buildings and the terrain (`BLD_*`, `CampusBuildings`, `Topography_*`, `OuterTerrain`); the trees are
   left out, and so are pick proxies (nodes with `extras.pickProxy`, the invisible `BLD_SCNU_*` prisms):
   they enclose the campus roofs up to the parapet top, and as occluders they baked those roofs black. The rays are cast with three-mesh-bvh on all cores but one. The texel value is the
   unoccluded fraction. After one 3 x 3 smoothing pass inside the charts and a 4 px dilation into the
   gutters, the script writes a grey PNG whose `tEXt` chunk carries the layout hash.
3. On the next build, `stages/buildings.mjs` attaches the PNG as `occlusionTexture { texCoord: 1 }`
   to those materials, but only when its hash matches the current layout. A stale atlas is left out
   with a warning rather than mapped onto the wrong texels. `pack.mjs` turns it into WebP like every
   other texture.

## Re-baking after a geometry change

Run from `frontend/`:

```sh
bun run model:build                       # 1. raw GLB with the new TEXCOORD_1 layout
bun scripts/campus-model/bake/bake-ao.mjs # 2. bake data/ao-buildings.png from .build/campus-v2.raw.glb
bun run model:build                       # 3. rebuild + pack with the atlas attached
```

Step 1 also works from an empty `.build/`. Re-bake whenever building geometry changes: footprints,
heights, the building set or roof equipment. Changes that leave the chart layout unchanged (such as
moving a neighbouring building) keep the old hash, so the stale atlas is still attached. Re-bake for
those as well.

Options, all optional:

```text
bun scripts/campus-model/bake/bake-ao.mjs [raw.glb] [out.png] [size=2048] [rays=64]
    [--materials Facade_*,Roof_*]                            target materials (glob list)
    [--occluders BLD_*,CampusBuildings,Topography_*,OuterTerrain]  occluder nodes (a match covers children)
    [--distance 3]                                           AO ray length in metres
    [--workers N]                                            default: CPU cores - 1
```

`--materials` and `--occluders` let the same script bake other surfaces into their own TEXCOORD_1
layout, for example ground AO.

## Ground AO (`--planar`)

`stages/ground.mjs` gives every `Topography_*` chunk a planar `TEXCOORD_1 = ((x - minX) / 504,
(z - minZ) / 378)` over the terrain extent and records the tag `asset.extras.aoGroundLayout`.
`bun scripts/campus-model/bake/bake-ao.mjs --planar` bakes `../data/ao-ground.png` (1024 x 1024 grey,
about 0.8 x 0.6 m per texel) for the `Ground` material on `Topography_*` nodes. OuterTerrain's material
is also named `Ground`, so `--targets` filters by node name. The occluders are the buildings and the
tree crowns (`BLD_*,CampusBuildings,Trees_*_crown`, instanced meshes expanded per instance). Trunks are
left out because at 0.6-0.8 m per texel they only add speckle under the crown. The ray length is 6 m
because the crowns start several metres above the ground, so 4 m rays barely reach them (mean 0.87,
mostly trunk dots). At 6 m the mean is about 0.79. On the next build, `stages/ground.mjs` attaches the
PNG as the Topography `Ground` material's `occlusionTexture { texCoord: 1 }` when its tag matches. The
tag only encodes the extent and size, so re-bake after any building or tree change:

```sh
bun run model:build                                  # raw GLB with the planar TEXCOORD_1
bun scripts/campus-model/bake/bake-ao.mjs --planar   # about 8 s on the M5 Pro
bun run model:build
```

As with the building atlas, the values come from a geometric simulation (estimated), not from a
measurement.

On the M5 Pro the bake takes about 21 s (2.3 M texels x 64 rays against about 126 k triangles). The
mean over covered texels is about 0.88. The open flat roofs dominate that mean; the darkening sits
in the contact zones. In the packed GLB the atlas is a 164 KB WebP and the AO UVs add 44 KB.
