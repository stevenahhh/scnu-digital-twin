# collectors/air_quality.py

from datetime import datetime, timedelta, timezone

import config
from .upstream import UpstreamError, request_json


BASE_URL = config.AIRKOREA_BASE_URL + "/B552584/ArpltnInforInqireSvc/getMsrstnAcctoRltmMesureDnsty"
KST = timezone(timedelta(hours=9))


def _parse_float(value):
    try:
        if value in (None, "", "-"):
            return None
        return float(value)
    except Exception:
        return None


def _parse_data_time(value: str) -> datetime:
    """AirKorea reports the midnight measurement as "YYYY-MM-DD 24:00" of the previous day."""
    day, _, clock = value.partition(" ")
    if clock == "24:00":
        return datetime.strptime(day, "%Y-%m-%d") + timedelta(days=1)
    return datetime.strptime(value, "%Y-%m-%d %H:%M")


def fetch_air_quality() -> dict:
    params = {
        "serviceKey": config.AIRKOREA_SERVICE_KEY,
        "returnType": "json",
        "numOfRows": 10,
        "pageNo": 1,
        "stationName": config.AIR_STATION_NAME,
        "dataTerm": "DAILY",
        "ver": "1.3",
    }

    if not config.AIRKOREA_SERVICE_KEY:
        raise UpstreamError("AirKorea", "missing_key", "AirKorea service key is not configured")

    data = request_json(
        "AirKorea",
        BASE_URL,
        params,
        connect_timeout=config.WEATHER_UPSTREAM_CONNECT_TIMEOUT_S,
        read_timeout=config.WEATHER_UPSTREAM_READ_TIMEOUT_S,
    )

    items = data.get("response", {}).get("body", {}).get("items", [])
    if isinstance(items, dict):
        items = items.get("item", [])
    if not items:
        raise UpstreamError("AirKorea", "no_data", "No measurement data returned")

    item = items[0]
    try:
        data_time = _parse_data_time(item["dataTime"])
    except (KeyError, TypeError, ValueError):
        raise UpstreamError("AirKorea", "malformed", "Invalid measurement dataTime") from None

    return {
        "pm10": _parse_float(item.get("pm10Value")),
        "pm25": _parse_float(item.get("pm25Value")),
        "o3": _parse_float(item.get("o3Value")),
        "khai_value": _parse_float(item.get("khaiValue")),
        "khai_grade": str(item.get("khaiGrade", "")),
        "observed_at": data_time.replace(tzinfo=KST).isoformat(),
    }
