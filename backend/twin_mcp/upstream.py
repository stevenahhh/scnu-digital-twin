from __future__ import annotations

import json
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from time import monotonic
from typing import Final
from urllib.parse import quote

import anyio
import httpx
from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ResourceError
from pydantic import JsonValue, TypeAdapter, ValidationError

from harness.config import TWIN_SIMULATION_URL, TWIN_TIMEOUT_S, TWIN_VISION_URL, TWIN_WEATHER_URL

from .auth import ADMIN_META, PUBLIC_META
from .digest import Body, obj, rows
from .places import Places

type Payload = Body | list[JsonValue]
JSON_BODY: Final = TypeAdapter(Payload)
SOURCES: Final = {
    "weather": TWIN_WEATHER_URL, "vision": TWIN_VISION_URL, "simulation": TWIN_SIMULATION_URL,
}
RESOURCE_ROUTES: Final = {
    "weather/current": ("weather", "/environment/current", False),
    "weather/full": ("weather", "/environment/full", False),
    "microclimate/elements": ("weather", "/microclimate/elements", False),
    "microclimate/zones": ("weather", "/microclimate/zones", False),
    "microclimate/heatmap": ("weather", "/microclimate/heatmap", False),
    "simulation/restrictions": ("simulation", "/api/simulation/restrictions", False),
    "traffic/parking": ("vision", "/api/traffic", False),
    "simulation/restrictions/targets": ("simulation", "/api/simulation/restrictions/targets", True),
    "simulation/status": ("simulation", "/api/simulation/status", True),
    "simulation/statistics": ("simulation", "/api/simulation/statistics", True),
    "simulation/timeline": ("simulation", "/api/simulation/timeline", True),
    "simulation/events": ("simulation", "/api/simulation/events", True),
    "simulation/network/quality": ("simulation", "/api/simulation/network/quality", True),
    "energy/buildings": ("weather", "/energy/buildings", True),
}


def strip_geometry(value: JsonValue) -> JsonValue:
    match value:
        case dict():
            return {key: strip_geometry(item) for key, item in value.items()
                    if key not in {"segments", "trajectory", "trajectories", "replay"}}
        case list():
            return [strip_geometry(item) for item in value]
        case _:
            return value


class Upstream:
    """Own the HTTP lifetime and the successful restriction-target cache."""

    def __init__(self, http: httpx.AsyncClient | None) -> None:
        self.http = http
        self._targets: Body | None = None
        self._targets_until = 0.0
        self._targets_lock = anyio.Lock()

    @asynccontextmanager
    async def lifespan(self, server: MCPServer) -> AsyncIterator[None]:
        if self.http is not None:
            yield
        else:
            async with httpx.AsyncClient(timeout=TWIN_TIMEOUT_S, follow_redirects=False) as http:
                self.http = http
                try:
                    yield
                finally:
                    self.http = None

    async def request(self, source: str, path: str, *, method: str = "GET",
                      body: Body | None = None, authorization: str = "",
                      params: dict[str, str | int] | None = None) -> Payload:
        if self.http is None:
            raise RuntimeError("MCP server lifespan is not active")
        detail: Body
        try:
            response = await self.http.request(
                method, SOURCES[source] + path, json=body, params=params,
                headers={"Authorization": authorization} if authorization else {},
                timeout=TWIN_TIMEOUT_S,
            )
            if response.status_code == 204:
                return {}
            if response.is_success:
                return JSON_BODY.validate_json(response.content)
            try:
                detail = obj(obj(JSON_BODY.validate_json(response.content)).get("detail"))
            except ValidationError:
                detail = {}
            detail = {**detail, "source": detail.get("source", source),
                      "code": detail.get("code", f"http_{response.status_code}")}
            if "retry_after_s" not in detail and response.headers.get("retry-after", "").isdigit():
                detail["retry_after_s"] = int(response.headers["retry-after"])
        except httpx.TimeoutException:
            detail = {"source": source, "code": "timeout"}
        except httpx.RequestError:
            detail = {"source": source, "code": "connection_unavailable"}
        except ValidationError:
            detail = {"source": source, "code": "invalid_response"}
        return {"unavailable": True, "detail": detail}

    async def many(self, requests: list[tuple[str, str]]) -> list[Body]:
        results: list[Body] = [{} for _ in requests]
        async def fetch(index: int, source: str, path: str) -> None:
            results[index] = obj(await self.request(source, path))
        async with anyio.create_task_group() as group:
            for index, (source, path) in enumerate(requests):
                group.start_soon(fetch, index, source, path)
        return results

    async def targets(self) -> Body:
        async with self._targets_lock:
            if self._targets is not None and monotonic() < self._targets_until:
                return self._targets
            result = obj(await self.request("simulation", "/api/simulation/restrictions/targets"))
            if not result.get("unavailable"):
                self._targets = result
                self._targets_until = monotonic() + 60
            return result


