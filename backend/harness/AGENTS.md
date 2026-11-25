# HARNESS

Per-user LLM assistant for the Main dashboard. Design and rationale:
`docs/HARNESS-DESIGN.md` (epic #172, tickets HRN-1 to HRN-8).

## RUN

```bash
.venv/bin/python -m pip install -r backend/harness/requirements.txt
TIMELY_API_KEY=... .venv/bin/python -m uvicorn harness.main:app --app-dir backend --host 127.0.0.1 --port 8004
```

The key comes from the timely-scnu credential. Pass it through the process
environment only. `GET /health` shows `llm` (`ready`/`key_missing`) and `eval`
(`on` where macOS `sandbox-exec` exists, else `off`; there is no unsandboxed
fallback).

## LAYOUT

| File | Role |
|---|---|
| `main.py` | FastAPI app, `/chat/*` routes, SSE with heartbeats, startup prefix check |
| `loop.py` | Turn loop: delta-only Timely calls, parallel tools, confirm gate, epoch roll |
| `timely.py` | Timely `llm-completion` client (SDK auth JWT, SSE, checkpoint resume) |
| `prefix.py`, `prefix/` | Frozen role prefixes (instructions + tool schemas); golden test pins them |
| `sessions.py` | Owner keys, journals, budgets, retention; `store.get(owner, id)` is the only accessor |
| `sandbox.py` | Persistent per-session Python kernel under a deny-default sandbox profile |
| `mcp_client.py` | In-memory `mcp.Client` to `backend/twin_mcp`, role allowlists, bearer in `meta` |
| `truncate.py`, `tools/` | Output caps with spill files, `read`/`search`, `todo` |
| `guard.py` | Appends missing 추정/저장된 기상 데이터/샘플 데이터/시뮬레이션 시나리오 labels |
| `tokens.py`, `config.py` | Local usage estimate (Timely returns none), every setting |

## RULES

- The prefix sent to Timely must stay byte-identical within an epoch. Change
  `prefix/*` only with the golden test, and expect open conversations to roll
  to a new epoch.
- Timely holds the history per session id. Send only the new user message or
  the tool results; never resend history.
- Tool results enter the model capped (`truncate.py`); raw twin payloads never do.
- A new MCP tool needs the same name and argument schema in `prefix/tools.*.json`,
  or the service refuses to start.
- Admin write tools run only after `POST /chat/sessions/{sid}/confirm` and carry
  the admin's own bearer, so the simulation API checks it again.
- Students never see admin tools; `/chat/tools` lists what a role gets.

## TEST

```bash
.venv/bin/python -m pytest -q backend/tests -k "harness or twin_mcp"
```
