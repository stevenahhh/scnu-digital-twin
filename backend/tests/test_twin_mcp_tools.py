import json
from contextlib import asynccontextmanager

import anyio
import httpx
import mcp
import pytest

from common.campus_auth import Account, issue_token
from twin_mcp.server import build_server


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture
def tokens(monkeypatch):
    monkeypatch.setenv("SCNU_AUTH_SECRET", "twin-mcp-isolated-test-secret")
    return {role: "Bearer " + issue_token(Account(role, role, role))["token"]
            for role in ("student", "admin")}


def meta(header):
    return {"scnu/authorization": header}


def text(result):
    return "\n".join(item.text for item in result.content)


@asynccontextmanager
async def connection(handler):
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        async with mcp.Client(build_server(http=http)) as client:
            yield client
        assert not http.is_closed


SCHEMAS = {
    "find_place": ({"query", "kind", "limit"}, {"query"}),
    "campus_weather": ({"forecast"}, set()),
    "building_status": ({"ids"}, {"ids"}),
    "comfort_rank": ({"metric", "order", "kind", "zone", "limit"}, {"metric", "order"}),
    "campus_status": (set(), set()),
    "simulation_overview": (set(), set()),
    "restriction_create": ({"target_type", "target_id", "cause", "access", "message"},
                           {"target_type", "target_id", "cause"}),
    "restriction_remove": ({"restriction_id"}, {"restriction_id"}),
    "simulation_control": ({"action", "scenario", "multiplier"}, {"action"}),
}
ADMIN_CALLS = [
    ("simulation_overview", {}),
    ("restriction_create", {"target_type": "road", "target_id": "RD_001", "cause": "event"}),
    ("restriction_remove", {"restriction_id": "RST_1"}),
    ("simulation_control", {"action": "pause"}),
]


@pytest.mark.anyio
async def test_catalogue_matches_harness_schemas_roles_and_prompts():
    async with connection(lambda request: httpx.Response(200, json={})) as client:
        tools = (await client.list_tools()).tools
        prompts = (await client.list_prompts()).prompts
    assert {tool.name for tool in tools} == SCHEMAS.keys()
    for tool in tools:
        properties, required = SCHEMAS[tool.name]
        assert set(tool.input_schema["properties"]) == properties
        assert set(tool.input_schema.get("required", [])) == required
        admin = tool.name in {name for name, _ in ADMIN_CALLS}
        assert tool.meta["scnu/roles"] == (["admin"] if admin else ["student", "admin"])
        assert tool.meta["scnu/write"] == (admin and tool.name != "simulation_overview")
    assert {prompt.name for prompt in prompts} == {
        "weather_now", "cool_places", "this_building", "campus_notices",
        "admin_draft_restriction", "admin_traffic_brief",
    }


@pytest.mark.anyio
@pytest.mark.parametrize(("name", "args"), ADMIN_CALLS)
@pytest.mark.parametrize("identity", ["missing", "forged", "student"])
async def test_admin_tools_reject_unverified_roles_without_upstream_calls(name, args, identity, tokens):
    requests = []
    async with connection(lambda request: requests.append(request) or httpx.Response(200, json={})) as client:
        auth = {"missing": None, "forged": meta("Bearer forged"), "student": meta(tokens["student"])}[identity]
        result = await client.call_tool(name, args, meta=auth)
    assert result.is_error
    assert requests == []


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("name", "args", "method", "path", "payload", "response", "expected"),
    [
        ("restriction_create", {"target_type": "road", "target_id": "RD_001", "cause": "event"},
         "POST", "/restrictions", {"target_type": "road", "target_id": "RD_001", "cause": "event",
                                  "access": None, "message": ""},
         {"restriction": {"id": "RST_1", "target_name": "길", "affected_edges": 3}, "rerouted": 7}, "7"),
        ("restriction_remove", {"restriction_id": "RST_1"}, "DELETE", "/restrictions/RST_1", None, None, "RST_1"),
        *[("simulation_control", {"action": action}, "POST", "/" + action, None,
           {"status": "running", "scenario": "normal"}, "running")
          for action in ("start", "pause", "resume", "reset")],
        ("simulation_control", {"action": "scenario", "scenario": "rush_hour"}, "POST", "/scenario",
         {"scenario": "rush_hour"}, {"status": "paused", "scenario": "rush_hour"}, "rush_hour"),
        ("simulation_control", {"action": "speed", "multiplier": 2.5}, "POST", "/speed",
         {"multiplier": 2.5}, {"status": "running", "speed_multiplier": 2.5}, "2.5"),
    ],
)
async def test_writes_forward_same_verified_bearer_and_exact_api_body(
    name, args, method, path, payload, response, expected, tokens,
):
    requests = []
    def handler(request):
        requests.append(request)
        return httpx.Response(204) if response is None else httpx.Response(200, json=response)
    async with connection(handler) as client:
        result = await client.call_tool(name, args, meta=meta(tokens["admin"]))
    assert not result.is_error
    assert expected in text(result) and "시뮬레이션 시나리오" in text(result).splitlines()[0]
    assert requests[0].headers["authorization"] == tokens["admin"]
    assert requests[0].method == method
    assert requests[0].url.path == "/api/simulation" + path
    assert (json.loads(requests[0].content) if requests[0].content else None) == payload


