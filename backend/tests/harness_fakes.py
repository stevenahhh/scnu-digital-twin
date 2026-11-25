from __future__ import annotations

import asyncio
import json
from pathlib import Path

from harness.loop import Harness
from harness.mcp_client import NotAllowed, allowed_tool
from harness.sessions import SessionStore

DIGEST = "comfort_rank metric=utci order=hot kind=building n=1 | 추정값 | weather live, KMA obs 13:00 KST, age 4m\nBLD_D4\t공과대학 3호관\t34.9\t높음"


class ScriptedTimely:
    def __init__(self, script: list[list[dict]]) -> None:
        self.script = list(script)
        self.requests: list[dict] = []
        self.gate: asyncio.Event | None = None

    async def stream(self, **request):
        self.requests.append(request)
        for event in self.script.pop(0):
            yield event

    async def aclose(self) -> None:
        return None


class FakeTwin:
    def __init__(self, barrier: int = 0) -> None:
        self.calls: list[tuple[str, dict, str, str | None]] = []
        self._arrived = 0
        self._barrier = barrier
        self._all_here = asyncio.Event()

    async def start(self) -> None:
        return None

    async def close(self) -> None:
        return None

    async def list_prompts(self) -> list:
        return []

    async def call(self, name, args, *, role, authorization=None, session_id=None):
        if not allowed_tool(role, name):
            raise NotAllowed(name)
        self.calls.append((name, args, role, authorization))
        if self._barrier:
            self._arrived += 1
            if self._arrived >= self._barrier:
                self._all_here.set()
            await asyncio.wait_for(self._all_here.wait(), 2)
        return DIGEST if name == "comfort_rank" else f"{name} ok {json.dumps(args, ensure_ascii=False)}"

    async def read(self, uri, *, role, authorization=None, session_id=None):
        return json.dumps({"uri": uri})

    async def bridge(self, request, *, role, authorization, session_id):
        return json.dumps({"request": request})


def make_harness(tmp_path: Path, script: list[list[dict]], twin: FakeTwin | None = None) -> Harness:
    ref = tmp_path / "ref"
    ref.mkdir(parents=True, exist_ok=True)
    return Harness(store=SessionStore(tmp_path / "data"), twin=twin or FakeTwin(), timely=ScriptedTimely(script),
                   ref_dir=ref)


def final(message: str) -> list[dict]:
    return [{"type": "start"}, {"type": "token", "content": message}, {"type": "final_response", "message": message},
            {"type": "end"}]


def tool_calls(*calls: tuple[str, str, dict], checkpoint: str = "cp-1") -> list[dict]:
    return [{"type": "tool_call_required", "configurable": {"checkpoint_id": checkpoint},
             "tool_calls": [{"tool_call_id": cid, "name": name, "args": args} for cid, name, args in calls]},
            {"type": "end"}]
