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
