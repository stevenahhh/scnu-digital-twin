"""HRN-5 byte stability, size budgets, and MCP startup compatibility."""
from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from harness import prefix
from harness.timely import prefix_hash


PREFIX_DIR = Path(__file__).parents[1] / "harness" / "prefix"


@pytest.mark.parametrize(
    ("role", "version", "digest", "sizes"),
    [
        ("student", "2f51301aa9d7", "5b2e60566d6007b2", (1654, 3413)),
        ("admin", "e1d62e7641f0", "6e7d850e741ceee0", (1872, 5261)),
    ],
)
def test_frozen_prefix_golden_bytes(role, version, digest, sizes):
    loaded = prefix.load(role)
    tools_json = json.dumps(loaded.tools, sort_keys=True, ensure_ascii=False, separators=(",", ":"))

    assert loaded.version == version
    assert loaded.hash == digest == prefix_hash(loaded.instructions, loaded.tools)
    assert (len(loaded.instructions), len(tools_json)) == sizes
    assert (PREFIX_DIR / f"instructions.{role}.md").read_text(encoding="utf-8") == loaded.instructions
    assert (PREFIX_DIR / f"tools.{role}.json").read_text(encoding="utf-8") == tools_json + "\n"


def test_prefix_size_ceilings():
    student = prefix.load("student")
    admin = prefix.load("admin")
    assert len(student.instructions) <= 3000
    # The verbatim section 4.1 arrays measure 3,413/5,261 chars; section 7.1 now budgets 3,600/5,600.
    assert len(json.dumps(student.tools, sort_keys=True, separators=(",", ":"))) <= 3600
    assert len(json.dumps(admin.tools, sort_keys=True, separators=(",", ":"))) <= 5600


def test_admin_extends_student_prefix():
    student = prefix.load("student")
    admin = prefix.load("admin")
    assert admin.tools[:len(student.tools)] == student.tools
    assert admin.instructions.startswith(student.instructions + "\n")


@pytest.mark.parametrize("role", ["student", "admin"])
def test_load_caches_files_and_isolates_tool_mutation(role, monkeypatch):
    original = prefix.load(role)
    expected_tools = original.tools
    changed = original.tools
    changed[0]["schema"]["properties"].clear()
    changed.append({"name": "injected"})

    def unexpected_read(*args, **kwargs):
        pytest.fail("cached prefix attempted another file read")

    monkeypatch.setattr(Path, "read_text", unexpected_read)
    loaded = prefix.load(role)
    assert loaded.instructions == original.instructions
    assert loaded.tools == expected_tools
    assert loaded.version == original.version
    assert loaded.hash == original.hash


@pytest.mark.parametrize("role", ["guest", "../admin", ""])
def test_load_rejects_unknown_roles(role):
    with pytest.raises(ValueError, match="role"):
        prefix.load(role)


def catalogue(role):
    """Independent MCP-shaped fixture; local tools deliberately absent."""
    contracts = [
        ("find_place", ["query", "kind", "limit"], ["query"]),
        ("campus_weather", ["forecast"], []),
        ("building_status", ["ids"], ["ids"]),
        ("comfort_rank", ["metric", "order", "kind", "zone", "limit"], ["order", "metric"]),
        ("campus_status", [], []),
    ]
    if role == "admin":
        contracts += [
            ("simulation_overview", [], []),
            ("restriction_create", ["target_type", "target_id", "cause", "access", "message"],
             ["cause", "target_id", "target_type"]),
            ("restriction_remove", ["restriction_id"], ["restriction_id"]),
            ("simulation_control", ["action", "scenario", "multiplier"], ["action"]),
        ]
    return [
        SimpleNamespace(
            name=name,
            meta={"scnu/roles": [role]},
            inputSchema={
                "title": "SDK-generated title",
                "properties": {key: {"title": key} for key in reversed(properties)},
                **({"required": required} if required else {}),
            },
        )
        for name, properties, required in contracts
    ]


@pytest.mark.parametrize("role", ["student", "admin"])
def test_compatible_mcp_ignores_titles_order_and_local_tools(role):
    assert prefix.check_compatible(role, catalogue(role)) == []


@pytest.mark.parametrize("role", ["student", "admin"])
def test_each_mcp_tool_is_required(role):
    tools = catalogue(role)
    for missing in tools:
        mismatches = prefix.check_compatible(role, [tool for tool in tools if tool is not missing])
        assert len(mismatches) == 1
        assert missing.name in mismatches[0]
        assert "missing" in mismatches[0]


@pytest.mark.parametrize("meta", [None, {}, {"scnu/roles": ["admin"]}])
def test_mcp_role_metadata_must_authorize_role(meta):
    tools = catalogue("student")
    tools[0].meta = meta
    mismatches = prefix.check_compatible("student", tools)
    assert len(mismatches) == 1
    assert "find_place" in mismatches[0] and "student" in mismatches[0]
    assert "scnu/roles" in mismatches[0]


def test_mcp_reports_property_and_required_set_diffs_together():
    tools = catalogue("student")
    tools[0].inputSchema = {"properties": {"unexpected": {}}, "required": ["unexpected"]}
    mismatches = prefix.check_compatible("student", tools)
    assert len(mismatches) == 2
    assert all("find_place" in message for message in mismatches)
    assert "properties" in mismatches[0] and "query" in mismatches[0]
    assert "required" in mismatches[1] and "unexpected" in mismatches[1]
