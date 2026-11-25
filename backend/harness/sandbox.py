from __future__ import annotations

import asyncio
import json
import os
import resource
import shutil
import signal
import sys
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path

import psutil

Bridge = Callable[[dict], Awaitable[str]]

SANDBOX_EXEC = "/usr/bin/sandbox-exec"
INTERRUPT_GRACE_S = 2.0
MEMORY_POLL_S = 0.25
MANY_CONCURRENCY = 8
ALLOWED_IMPORTS = (
    "json", "math", "statistics", "collections", "itertools", "functools", "datetime", "re", "csv", "io",
    "textwrap", "decimal", "heapq", "bisect", "signal",
)

# Runs inside the sandbox as `python -I -S -B -c`, because the jail cannot read the repository.
# Protocol, one JSON object per line on the real stdin/stdout:
#   parent -> {"op": "exec", "code"} | {"op": "result", "value"} | {"op": "results", "values"}
#   worker -> {"op": "get"|"call", ...} | {"op": "get_many", "uris"} | {"op": "done", "stdout", "error"}
WORKER = r'''
import builtins, contextlib, io, json, os, sys, traceback
_out, _in = sys.__stdout__, sys.__stdin__
_ALLOWED = set(json.loads(sys.argv[1]))
_real_import = builtins.__import__
def _guarded_import(name, globals=None, locals=None, fromlist=(), level=0):
    caller = sys._getframe(1).f_globals.get("__name__")
    if caller == "__eval__" and level == 0 and name.split(".")[0] not in _ALLOWED:
        raise ImportError(f"import of {name!r} is not allowed in eval")
    return _real_import(name, globals, locals, fromlist, level)
builtins.__import__ = _guarded_import
def _send(msg):
    _out.write(json.dumps(msg) + "\n"); _out.flush()
def _decode(value):
    try:
        return json.loads(value)
    except (TypeError, ValueError):
        return value
def _ask(msg):
    _send(msg)
    return json.loads(_in.readline())
class _Twin:
    def get(self, uri):
        return _decode(_ask({"op": "get", "uri": uri})["value"])
    def get_many(self, uris):
        return [_decode(v) for v in _ask({"op": "get_many", "uris": list(uris)})["values"]]
    def call(self, name, **args):
        return _decode(_ask({"op": "call", "name": name, "args": args})["value"])
def show(rows, cols=None, limit=20):
    rows = list(rows)[:limit]
    if rows and isinstance(rows[0], dict):
        cols = cols or list(rows[0])
        print("\t".join(cols))
        for row in rows:
            print("\t".join(str(row.get(c, "")) for c in cols))
    else:
        for row in rows:
            print("\t".join(map(str, row)) if isinstance(row, (list, tuple)) else row)
def save(name, text):
    os.makedirs("out", exist_ok=True)
    path = os.path.join("out", os.path.basename(name))
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)
    return path
scope = {"__name__": "__eval__", "twin": _Twin(), "show": show, "save": save}
for line in _in:
    msg = json.loads(line)
    buffer, error = io.StringIO(), None
    with contextlib.redirect_stdout(buffer), contextlib.redirect_stderr(buffer):
        try:
            exec(compile(msg["code"], "<eval>", "exec"), scope)
        except KeyboardInterrupt:
            error = "interrupted"
        except BaseException:
            error = traceback.format_exc(limit=3)
    _send({"op": "done", "stdout": buffer.getvalue(), "error": error})
'''


def _python_home() -> Path:
    return Path(os.path.realpath(sys.base_prefix))


def _inner_python() -> Path:
    # Homebrew's bin/python3.x is a launcher that spawns this binary; fork is denied in the jail.
    return _python_home() / "Resources" / "Python.app" / "Contents" / "MacOS" / "Python"


def sandbox_available() -> bool:
    return sys.platform == "darwin" and os.path.exists(SANDBOX_EXEC) and _inner_python().exists()


def eval_status() -> str:
    return "on" if sandbox_available() else "off"


def _profile(jail: Path, ref: Path | None) -> str:
    # Deny by default; reads under /Users (repository, ~/.omo keys, .scnu-auth-secret) are refused except
    # for the jail and the reference corpus; no network (twin data only arrives through the pipe), no fork.
    readable = f'(subpath "{jail}")' + (f' (subpath "{ref}")' if ref else "")
    return (
        "(version 1)(deny default)"
        f'(allow process-exec (subpath "{_python_home()}"))'
        "(allow file-read*)"
        '(deny file-read* (subpath "/Users") (subpath "/Volumes"))'
        f"(allow file-read* {readable})"
        f'(allow file-write* (subpath "{jail}"))(allow file-write* (literal "/dev/null"))'
        "(allow sysctl-read)(allow mach-lookup)"
        "(deny network*)(deny process-fork)"
    )


@dataclass
class EvalResult:
    stdout: str
    error: str | None
    truncated: bool = False
    full_length: int = 0


