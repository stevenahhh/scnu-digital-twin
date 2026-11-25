from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from common.campus_auth import Account, issue_token
from harness.main import create_app
from harness_fakes import final, make_harness, tool_calls

GUEST_CLIENT = "client-0000000000000000000001"


@pytest.fixture
def key_file(tmp_path, monkeypatch):
    monkeypatch.delenv("SCNU_AUTH_SECRET", raising=False)
    monkeypatch.setenv("SCNU_AUTH_SECRET_FILE", str(tmp_path / "campus-auth.key"))


def bearer(account: Account) -> dict[str, str]:
    return {"Authorization": f"Bearer {issue_token(account)['token']}"}


STUDENT = Account("20239901", "학생", "student")
OTHER = Account("20239902", "학생2", "student")
ADMIN = Account("admin", "관리자", "admin")
GUEST = Account("guest-student", "게스트", "student", guest=True)


@pytest.fixture
def client(tmp_path, key_file):
    script = [
        tool_calls(("c1", "comfort_rank", {"metric": "utci", "order": "hot"})),
        final("공과대학 3호관이 가장 덥습니다."),
    ]
    with TestClient(create_app(lambda: make_harness(tmp_path, script), check_prefix=False)) as test_client:
        yield test_client


def events(body: str) -> list[str]:
    return [line.split(": ", 1)[1] for line in body.splitlines() if line.startswith("event: ")]


def test_auth_and_guest_client_id_are_required(client) -> None:
    anonymous = client.post("/chat/sessions")
    assert anonymous.status_code == 401
    assert anonymous.json() == {"detail": "로그인이 필요합니다"}
    no_client = client.post("/chat/sessions", headers=bearer(GUEST))
    assert no_client.status_code == 400 and no_client.json()["detail"]["code"] == "client_id_required"
    assert client.post("/chat/sessions", headers={**bearer(GUEST), "X-Assistant-Client": GUEST_CLIENT}).status_code == 201


def test_one_user_cannot_read_or_post_to_another_users_session(client) -> None:
    sid = client.post("/chat/sessions", headers=bearer(STUDENT)).json()["session_id"]
    other = bearer(OTHER)
    assert client.get(f"/chat/sessions/{sid}/messages", headers=other).status_code == 404
    assert client.post(f"/chat/sessions/{sid}/messages", headers=other, json={"text": "hi"}).status_code == 404
    assert client.delete(f"/chat/sessions/{sid}", headers=other).status_code == 404
    assert client.get("/chat/sessions", headers=other).json() == {"sessions": []}


def test_students_and_admins_see_different_tool_lists_and_only_admins_confirm(client) -> None:
    student_tools = set(client.get("/chat/tools", headers=bearer(STUDENT)).json()["tools"])
    admin_tools = set(client.get("/chat/tools", headers=bearer(ADMIN)).json()["tools"])
    assert {"restriction_create", "simulation_control"} <= admin_tools - student_tools
    sid = client.post("/chat/sessions", headers=bearer(STUDENT)).json()["session_id"]
    denied = client.post(f"/chat/sessions/{sid}/confirm", headers=bearer(STUDENT),
                         json={"confirm_id": "x", "decision": "approve"})
    assert denied.status_code == 403


def test_message_streams_tool_and_final_events(client) -> None:
    headers = bearer(STUDENT)
    sid = client.post("/chat/sessions", headers=headers).json()["session_id"]
    with client.stream("POST", f"/chat/sessions/{sid}/messages", headers=headers,
                       json={"text": "제일 더운 건물?", "context": {"sel": "BLD_D4"}}) as response:
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/event-stream")
        body = "".join(response.iter_text())
    names = events(body)
    assert names[0] == "run" and "tool" in names and names[-2:] == ["final", "end"]
    assert "추정" in body
    history = client.get(f"/chat/sessions/{sid}/messages", headers=headers).json()["messages"]
    assert [m["role"] for m in history] == ["user", "assistant"]
    assert client.delete(f"/chat/sessions/{sid}", headers=headers).status_code == 204
    assert client.get(f"/chat/sessions/{sid}/messages", headers=headers).status_code == 404


@pytest.mark.anyio
async def test_frozen_prefixes_match_the_real_twin_mcp_server(tmp_path) -> None:
    from harness.main import verify_prefixes
    from harness.mcp_client import TwinClient
    from twin_mcp.server import build_server

    harness = make_harness(tmp_path, [])
    harness.twin = TwinClient(build_server())
    await harness.twin.start()
    try:
        await verify_prefixes(harness)
    finally:
        await harness.twin.close()


def test_health_reports_llm_and_eval_state(client) -> None:
    health = client.get("/health").json()
    assert health["llm"] == "ready" and health["eval"] in ("on", "off")
