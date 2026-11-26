"""Client for Timely's llm-completion API, the route the timely-scnu key reaches Claude through.

Timely keeps each conversation server-side under the caller's session_id, so a turn sends only
its new messages. A tool round trip resumes the same session with the checkpoint_id that came
with tool_call_required. The API returns no token usage.
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import time
from collections.abc import AsyncIterator
from typing import Any

import httpx

DEFAULT_BASE_URL = "https://hello.timelygpt.co.kr"
DEFAULT_MODEL = "claude-sonnet-5-5"
AUTH_PATH = "/api/v2/chat/sdk-auth/authenticate"
COMPLETION_PATH = "/api/v2/chat/llm-completion"


class TimelyError(RuntimeError):
    pass


def _expires_soon(token: str, margin_s: float = 60.0) -> bool:
    try:
        payload = token.split(".")[1]
        claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
        return float(claims["exp"]) - time.time() < margin_s
    except (IndexError, KeyError, ValueError, TypeError):
        return False


def prefix_hash(instructions: str, tools: list[dict[str, Any]]) -> str:
    canonical = json.dumps({"instructions": instructions, "tools": tools}, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(canonical.encode()).hexdigest()[:16]


class TimelyClient:
    def __init__(self, api_key: str, *, base_url: str = DEFAULT_BASE_URL, model: str = DEFAULT_MODEL,
                 http: httpx.AsyncClient | None = None) -> None:
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self.model = model
        self._http = http or httpx.AsyncClient(timeout=httpx.Timeout(10.0, read=180.0))
        self._token: str | None = None

    @classmethod
    def from_env(cls) -> "TimelyClient":
        key = os.environ.get("TIMELY_API_KEY", "")
        if not key:
            raise TimelyError("TIMELY_API_KEY is not set")
        return cls(key, base_url=os.environ.get("TIMELY_BASE_URL", DEFAULT_BASE_URL),
                   model=os.environ.get("HARNESS_MODEL", DEFAULT_MODEL))

    def __repr__(self) -> str:
        return f"TimelyClient(base_url={self._base_url!r}, model={self.model!r})"

    async def aclose(self) -> None:
        await self._http.aclose()

    async def _authenticate(self) -> str:
        response = await self._http.get(self._base_url + AUTH_PATH, headers={"X-Timely-API": self._api_key})
        if response.status_code != 200:
            raise TimelyError(f"Timely authentication failed: HTTP {response.status_code}")
        self._token = response.json()["data"]["access_token"]
        return self._token

    async def stream(self, *, session_id: str, instructions: str, tools: list[dict[str, Any]],
                     messages: list[dict[str, Any]], checkpoint_id: str | None = None,
                     reasoning_effort: str | None = None) -> AsyncIterator[dict[str, Any]]:
        body: dict[str, Any] = {
            "model": self.model, "session_id": session_id, "instructions": instructions,
            "tools": tools, "messages": messages, "stream": True,
        }
        if checkpoint_id:
            body["checkpoint_id"] = checkpoint_id
        if reasoning_effort:
            body["reasoning_effort"] = reasoning_effort
        try:
            for attempt in range(2):
                token = self._token if self._token and not _expires_soon(self._token) else await self._authenticate()
                request = self._http.build_request(
                    "POST", self._base_url + COMPLETION_PATH, json=body,
                    headers={"authorization": f"Bearer {token}", "accept": "text/event-stream"})
                response = await self._http.send(request, stream=True)
                try:
                    if response.status_code == 401 and attempt == 0:
                        self._token = None
                        continue
                    if response.status_code >= 400:
                        detail = (await response.aread()).decode(errors="replace")[:300]
                        raise TimelyError(f"Timely completion failed: HTTP {response.status_code} {detail}")
                    async for line in response.aiter_lines():
                        if not line.startswith("data:"):
                            continue
                        event = json.loads(line[5:])
                        if event.get("type") == "error":
                            raise TimelyError(event.get("message") or event.get("error") or "Timely error event")
                        yield event
                    return
                finally:
                    await response.aclose()
        except httpx.HTTPError as exc:
            raise TimelyError(f"Timely connection failed: {type(exc).__name__}") from exc
