from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import pytest

from harness.sandbox import EvalKernel, sandbox_available

pytestmark = [
    pytest.mark.anyio,
    pytest.mark.skipif(not sandbox_available(), reason="eval sandbox needs macOS sandbox-exec"),
]

REPO_FILE = Path(__file__).resolve().parents[2] / "AGENTS.md"


async def no_tools(name: str, args: dict) -> str:
    raise AssertionError(f"unexpected tool call {name}")


@pytest.fixture
async def kernel(tmp_path):
    k = EvalKernel(tmp_path / "jail", call_tool=no_tools, timeout_s=5)
    yield k
    await k.close()


async def test_state_persists_between_runs(kernel) -> None:
    await kernel.run("x = 21")
    result = await kernel.run("print(x * 2)")
    assert result.stdout == "42\n"
    assert result.error is None


async def test_errors_are_reported_without_killing_the_kernel(kernel) -> None:
    await kernel.run("kept = 'yes'")
    failed = await kernel.run("1 / 0")
    assert "ZeroDivisionError" in failed.error
    assert (await kernel.run("print(kept)")).stdout == "yes\n"


async def test_timeout_kills_and_restarts_with_fresh_state(kernel) -> None:
    await kernel.run("lost = 1")
    slow = await kernel.run("while True: pass")
    assert "timed out" in slow.error
    after = await kernel.run("print('lost' in globals())")
    assert after.stdout == "False\n"


async def test_jail_blocks_reads_writes_network_and_secrets(kernel, monkeypatch) -> None:
    monkeypatch.setenv("TIMELY_API_KEY", "must-not-leak")
    await kernel.close()
    probe = f"""
import os, socket
out = {{}}
for name, action in {{
    "read_repo": lambda: open({str(REPO_FILE)!r}).read(),
    "write_tmp": lambda: open('/tmp/scnu-harness-escape', 'w').write('x'),
    "network": lambda: socket.create_connection(('127.0.0.1', 8000), timeout=1),
}}.items():
    try:
        action(); out[name] = 'allowed'
    except Exception as exc:
        out[name] = type(exc).__name__
open('inside.txt', 'w').write('ok')
out['write_jail'] = open('inside.txt').read()
out['key'] = os.environ.get('TIMELY_API_KEY')
print(__import__('json').dumps(out))
"""
    result = await kernel.run(probe)
    out = json.loads(result.stdout)
    assert out["read_repo"] == "PermissionError"
    assert out["write_tmp"] == "PermissionError"
    assert out["network"] == "PermissionError"
    assert out["write_jail"] == "ok"
    assert out["key"] is None
    assert not os.path.exists("/tmp/scnu-harness-escape")


async def test_code_can_call_harness_tools_through_the_pipe(tmp_path) -> None:
    calls = []

    async def tools(name: str, args: dict) -> str:
        calls.append((name, args))
        return json.dumps({"temperature_c": 6.1, "zone": args["zone"]})

    k = EvalKernel(tmp_path / "jail", call_tool=tools, timeout_s=5)
    try:
        result = await k.run("w = call_tool('weather_now', zone='D4')\nprint(w['temperature_c'] + 1)")
    finally:
        await k.close()
    assert calls == [("weather_now", {"zone": "D4"})]
    assert result.stdout == "7.1\n"


async def test_output_is_capped(tmp_path) -> None:
    k = EvalKernel(tmp_path / "jail", call_tool=no_tools, timeout_s=5, output_cap=100)
    try:
        result = await k.run("print('a' * 5000)")
    finally:
        await k.close()
    assert len(result.stdout) <= 100
    assert result.truncated is True
    assert result.full_length >= 5000
