import pytest
import json
import httpx
import mcp

from twin_mcp.places import Places
from twin_mcp.server import build_server


@pytest.mark.parametrize(
    ("query", "expected"),
    [
        ("공대 3호관", "BLD_D4"),
        ("도서관", "BLD_C1"),
        ("ｂｌｄ＿ｄ４", "BLD_D4"),
        ("D4", "BLD_D4"),
        ("본관", "BLD_A1"),
        ("공과대학-3호관", "BLD_D4"),
    ],
)
def test_aliases_and_codes_resolve_against_campus_data(query, expected):
    results = Places().find(query)
    assert results[0].element_id == expected


def test_place_filters_limits_and_unknown_queries():
    places = Places()
    roads = places.find("공대", kind="road", limit=2)
    assert len(roads) == 2
    assert all(row.element_type == "road" for row in roads)
    assert places.find("존재하지않는장소") == []
    assert places.find("   ") == []
    assert places.find("도서관", kind="building")[0].zone_id == "zone_C"
    assert places.find("zone_D", kind="zone")[0].element_id == "zone_D"


def test_exact_name_precedes_road_substring_and_order_is_stable():
    results = Places().find("도서관")
    assert results[0].name == "도서관"
    assert [row.element_id for row in results] == [
        row.element_id for row in Places().find("도서관")
    ]


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
async def test_local_resources_keep_raw_elements_and_zone_names():
    def handler(request):
        pytest.fail("Local resources must not call an upstream")
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        async with mcp.Client(build_server(http)) as client:
            elements = await client.read_resource("twin://elements")
            building = await client.read_resource("twin://elements/BLD_D4")
            zones = await client.read_resource("twin://zones")
    assert 'BLD_D4\t공과대학 3호관\tbuilding\tzone_D' in elements.contents[0].text
    assert json.loads(building.contents[0].text)["name"] == "공과대학 3호관"
    assert {row["zone_id"] for row in json.loads(zones.contents[0].text)} == {
        "zone_A", "zone_B", "zone_C", "zone_D", "zone_E", "zone_F",
    }


RESOURCE_CASES = [
    ("weather/current", "/environment/current", False),
    ("weather/full", "/environment/full", False),
    ("weather/timeline/BLD_D4", "/environment/elements/BLD_D4/timeline", False),
    ("microclimate/elements", "/microclimate/elements", False),
    ("microclimate/elements/BLD_D4/popup", "/microclimate/elements/BLD_D4/popup", False),
    ("microclimate/zones", "/microclimate/zones", False),
    ("microclimate/heatmap", "/microclimate/heatmap", False),
    ("simulation/restrictions", "/api/simulation/restrictions", False),
    ("traffic/parking", "/api/traffic", False),
    ("simulation/restrictions/targets", "/api/simulation/restrictions/targets", True),
    ("simulation/status", "/api/simulation/status", True),
    ("simulation/statistics", "/api/simulation/statistics", True),
    ("simulation/timeline", "/api/simulation/timeline", True),
    ("simulation/events", "/api/simulation/events", True),
    ("simulation/agents/car_001", "/api/simulation/agents/car_001", True),
    ("simulation/network/quality", "/api/simulation/network/quality", True),
    ("energy/buildings", "/energy/buildings", True),
    ("energy/rankings/2026-11-25/clear", "/energy/rankings", True),
]


@pytest.mark.anyio
@pytest.mark.parametrize(("uri", "path", "admin"), RESOURCE_CASES)
async def test_resource_routes_roles_and_reduced_geometry(uri, path, admin, monkeypatch):
    from common.campus_auth import Account, issue_token
    monkeypatch.setenv("SCNU_AUTH_SECRET", "twin-mcp-resource-test-secret")
    token = issue_token(Account("admin", "admin", "admin"))["token"]
    requests = []
    def handler(request):
        requests.append(request)
        assert request.url.path == path
        if uri == "energy/buildings":
            return httpx.Response(200, json=[{"id": "BLD_D4", "name": "공과대학 3호관"}])
        return httpx.Response(200, json={
            "source_path": path, "events": [{"id": index, "replay": {"before": [1]},
                                           "trajectories": [[2]]} for index in range(70)],
            "restrictions": [{"id": "RST_1", "segments": [[3]]}],
        })
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        async with mcp.Client(build_server(http)) as client:
            if admin:
                with pytest.raises(mcp.MCPError, match="관리자"):
                    await client.read_resource("twin://" + uri)
                assert requests == []
            result = await client.read_resource(
                "twin://" + uri, meta={"scnu/authorization": "Bearer " + token} if admin else None)
            catalogue = (await client.list_resources()).resources
            templates = (await client.list_resource_templates()).resource_templates
    body = json.loads(result.contents[0].text)
    if uri == "energy/buildings":
        assert body == [{"id": "BLD_D4", "name": "공과대학 3호관"}]
    else:
        assert body["source_path"] == path
    assert all(item.meta["scnu/write"] is False for item in [*catalogue, *templates])
    if uri == "simulation/events":
        assert len(body["events"]) == 50
        assert "trajectories" not in result.contents[0].text and "replay" not in result.contents[0].text
        assert requests[0].url.params["limit"] == "50"
    if uri == "simulation/restrictions":
        assert "segments" not in body["restrictions"][0]
    if uri.startswith("energy/rankings/"):
        assert dict(requests[0].url.params) == {"date": "2026-11-25", "weather_preset": "clear"}


@pytest.mark.anyio
async def test_scenarios_are_labels_only_and_admin_prompts_are_guarded(monkeypatch):
    from common.campus_auth import Account, issue_token
    monkeypatch.setenv("SCNU_AUTH_SECRET", "twin-mcp-prompts-test-secret")
    token = issue_token(Account("admin", "admin", "admin"))["token"]
    async with httpx.AsyncClient(transport=httpx.MockTransport(
        lambda request: pytest.fail("Static scenarios and prompts must not call upstream")
    )) as http, mcp.Client(build_server(http)) as client:
        with pytest.raises(mcp.MCPError, match="관리자"):
            await client.get_prompt("admin_traffic_brief")
        auth = {"scnu/authorization": "Bearer " + token}
        result = await client.read_resource("twin://simulation/scenarios", meta=auth)
        for prompt in (await client.list_prompts()).prompts:
            message = await client.get_prompt(prompt.name, meta=auth)
            assert message.messages[0].role == "user"
            assert message.messages[0].content.text
    body = json.loads(result.contents[0].text)
    assert body["default"] == "normal"
    assert body["scenarios"]["normal"] == {"label": "일반"}
    assert all(set(value) == {"label"} for value in body["scenarios"].values())
