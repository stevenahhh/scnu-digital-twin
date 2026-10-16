# PROJECT KNOWLEDGE BASE

**Generated:** 2026-07-29
**Commit:** 883bad1
**Branch:** dev

## OVERVIEW

SCNU campus digital-twin prototype: a React/Three.js or VWorld dashboard, a
FastAPI weather/microclimate service, a traffic simulation service, and local computer-vision and safety
proofs of concept. JavaScript UI and Python services are separate runtimes
joined by HTTP and shared `BLD_*` element identifiers.

## STRUCTURE

```text
./
├── frontend/                  # Main dashboard; Legacy and VWorld entry points
├── weather/                   # KMA/AirKorea collection and microclimate API
├── car_vision_model/          # YOLO gate counter plus its own React client
├── TrafficSafety/             # Separate OCR/NLP/Streamlit safety PoC
├── common/data/               # Cross-domain campus and element contracts
├── backend/simulation/        # Traffic simulation API on port 8002
├── docs/                      # Static demonstration artifacts
├── vision_api.py              # Dashboard traffic endpoint on port 8001
├── pytest.ini                 # Root pytest config (weather/tests, backend/tests)
└── README.md                  # Local runbook and Git workflow
```

Ignore `.omo/`, `.playwright-mcp/`, virtual environments, `__pycache__/`, and
build outputs when mapping product code.

## WHERE TO LOOK

| Task | Location | Notes |
|---|---|---|
| Legacy dashboard behavior | `frontend/src/AppLegacy.jsx` | Default `index.html` route |
| VWorld dashboard behavior | `frontend/src/AppVWorld.jsx` | `index-vworld.html` route |
| VWorld SDK and selection | `frontend/src/vworld/` | Mapping, camera, marker, loader tests |
| Building/room details | `frontend/src/components/` | D4 section and room status UI |
| Weather HTTP API | `weather/api/app.py` | FastAPI routes and response assembly |
| Microclimate calculations | `weather/processors/` | Radiation, wind, thermal, timeline |
| External weather inputs | `weather/collectors/` | KMA and AirKorea requests |
| Campus data contracts | `common/data/` | IDs and geometry consumed across domains |
| Dashboard traffic feed | `vision_api.py` | `GET /api/traffic`, default port 8001 |
| WebSocket vision demo | `car_vision_model/` | Separate server and React 19 client |
| Traffic simulation | `backend/simulation/main.py` | FastAPI + WebSocket, port 8002 |
| Safety-report PoC | `TrafficSafety/` | Separate OCR/NLP/Streamlit PoC |

## CODE MAP

| Symbol | Type | Location | Refs | Role |
|---|---|---|---:|---|
| `AppLegacy` | React component | `frontend/src/AppLegacy.jsx` | entry | Main Three.js dashboard |
| `AppVWorld` | React component | `frontend/src/AppVWorld.jsx` | entry | VWorld-backed dashboard |
| `VWorldRenderer` | React component | `frontend/src/vworld/VWorldRenderer.jsx` | 1 | SDK lifecycle and map selection |
| `BuildingSectionView` | React component | `frontend/src/components/BuildingSectionView.jsx` | 2 | D4 floor/room drill-down |
| `app` | FastAPI app | `weather/api/app.py` | entry | Weather and microclimate routes |
| `run_pipeline_for_element` | function | `weather/processors/pipeline.py` | 4 | Per-element thermal pipeline |
| `run_pipeline_all` | function | `weather/processors/pipeline.py` | 6 | Bulk/heatmap calculations |
| `build_weather_timeline` | function | `weather/processors/weather_timeline.py` | 3 | Current-plus-forecast frames |
| `run_vision_model` | function | `vision_api.py` | 1 | Background YOLO traffic counter |

## CONVENTIONS

- Branch from `dev` as `feature/<name>`; merge through a PR back into `dev`.
  `main` is reserved for deployment-ready source.
- Run services from their documented working directories. Weather starts from
  the repository root with `--app-dir weather`, because its modules use imports
  such as `from config import ...`. Simulation imports resolve from `backend/`:
  use `--app-dir backend` from the root (or run inside `backend/`).
- Legacy and VWorld are parallel products, not aliases. Both builds must remain
  valid when shared dashboard behavior changes.
- `common/data/common_elemetns.json` is misspelled but is a live contract.
  Rename only with every consumer in the same change.
- Element prefixes are semantic: `BLD_` building, `RD_` road, `ND_` node,
  `CW_` crosswalk. Building popup data currently targets `BLD_*`.
- Material, radiation, MRT, and local-temperature values are estimated
  simulation outputs. User-facing text must not describe them as measurements.
- Existing popup and pipeline fields are compatibility contracts. Add new
  fields; do not remove or rename existing fields without coordinated clients.

## ANTI-PATTERNS (THIS PROJECT)

- Do not copy or add API keys in source, tests, HTML, examples, or generated
  documentation. Existing committed credentials require migration, not reuse.
