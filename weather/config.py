"""Weather service configuration loaded from the environment and weather/.env."""

from __future__ import annotations

import os
import math
from pathlib import Path


def _load_dotenv(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except FileNotFoundError:
        return values

    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        name, value = stripped.split("=", 1)
        name = name.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
            value = value[1:-1]
        if name:
            values[name] = value
    return values


_DOTENV = _load_dotenv(Path(__file__).with_name(".env"))


def _setting(name: str, default: str = "") -> str:
    if name in os.environ:
        return os.environ[name]
    return _DOTENV.get(name, default)


def _number(name: str, default: int | float) -> int | float:
    value = _setting(name)
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return default
    if not math.isfinite(parsed) or parsed < 0:
        return default
    return int(parsed) if parsed.is_integer() else parsed


# API credentials: use the data.go.kr Decoding key.
KMA_SERVICE_KEY = _setting("KMA_SERVICE_KEY")
AIRKOREA_SERVICE_KEY = _setting("AIRKOREA_SERVICE_KEY", KMA_SERVICE_KEY)

# Upstream service origins; collectors own their endpoint paths.
KMA_BASE_URL = _setting("KMA_BASE_URL", "https://apis.data.go.kr").rstrip("/")
AIRKOREA_BASE_URL = _setting("AIRKOREA_BASE_URL", "https://apis.data.go.kr").rstrip("/")

WEATHER_UPSTREAM_CONNECT_TIMEOUT_S = _number("WEATHER_UPSTREAM_CONNECT_TIMEOUT_S", 3)
WEATHER_UPSTREAM_READ_TIMEOUT_S = _number("WEATHER_UPSTREAM_READ_TIMEOUT_S", 7)
WEATHER_CACHE_TTL_KMA_CURRENT_S = _number("WEATHER_CACHE_TTL_KMA_CURRENT_S", 600)
WEATHER_CACHE_TTL_KMA_FORECAST_S = _number("WEATHER_CACHE_TTL_KMA_FORECAST_S", 3600)
WEATHER_CACHE_TTL_AIRKOREA_S = _number("WEATHER_CACHE_TTL_AIRKOREA_S", 1800)
WEATHER_CACHE_MAX_STALE_S = _number("WEATHER_CACHE_MAX_STALE_S", 10800)
WEATHER_UPSTREAM_RETRY_AFTER_S = _number("WEATHER_UPSTREAM_RETRY_AFTER_S", 60)
WEATHER_CACHE_FILE = _setting("WEATHER_CACHE_FILE", "weather/data/weather-cache.json")

# 순천대학교 근처 격자 좌표
KMA_NX = 67
KMA_NY = 84

# 순천대학교 캠퍼스 위경도 (미기후 태양고도 계산용)
CAMPUS_LAT = 34.96   # 위도 (°N)
CAMPUS_LON = 127.49  # 경도 (°E)

# 에어코리아 측정소/시군 이름
AIR_STATION_NAME = "용당동"
AIR_SIDO_NAME = "전남"

#AIR_STATION_NAME = "매곡동"
