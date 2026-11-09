# Visual QA harness

Replays the audit states S01..S17 of the SCNU dashboard in a headless Chrome (`Bun.WebView`,
SwiftShader GL), evaluates the audit checks, compares every captured scenario with
`baselines.json`, and exits non-zero on any regression. No Playwright/Puppeteer dependency.

```bash
bun frontend/scripts/qa/visual-qa.mjs --entry legacy|vworld|both --viewport D|P|T|D,P,T|both|all \
  --theme dark|light|both --states S01..S17,S09E,S12E,S18 --only <ids> --out <dir> [--reduced-motion] [--update-baseline]
bun frontend/scripts/qa/visual-qa.mjs --list-checks
bun frontend/scripts/qa/static-checks.mjs [--only <ids>] [--json <path>]
node --test frontend/scripts/qa/lib/*.test.mjs frontend/scripts/qa/checks/*.test.mjs frontend/scripts/qa/static-checks.test.mjs
```

## Viewports, states, themes

- `D` = 1440x900 @1x; `P` = 390x844 @2x with mobile emulation (PNGs are 780x1688); `T` = 834x1194 @2x with touch
  emulation (tablet portrait). `--viewport both` stays D and P; `all` or `D,P,T` adds T.
- New states (ideal-state.md section 6.1): `S09E` = S09 then the 에너지 tab, `S12E` = S12 then the 에너지 tab, `S18` = S01
  then key P (presentation mode). They fork from the chain and undo themselves, and they are replayed only when requested.
- Tab picks go through `lib/tabs.mjs`, keyed by role with dev-era fallbacks (S08 environment -> simulation, S09
  dashboard -> status, S13 parking_safety -> status, S09E/S12E energy). The panel opens through the current tab's
  `[data-qa^=dashboard-tab-]` hook; `패널 열기` is only the fallback (phone sheet at peek).
- `--reduced-motion` emulates `prefers-reduced-motion: reduce` for the whole run (baseline keys get `@reduced-motion`).
- S01..S12 follow `waves/uhf-ux/screens.md` "How to reproduce" (same selectors, waits and the
  12 s tap retry). S13 = 주차·안전 tab, S14 = S05 then floor 6 (waits for
  `[data-qa=d4-room-grid]`), S15 = S05 then 태양광 설치 then the first 편집 button (fixtures up for this state only: with
  backends down the plan list is empty and has no 편집), S16 = a fresh
  load with 설정 > 테마 > 라이트 applied, S17 = S01/S04/S06/S08/S13 with the fixture backends up.
  VWorld runs every chained state except the Legacy-only roof editor S15 (S16 is Legacy-only too), and the S17
  sub-states (`LEGACY_ONLY_STATE_IDS` in `lib/states.mjs`).
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

S11 is captured mid-drag and the held orbit ends at a pose that depends on the frame rate, so S11
scenarios are gated by their key rects only (the dHash distance is still reported). VWorld states wait
for the live map tiles to stop streaming before capture (three screenshots 1.5 s apart within 1 %,
min 6 s, max 40 s).

The harness kills its process tree (Vite, Chrome) before returning the code. `--update-baseline`
rewrites the captured scenarios in `baselines.json` (others are kept); check FAILs still exit 1.

Baseline fingerprint: a 64-bit difference hash (9x8 area-averaged grayscale grid, 16 hex chars)
of each PNG, plus the rects of `[data-qa=dashboard-panel]`, `[data-qa=campus-hud]`,
`[data-qa=time-slider]`, `[data-qa=camera-preset-bar]` and the selected chip.

## Ideal-state checks IS-01..IS-40

`checks/ideal.mjs` measures every row of `.omo/ui-hig-2026-11-09/audit/ideal-state.md` section 6.2 with the section 6.1
helpers (installed as `window.__qaIdeal`); `checks/ideal-eval.mjs` holds the pure PASS/FAIL logic and `checks/ideal-rows.mjs`
the literal row text. A row that needs a hook the product does not have yet (`feed-status-chip`, `more-menu`, `hud-bar`,
`d4-open`, `traffic-simulation-panel`) FAILs with measured `hook missing`. IS-04/IS-05/IS-16 measure the HUD bar
(`[data-qa=hud-bar]`, else the first row child of `[data-qa=campus-hud]`, whose root spans the viewport). Rows that act on
the page (IS-13 S04, IS-22, IS-25 S09E, IS-26..IS-28, IS-32, IS-34..IS-40) run as `parts` in the probe replay and put the
page back. IS-34..IS-37 sample the DOM every 50 ms in the page; IS-38 switches to reduced motion itself; IS-39 makes its own
3000 ms delayed request, so a plain run evaluates all 40 ids. Tablet policy: on `T` only IS-07, IS-17, IS-18 (44 px),
IS-25, IS-27 and IS-33 evaluate; every other requested IS row reports `n/a` (never FAIL). Owners are in
`checks/owners.json`.

## Required product hooks

Checks are written against these hooks now and FAIL until the owning todo adds them
(`REQUIRED_HOOKS` in `checks/index.mjs`):

`[data-qa=selection-inspector]`, `[data-qa=estimate-value]`, `[data-qa=freshness-stamp]`,
`[data-qa=sample-badge]`, `[data-qa=campus-label-layer]`, `[data-qa=search-field]`,
`[data-qa=legend]`, `[data-qa=breadcrumb]`, `[data-qa=camera-controls]`,
`[data-qa=presentation-toggle]`, `[data-qa=sheet-handle]`, `[data-qa=d4-room-grid]`.

## Static checks

`static-checks.mjs` runs the 101 static rows of AUDIT section 7 and the token lint with no
browser and prints `PASS|FAIL <id> <count> <first path:line>` per rule; exit 1 on any FAIL.
`bun run test` runs it as a third stage. Until `scripts/qa/.static-enforced` exists (created by
todo 21) the stage is advisory: it prints every FAIL line and `static=advisory-fail` but does not
fail the test run.