def register_resources(server: MCPServer, upstream: Upstream, places: Places) -> None:
    @server.resource("twin://elements", mime_type="text/tab-separated-values", meta=PUBLIC_META)
    def elements() -> str:
        return places.tsv()

    @server.resource("twin://elements/{element_id}", mime_type="application/json", meta=PUBLIC_META)
    def element(element_id: str) -> str:
        for item in places.raw["elements"]:
            if item["element_id"] == element_id:
                return json.dumps(item, ensure_ascii=False)
        raise ResourceError("알 수 없는 element_id")

    @server.resource("twin://zones", mime_type="application/json", meta=PUBLIC_META)
    def zones() -> str:
        return json.dumps(places.raw["zones"], ensure_ascii=False)

    def register_route(uri: str, source: str, path: str, admin: bool) -> None:
        async def resource() -> str:
            params = {"limit": 50} if uri == "simulation/events" else None
            body = await upstream.request(source, path, params=params)
            if uri == "simulation/events" and not obj(body).get("unavailable"):
                body = {**obj(body), "events": rows(obj(body).get("events"))[:50]}
            if uri in {"simulation/restrictions", "simulation/events"}:
                body = obj(strip_geometry(body))
            return json.dumps(body, ensure_ascii=False)
        server.resource("twin://" + uri, name=uri.replace("/", "_"),
                        mime_type="application/json", meta=ADMIN_META if admin else PUBLIC_META)(resource)
    for uri, (source, path, admin) in RESOURCE_ROUTES.items():
        register_route(uri, source, path, admin)

    @server.resource("twin://weather/timeline/{element_id}", mime_type="application/json", meta=PUBLIC_META)
    async def timeline(element_id: str) -> str:
        return json.dumps(await upstream.request(
            "weather", f"/environment/elements/{quote(element_id, safe='')}/timeline"), ensure_ascii=False)

    @server.resource("twin://microclimate/elements/{element_id}/popup", mime_type="application/json", meta=PUBLIC_META)
    async def popup(element_id: str) -> str:
        return json.dumps(await upstream.request(
            "weather", f"/microclimate/elements/{quote(element_id, safe='')}/popup"), ensure_ascii=False)

    @server.resource("twin://simulation/agents/{agent_id}", mime_type="application/json", meta=ADMIN_META)
    async def agent(agent_id: str) -> str:
        return json.dumps(await upstream.request(
            "simulation", f"/api/simulation/agents/{quote(agent_id, safe='')}"), ensure_ascii=False)

    @server.resource("twin://simulation/scenarios", mime_type="application/json", meta=ADMIN_META)
    def scenarios() -> str:
        path = Path(__file__).resolve().parents[1] / "simulation/data/sample_scenario.json"
        body = json.loads(path.read_text(encoding="utf-8"))
        return json.dumps({"default": body["default"], "scenarios": {
            name: {"label": item["label"]} for name, item in body["scenarios"].items()
        }}, ensure_ascii=False)

    @server.resource("twin://energy/rankings/{date}/{weather_preset}", mime_type="application/json", meta=ADMIN_META)
    async def rankings(date: str, weather_preset: str) -> str:
        return json.dumps(await upstream.request(
            "weather", "/energy/rankings", params={"date": date, "weather_preset": weather_preset}),
            ensure_ascii=False)
