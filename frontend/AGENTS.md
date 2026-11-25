# FRONTEND KNOWLEDGE BASE

## OVERVIEW

React 18/Vite dashboard. The default entry is Main (Three.js, the former
Legacy view): it opens on a login and then shows the student screen or the
admin dashboard, by account role. The VWorld WebGL entry is frozen: it must
keep building, and gets no feature work or QA. Both consume the weather API and
share building selection, detail panels, and D4 room data.

## STRUCTURE

```text
frontend/
├── index.html                 # `/src/index.jsx` -> App (login, then AppMain or AppStudent)
├── index-vworld.html          # VWorld SDK -> `/src/index-vworld.jsx` (frozen)
├── src/App.jsx                # Role routing; lazy-loads the screen for the session
├── src/AppMain.jsx            # Admin dashboard: every feature
├── src/student/AppStudent.jsx # Student screen: read-only, 건물 and 현황 tabs
├── src/auth/                  # Session store, login screen, token on writes
├── src/AppVWorld.jsx          # VWorld dashboard (frozen)
├── src/CityModel.jsx          # GLB selection and camera focus
├── src/components/            # Building and room drill-down UI
├── src/ui/                    # Design tokens (tokens.css) and shared UI primitives
├── src/panel/                 # Dashboard panel, tabs and settings shared by both entries
├── src/vworld/                # VWorld adapters and focused unit tests
└── src/utils/                 # D4 data, solar math, mock data
```

## WHERE TO LOOK

| Task | Location | Notes |
|---|---|---|
| Default entry | `src/App.jsx` | No session: `LoginScreen`. Role `admin`: `AppMain`. Role `student`: `AppStudent` |
| Main (admin) layout/data flow | `src/AppMain.jsx` | Composes `src/panel/` and `src/hooks/` |
| Student layout/data flow | `src/student/AppStudent.jsx` | Same scene, hooks and shell; tabs 건물 and 현황 only |
| Session, login, token | `src/auth/session.mjs` | `sessionStore`, `authorizedFetch` (token on non-GET requests) |
| VWorld layout/data flow | `src/AppVWorld.jsx` | Same panel and hooks, VWorld renderer |
| Dashboard panel and tabs | `src/panel/` | One implementation for both entries |
| 3D building mapping | `src/CityModel.jsx` | GLB names to `BLD_*` |
| Admin model editor | `src/editor/` | `ModelEditorPanel` (admin UI), `ModelEditorScene` (gizmo, picking, applies saved edits on every screen), `sceneEditor.mjs`, `modelEditStore.mjs`; weather `/model/edits` |
| VWorld building mapping | `src/vworld/buildingResolver.mjs` | `MODEL_NAME` contract |
| VWorld map lifecycle | `src/vworld/VWorldRenderer.jsx` | SDK, boundary, D4 marker |
| Popup API contract | `WEATHER_API.md` | Complete response and ID rules |
| D4 room data | `src/utils/d4BuildingData.mjs` | Floors, rooms, energy state |

## CONVENTIONS

- Main: `bun run dev:main`, `index.html`, `src/index.jsx`, `App` -> `AppMain` or `AppStudent`.
- VWorld: `bun run dev:vworld`, `index-vworld.html`,
  `src/index-vworld.jsx`, `AppVWorld`.
- `vite.config.js` selects the HTML build input from mode; validate both outputs.
- Keep env values in ignored `.env.local` (or `.env`). Never commit keys.
- Convert UI selections to canonical `BLD_*` IDs before fetching popup data.
- Use `/microclimate/elements/{element_id}/popup` as the complete building
  popup request. `RD_`, `ND_`, and `CW_` currently have no popup payload.
- Preserve the D4 coordinate marker until VWorld supplies a resolvable model.
- Keep estimated-data labeling visible when rendering material/radiation values.

## ENVIRONMENT

| Variable | Used by | Notes |
|---|---|---|
| `VITE_API_URL` | both | Weather API origin. Canonical name. |
| `VITE_WEATHER_API_URL` | both | Deprecated alias of `VITE_API_URL`; read only as a fallback. Don't add new uses. |
| `VITE_VISION_API_URL` | both | Traffic feed; default `http://127.0.0.1:8001`. |
| `VITE_SIMULATION_API_URL` | both | Traffic simulation HTTP origin. |
| `VITE_SIMULATION_WS_URL` | both | Traffic simulation WebSocket. |
| `VITE_VWORLD_API_KEY` | VWorld | Required only in VWorld mode. |

## SHARED STATE VOCABULARY

Both dashboards show the same Korean strings. Change them in both or neither.

- Weather: `실시간 연동 정상`, `기상 데이터 갱신 중`, `저장된 기상 데이터 표시 중`,
  `기상 서버에 연결할 수 없습니다`, `기상 서버 응답이 지연되고 있습니다`,
  `시뮬레이션 모드` (badge `시뮬레이션 값`), retry `다시 시도`. When the state
  isn't live, show `마지막 정상 수신 HH:mm` next to values.
- Traffic: `실시간 영상 분석 중`, `영상 분석 서버 연결 없음`, `카메라·모델 미작동`.
- Simulation overlay: `교통 시뮬레이션 연결 중`, `교통 시뮬레이션 연결됨`,
  `교통 시뮬레이션 연결 끊김`. TrafficSafetyPanel keeps the hook vocabulary
  (`재연결 중`, `오류`, `연결 끊김`, `연결됨`) in a status badge with a lucide
  `TriangleAlert` (not connected) or `Circle` (연결됨) icon, never a glyph.
