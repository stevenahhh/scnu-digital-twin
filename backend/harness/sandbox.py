from __future__ import annotations

import asyncio
import json
import os
import resource
import shutil
import sys
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path

ToolCaller = Callable[[str, dict], Awaitable[str]]

SANDBOX_EXEC = "/usr/bin/sandbox-exec"
CPU_SECONDS = 60
MAX_FILE_BYTES = 16 * 1024 * 1024

# Runs inside the sandbox as `python -I -c`, because the jail cannot read the repository.
# Protocol on the real stdout/stdin, one JSON object per line:
#   parent -> {"op": "exec", "code"} | {"op": "result", "value"}
#   worker -> {"op": "call", "name", "args"} | {"op": "done", "stdout", "error"}
WORKER = r'''
import contextlib, io, json, sys, traceback
_out, _in = sys.__stdout__, sys.__stdin__
def _send(msg):
    _out.write(json.dumps(msg) + "\n"); _out.flush()
def call_tool(name, **args):
    _send({"op": "call", "name": name, "args": args})
    reply = json.loads(_in.readline())
    value = reply.get("value")
    try:
        return json.loads(value)
    except (TypeError, ValueError):
        return value
scope = {"__name__": "__eval__", "call_tool": call_tool}
for line in _in:
    msg = json.loads(line)
    buffer, error = io.StringIO(), None
    with contextlib.redirect_stdout(buffer), contextlib.redirect_stderr(buffer):
        try:
            exec(compile(msg["code"], "<eval>", "exec"), scope)
        except BaseException:
            error = traceback.format_exc(limit=3)
    _send({"op": "done", "stdout": buffer.getvalue(), "error": error})
'''


def sandbox_available() -> bool:
    return sys.platform == "darwin" and os.path.exists(SANDBOX_EXEC)


def _base_python() -> str:
    candidate = Path(sys.base_prefix) / "bin" / f"python{sys.version_info.major}.{sys.version_info.minor}"
    return str(candidate) if candidate.exists() else sys.executable


def _profile(jail: Path) -> str:
    # Deny every network socket (twin data reaches the kernel only through call_tool), every read of
    # user files (repository, keys under ~/.omo), and every write outside the jail.
    return (
        "(version 1)(allow default)(deny network*)"
        '(deny file-read-data (subpath "/Users"))'
        f'(allow file-read-data (subpath "{jail}"))'
        "(deny file-write*)"
        f'(allow file-write* (subpath "{jail}"))(allow file-write* (literal "/dev/null"))'
    )


def _limit_resources() -> None:
    resource.setrlimit(resource.RLIMIT_CPU, (CPU_SECONDS, CPU_SECONDS))
    resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_FILE_BYTES, MAX_FILE_BYTES))


@dataclass
class EvalResult:
    stdout: str
    error: str | None
    truncated: bool = False
    full_length: int = 0


class EvalKernel:
    def __init__(self, jail: Path, *, call_tool: ToolCaller, timeout_s: float = 20.0, output_cap: int = 6000) -> None:
        if not sandbox_available():
            raise RuntimeError("eval sandbox requires macOS sandbox-exec")
        jail.mkdir(parents=True, exist_ok=True)
        self.jail = jail.resolve()
        self._call_tool = call_tool
        self._timeout_s = timeout_s
        self._output_cap = output_cap
        self._process: asyncio.subprocess.Process | None = None
        self._lock = asyncio.Lock()

    async def _start(self) -> asyncio.subprocess.Process:
        env = {"PATH": "/usr/bin:/bin", "HOME": str(self.jail), "LANG": "C.UTF-8", "PYTHONIOENCODING": "utf-8"}
        self._process = await asyncio.create_subprocess_exec(
            SANDBOX_EXEC, "-p", _profile(self.jail), _base_python(), "-I", "-u", "-c", WORKER,
            cwd=self.jail, env=env, stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL, preexec_fn=_limit_resources, limit=8 * 1024 * 1024)
        return self._process

    async def _exchange(self, process: asyncio.subprocess.Process, code: str) -> dict:
        process.stdin.write((json.dumps({"op": "exec", "code": code}) + "\n").encode())
        await process.stdin.drain()
        while True:
            line = await process.stdout.readline()
            if not line:
                raise RuntimeError("eval kernel exited")
            msg = json.loads(line)
            if msg["op"] == "done":
                return msg
            try:
                value = await self._call_tool(msg["name"], msg.get("args") or {})
            except Exception as exc:
                value = json.dumps({"error": f"{type(exc).__name__}: {exc}"}, ensure_ascii=False)
            process.stdin.write((json.dumps({"op": "result", "value": value}) + "\n").encode())
            await process.stdin.drain()

    async def run(self, code: str) -> EvalResult:
        async with self._lock:
            process = self._process if self._process and self._process.returncode is None else await self._start()
            try:
                msg = await asyncio.wait_for(self._exchange(process, code), self._timeout_s)
            except (asyncio.TimeoutError, RuntimeError) as exc:
                await self._kill()
                reason = f"timed out after {self._timeout_s:g}s" if isinstance(exc, asyncio.TimeoutError) else str(exc)
                return EvalResult(stdout="", error=f"{reason}; the kernel was restarted and its variables are gone")
        stdout = msg["stdout"]
        return EvalResult(stdout=stdout[: self._output_cap], error=msg["error"],
                          truncated=len(stdout) > self._output_cap, full_length=len(stdout))

    async def _kill(self) -> None:
        process, self._process = self._process, None
        if process and process.returncode is None:
            process.kill()
            await process.wait()

    async def close(self, *, remove_jail: bool = False) -> None:
        await self._kill()
        if remove_jail:
            shutil.rmtree(self.jail, ignore_errors=True)