- Do not bypass VWorld `MODEL_NAME` resolution or the D4 coordinate-marker
  fallback when changing building selection.
- Do not add extra building-popup requests; the popup endpoint is intended to
  provide the complete payload.
- Do not treat development fallback features from `weather/api/app.py` as
  production observations.
- Do not assume YOLO assets are present: model files are gitignored and must be
  provisioned locally.
- Do not describe a degraded weather response as live data. When the upstream
  fails, routes return 503 (see Weather contracts below) or cached data marked
  by `freshness`.

## COMMANDS

Every command runs from the repository root. Python commands call the shared
`.venv` interpreter by path. Frontend commands use Bun's `--cwd`.

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r weather/requirements.txt
.venv/bin/python -m pip install -r backend/simulation/requirements.txt
.venv/bin/python -m pip install -r car_vision_model/requirements_server.txt
bun install --cwd frontend
```
```powershell
py -m venv .venv
.venv\Scripts\python.exe -m pip install -r weather\requirements.txt
.venv\Scripts\python.exe -m pip install -r backend\simulation\requirements.txt
.venv\Scripts\python.exe -m pip install -r car_vision_model\requirements_server.txt
bun install --cwd frontend
```

Services, one terminal each:

```bash
.venv/bin/python -m uvicorn api.app:app --app-dir weather --host 127.0.0.1 --port 8000
.venv/bin/python vision_api.py --source 0 --port 8001
.venv/bin/python -m uvicorn simulation.main:app --app-dir backend --host 127.0.0.1 --port 8002
bun run --cwd frontend dev:legacy
bun run --cwd frontend dev:vworld
```
```powershell
.venv\Scripts\python.exe -m uvicorn api.app:app --app-dir weather --host 127.0.0.1 --port 8000
.venv\Scripts\python.exe vision_api.py --source 0 --port 8001
.venv\Scripts\python.exe -m uvicorn simulation.main:app --app-dir backend --host 127.0.0.1 --port 8002
bun run --cwd frontend dev:legacy
bun run --cwd frontend dev:vworld
```

Tests and builds:

```bash
bun run --cwd frontend test
bun run --cwd frontend build
bun run --cwd frontend build:vworld
.venv/bin/python -m pytest
```
```powershell
bun run --cwd frontend test
bun run --cwd frontend build
bun run --cwd frontend build:vworld
.venv\Scripts\python.exe -m pytest
```

`bun run test` covers both frontend test layers. Root `pytest` reads
`pytest.ini` and runs `weather/tests` and `backend/tests`.

## CONFIGURATION

Backend (`weather/config.py`). A variable already in the environment wins, even
when empty; `weather/.env` only fills gaps. Copy `weather/.env.example` to start.

- `KMA_SERVICE_KEY`: data.go.kr Decoding key. `AIRKOREA_SERVICE_KEY` falls back to it.
- `KMA_BASE_URL`, `AIRKOREA_BASE_URL`: origins only, default `apis.data.go.kr`.
- `WEATHER_UPSTREAM_CONNECT_TIMEOUT_S` (3), `WEATHER_UPSTREAM_READ_TIMEOUT_S` (7),
  `WEATHER_UPSTREAM_RETRY_AFTER_S` (60).
- `WEATHER_CACHE_TTL_KMA_CURRENT_S` (600), `WEATHER_CACHE_TTL_KMA_FORECAST_S` (3600),
  `WEATHER_CACHE_TTL_AIRKOREA_S` (1800), `WEATHER_CACHE_MAX_STALE_S` (10800).
- `WEATHER_CACHE_FILE`: default `weather/data/weather-cache.json`; a relative path resolves
  against the repository root; empty disables it. A failed write is logged, never an error.
- `WEATHER_ENERGY_DB`: energy SQLite path.

Frontend (`frontend/.env`, copied from `frontend/.env.example`): `VITE_API_URL` (weather; `VITE_WEATHER_API_URL`
is a deprecated alias), `VITE_VISION_API_URL` (default `http://127.0.0.1:8001`),
`VITE_SIMULATION_API_URL`, `VITE_SIMULATION_WS_URL`, `VITE_VWORLD_API_KEY`.

Vision: `--model`, `--host` (default `0.0.0.0`), `--port`; Ultralytics
auto-install is off (`YOLO_AUTOINSTALL=False`). Car demo: `--port` or
`CAR_DEMO_PORT`, default 8003.

Weather contracts: see `weather/AGENTS.md` for the 503 upstream error body and
the `freshness` field that every `/microclimate/*` and `/environment/*` route
returns.

## NOTES

- Local runtime is four processes: weather `8000`, vision `8001`, simulation
  `8002`, frontend `5173`.
- KMA/AirKorea calls may delay or time out while map and popup UI remain usable.
- Vision startup loads a YOLO model and camera/stream; first launch can be slow.
- No repository CI workflow was found. Validation is local and domain-specific.
