# FRONTEND KNOWLEDGE BASE

## OVERVIEW

React 18/Vite dashboard with two supported entry points: the Three.js Legacy
view and the VWorld WebGL view. Both consume the weather API and share building
selection, detail panels, and D4 room data.

## STRUCTURE

```text
frontend/
├── index.html                 # `/src/index.jsx` -> App -> AppLegacy
├── index-vworld.html          # VWorld SDK -> `/src/index-vworld.jsx`
├── src/AppLegacy.jsx          # Three.js dashboard
├── src/AppVWorld.jsx          # VWorld dashboard
├── src/CityModel.jsx          # GLB selection and camera focus
├── src/components/            # Building and room drill-down UI
├── src/vworld/                # VWorld adapters and focused unit tests
└── src/utils/                 # D4 data, solar math, mock data
```

## WHERE TO LOOK

| Task | Location | Notes |
|---|---|---|
| Shared/default entry | `src/App.jsx` | Re-exports `AppLegacy` |
| Legacy layout/data flow | `src/AppLegacy.jsx` | Large integration component |
| VWorld layout/data flow | `src/AppVWorld.jsx` | Large integration component |
| 3D building mapping | `src/CityModel.jsx` | GLB names to `BLD_*` |
| VWorld building mapping | `src/vworld/buildingResolver.mjs` | `MODEL_NAME` contract |
| VWorld map lifecycle | `src/vworld/VWorldRenderer.jsx` | SDK, boundary, D4 marker |
| Popup API contract | `WEATHER_API.md` | Complete response and ID rules |
| D4 room data | `src/utils/d4BuildingData.mjs` | Floors, rooms, energy state |

## CONVENTIONS

- Legacy: `bun run dev:legacy`, `index.html`, `src/index.jsx`, `AppLegacy`.
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
  (`△ 재연결 중`, `△ 오류`, `△ 연결 끊김`, `● 연결됨`).
- Labels: `추정`, `샘플 데이터`, `시뮬레이션 기준일`, `기상 데이터 없음`.
- Button names: `패널 열기`, `패널 닫기`, `설정`, `기상 데이터 새로고침`, `닫기`.
- Errors: `이 영역을 표시하는 중 문제가 발생했습니다`, `설치 계획을 불러오지 못했습니다`.

## LEGACY / VWORLD PARITY

Every dashboard fix lands in both entries unless it's listed as intentional below.

| Area | Legacy | VWorld |
|---|---|---|
| Tabs | 기본 현황, `parking_safety` 주차·안전, 에너지, 환경 시뮬 | same tab set |
| Feeds | weather, traffic, simulation hooks | same hooks |
| `MicroclimatePanel` | shared component | shared component |
| Dialogs and error boundary | shared | shared |
| Renderer (intentional) | Three.js GLB (`CityModel.jsx`) | VWorld WebGL SDK |
| D4 entry (intentional) | GLB mesh click | `MODEL_NAME` or D4 coordinate marker |
| Building selection (intentional) | opens the `미기후` selection tab | switches to the `에너지` tab |
| Building detail (intentional) | rendered in a tab | popup modal |

## ANTI-PATTERNS

- Do not collapse Legacy and VWorld entry points into one build accidentally.
- `AlertBadge.jsx`, `BuildingSectionView.jsx`, `D4RoomPopup.jsx`,
  `D4WingDetailCard.jsx`, `MiniStatusWidget.jsx` and `utils/feelsLike.mjs` are
  unused on `dev` but kept for open teammate branches. Don't delete them, and
  don't treat them as live runtime paths.
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
bun run dev:legacy
bun run dev:vworld
```

## CHECKS

- Legacy renders at `http://127.0.0.1:5173`.
- VWorld renders at `http://127.0.0.1:5173/index-vworld.html`.
- A native VWorld building opens the matching `BLD_*` detail.
- The D4 coordinate marker opens the same detail path.
- Traffic failures are visible: the 주차·안전 card shows `영상 분석 서버 연결 없음`, or
  `카메라·모델 미작동` with the server's reason. `GET :8001/api/traffic` shows the raw state.

