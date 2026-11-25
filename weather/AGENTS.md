# WEATHER SERVICE KNOWLEDGE BASE

## OVERVIEW

FastAPI service that combines KMA/AirKorea inputs with campus feature data to
produce zone summaries, per-element microclimate values, heatmaps, timelines,
and UI-ready building popup responses.

## STRUCTURE

```text
weather/
├── api/app.py                 # FastAPI app and all HTTP routes
├── api/auth.py                # /auth/login, /auth/guest, /auth/me (logic in common/campus_auth.py)
├── collectors/                # KMA/AirKorea adapters, upstream.py, cache.py
├── domain/                    # Legacy zone-level environment model
├── processors/                # Element microclimate and thermal pipeline
├── data/                      # Campus zones and generated feature inputs
├── energy/                    # Energy/solar persistence and models
├── tests/                     # pytest suite, run from the repository root
├── config.py                  # Env-based keys, timeouts, cache settings
├── .env.example               # Template for the optional weather/.env
├── main.py                    # CLI-style environment output
└── UPDATE_MRT_HANDOFF.md      # Estimated-material compatibility contract
```

## WHERE TO LOOK

| Task | Location | Notes |
|---|---|---|
| Route or response change | `api/app.py` | Loads features and assembles endpoints |
| Current weather | `collectors/kma_current.py` | Normalization and solar estimates |
| Forecast timeline | `collectors/kma_forecast.py`, `processors/weather_timeline.py` | +1/+2/+3 hour frames |
| Air quality | `collectors/air_quality.py` | External station lookup |
| Element calculation | `processors/pipeline.py` | Microclimate then thermal index |
| Radiation/material model | `processors/radiation.py`, `processors/materials.py` | Estimated physics |
| Popup schema | `processors/popup_formatter.py` | UI-ready compatibility surface |
| Upstream errors, cache | `collectors/upstream.py`, `collectors/cache.py` | Timeouts, stale cache |
| Feature source | `data/microclimate_features.json` | `{metadata, features}` wrapper |

## CONVENTIONS

- Start from the repository root with `--app-dir weather`; imports such as
  `from config import ...` need `weather/` on `sys.path`. `python weather/main.py`
  also works from the root.
- Route flow is collector -> normalized weather -> element feature ->
  `run_pipeline_for_element`/`run_pipeline_all` -> formatter or aggregate.
- Feature loading must return the nested `features` array, not the raw wrapper.
- Timeline buckets are fixed to +1, +2, and +3 hours in KST and record fallback
  fields when forecast values are missing.
- `local_temp`, `local_wind_speed`, `radiation_load`, `tmrt`, `utci`, and `wbgt`
  are stable pipeline outputs.
- Popup fields `thermal`, `factors`, `delta`, `reasons`, and `base_weather` are
  stable client contracts. Extend additively.
- Material and radiation parameters are estimated until replaced by measured
  asset, geometry, or sensor data.

## ANTI-PATTERNS

- Do not add, duplicate, or expose service credentials. Keys come only from
  the environment or `weather/.env` (`KMA_SERVICE_KEY`, `AIRKOREA_SERVICE_KEY`).
- Do not describe development sample features or estimated MRT as observations.
- Do not silently change `common/data/common_elemetns.json` element IDs.
- Do not remove fallback provenance from timeline frames.
- Do not break existing popup fields while refining materials or radiation.

## CONTRACTS

- **Upstream error (C1).** Every `/microclimate/*` and `/environment/*` route
  with no usable data returns HTTP 503 with `Retry-After: 60` and
  `{"detail": {"code", "source", "reason", "message_ko", "message_en", "retry_after_s"}}`.
  `code` is `weather_upstream_unavailable` or `weather_api_key_missing`;
  `source` is `kma_current`, `kma_forecast`, or `airkorea`. Unknown element ids
  keep their 404. Unexpected faults return 500 with `code: internal_error`,
  never raw exception text. Energy routes are separate.
- **Freshness (C3).** Every 200 from those routes carries
  `freshness: {weather, forecast, air_quality}`. Each entry has `source`
  (`live` or `cache`), `observed_at`, `fetched_at`, `age_seconds` (from
  `fetched_at`), and `stale`. Unused sources are `null`; a failed air-quality
  lookup is `{"stale": true, "error": <kind>}`. Sample-feature responses add
  `"sample_data": true`.
- **Configuration (C4).** See the root `AGENTS.md` CONFIGURATION section.
- **Auth (C5).** GET, HEAD and OPTIONS are public. Every other method needs
  `Authorization: Bearer <token>` from an admin account, checked once by the
  app-wide dependency `require_admin_for_writes`: no or bad token is 401
  `{"detail": "로그인이 필요합니다"}` with `WWW-Authenticate: Bearer`, a student
  token is 403 `{"detail": "관리자 권한이 필요합니다"}`. `POST /auth/login`
  takes `{id, password}` (password exactly 8 characters, else 422) and
  `POST /auth/guest` takes `{role}`; both return
  `{token, token_type, expires_at, account: {id, name, role, guest}}`.
  `GET /auth/me` returns the account for a token. The simulation service
  verifies the same tokens with the shared secret.
- **Model edits (C6).** `GET /model/edits` (public) returns the campus-model
  edit document `{version, revision, updated_at, updated_by, transforms, removed, added}`;
  `PUT /model/edits` (admin) replaces it and must send the `revision` it
  read, else 409 `{"detail": {"message", "revision"}}`. Objects are GLB
  `extras.editable.id` values or `<Trees_*>#<index>`; transforms are
  `{position, quaternion, scale}` local to the object's parent node, in scene
  units. Added objects have `ADD_*` ids and a `prototype` id. Stored in
  `MODEL_EDITS_FILE` (default `weather/data/model-edits.json`, git-ignored).

## COMMANDS

Run from the repository root.

```bash
.venv/bin/python -m pip install -r weather/requirements.txt
.venv/bin/python -m uvicorn api.app:app --app-dir weather --host 127.0.0.1 --port 8000
.venv/bin/python weather/main.py
.venv/bin/python -m pytest weather/tests
.venv/bin/python -m compileall -q weather/api weather/collectors weather/domain weather/processors weather/energy weather/main.py weather/config.py
```
```powershell
.venv\Scripts\python.exe -m pip install -r weather\requirements.txt
.venv\Scripts\python.exe -m uvicorn api.app:app --app-dir weather --host 127.0.0.1 --port 8000
.venv\Scripts\python.exe weather\main.py
.venv\Scripts\python.exe -m pytest weather\tests
.venv\Scripts\python.exe -m compileall -q weather\api weather\collectors weather\domain weather\processors weather\energy weather\main.py weather\config.py
```

## CHECKS

- `GET /health` responds before frontend integration checks.
- `GET /environment/full` exercises current weather and timeline assembly.
- `GET /microclimate/elements/{BLD_ID}/popup` exercises the complete UI path.
- External collectors use network timeouts; a failure there is not a VWorld SDK
  failure. Expect 503 or a stale `freshness` entry, not a hang.
- `weather/tests` holds the pytest suite: energy API and persistence, weather
  scenarios, collectors, popup honesty, upstream errors, cache, microclimate
  resilience, and config env loading.