@pytest.mark.anyio
@pytest.mark.parametrize("failure", [503, 501, "timeout", "refused"])
async def test_upstream_failures_are_unavailable_digests(failure):
    def handler(request):
        if failure == "timeout":
            raise httpx.ReadTimeout("private diagnostic", request=request)
        if failure == "refused":
            raise httpx.ConnectError("private diagnostic", request=request)
        return httpx.Response(failure, json={"detail": {
            "code": "weather_upstream_unavailable", "source": "kma_current",
            "retry_after_s": 60, "message_ko": "기상 응답 지연",
        }})
    async with connection(handler) as client:
        result = await client.call_tool("campus_weather")
    assert not result.is_error
    assert "UNAVAILABLE" in text(result).splitlines()[0]
    assert "private diagnostic" not in text(result)
    if isinstance(failure, int):
        assert "retry_after_s=60" in text(result)


@pytest.mark.anyio
async def test_place_search_uses_target_cache_and_does_not_guess_restrictability(monkeypatch):
    requests = []
    now = [100.0]
    monkeypatch.setattr("twin_mcp.upstream.monotonic", lambda: now[0])
    def handler(request):
        requests.append(request)
        return httpx.Response(200, json={"buildings": [{"id": "BLD_D4"}], "roads": []})
    async with connection(handler) as client:
        first = text(await client.call_tool("find_place", {"query": "공대 3호관"}))
        second = text(await client.call_tool("find_place", {"query": "도서관"}))
        now[0] = 161
        await client.call_tool("find_place", {"query": "D4"})
    assert first.splitlines()[1].startswith("BLD_D4\t") and "true" in first.splitlines()[1]
    assert second.splitlines()[1].startswith("BLD_C1\t") and "false" in second.splitlines()[1]
    assert len(requests) == 2


@pytest.mark.anyio
async def test_comfort_ranking_filters_before_sort_and_caps_results():
    body = {"elements": [
        {"element_id": code, "element_type": kind, "zone_id": zone, "utci": utci, "risk_level": "높음"}
        for code, kind, zone, utci in [
            ("BLD_D4", "building", "zone_D", 35), ("BLD_D3", "building", "zone_D", 30),
            ("RD_001", "road", "zone_D", 50), ("BLD_C1", "building", "zone_C", 40),
            ("BLD_D2", "building", "zone_D", None),
        ]
    ]}
    async with connection(lambda request: httpx.Response(200, json=body)) as client:
        result = await client.call_tool("comfort_rank", {
            "metric": "utci", "order": "hot", "kind": "building", "zone": "zone_D", "limit": 2,
        })
    output = text(result)
    assert output.splitlines()[1].startswith("BLD_D4\t")
    assert output.splitlines()[2].startswith("BLD_D3\t")
    assert "BLD_C1" not in output and "RD_001" not in output
    assert len(output) <= 1200 and "추정값" in output.splitlines()[0]


@pytest.mark.anyio
async def test_building_popups_are_parallel_ordered_and_include_scenario_notices():
    waiting = 0
    ready = anyio.Event()
    async def handler(request):
        nonlocal waiting
        if request.url.path.endswith("/restrictions"):
            return httpx.Response(200, json={"restrictions": [{"target_id": "BLD_D4", "message": "학술제"}]})
        waiting += 1
        if waiting == 2:
            ready.set()
        with anyio.fail_after(2):
            await ready.wait()
        return httpx.Response(200, json={"element_id": request.url.path.split("/")[-2],
                                        "thermal": {"utci": 34.9}, "reasons": ["일사"]})
    async with connection(handler) as client:
        result = await client.call_tool("building_status", {"ids": ["BLD_D4", "BLD_C1"]})
    output = text(result)
    assert not result.is_error
    assert output.index("BLD_D4") < output.index("BLD_C1")
    assert "시뮬레이션 시나리오" in output and "학술제" in output
    assert len(output) <= 800


@pytest.mark.anyio
@pytest.mark.parametrize(("name", "args"), [
    ("building_status", {"ids": []}), ("building_status", {"ids": ["RD_001"]}),
    ("find_place", {"query": "x", "limit": 11}),
    ("comfort_rank", {"metric": "temperature", "order": "hot"}),
    ("simulation_control", {"action": "speed", "multiplier": 11}),
    ("simulation_control", {"action": "scenario"}),
])
async def test_invalid_arguments_never_reach_upstream(name, args, tokens):
    requests = []
    async with connection(lambda request: requests.append(request) or httpx.Response(200, json={})) as client:
        result = await client.call_tool(name, args, meta=meta(tokens["admin"]))
    assert result.is_error
    assert requests == []


@pytest.mark.anyio
async def test_http_authorization_header_is_verified_and_propagated(tokens):
    requests = []
    def handler(request):
        requests.append(request)
        return httpx.Response(200, json={"status": "paused"})
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as upstream:
        server = build_server(upstream)
        app = server.streamable_http_app(stateless_http=True, json_response=True)
        async with server.session_manager.run(), httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://127.0.0.1:18174",
            headers={"Accept": "application/json, text/event-stream"},
        ) as client:
            request = {"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {
                "name": "simulation_control", "arguments": {"action": "pause"},
            }}
            student = await client.post("/mcp", json=request, headers={"Authorization": tokens["student"]})
            admin = await client.post("/mcp", json=request, headers={"Authorization": tokens["admin"]})
    assert student.status_code == 200, student.text
    assert admin.status_code == 200, admin.text
    assert student.json()["result"]["isError"] is True
    assert admin.json()["result"].get("isError", False) is False
    assert len(requests) == 1 and requests[0].headers["authorization"] == tokens["admin"]
