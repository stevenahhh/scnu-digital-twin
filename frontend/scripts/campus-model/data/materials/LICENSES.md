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
