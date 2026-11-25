"""Frozen role prefixes and startup checks against the MCP tool catalogue."""
from __future__ import annotations

import hashlib
import json
from collections.abc import Iterable
from dataclasses import dataclass
from functools import cache
from pathlib import Path
from typing import Final, Protocol, TypedDict

from .timely import prefix_hash


PREFIX_DIR: Final = Path(__file__).with_suffix("")
MCP_NAMES: Final = frozenset({
    "find_place", "campus_weather", "building_status", "comfort_rank",
    "campus_status", "simulation_overview", "restriction_create",
    "restriction_remove", "simulation_control",
})

JSONValue = str | int | float | bool | None | list["JSONValue"] | dict[str, "JSONValue"]


class ToolSchema(TypedDict, total=False):
    type: str
    properties: dict[str, JSONValue]
    required: list[str]
    additionalProperties: bool


class Tool(TypedDict):
    type: str
    name: str
    description: str
    schema: ToolSchema


class MCPTool(Protocol):
    """The fields consumed from each tool returned by MCP list_tools()."""

    name: str
    meta: dict[str, JSONValue] | None
    input_schema: ToolSchema


@dataclass(frozen=True, slots=True)
class UnknownRole(ValueError):
    role: str

    def __str__(self) -> str:
        return f"Unknown prefix role: {self.role!r}; expected student or admin"


@dataclass(frozen=True, slots=True)
class Prefix:
    instructions: str
    tools_json: str
    version: str
    hash: str

    @property
    def tools(self) -> list[Tool]:
        """Return a fresh list so callers cannot mutate the cached prefix."""
        return json.loads(self.tools_json)


@cache
def load(role: str) -> Prefix:
    """Read each role once; restart the process to adopt changed prefix files."""
    if role not in ("student", "admin"):
        raise UnknownRole(role)
    instructions = (PREFIX_DIR / f"instructions.{role}.md").read_text(encoding="utf-8")
    # A text-file final newline is not part of the minified JSON payload.
    tools_json = (PREFIX_DIR / f"tools.{role}.json").read_text(encoding="utf-8").removesuffix("\n")
    tools = json.loads(tools_json)
    return Prefix(
        instructions=instructions,
        tools_json=tools_json,
        version=hashlib.sha256((instructions + tools_json).encode("utf-8")).hexdigest()[:12],
        hash=prefix_hash(instructions, tools),
    )


def check_compatible(role: str, mcp_tools: Iterable[MCPTool]) -> list[str]:
    """Compare frozen contracts with MCP tools (ClientSession result.tools).

    Local/client tools are exempt. SDK titles, descriptions and property order
    do not affect compatibility. The caller stops startup on any mismatch.
    """
    frozen = load(role)
    catalogue = {tool.name: tool for tool in mcp_tools}
    mismatches: list[str] = []
    for tool in frozen.tools:
        name = tool["name"]
        if name not in MCP_NAMES:
            continue
        if name not in catalogue:
            mismatches.append(f"{name}: missing MCP tool for role {role}")
            continue
        actual = catalogue[name]
        roles = (actual.meta or {}).get("scnu/roles", [])
        if not isinstance(roles, list) or role not in roles:
            mismatches.append(f"{name}: meta['scnu/roles'] does not contain {role!r}")
        expected_schema = tool["schema"]
        expected_properties = set(expected_schema.get("properties", {}))
        actual_properties = set(actual.input_schema.get("properties", {}))
        if expected_properties != actual_properties:
            mismatches.append(
                f"{name}: properties differ; expected {sorted(expected_properties)}, "
                f"got {sorted(actual_properties)}"
            )
        expected_required = set(expected_schema.get("required", []))
        actual_required = set(actual.input_schema.get("required", []))
        if expected_required != actual_required:
            mismatches.append(
                f"{name}: required differ; expected {sorted(expected_required)}, "
                f"got {sorted(actual_required)}"
            )
    return mismatches
