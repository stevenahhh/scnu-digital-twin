# Facade and roof detail-map sources (U42)

Every file in this directory is a downscaled copy of a **CC0 1.0** (public domain dedication)
texture from Poly Haven. Licence: https://polyhaven.com/license ("Our assets are all licensed as
CC0", read 2026-10-24). No attribution is required; the authors are credited here anyway.

`lib/textures.mjs` resamples these tiles to their physical size on the facade atlas, combines them
with the painted layout (window recesses, frames, sills, mortar joints) and writes per-style
`normalTexture` and `metallicRoughnessTexture` maps into the GLB. Only the green (roughness)
channel of the `arm` maps is used; red (AO) and blue (metal) are ignored.

| File | Poly Haven asset | Authors | Tile size | Source file (1k JPEG) | MD5 of the source |
|---|---|---|---|---|---|
| `brick-nor.webp`, `brick-arm.webp` | [red_brick_03](https://polyhaven.com/a/red_brick_03) | Rob Tuytel | 1.0 m | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/red_brick_03/red_brick_03_nor_gl_1k.jpg , https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/red_brick_03/red_brick_03_arm_1k.jpg | `e89ce432d9160edb7c902f901756865f`, `1b5472dd06888c7cf7db63e692e03978` |
| `concrete-nor.webp`, `concrete-arm.webp` | [concrete_wall_004](https://polyhaven.com/a/concrete_wall_004) | Dario Barresi, Charlotte Baglioni | 2.0 m | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/concrete_wall_004/concrete_wall_004_nor_gl_1k.jpg , https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/concrete_wall_004/concrete_wall_004_arm_1k.jpg | `aabe52218b302ea0a12990da25ed60ed`, `aab832f10b332076ddf214509b798f69` |
| `beige-nor.webp`, `beige-arm.webp` | [rough_plaster_03](https://polyhaven.com/a/rough_plaster_03) | Rob Tuytel | 1.5 m | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/rough_plaster_03/rough_plaster_03_nor_gl_1k.jpg , https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/rough_plaster_03/rough_plaster_03_arm_1k.jpg | `f476fad1fc322803c2cfe87de8e0046c`, `8ae336a10b2a3ed1343f2f124a2e88d1` |
| `roof-nor.webp`, `roof-arm.webp` | [concrete_floor_painted](https://polyhaven.com/a/concrete_floor_painted) | Rob Tuytel | 2.0 m | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/concrete_floor_painted/concrete_floor_painted_nor_gl_1k.jpg , https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/concrete_floor_painted/concrete_floor_painted_arm_1k.jpg | `95eeeb46f335e3b4ba76340193dc1b7d`, `8ad80eab6096e33d054068bab91c22a4` |

URLs and MD5s come from the Poly Haven files API (`https://api.polyhaven.com/files/<asset>`), and
tile sizes from `https://api.polyhaven.com/info/<asset>` (`dimensions`, mm). Downloaded 2026-10-24.
Each download matched the API MD5.

Conversion (Bun 1.4 `Bun.Image`): 1k JPEG -> `resize(256, 256)` -> WebP quality 92, e.g.

```js
await Bun.file("red_brick_03_nor_gl_1k.jpg").image().resize(256, 256).webp({ quality: 92 }).write("brick-nor.webp");
```

The glass-curtain and greenhouse styles use no external texture: their relief and roughness come only
from the painted layout. Surface roughness values per style (brick 0.9, concrete 0.85, render 0.8,
glass 0.1, roof 0.95) are assumed starting values (BUILD-PLAN U42), not measurements.

<!-- ground-materials:start (written by fetch/groundMaterials.mjs) -->

## Ground material tiles (plan uhf-ground-roads-routing, todo 4)

CC0 1.0 tiles from Poly Haven (https://polyhaven.com/license) and ambientCG (https://ambientcg.com/license), downloaded 2026-10-26
by `fetch/groundMaterials.mjs` and converted to 1024 x 1024 WebP (quality 90): colour, normal (GL) and ARM (R AO, G
roughness, B metal; AO 255 and metal 0 where a source has none). MD5s are of the downloaded files (Poly Haven, checked
against its files API) or of the ambientCG 1K-JPG zip. Tile sizes come from the provider APIs; the manifest is
`ground-materials.json`.

| File | Asset | Authors | Tile size | Source file | MD5 of the source |
|---|---|---|---|---|---|
| `ground-asphalt-col.webp`, `ground-asphalt-nor.webp`, `ground-asphalt-arm.webp` | [asphalt_02](https://polyhaven.com/a/asphalt_02) (Poly Haven) | Rob Tuytel | 3.00 m | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/asphalt_02/asphalt_02_diff_1k.jpg , https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/asphalt_02/asphalt_02_nor_gl_1k.jpg , https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/asphalt_02/asphalt_02_arm_1k.jpg | `fa19772d4817754c3efab708c651f5a8`, `338da8de636ea36133170578cac82e8e`, `33820445f43af5e5ee484674b6939271` |
| `ground-pavers-col.webp`, `ground-pavers-nor.webp`, `ground-pavers-arm.webp` | [PavingStones150](https://ambientcg.com/view?id=PavingStones150) (ambientCG) | ambientCG | 0.90 m | https://ambientcg.com/get?file=PavingStones150_1K-JPG.zip | `2c7b9276e09ac4be736fe48eaf95e39f` |
| `ground-concrete-col.webp`, `ground-concrete-nor.webp`, `ground-concrete-arm.webp` | [Concrete034](https://ambientcg.com/view?id=Concrete034) (ambientCG) | ambientCG | 1.10 m | https://ambientcg.com/get?file=Concrete034_1K-JPG.zip | `86e6572ed6cffec20639c3d8168f0ffd` |
| `ground-grass-col.webp`, `ground-grass-nor.webp`, `ground-grass-arm.webp` | [Grass004](https://ambientcg.com/view?id=Grass004) (ambientCG) | ambientCG | 1.40 m | https://ambientcg.com/get?file=Grass004_1K-JPG.zip | `ede3ecdf304e4c95212d7ec4157d2e74` |
| `ground-soil-col.webp`, `ground-soil-nor.webp`, `ground-soil-arm.webp` | [Ground111](https://ambientcg.com/view?id=Ground111) (ambientCG) | ambientCG | 2.80 m | https://ambientcg.com/get?file=Ground111_1K-JPG.zip | `59e7145dceaef3181e6405fde2f665a1` |
| `ground-asphalt-red-col.webp`, `ground-asphalt-red-nor.webp`, `ground-asphalt-red-arm.webp` | [Asphalt029A](https://ambientcg.com/view?id=Asphalt029A) (ambientCG) | ambientCG | 2.50 m (estimated) | https://ambientcg.com/get?file=Asphalt029A_1K-JPG.zip | `6d880dc609d50e6067a1b5c8cb5290d0` |
| `ground-lot-col.webp`, `ground-lot-nor.webp`, `ground-lot-arm.webp` | [concrete_floor_worn_001](https://polyhaven.com/a/concrete_floor_worn_001) (Poly Haven) | Dimitrios Savva, Rico Cilliers | 3.00 m | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/concrete_floor_worn_001/concrete_floor_worn_001_diff_1k.jpg , https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/concrete_floor_worn_001/concrete_floor_worn_001_nor_gl_1k.jpg , https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/concrete_floor_worn_001/concrete_floor_worn_001_arm_1k.jpg | `e35597cca586150b1ab2aa9a331a39c5`, `9de6626758f8793b71182b892c110827`, `8174fe8a5c982edef079c3c3775e5377` |

<!-- ground-materials:end -->

<!-- d4-materials:begin -->

## D4 (BLD_D4 and its surroundings)

Records: `d4-materials.json` (`materials` for ground, `buildingMaterials` for the D4 facade, roof, soffit, pier and trim sets; download URLs and md5 per map). `d4-atlas.json` maps the D4 facade detail classes onto these sets.

| Files | Source | Authors | Licence | Tile size |
|---|---|---|---|---|
| `ground-d4-pavers-col.webp`, `ground-d4-pavers-nor.webp`, `ground-d4-pavers-arm.webp` | [square_concrete_pavers](https://polyhaven.com/a/square_concrete_pavers) (Poly Haven) | Amal Kumar | CC0 1.0 | 1.8 m (estimated) |
| `ground-d4-asphalt-col.webp`, `ground-d4-asphalt-nor.webp`, `ground-d4-asphalt-arm.webp` | [asphalt_02](https://polyhaven.com/a/asphalt_02) (Poly Haven) | Rob Tuytel | CC0 1.0 | 3 m (estimated) |
| `ground-d4-soil-col.webp`, `ground-d4-soil-nor.webp`, `ground-d4-soil-arm.webp` | [sparse_grass](https://polyhaven.com/a/sparse_grass) (Poly Haven) | Amal Kumar | CC0 1.0 | 2 m (estimated) |
| `ground-d4-passage-col.webp`, `ground-d4-passage-nor.webp`, `ground-d4-passage-arm.webp` | [large_grey_tiles](https://polyhaven.com/a/large_grey_tiles) (Poly Haven) | Rob Tuytel | CC0 1.0 | 3 m (estimated) |
| `ground-d4-granite-col.webp`, `ground-d4-granite-nor.webp`, `ground-d4-granite-arm.webp` | [granite_tile](https://polyhaven.com/a/granite_tile) (Poly Haven) | Charlotte Baglioni | CC0 1.0 | 2.3 m (estimated) |
| `ground-d4-slate-col.webp`, `ground-d4-slate-nor.webp`, `ground-d4-slate-arm.webp` | [stone_tiles_02](https://polyhaven.com/a/stone_tiles_02) (Poly Haven) | Charlotte Baglioni | CC0 1.0 | 2 m (estimated) |
| `ground-d4-terracotta-col.webp`, `ground-d4-terracotta-nor.webp`, `ground-d4-terracotta-arm.webp` | [red_brick_pavers](https://polyhaven.com/a/red_brick_pavers) (Poly Haven) | Amal Kumar | CC0 1.0 | 1.8 m (estimated) |
| `ground-d4-tactile-base-col.webp`, `ground-d4-tactile-base-nor.webp`, `ground-d4-tactile-base-arm.webp` | [concrete_pavers_02](https://polyhaven.com/a/concrete_pavers_02) (Poly Haven) | Amal Kumar | CC0 1.0 | 2 m (estimated) |
| `ground-d4-retaining-rock-col.webp`, `ground-d4-retaining-rock-nor.webp`, `ground-d4-retaining-rock-arm.webp` | [rock_embedded_concrete_wall](https://polyhaven.com/a/rock_embedded_concrete_wall) (Poly Haven) | Dimitrios Savva | CC0 1.0 | 1.76 m (estimated) |
| `ground-d4-retaining-concrete-col.webp`, `ground-d4-retaining-concrete-nor.webp`, `ground-d4-retaining-concrete-arm.webp` | [concrete_slab_wall](https://polyhaven.com/a/concrete_slab_wall) (Poly Haven) | Dimitrios Savva | CC0 1.0 | 2.3 m (estimated) |
| `ground-d4-footway-col.webp`, `ground-d4-footway-nor.webp`, `ground-d4-footway-arm.webp` | [patterned_paving](https://polyhaven.com/a/patterned_paving) (Poly Haven) | Charlotte Baglioni | CC0 1.0 | 2 m (estimated) |
| `ground-d4-concrete-col.webp`, `ground-d4-concrete-nor.webp`, `ground-d4-concrete-arm.webp` | [Concrete034](https://ambientcg.com/view?id=Concrete034) (ambientCG) | ambientCG | CC0 1.0 | 1.1 m (estimated) |
| `ground-d4-grass-col.webp`, `ground-d4-grass-nor.webp`, `ground-d4-grass-arm.webp` | [Grass004](https://ambientcg.com/view?id=Grass004) (ambientCG) | ambientCG | CC0 1.0 | 1.4 m (estimated) |
| `ground-d4-treepit-col.webp`, `ground-d4-treepit-nor.webp`, `ground-d4-treepit-arm.webp` | [Bricks105](https://ambientcg.com/view?id=Bricks105) (ambientCG) | ambientCG | CC0 1.0 | 2.4 m (estimated) |
| `ground-d4-trim-col.webp`, `ground-d4-trim-nor.webp`, `ground-d4-trim-arm.webp` | [white_plaster_02](https://polyhaven.com/a/white_plaster_02) (Poly Haven) | Rob Tuytel | CC0 1.0 | 1 m (estimated) |
| `ground-d4-pier-col.webp`, `ground-d4-pier-nor.webp`, `ground-d4-pier-arm.webp` | [concrete_tile_facade](https://polyhaven.com/a/concrete_tile_facade) (Poly Haven) | Charlotte Baglioni | CC0 1.0 | 2.09 m (estimated) |
| `ground-d4-endwall-col.webp`, `ground-d4-endwall-nor.webp`, `ground-d4-endwall-arm.webp` | [granite_tile_04](https://polyhaven.com/a/granite_tile_04) (Poly Haven) | Amal Kumar | CC0 1.0 | 2 m (estimated) |
| `ground-d4-steel-col.webp`, `ground-d4-steel-nor.webp`, `ground-d4-steel-arm.webp` | [metal_plate_02](https://polyhaven.com/a/metal_plate_02) (Poly Haven) | Rob Tuytel | CC0 1.0 | 2 m (estimated) |
| `ground-d4-soffit-col.webp`, `ground-d4-soffit-nor.webp`, `ground-d4-soffit-arm.webp` | [painted_metal_shutter](https://polyhaven.com/a/painted_metal_shutter) (Poly Haven) | Dario Barresi, Rico Cilliers, Charlotte Baglioni | CC0 1.0 | 2 m (estimated) |
| `ground-d4-roof-south-col.webp`, `ground-d4-roof-south-nor.webp`, `ground-d4-roof-south-arm.webp` | [bitumen](https://polyhaven.com/a/bitumen) (Poly Haven) | Rob Tuytel | CC0 1.0 | 20 m (estimated) |
| `ground-d4-roof-north-col.webp`, `ground-d4-roof-north-nor.webp`, `ground-d4-roof-north-arm.webp` | [grey_roof_01](https://polyhaven.com/a/grey_roof_01) (Poly Haven) | Rob Tuytel | CC0 1.0 | 8 m (estimated) |
| `ground-d4-painted-col.webp`, `ground-d4-painted-nor.webp`, `ground-d4-painted-arm.webp` | [concrete_floor_painted](https://polyhaven.com/a/concrete_floor_painted) (Poly Haven) | Rob Tuytel | CC0 1.0 | 2 m (estimated) |
| `ground-d4-penthouse-col.webp`, `ground-d4-penthouse-nor.webp`, `ground-d4-penthouse-arm.webp` | [concrete_wall_008](https://polyhaven.com/a/concrete_wall_008) (Poly Haven) | Dario Barresi, Charlotte Baglioni | CC0 1.0 | 2.71 m (estimated) |
| `ground-d4-grating-col.webp`, `ground-d4-grating-nor.webp`, `ground-d4-grating-arm.webp` | [rusty_metal_grid](https://polyhaven.com/a/rusty_metal_grid) (Poly Haven) | Amal Kumar | CC0 1.0 | 1.8 m (estimated) |
| `ground-d4-facade-col.webp`, `ground-d4-facade-nor.webp`, `ground-d4-facade-arm.webp` | [Facade018A](https://ambientcg.com/view?id=Facade018A) (ambientCG) | ambientCG | CC0 1.0 | 13 m (estimated) |

<!-- d4-materials:end -->
