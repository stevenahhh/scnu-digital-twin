from __future__ import annotations

import math
from typing import Annotated, Literal
from urllib.parse import quote

import httpx
from mcp.server.mcpserver import Context, MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from pydantic import Field

from . import digest
from .auth import ADMIN_META, PUBLIC_META, WRITE_META, TwinMCPServer, require_admin, resource_authorization
from .places import Kind, Places
from .prompts import register_prompts
from .upstream import Upstream, register_resources

Limit = Annotated[int, Field(ge=1, le=10)]
BuildingId = Annotated[str, Field(pattern=r"^BLD_[A-Za-z0-9_]+$")]


def build_server(http: httpx.AsyncClient | None = None) -> MCPServer:
    places = Places()
    upstream = Upstream(http)
    server = TwinMCPServer("scnu-twin", lifespan=upstream.lifespan, middleware=[resource_authorization])

    @server.tool(meta=PUBLIC_META, structured_output=False)
    async def find_place(query: str, kind: Kind = "any", limit: Limit = 5) -> str:
        """Resolve a campus name, alias or code before calling tools that need an id."""
        matches = places.find(query, kind, limit)
        targets = await upstream.targets()
        available = {item.get("id") for key in ("roads", "buildings")
                     for item in digest.rows(targets.get(key))}
        title = "find_place"
        if targets.get("unavailable"):
            title += " | UNAVAILABLE source=simulation restrictable=unknown"
        lines = ["\t".join((
            place.element_id, digest.quote(place.name), place.element_type, place.zone_id or "-",
            "unknown" if targets.get("unavailable") else str(place.element_id in available).lower(),
        )) for place in matches]
        return digest.render(title, lines, cap=1200)

    @server.tool(meta=PUBLIC_META, structured_output=False)
    async def campus_weather(forecast: bool = False) -> str:
        """Current KMA and AirKorea observations; optionally include +1 to +3 h frames."""
        return digest.weather(digest.obj(await upstream.request("weather", "/environment/full")), forecast=forecast)

    @server.tool(meta=PUBLIC_META, structured_output=False)
    async def building_status(ids: Annotated[list[BuildingId], Field(min_length=1, max_length=5)]) -> str:
        """Estimated thermal status, reasons and scenario notices for one to five buildings."""
        responses = await upstream.many([
            *(("weather", f"/microclimate/elements/{identifier}/popup") for identifier in ids),
            ("simulation", "/api/simulation/restrictions"),
        ])
        restrictions = responses[-1]
        notices = digest.rows(restrictions.get("restrictions"))
        chunks = []
        for identifier, body in zip(ids, responses[:-1]):
            if body.get("unavailable"):
                chunk = digest.unavailable("building_status", body)
                chunk = digest.render(chunk, [identifier], cap=400)
            else:
                chunk = digest.building(body, notices)
                if restrictions.get("unavailable"):
                    title, _, remainder = chunk.partition("\n")
                    chunk = digest.render(title + " | UNAVAILABLE notices", [remainder], cap=400)
            chunks.append(chunk)
        return "\n".join(chunk[:399] for chunk in chunks)

    @server.tool(meta=PUBLIC_META, structured_output=False)
    async def comfort_rank(metric: Literal["utci", "wbgt", "feels_like", "local_temp"],
                           order: Literal["hot", "cool"], kind: Literal["building", "road", "any"] = "any",
                           zone: str = "", limit: Limit = 5) -> str:
        """Rank elements by an estimated thermal metric after zone and kind filtering."""
        body = digest.obj(await upstream.request("weather", "/microclimate/elements"))
        if body.get("unavailable"):
            return digest.unavailable("comfort_rank", body)
        candidates = []
        for item in digest.rows(body.get("elements")):
            value = item.get(metric)
            if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value):
                continue
            if kind != "any" and item.get("element_type") != kind:
                continue
            if zone and item.get("zone_id") != zone:
                continue
            candidates.append(item)
        candidates.sort(key=lambda item: (float(item[metric]) * (-1 if order == "hot" else 1),
                                          str(item.get("element_id"))))
        selected = candidates[:limit]
        lines = []
        for item in selected:
            identifier = str(item.get("element_id"))
            place = places.by_id.get(identifier)
            lines.append("\t".join((identifier, digest.quote(place.name if place else identifier),
                                    digest.scalar(item.get(metric)), digest.scalar(item.get("risk_level")),
                                    digest.scalar(item.get("zone_id")), digest.scalar(item.get("element_type")))))
        return digest.render(digest.header(
            f"comfort_rank metric={metric} order={order} kind={kind} n={len(selected)}",
            body, estimated=True), lines, cap=1200)

    @server.tool(meta=PUBLIC_META, structured_output=False)
    async def campus_status() -> str:
        """Restriction scenarios and gate-counter parking state, without geometry."""
        restrictions, parking = await upstream.many([
            ("simulation", "/api/simulation/restrictions"), ("vision", "/api/traffic"),
        ])
        return digest.status(restrictions, parking)

    @server.tool(meta=ADMIN_META, structured_output=False)
    async def simulation_overview(ctx: Context) -> str:
        """Simulation status, agent counts, risk levels and near-miss and event counts."""
        require_admin(ctx)
        status, statistics = await upstream.many([
            ("simulation", "/api/simulation/status"), ("simulation", "/api/simulation/statistics"),
        ])
        return digest.overview(status, statistics)

    @server.tool(meta=WRITE_META, structured_output=False)
    async def restriction_create(target_type: Literal["road", "building"], target_id: str,
                                 cause: Literal["construction", "event", "other"], ctx: Context,
                                 access: Literal["vehicles", "all"] | None = None,
                                 message: Annotated[str, Field(max_length=200)] = "") -> str:
        """Apply a restriction scenario after the harness obtains admin confirmation."""
        authorization = require_admin(ctx)
        body = digest.obj(await upstream.request("simulation", "/api/simulation/restrictions", method="POST",
                                      authorization=authorization, body={
                                          "target_type": target_type, "target_id": target_id,
                                          "cause": cause, "access": access, "message": message,
                                      }))
        if body.get("unavailable"):
            return digest.unavailable("restriction_create", body)
        return digest.render(digest.header("restriction_create", {}, simulation=True), [
            digest.fields(digest.obj(body.get("restriction")), ("id", "target_name", "affected_edges")),
            digest.fields(body, ("rerouted",)),
        ], cap=600)

    @server.tool(meta=WRITE_META, structured_output=False)
    async def restriction_remove(restriction_id: str, ctx: Context) -> str:
        """Remove a restriction scenario after admin confirmation."""
        body = digest.obj(await upstream.request(
            "simulation", f"/api/simulation/restrictions/{quote(restriction_id, safe='')}",
            method="DELETE", authorization=require_admin(ctx)))
        if body.get("unavailable"):
            return digest.unavailable("restriction_remove", body)
        return digest.render(digest.header("restriction_remove", {}, simulation=True),
                             ["removed\t" + digest.quote(restriction_id)], cap=300)

    @server.tool(meta=WRITE_META, structured_output=False)
    async def simulation_control(action: Literal["start", "pause", "resume", "reset", "scenario", "speed"],
                                 ctx: Context, scenario: str | None = None,
                                 multiplier: Annotated[float | None, Field(ge=0.1, le=10)] = None) -> str:
        """Control the simulator after admin confirmation and return its updated status."""
        authorization = require_admin(ctx)
        payload = None
        if action == "scenario":
            if not scenario:
                raise ToolError("scenario is required for action=scenario")
            payload = {"scenario": scenario}
        if action == "speed":
            if multiplier is None:
                raise ToolError("multiplier is required for action=speed")
            payload = {"multiplier": multiplier}
        body = digest.obj(await upstream.request("simulation", "/api/simulation/" + action, method="POST",
                                                 body=payload, authorization=authorization))
        if body.get("unavailable"):
            return digest.unavailable("simulation_control", body)
        return digest.render(digest.header("simulation_control", {}, simulation=True), [
            digest.fields(body, ("status", "scenario", "simulation_time", "speed_multiplier")),
        ], cap=600)

    register_resources(server, upstream, places)
    register_prompts(server)
    return server
