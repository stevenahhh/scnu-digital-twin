from __future__ import annotations

import math
import os
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]


def _setting(name: str, default: str = "") -> str:
    return os.environ.get(name, default)


def _number(name: str, default: int | float) -> int | float:
    try:
        parsed = float(_setting(name))
    except ValueError:
        return default
    if not math.isfinite(parsed) or parsed < 0:
        return default
    return int(parsed) if parsed.is_integer() else parsed


def _path(name: str, default: Path) -> Path:
    value = _setting(name)
    if not value:
        return default
    path = Path(value)
    return path if path.is_absolute() else REPO_ROOT / path


# Timely. The key is read from the process environment only and never written anywhere.
TIMELY_API_KEY = _setting("TIMELY_API_KEY")
TIMELY_BASE_URL = _setting("TIMELY_BASE_URL", "https://hello.timelygpt.co.kr").rstrip("/")
HARNESS_MODEL = _setting("HARNESS_MODEL", "claude-sonnet-5-5")
REASONING_EFFORT = {
    "student": _setting("HARNESS_REASONING_EFFORT_STUDENT", "low"),
    "admin": _setting("HARNESS_REASONING_EFFORT_ADMIN", "medium"),
}

# Twin upstreams reached by the MCP server.
TWIN_WEATHER_URL = _setting("TWIN_WEATHER_URL", "http://127.0.0.1:8000").rstrip("/")
TWIN_VISION_URL = _setting("TWIN_VISION_URL", "http://127.0.0.1:8001").rstrip("/")
TWIN_SIMULATION_URL = _setting("TWIN_SIMULATION_URL", "http://127.0.0.1:8002").rstrip("/")
TWIN_TIMEOUT_S = _number("TWIN_TIMEOUT_S", 8)

# Service.
HARNESS_PORT = int(_number("HARNESS_PORT", 8004))
HARNESS_DATA_DIR = _path("HARNESS_DATA_DIR", REPO_ROOT / "backend" / "harness" / "data")
HARNESS_EVAL = _setting("HARNESS_EVAL", "auto")
HARNESS_MCP_HTTP = _setting("HARNESS_MCP_HTTP", "0") in ("1", "true", "on")
HARNESS_CORS_ORIGIN_REGEX = _setting(
    "HARNESS_CORS_ORIGIN_REGEX",
    r"^https?://(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$",
)

# Usage limits below are off by default (0). Set them before exposing guest login publicly.
# Sessions.
MAX_CONVERSATIONS_PER_OWNER = int(_number("HARNESS_MAX_CONVERSATIONS_PER_OWNER", 0))
MAX_LIVE_KERNELS = int(_number("HARNESS_MAX_LIVE_KERNELS", 8))
KERNEL_IDLE_TIMEOUT_S = _number("HARNESS_KERNEL_IDLE_TIMEOUT_S", 900)
RETENTION_S = {"account": _number("HARNESS_RETENTION_S", 86400), "guest": _number("HARNESS_GUEST_RETENTION_S", 7200)}
MAX_RUNS_PER_OWNER = int(_number("HARNESS_MAX_RUNS_PER_OWNER", 0))
MAX_TIMELY_STREAMS = int(_number("HARNESS_MAX_TIMELY_STREAMS", 8))
CONFIRM_TIMEOUT_S = _number("HARNESS_CONFIRM_TIMEOUT_S", 120)
HEARTBEAT_S = _number("HARNESS_HEARTBEAT_S", 15)

# Turn and context budgets (estimated tokens, characters).
MAX_USER_CHARS = int(_number("HARNESS_MAX_USER_CHARS", 0))
MAX_CONTEXT_LINE_CHARS = 120
MAX_ROUNDS = int(_number("HARNESS_MAX_ROUNDS", 0))
MAX_TOOL_CALLS_PER_TURN = int(_number("HARNESS_MAX_TOOL_CALLS_PER_TURN", 0))
MAX_TOOL_OUTPUT_CHARS_PER_TURN = int(_number("HARNESS_MAX_TOOL_OUTPUT_CHARS_PER_TURN", 40000))
DEFAULT_TOOL_CAP = 4000
EVAL_TOOL_CAP = 6000
EPOCH_SOFT_LIMIT = {"student": _number("HARNESS_EPOCH_SOFT_STUDENT", 24000),
                    "admin": _number("HARNESS_EPOCH_SOFT_ADMIN", 40000)}
EPOCH_HARD_LIMIT = _number("HARNESS_EPOCH_HARD", 60000)
SEED_MAX_CHARS = 2500
DAILY_BUDGET = {"guest": _number("HARNESS_DAILY_GUEST", 0), "student": _number("HARNESS_DAILY_STUDENT", 0),
                "admin": _number("HARNESS_DAILY_ADMIN", 0)}
DAILY_BUDGET_TOTAL = _number("HARNESS_DAILY_TOTAL", 0)

# Eval sandbox limits per role.
EVAL_LIMITS = {
    "student": {"timeout_s": 8, "max_timeout_s": 15, "cpu_s": 60, "memory_mb": 256, "file_mb": 2, "calls": 20},
    "admin": {"timeout_s": 20, "max_timeout_s": 60, "cpu_s": 300, "memory_mb": 512, "file_mb": 10, "calls": 100},
}

# Token estimator coefficients (Timely returns no usage, see tokens.py).
TOKENS_PER_ASCII_DIVISOR = _number("HARNESS_TOKENS_ASCII_DIVISOR", 3.0)
TOKENS_PER_HANGUL = _number("HARNESS_TOKENS_HANGUL", 1.2)
TOKENS_PER_OTHER = _number("HARNESS_TOKENS_OTHER", 1.5)


def summary() -> dict:
    return {
        "llm": "ready" if TIMELY_API_KEY else "key_missing",
        "model": HARNESS_MODEL,
        "base_url": TIMELY_BASE_URL,
        "twin": {"weather": TWIN_WEATHER_URL, "vision": TWIN_VISION_URL, "simulation": TWIN_SIMULATION_URL},
        "data_dir": str(HARNESS_DATA_DIR),
        "eval": HARNESS_EVAL,
    }
