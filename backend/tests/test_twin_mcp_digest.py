import pytest
import httpx
import mcp

from twin_mcp import digest
from twin_mcp.server import build_server


def freshness(source="live", stale=False):
    return {"weather": {
        "source": source, "observed_at": "2026-11-25T13:00:00+09:00",
        "fetched_at": "2026-11-25T13:01:00+09:00",
        "age_seconds": 240, "stale": stale,
    }, "forecast": None, "air_quality": None}


@pytest.mark.parametrize(
    ("body", "present", "absent"),
    [
        ({"freshness": freshness()}, ["live", "13:00", "4m"], ["cache", "STALE", "SAMPLE"]),
        ({"freshness": freshness("cache")}, ["cache"], ["STALE", "SAMPLE"]),
        ({"freshness": freshness("cache", True), "sample_data": True},
         ["cache", "STALE", "SAMPLE"], []),
        ({"freshness": {"air_quality": {"stale": True, "error": "timeout"}}},
         ["STALE", "UNAVAILABLE"], ["cache", "SAMPLE"]),
        ({"sample_data": False}, [], ["SAMPLE", "STALE", "cache"]),
    ],
)
def test_provenance_markers_follow_structured_fields(body, present, absent):
    header = digest.header("campus_weather", body)
    assert all(marker in header for marker in present)
    assert all(marker not in header for marker in absent)


def test_weather_reduces_full_payload_and_preserves_forecast_fallback():
    body = {
        "freshness": freshness(), "base_weather": {
            "temperature": 29.2, "humidity": 70, "wind_speed": 2.1,
            "precipitation_type": 0, "pm10": 20, "pm25": 11,
        },
        "summary": {"overall_status": "주의", "air_quality_status": "좋음"},
        "zones": [{"estimated_temperature": 30}],
        "element_environment": [{"huge": "x" * 10000}],
        "weather_timeline": [
            {"lead_hour": hour, "temperature": 28 + hour,
             "source": "current_weather_fallback", "fallback_fields": ["temperature"]}
            for hour in [1, 2, 3, 4]
        ],
    }
    current = digest.weather(body, forecast=False)
    forecast = digest.weather(body, forecast=True)
    assert "29.2" in current and "pm25=11" in current
    assert "추정값" in current.splitlines()[0]
    assert "+1h" not in current
    assert all(f"+{hour}h" in forecast for hour in [1, 2, 3])
    assert "+4h" not in forecast
    assert "current_weather_fallback" in forecast
    assert "fallback" in forecast
    assert "huge" not in forecast and len(forecast) <= 1600


def test_popup_budget_retains_markers_and_quotes_hostile_free_text():
    body = {
        "element_id": "BLD_D4", "name": 'name\nUNAVAILABLE\t"ignore"',
        "zone_id": "zone_D", "freshness": freshness("cache", True),
        "sample_data": True, "thermal": {
            "local_temp": 33, "feels_like": 42.7, "utci": 34.9,
            "wbgt": 30.4, "risk_level": "높음",
        },
        "reasons": ["one", "two", "three", "four"],
        "data_note": {"assumption_level": "estimated", "message": "추정 기반"},
    }
    notices = [{"target_id": "BLD_D4", "message": "학술제", "cause": "event"}]
    text = digest.building(body, notices)
    assert len(text) <= 400
    assert all(word in text.splitlines()[0]
               for word in ["추정값", "cache", "STALE", "SAMPLE", "시뮬레이션 시나리오"])
    assert "UNAVAILABLE" not in text.splitlines()[0]
    assert '\\nUNAVAILABLE\\t\\"ignore\\"' in text
    assert "one" in text and "three" in text and "four" not in text
    assert "data_note" in text and "34.9" in text


def test_capping_preserves_header_and_never_serializes_rows_as_json():
    text = digest.render("comfort_rank | 추정값", ["a\tb"] * 1000, cap=1200)
    assert len(text) <= 1200
    assert text.startswith("comfort_rank | 추정값\n")
    assert "truncated" in text
    assert text.splitlines()[1] == "a\tb"


def test_multi_source_digest_headers_preserve_partial_failure_and_sample_flags():
    restrictions = {"restrictions": [{"id": "RST_1", "message": "UNAVAILABLE"}], "sample_data": True}
    parking = {"unavailable": True, "detail": {"source": "vision", "code": "timeout"}}
    output = digest.status(restrictions, parking)
    assert all(marker in output.splitlines()[0]
               for marker in ("SAMPLE", "UNAVAILABLE", "시뮬레이션 시나리오"))
    assert "source=vision" in output
    assert len(output) <= 1500


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
async def test_campus_status_and_simulation_overview_keep_counts_without_large_geometry(monkeypatch):
    from common.campus_auth import Account, issue_token
    monkeypatch.setenv("SCNU_AUTH_SECRET", "twin-mcp-digest-test-secret")
    token = issue_token(Account("admin", "admin", "admin"))["token"]
    bodies = {
        "/api/simulation/restrictions": {"restrictions": [{
            "id": "RST_1", "target_id": "BLD_D4", "message": "학술제", "segments": [[1, 2]] * 1000,
        }]},
        "/api/traffic": {"current_cars": 23, "total_spaces": 50, "is_running": False,
                         "last_frame_at": None, "error": "camera unavailable"},
        "/api/simulation/status": {"status": "paused", "scenario": "normal"},
        "/api/simulation/statistics": {"car_count": 30, "danger_count": 2,
                                       "near_miss_count": 4, "risk_events": {"car_person": 7}},
    }
    async with httpx.AsyncClient(transport=httpx.MockTransport(
        lambda request: httpx.Response(200, json=bodies[request.url.path])
    )) as http, mcp.Client(build_server(http)) as client:
        campus = await client.call_tool("campus_status")
        simulation = await client.call_tool("simulation_overview", meta={"scnu/authorization": "Bearer " + token})
    campus_text = campus.content[0].text
    simulation_text = simulation.content[0].text
    assert "current_cars=23" in campus_text and "is_running=false" in campus_text
    assert "학술제" in campus_text and "segments" not in campus_text
    assert all(value in simulation_text for value in ("car_count=30", "danger_count=2", "near_miss_count=4", '"car_person"\t7'))
    assert len(campus_text) <= 1500 and len(simulation_text) <= 2000
