from __future__ import annotations

from weather.api import app as weather_app
from weather.collectors.upstream import UpstreamError
from weather.collectors.cache import TTLCache


def test_zone_environment_keeps_weather_when_air_quality_is_unavailable(monkeypatch) -> None:
    weather = {
        "timestamp": "20260820T1200",
        "temperature": 31.2,
        "humidity": 64.0,
        "wind_speed": 1.8,
    }

    def fail_air_quality() -> dict:
        raise UpstreamError("airkorea", "http_error", "429 Too Many Requests")

    monkeypatch.setattr(weather_app, "fetch_air_quality", fail_air_quality)
    monkeypatch.setattr(weather_app, "WEATHER_CACHE", TTLCache())

    air_quality, freshness = weather_app._get_air_quality()
    result = weather_app._build_zone_environment(weather, air_quality)

    assert freshness == {"stale": True, "error": "http_error"}
    assert result["base_weather"]["temperature"] == 31.2
    assert result["base_weather"]["air_quality_source"] == "unavailable"
    assert result["base_weather"]["pm10"] is None
    assert result["summary"]["air_quality_status"] == "정보 없음"