- Labels: `추정`, `샘플 데이터`, `시뮬레이션 기준일`, `기상 데이터 없음`.
- Button names: `패널 열기`, `패널 닫기`, `설정`, `기상 데이터 새로고침`, `닫기`.
- Errors: `이 영역을 표시하는 중 문제가 발생했습니다`, `설치 계획을 불러오지 못했습니다`.

## SCREENS AND ROLES

- The login screen has an id/password form (password exactly 8 characters) and
  two guest buttons, `게스트 · 학생 모드` and `게스트 · 관리자 모드`. The session
  lives in `localStorage` under `scnu.session`; `더보기` -> `로그아웃` ends it.
- The role picks the screen and nothing else. The server checks the token:
  GET is public, every other method needs an admin token. A 401 on a write ends
  the session and returns to the login screen with a notice.
- When the auth server can't be reached, a guest button still opens its screen
  without a token, so the map works with no backend. Account login needs the server.
- A client that writes to the weather or simulation API takes `authorizedFetch`
  as its default fetch. Don't call bare `fetch` for POST/PUT/DELETE.
- The student screen imports nothing that writes: no energy tab, simulation
  tab, comparison, or presentation mode. Its D4 pane is the shared
  `D4SectionExperience`, loaded lazily and opened without plan ids, so the roof
  editor has no entry there.
- The QA harness (`scripts/qa/visual-qa.mjs`) seeds a guest-admin session before
  each Main pass, so its states still start on the dashboard, and it waits for
  `[data-qa=loading-veil]` to leave before measuring.
- `src/loading/` owns the path from login to the first scene frame:
  `index.jsx` starts the model download while the login screen is up,
  `campusLoad.mjs` holds the progress, and `CampusLoadingVeil.jsx` draws it.
- Disconnected feeds and active restrictions show as a dot on the 현황 tab
  (`panel/tabAlerts.mjs`), not as a box on the map.
- `src/restrictions/` holds the road and building scenarios: admins set them in
  the 시뮬레이션 tab, both screens poll `/api/simulation/restrictions`, list them
  in 현황 and draw them over the 3D scene. They are simulation scenarios, and the
  UI must not present them as real notices.

## MAIN AND VWORLD

Fixes land in Main. VWorld shares `src/panel/`, `src/ui/` and the hooks, so a
shared change must leave `build:vworld` and the existing VWorld tests passing.
Nothing else is owed to it: no new VWorld features, no VWorld QA passes. VWorld
has no login screen; its writes carry a token only when a Main session exists
in the same browser. The table records what the two entries shared when VWorld
was frozen.

| Area | Main | VWorld |
|---|---|---|
| Tabs | 건물 (`building`, only with a selection), 현황 (`status`), 에너지 (`energy`), 시뮬레이션 (`simulation`) | same tab set |
| Feeds | weather, traffic, simulation hooks | same hooks |
| `SelectionInspector` (`src/panel/`) | shared component | shared component |
| Dialogs and error boundary | shared | shared |
| Renderer (intentional) | Three.js GLB (`CityModel.jsx`) | VWorld WebGL SDK |
| Render quality | `설정` dialog 낮음/보통/높음 (`settings/qualityPreset.mjs`, lazy `postfx/HighTierEffects.jsx`) | same setting and stored value; `vworld/renderQuality.mjs` maps it to Cesium resolution scale, FXAA and shadows |
| D4 entry (intentional) | GLB mesh click | `MODEL_NAME` or D4 coordinate marker |
| Building selection | opens the selection inspector (tab unchanged) | opens the selection inspector (tab unchanged) |
| Building detail | selection inspector above the tabs (rail: card beside it; phone: sheet `half`) | same |

## ANTI-PATTERNS

- Do not collapse Main and VWorld entry points into one build accidentally.
- The live D4 path is `vworld/D4SectionExperience.jsx` with
  `components/D4WingFloorSelect.jsx` and `components/D4RoomGridSelect.jsx`
  (both entries). Dead components are deleted, not parked. The one exception is
  `AlertBadge.jsx`, `BuildingSectionView.jsx`, `D4RoomPopup.jsx`,
  `D4WingDetailCard.jsx`, `MiniStatusWidget.jsx` and `utils/feelsLike.mjs`.
  They have no importers but stay until the open teammate branches that touch
  them merge. Don't import them, and don't treat them as live runtime paths.
- Don't keep `*.manual.mjs` drivers or `console.log` under `src/`. Manual
  energy drivers live in `scripts/energy-manual/` (`node scripts/energy-manual/<name>.manual.mjs`).
- Don't load fonts from a CDN. Wanted Sans Variable is served from
  `public/fonts/` (OFL text beside it) and preloaded by both HTML entries.
- Do not copy hardcoded weather keys from old test/demo files into active code.
- Do not rename `common_elemetns.json` in isolation.
- Do not replace the VWorld selection helpers with ad hoc component-local maps;
  their `.mjs` modules have focused contract tests.

## COMMANDS

```powershell
cd frontend
bun install
bun run test   # runs both test layers (scripts/run-tests.mjs)
node --test src/vworld/*.test.mjs
bun run build
bun run build:vworld
bun run dev:main
bun run dev:vworld
```

## CHECKS

- Main opens on the login screen at `http://127.0.0.1:5173`. `게스트 · 관리자 모드`
  opens the dashboard and `게스트 · 학생 모드` the student screen.
- VWorld renders at `http://127.0.0.1:5173/index-vworld.html`.
- A native VWorld building opens the matching `BLD_*` detail.
- The D4 coordinate marker opens the same detail path.
- Traffic failures are visible: the 현황 tab's parking and safety card shows `영상 분석 서버 연결 없음`, or
  `카메라·모델 미작동` with the server's reason. `GET :8001/api/traffic` shows the raw state.

