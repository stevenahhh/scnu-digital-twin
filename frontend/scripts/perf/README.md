# Legacy dashboard perf bench

`bench.mjs` is a headless benchmark that runs on the real GPU and scores the Legacy
(Three.js) dashboard. It is a dev-only tool and adds 0 shipped bytes.

## Run

Start a vite dev server, then point the bench at it:

```bash
cd frontend
bunx vite --host 127.0.0.1 --port 5181 --strictPort        # or: bun run dev:legacy (5173)
bun scripts/perf/bench.mjs http://127.0.0.1:5181/ <label> ../.omo/ulw-research/20261023-181400/qa/results/
```

To compare two builds, interleave them (runs go A B A B ...):

```bash
bun scripts/perf/bench.mjs http://127.0.0.1:5181/ before <outDir> --compare http://127.0.0.1:5182/ after
```

| Option | Default | Meaning |
|---|---|---|
| `--runs` | 5 | Fresh-profile Chrome launches per config. Keep at least 5. |
| `--cdp` | 9351 | Chrome remote-debugging port. |
| `--width` / `--height` | 1920 / 1080 | Viewport at device scale factor 1. Use 1440 x 900 or 390 x 844 for A8 screenshots. |
| `--warmup` / `--frames` | 60 / 300 | Frames discarded and frames timed for each camera. |
| `--clock` | `2026-10-24T15:00:00+09:00` | Pinned page clock. The sun position follows it, so it is fixed by default. |
| `--chrome` | system Google Chrome | Chrome binary. |
| `--live-backends` | off | Let requests reach the local weather, vision and simulation services (`127.0.0.1:80*`). By default they get a 404 so that a missing service can't add console errors: the `d4` camera is within the app's 120-unit proximity radius and opens building popups. |
| `--orbit` | 0 | Seconds of one camera turn around the origin (260 units out, 180 up) after the fixed views, invalidating the R3F store every frame. Writes `orbit.fps` (rendered frames per second) and `orbit.low1` (1000 / mean of the slowest 1 % of frame intervals). |
| `--dpr` | 1 | Device scale factor of the emulated screen. |

You need the **vite dev server**. The bench imports the same `three` module the
app uses, from `/node_modules/.vite/deps/three.js`, so it does not work against a
production `dist/` build.

## What it does

- Starts Chrome with `--headless=new --use-angle=metal` and a new
  `--user-data-dir` on every run, with the HTTP cache disabled and the
  timezone set to Asia/Seoul. It aborts if `UNMASKED_RENDERER_WEBGL` reports
  SwiftShader.
- Patches `THREE.Scene.prototype.onBeforeRender` / `onAfterRender`, which three
  (r163 and r186) calls once per `render()`, around both the shadow pass and the main pass.
  The `onBeforeRender` hook:
  - grabs the renderer and sets `renderer.info.autoReset = false`;
  - calls `renderer.info.reset()` at frame start, so shadow-pass draws are counted
    (r163 resets `info` after `shadowMap.render`, r186 before it);
  - pins the camera to the current view;
  - wraps the frame in `EXT_disjoint_timer_query_webgl2` `TIME_ELAPSED_EXT`
    queries.

  If `GPU_DISJOINT_EXT` is raised, the in-flight samples are dropped and counted
  in `disjointDropped`.
- Hooks `WebGL2RenderingContext` draw calls as a cross-check (`drawCallsGl`,
  `trianglesGl`). These hooks also count the 2-second idle window.
- Measures three cameras, the A8 views (+x east, +z south, scene units):
  - `overview`: position `[0, 260, 260]`, looking at the origin. This is the
    dashboard's default camera.
  - `d4`: the `BLD_D4` bounding-box centre plus `(60, 50, 60)`, looking at that
    centre.
  - `oblique15`: position `[-220, 110, 180]`, looking at the origin. It views
    from the south-west, so the 15:00 shadows fall away from the camera.
- Writes one screenshot per view from run 0 to `<outDir>/<label>-<view>.png`.

