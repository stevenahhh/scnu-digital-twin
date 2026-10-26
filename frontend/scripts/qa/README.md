# Visual QA harness

Replays the audit states S01..S17 of the SCNU dashboard in a headless Chrome (`Bun.WebView`,
SwiftShader GL), evaluates the audit checks, compares every captured scenario with
`baselines.json`, and exits non-zero on any regression. No Playwright/Puppeteer dependency.

```bash
bun frontend/scripts/qa/visual-qa.mjs --entry legacy|vworld|both --viewport D|P|both \
  --theme dark|light|both --states S01..S17 --only <ids> --out <dir> [--update-baseline]
node --test frontend/scripts/qa/lib/*.test.mjs frontend/scripts/qa/checks/*.test.mjs
```

## Viewports, states, themes

- `D` = 1440x900 @1x; `P` = 390x844 @2x with mobile emulation (PNGs are 780x1688).
- S01..S12 follow `waves/uhf-ux/screens.md` "How to reproduce" (same selectors, waits and the
  12 s tap retry). S13 = 주차·안전 tab, S14 = S05 then floor 6 (waits for
  `[data-qa=d4-room-grid]`), S15 = S05 then 태양광 설치 then the first 편집 button (fixtures up for this state only: with
  backends down the plan list is empty and has no 편집), S16 = a fresh
  load with 설정 > 테마 > 라이트 applied, S17 = S01/S04/S06/S08/S13 with the fixture backends up.
  VWorld runs S01..S12.
- `--theme light` applies 설정 > 테마 > 라이트 through the dialog after load; `dark` keeps the
  default 시스템 theme with `prefers-color-scheme: dark` emulated (as in the audit run).
- Runs are hermetic: `api.open-meteo.com` (live cloud cover for the sky) is blocked through CDP,
  and Vite runs without a file watcher or HMR, so editing the tree during a run cannot reload the page.
- The page clock is pinned to `--clock` (default `2026-10-25T19:00:00+09:00`, the audit capture
  time) and advances in real time from there, so "now" scenes are reproducible across days.

## Single port and fixture backends

The harness starts one Vite dev server (`--port`, default 5181) with
`scripts/qa/vite.qa.config.mjs`, which adds the fixture backends as middleware on the same port:

| env | value |
|---|---|
| `VITE_API_URL` | `http://127.0.0.1:<port>/__qa/api` (weather, microclimate popup, energy) |
| `VITE_VISION_API_URL` | `http://127.0.0.1:<port>/__qa/vision` (`/api/traffic`) |
| `VITE_SIMULATION_WS_URL` | `ws://127.0.0.1:<port>/__qa/ws/simulation` (accepts, sends one `{"status":"idle"}`) |

Backends are "down" by default: requests are dropped, so the app sees network failures as in the
audit run. S17 switches them "up". `--fail <route>` (repeatable) answers that route with the
weather 503 envelope and `--delay-ms <n>` delays every answer; both imply fixtures up for the
whole run. Keeping everything on one port means a run never claims 8010-8012; Legacy and VWorld
are two entries of the same server. Chrome is driven over a pipe and opens no TCP port.

## Switches

`--script <json>` runs `[{ "state": "S03", "do": [{ "tap": "<sel>", "text": "..." }, { "key": "Escape" },
{ "drag": [x, y, dx, dy] }, { "wait": 500 }, { "fixtures": { "mode": "up" } }] }]` after that state's
steps; `--url-suffix <query>` is appended to the entry URL; `--hold-ms <n>` is the minimum S11
hold before capture (default 150, as in SCREENS); the button then stays held until two frames 300 ms
apart differ by < 0.2 % (max 10 s), because the orbit damping keeps easing and a fixed 150 ms frame
is not reproducible under SwiftShader; `--quality low|medium|high` picks the render tier after S01;
`--after-dir <dir>` copies `<state>-<viewport>-<theme>.png` to `<dir>/<id>-<state>-<viewport>-<theme>.png`
for every evaluated check; `--states GALLERY` captures `?ui=gallery`; `--sample-ms 500,2500`
also saves screenshots at those offsets after the S04/S12 chip tap (the DOM is always sampled at
500/2000/2500 ms for the loading checks); `--clock <iso>` pins the page clock.

## Outputs

- `<out>/<state>-<viewport>-<theme>.png` (VWorld prefixed `vworld-`, S17 frames `S17-S04-...`).
- `<out>/report.json`: `entries` (one `{id, state, viewport, pass, measured, expected}` per check
  evaluation), `checks` (one rollup per requested id; never evaluated = FAIL), `scenarios`
  (dHash, key rects, baseline verdict, actions, console entries since the previous capture).
- `<out>/summary.md`: totals, baseline regressions (dHash distance and moved rects), failing
  checks grouped by owning todo (`checks/owners.json`), per-scenario actions and console.

## Regression exit contract

| code | meaning |
|---|---|
| 0 | every requested check PASSed and every scenario matched `baselines.json` |
| 1 | regression: a check FAIL (a thrown probe, missing hook or undefined measurement is a FAIL), a dHash distance > 8 bits, a key rect moved > 4 px, or a scenario missing from the baseline |
| 2 | usage error: unknown flag, bad value, unknown check id (`unknown check id X` on stderr) |
| 3 | a requested entry cannot run (VWorld without `VITE_VWORLD_API_KEY`); reported as `SKIPPED` |

The harness kills its process tree (Vite, Chrome) before returning the code. `--update-baseline`
rewrites the captured scenarios in `baselines.json` (others are kept); check FAILs still exit 1.

Baseline fingerprint: a 64-bit difference hash (9x8 area-averaged grayscale grid, 16 hex chars)
of each PNG, plus the rects of `[data-qa=dashboard-panel]`, `[data-qa=campus-hud]`,
`[data-qa=time-slider]`, `[data-qa=camera-preset-bar]` and the selected chip.

## Required product hooks

Checks are written against these hooks now and FAIL until the owning todo adds them
(`REQUIRED_HOOKS` in `checks/index.mjs`):

`[data-qa=selection-inspector]`, `[data-qa=estimate-value]`, `[data-qa=freshness-stamp]`,
`[data-qa=sample-badge]`, `[data-qa=campus-label-layer]`, `[data-qa=search-field]`,
`[data-qa=legend]`, `[data-qa=breadcrumb]`, `[data-qa=camera-controls]`,
`[data-qa=presentation-toggle]`, `[data-qa=sheet-handle]`, `[data-qa=d4-room-grid]`.
