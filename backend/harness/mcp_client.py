from __future__ import annotations

import json
import re
from contextlib import AsyncExitStack
from typing import Any

import mcp

STUDENT_TOOLS = frozenset({"find_place", "campus_weather", "building_status", "comfort_rank", "campus_status"})
ADMIN_TOOLS = STUDENT_TOOLS | {"simulation_overview", "restriction_create", "restriction_remove", "simulation_control"}
WRITE_TOOLS = frozenset({"restriction_create", "restriction_remove", "simulation_control"})
STUDENT_RESOURCES = re.compile(
    r"^twin://(elements(/[A-Za-z0-9_]+)?|zones|weather/(current|full|timeline/[A-Za-z0-9_]+)"
    r"|microclimate/(elements(/[A-Za-z0-9_]+/popup)?|zones|heatmap)|simulation/restrictions|traffic/parking)$"
)


class NotAllowed(PermissionError):
    pass


def allowed_tool(role: str, name: str) -> bool:
    return name in (ADMIN_TOOLS if role == "admin" else STUDENT_TOOLS)


def allowed_resource(role: str, uri: str) -> bool:
    return uri.startswith("twin://") if role == "admin" else bool(STUDENT_RESOURCES.match(uri))


def _text(contents: list[Any]) -> str:
    parts = []
    for item in contents:
        text = getattr(item, "text", None)
        if text is not None:
            parts.append(text)
        elif getattr(item, "blob", None) is not None:
            parts.append(f"[binary {getattr(item, 'mime_type', '')}]")
    return "\n".join(parts)


class TwinClient:
    def __init__(self, server: Any) -> None:
        self._server = server
        self._stack: AsyncExitStack | None = None
        self._client: mcp.Client | None = None

    async def start(self) -> None:
        self._stack = AsyncExitStack()
        self._client = await self._stack.enter_async_context(mcp.Client(self._server))

    async def close(self) -> None:
        if self._stack is not None:
            await self._stack.aclose()
            self._stack = self._client = None

    @staticmethod
    def _meta(authorization: str | None, session_id: str | None) -> dict[str, str]:
        meta = {}
        if authorization:
            meta["scnu/authorization"] = authorization
        if session_id:
            meta["scnu/session"] = session_id
        return meta

    async def list_tools(self) -> list[Any]:
        return (await self._client.list_tools()).tools

    async def list_prompts(self) -> list[Any]:
        return (await self._client.list_prompts()).prompts

    async def call(self, name: str, args: dict, *, role: str, authorization: str | None = None,
                   session_id: str | None = None) -> str:
        if not allowed_tool(role, name):
            raise NotAllowed(name)
        result = await self._client.call_tool(name, args, meta=self._meta(authorization, session_id))
        text = _text(result.content)
        return f"ERROR {text}" if result.is_error else text

    async def read(self, uri: str, *, role: str, authorization: str | None = None,
                   session_id: str | None = None) -> str:
        if not allowed_resource(role, uri):
            raise NotAllowed(uri)
        result = await self._client.read_resource(uri, meta=self._meta(authorization, session_id),
                                                  cache_mode="bypass")
        return _text(result.contents)

    async def bridge(self, request: dict, *, role: str, authorization: str | None, session_id: str) -> str:
        """Answer an eval kernel's twin.get / twin.call; write tools never run from eval."""
        try:
            if request["kind"] == "get":
                return await self.read(request["uri"], role=role, authorization=authorization, session_id=session_id)
            if request["name"] in WRITE_TOOLS:
                raise NotAllowed(request["name"])
            return await self.call(request["name"], request.get("args") or {}, role=role,
                                   authorization=authorization, session_id=session_id)
        except NotAllowed as exc:
            return json.dumps({"error": f"not allowed for role {role}: {exc}"})