class EvalKernel:
    def __init__(self, jail: Path, *, bridge: Bridge, ref_dir: Path | None = None, timeout_s: float = 20.0,
                 output_cap: int = 6000, max_calls: int = 100, cpu_s: int = 300, file_mb: int = 10,
                 memory_mb: int = 512) -> None:
        if not sandbox_available():
            raise RuntimeError("eval sandbox requires macOS sandbox-exec")
        jail.mkdir(parents=True, exist_ok=True)
        self.jail = Path(os.path.realpath(jail))
        self._ref = Path(os.path.realpath(ref_dir)) if ref_dir else None
        self._bridge = bridge
        self._timeout_s = timeout_s
        self._output_cap = output_cap
        self._max_calls = max_calls
        self._cpu_s = cpu_s
        self._file_bytes = file_mb * 1024 * 1024
        self._memory_bytes = memory_mb * 1024 * 1024
        self._process: asyncio.subprocess.Process | None = None
        self._lock = asyncio.Lock()
        self._calls = 0

    def _limits(self) -> None:
        resource.setrlimit(resource.RLIMIT_CPU, (self._cpu_s, self._cpu_s))
        resource.setrlimit(resource.RLIMIT_FSIZE, (self._file_bytes, self._file_bytes))
        resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))

    async def _start(self) -> asyncio.subprocess.Process:
        self._process = await asyncio.create_subprocess_exec(
            SANDBOX_EXEC, "-p", _profile(self.jail, self._ref), str(_inner_python()), "-I", "-S", "-B", "-u",
            "-c", WORKER, json.dumps(ALLOWED_IMPORTS),
            cwd=self.jail, env={"PATH": "/usr/bin:/bin", "LANG": "C.UTF-8", "HOME": str(self.jail)},
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
            preexec_fn=self._limits, limit=8 * 1024 * 1024)
        return self._process

    async def _ask_bridge(self, request: dict) -> str:
        if self._calls >= self._max_calls:
            return json.dumps({"error": f"call budget of {self._max_calls} per cell exceeded"})
        self._calls += 1
        try:
            return await self._bridge(request)
        except Exception as exc:
            return json.dumps({"error": f"{type(exc).__name__}: {exc}"}, ensure_ascii=False)

    async def _reply(self, process: asyncio.subprocess.Process, msg: dict) -> None:
        process.stdin.write((json.dumps(msg) + "\n").encode())
        await process.stdin.drain()

    async def _exchange(self, process: asyncio.subprocess.Process) -> dict:
        limit = asyncio.Semaphore(MANY_CONCURRENCY)

        async def one(uri: str) -> str:
            async with limit:
                return await self._ask_bridge({"kind": "get", "uri": uri})

        while True:
            line = await process.stdout.readline()
            if not line:
                raise RuntimeError("eval kernel exited")
            msg = json.loads(line)
            op = msg["op"]
            if op == "done":
                return msg
            if op == "get_many":
                values = await asyncio.gather(*(one(uri) for uri in msg["uris"]))
                await self._reply(process, {"op": "results", "values": list(values)})
            elif op == "get":
                await self._reply(process, {"op": "result", "value": await self._ask_bridge({"kind": "get", "uri": msg["uri"]})})
            else:
                value = await self._ask_bridge({"kind": "call", "name": msg["name"], "args": msg.get("args") or {}})
                await self._reply(process, {"op": "result", "value": value})

    async def _watch_memory(self, process: asyncio.subprocess.Process) -> None:
        try:
            proc = psutil.Process(process.pid)
            while process.returncode is None:
                if sum(p.memory_info().rss for p in [proc, *proc.children(recursive=True)]) > self._memory_bytes:
                    process.kill()
                    return
                await asyncio.sleep(MEMORY_POLL_S)
        except psutil.Error:
            return

    async def run(self, code: str, timeout_s: float | None = None) -> EvalResult:
        async with self._lock:
            process = self._process if self._process and self._process.returncode is None else await self._start()
            self._calls = 0
            await self._reply(process, {"op": "exec", "code": code})
            exchange = asyncio.ensure_future(self._exchange(process))
            watchdog = asyncio.ensure_future(self._watch_memory(process))
            limit = timeout_s or self._timeout_s
            try:
                msg = await asyncio.wait_for(asyncio.shield(exchange), limit)
            except asyncio.TimeoutError:
                process.send_signal(signal.SIGINT)
                try:
                    msg = await asyncio.wait_for(exchange, INTERRUPT_GRACE_S)
                    msg["error"] = f"interrupted after {limit:g}s timeout; variables kept"
                except (asyncio.TimeoutError, RuntimeError):
                    await self._kill()
                    return EvalResult("", f"timed out after {limit:g}s; kernel restarted: state lost")
            except RuntimeError:
                await self._kill()
                return EvalResult("", "eval kernel exited (memory or CPU limit); kernel restarted: state lost")
            finally:
                watchdog.cancel()
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