## Output: `<outDir>/<label>.json`

The headline fields come from the `overview` camera. Each is the median of the
per-run medians:

| Field | Meaning |
|---|---|
| `drawCalls` | `renderer.info.render.calls` per frame, shadow pass included. |
| `triangles` | `renderer.info.render.triangles` per frame, shadow pass included. |
| `fps` | rAF frames per second over the timed frames. Headless Chrome caps it at 60. |
| `idleDrawCalls2s` | WebGL draw calls in 2 s with no input. 0 once the loop renders on demand. |
| `gpuMs.median`, `gpuMs.p95` | GPU time of one `render()`: the median of run medians, and the median of run p95s. |
| `transferBytes` | Sum of `encodedBodySize` over 3D assets (`.glb .gltf .bin .ktx2 .drc .wasm .hdr .exr`), listed in `assets`. |
| `consoleErrors` | `console.error` calls plus uncaught exceptions, all runs combined. The texts are in `consoleErrorMessages`. |

Network failures logged by the browser, such as an unreachable weather API, go to
`logErrorMessages` and are not counted in `consoleErrors`. The JSON also holds:

- `views`: every camera, with the same fields and `drawCallsGl`, `frameMs`, `heapMB`
  and `runMedians`;
- `runs`: the per-run raw values;
- `setup`: the Chrome version, GPU string and parameters.

`--compare` also writes `<labelA>-vs-<labelB>.json` with per-view deltas.

**Noise floor:** on the M5 Pro, run-to-run spread of `gpuMs.median` is about
1.5 ms (measured). A GPU-time difference smaller than that is not a result, and
the compare file marks it `below noise floor`.

## Optimisation formula (`formula.mjs`, `fidelity.mjs`)

`formula.mjs` measures every input of `docs/OPTIMIZATION-FORMULA.md` against one running dev server, one Chrome at a
time: `bench.mjs --quality low` (5 runs) for D, T, L, B and X; `--quality medium` and `high` (1 run each) for D at those
tiers (`drawCallsGl`, since post-processing resets `renderer.info`); three 60 s orbits (1440 x 900 low and high,
390 x 844 low) for F; and `overhead-blend.mjs --campus-only` plus `fidelity.mjs` for Q.

```bash
bun scripts/perf/formula.mjs --url http://127.0.0.1:5190/ --label after --out <dir> --cdp 9190 --ref <dir> --ref-label before
```

- B: bytes of `campus-v2*.glb`, `.ktx2` and `.wasm` files the page fetched (the dev server sends them uncompressed).
- X (`textureMemory.gpuTextureMB`) is an estimate (추정) from the scene, not a driver reading: each distinct texture
  source of the main scene's materials, compressed textures by their mip data, others as RGBA8 with a full mip chain.
- L: `loadMs`, navigation (HTTP cache off, fresh profile) to more than 5 campus labels, which need the GLB.
- Q: `fidelity.mjs` picks the 12 campus tiles whose photo has the largest edge share (the photo alone decides, so
  every candidate is scored on the same tiles) and averages the luma SSIM (8 x 8 windows every 4 px) of render
  against photo. With `--ref` it also reports `Qself`, the SSIM against the reference run's render (1 = identical).


## Canopy cover (`canopy-cover.mjs`)

Share of the ground under tree crowns seen from straight above, per area (the four overhead-blend windows and the b1
south slope), in a campus GLB (each `Trees_*_crown` instance a disc of its crown mesh's horizontal reach times its
scale; hedges not counted) against the photo canopy mask of `fetch/treeInventory.mjs` (run with `--out`, so `data/`
is untouched). Canopy masses (`Trees_canopy_crown`) count as rotated ellipses. It also prints the camera clearance: the
smallest distance from any VR station to a crown edge (written to `station-clearance.txt` with `--out`). No browser and no
dev server.

```bash
bun scripts/perf/canopy-cover.mjs --glb before=<file> --glb after=public/campus-v2.glb [--inventory inv=<trees.json>] [--out <dir>]
```
