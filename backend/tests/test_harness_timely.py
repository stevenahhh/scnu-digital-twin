from __future__ import annotations

import json

import httpx
import pytest

from harness.timely import TimelyClient, TimelyError, prefix_hash


def sse(*events: dict) -> bytes:
    return "".join(f"data: {json.dumps(event, ensure_ascii=False)}\n\n" for event in events).encode()


class FakeTimely:
    def __init__(self, replies: list[httpx.Response], expire_first_token: bool = False) -> None:
        self.replies = list(replies)
        self.requests: list[httpx.Request] = []
        self.auth_calls = 0
        self.expire_first_token = expire_first_token

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if request.url.path.endswith("/sdk-auth/authenticate"):
            assert request.headers["X-Timely-API"] == "test-key"
            self.auth_calls += 1
            return httpx.Response(200, json={"data": {"access_token": f"jwt-{self.auth_calls}"}})
        if self.expire_first_token and request.headers["authorization"] == "Bearer jwt-1":
            return httpx.Response(401, json={"message": "expired"})
        return self.replies.pop(0)


def client_for(fake: FakeTimely) -> TimelyClient:
    http = httpx.AsyncClient(transport=httpx.MockTransport(fake))
    return TimelyClient(api_key="test-key", base_url="https://timely.test", http=http)


async def collect(client: TimelyClient, **kwargs) -> list[dict]:
    return [event async for event in client.stream(**kwargs)]


@pytest.mark.anyio
async def test_stream_yields_events_and_sends_only_the_given_delta() -> None:
    fake = FakeTimely([httpx.Response(201, content=sse(
        {"type": "start"},
        {"type": "token", "content": "안녕"},
        {"type": "final_response", "message": "안녕하세요"},
        {"type": "end"},
    ), headers={"content-type": "text/event-stream"})])
    client = client_for(fake)

    events = await collect(client, session_id="u1-s1", instructions="sys", tools=[],
                           messages=[{"role": "user", "content": "hi"}])

    assert [e["type"] for e in events] == ["start", "token", "final_response", "end"]
    body = json.loads(fake.requests[-1].content)
    assert body["model"] == "claude-sonnet-5-5"
    assert body["session_id"] == "u1-s1"
    assert body["stream"] is True
    assert body["messages"] == [{"role": "user", "content": "hi"}]
    assert "checkpoint_id" not in body
    assert fake.requests[-1].headers["authorization"] == "Bearer jwt-1"


@pytest.mark.anyio
async def test_resume_carries_checkpoint_and_tool_messages() -> None:
    fake = FakeTimely([httpx.Response(201, content=sse({"type": "final_response", "message": "ok"}))])
    client = client_for(fake)
    tool_message = {"role": "tool", "tool_call_id": "t1", "name": "x", "content": "{}"}

    await collect(client, session_id="s", instructions="sys", tools=[], messages=[tool_message], checkpoint_id="cp-1")

    body = json.loads(fake.requests[-1].content)
    assert body["checkpoint_id"] == "cp-1"
    assert body["messages"] == [tool_message]


@pytest.mark.anyio
async def test_expired_token_is_refreshed_once_and_the_request_retried() -> None:
    fake = FakeTimely([httpx.Response(201, content=sse({"type": "final_response", "message": "ok"}))],
                      expire_first_token=True)
    client = client_for(fake)

    events = await collect(client, session_id="s", instructions="sys", tools=[], messages=[])

    assert events[-1]["message"] == "ok"
    assert fake.auth_calls == 2


@pytest.mark.anyio
async def test_error_status_and_error_events_raise() -> None:
    client = client_for(FakeTimely([httpx.Response(500, json={"message": "boom"})]))
    with pytest.raises(TimelyError):
        await collect(client, session_id="s", instructions="sys", tools=[], messages=[])

    client = client_for(FakeTimely([httpx.Response(201, content=sse({"type": "error", "message": "bad"}))]))
    with pytest.raises(TimelyError, match="bad"):
        await collect(client, session_id="s", instructions="sys", tools=[], messages=[])


def jwt_with_exp(exp: float) -> str:
    import base64

    payload = base64.urlsafe_b64encode(json.dumps({"exp": exp}).encode()).decode().rstrip("=")
    return f"h.{payload}.s"


@pytest.mark.anyio
async def test_token_close_to_expiry_is_refreshed_before_the_request() -> None:
    import time

    fake = FakeTimely([httpx.Response(201, content=sse({"type": "final_response", "message": "ok"}))])
    client = client_for(fake)
    client._token = jwt_with_exp(time.time() + 30)

    await collect(client, session_id="s", instructions="sys", tools=[], messages=[])

    assert fake.auth_calls == 1
    assert fake.requests[-1].headers["authorization"] == "Bearer jwt-1"


def test_prefix_hash_depends_only_on_instructions_and_tools() -> None:
    tools = [{"type": "function", "name": "a", "description": "d", "schema": {"type": "object"}}]
    assert prefix_hash("sys", tools) == prefix_hash("sys", [dict(tools[0])])
    assert prefix_hash("sys", tools) != prefix_hash("sys2", tools)
    assert prefix_hash("sys", tools) != prefix_hash("sys", [])


@pytest.mark.anyio
async def test_network_errors_become_timely_errors() -> None:
    def broken(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/sdk-auth/authenticate"):
            return httpx.Response(200, json={"data": {"access_token": "jwt"}})
        raise httpx.ReadError("connection reset", request=request)

    client = TimelyClient(api_key="test-key", base_url="https://timely.test",
                          http=httpx.AsyncClient(transport=httpx.MockTransport(broken)))
    with pytest.raises(TimelyError, match="ReadError"):
        await collect(client, session_id="s", instructions="sys", tools=[], messages=[])
