from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from harness.sandbox import EvalKernel, eval_status, sandbox_available

pytestmark = [
    pytest.mark.anyio,
    pytest.mark.skipif(not sandbox_available(), reason="eval sandbox needs macOS sandbox-exec"),
]

REPO_FILE = Path(__file__).resolve().parents[2] / "AGENTS.md"


async def no_bridge(request: dict) -> str:
    raise AssertionError(f"unexpected twin request {request}")


@pytest.fixture
async def kernel(tmp_path):
    k = EvalKernel(tmp_path / "jail", bridge=no_bridge, timeout_s=3)
    yield k
    await k.close()


def test_status_reports_on_where_the_backend_exists() -> None:
    assert eval_status() == "on"


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


async def test_timeout_interrupts_and_keeps_state(kernel) -> None:
    await kernel.run("kept = 1")
    slow = await kernel.run("while True: pass")
    assert "interrupted" in slow.error
    assert (await kernel.run("print(kept)")).stdout == "1\n"


async def test_timeout_kills_a_cell_that_ignores_interrupts(kernel) -> None:
    await kernel.run("lost = 1")
    stubborn = await kernel.run("import signal\nsignal.signal(signal.SIGINT, signal.SIG_IGN)\nwhile True: pass")
    assert "kernel restarted: state lost" in stubborn.error
    assert (await kernel.run("print('lost' in globals())")).stdout == "False\n"


async def test_jail_blocks_escape_routes_and_secrets(kernel, monkeypatch) -> None:
    monkeypatch.setenv("TIMELY_API_KEY", "must-not-leak")
    monkeypatch.setenv("SCNU_AUTH_SECRET", "must-not-leak")
    await kernel.close()
    probe = f"""
import json
real_import = save.__globals__['_real_import']
os, socket = real_import('os'), real_import('socket')
out = {{}}
for name, action in {{
    "read_repo": lambda: open({str(REPO_FILE)!r}).read(),
    "write_tmp": lambda: open('/tmp/scnu-harness-escape', 'w').write('x'),
    "network": lambda: socket.create_connection(('127.0.0.1', 8000), timeout=1),
    "fork": lambda: os.fork(),
    "import_subprocess": lambda: __import__('subprocess'),
    "run_binary": lambda: real_import('subprocess').run(['/bin/ls']),
}}.items():
    try:
        action(); out[name] = 'allowed'
    except BaseException as exc:
        out[name] = type(exc).__name__
open('inside.txt', 'w').write('ok')
out['write_jail'] = open('inside.txt').read()
out['env'] = sorted(k for k in os.environ if k in ('TIMELY_API_KEY', 'SCNU_AUTH_SECRET'))
print(json.dumps(out))
"""
    out = json.loads((await kernel.run(probe)).stdout)
    assert out["read_repo"] == "PermissionError"
    assert out["write_tmp"] == "PermissionError"
    assert out["network"] == "PermissionError"
    assert out["fork"] == "PermissionError"
    assert out["import_subprocess"] == "ImportError"
    assert out["run_binary"] == "PermissionError"
    assert out["write_jail"] == "ok"
    assert out["env"] == []
    assert not os.path.exists("/tmp/scnu-harness-escape")


async def test_jail_under_users_is_usable_but_siblings_are_not() -> None:
    base = REPO_FILE.parent / "backend" / "harness" / "data" / "pytest-jail-check"
    jail, sibling = base / "work", base / "other"
    sibling.mkdir(parents=True, exist_ok=True)
    (sibling / "secret.txt").write_text("no")
    k = EvalKernel(jail, bridge=no_bridge, timeout_s=3)
    try:
        out = await k.run(
            "open('a.txt','w').write('ok')\nprint(open('a.txt').read())\n"
            f"try:\n    open({str(sibling / 'secret.txt')!r}).read(); print('LEAK')\n"
            "except PermissionError:\n    print('blocked')")
    finally:
        await k.close()
        import shutil
        shutil.rmtree(base, ignore_errors=True)
    assert out.stdout == "ok\nblocked\n"


async def test_twin_helpers_reach_the_bridge_and_respect_the_call_budget(tmp_path) -> None:
    requests = []

    async def bridge(request: dict) -> str:
        requests.append(request)
        if request["kind"] == "call":
            return json.dumps({"temperature_c": 6.1, "zone": request["args"]["zone"]})
        return json.dumps({"uri": request["uri"]})

    k = EvalKernel(tmp_path / "jail", bridge=bridge, timeout_s=5, max_calls=3)
    try:
        result = await k.run(
            "w = twin.call('campus_weather', zone='D4')\n"
            "many = twin.get_many(['twin://zones', 'twin://weather/current'])\n"
            "print(w['temperature_c'] + 1, [m['uri'] for m in many])\n"
            "print(twin.get('twin://elements'))")
    finally:
        await k.close()
    assert result.stdout.splitlines()[0] == "7.1 ['twin://zones', 'twin://weather/current']"
    assert "call budget" in result.stdout.splitlines()[1]
    assert requests[0] == {"kind": "call", "name": "campus_weather", "args": {"zone": "D4"}}
    assert len(requests) == 3


async def test_show_and_save_helpers(tmp_path) -> None:
    k = EvalKernel(tmp_path / "jail", bridge=no_bridge, timeout_s=5)
    try:
        result = await k.run("show([{'a': 1, 'b': 2}, {'a': 3, 'b': 4}], ['a', 'b'])\nsave('r.txt', 'hi')")
    finally:
        await k.close()
    assert result.stdout == "a\tb\n1\t2\n3\t4\n"
    assert (tmp_path / "jail" / "out" / "r.txt").read_text() == "hi"


async def test_output_is_capped(tmp_path) -> None:
    k = EvalKernel(tmp_path / "jail", bridge=no_bridge, timeout_s=5, output_cap=100)
    try:
        result = await k.run("print('a' * 5000)")
    finally:
        await k.close()
    assert len(result.stdout) <= 100
    assert result.truncated is True
    assert result.full_length >= 5000
