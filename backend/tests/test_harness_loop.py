from __future__ import annotations

import asyncio
import json

import pytest
from mcp.server.mcpserver import Context, MCPServer

from harness.mcp_client import TwinClient
from harness_fakes import FakeTwin, final, make_harness, tool_calls

pytestmark = pytest.mark.anyio


async def run(harness, session, text, context=None, authorization="Bearer t"):
    return [event async for event in harness.run_turn(session, text=text, context=context,
                                                     authorization=authorization)]


async def test_parallel_tool_calls_run_together_and_resume_with_only_tool_messages(tmp_path) -> None:
    twin = FakeTwin(barrier=2)
    harness = make_harness(tmp_path, [
        tool_calls(("c1", "comfort_rank", {"metric": "utci", "order": "hot"}), ("c2", "campus_status", {})),
        final("공과대학 3호관이 가장 덥습니다."),
    ], twin)
    session = harness.store.create("acct:20239901", "student")

    events = await run(harness, session, "제일 더운 곳?", {"sel": "BLD_D4", "tab": "status"})

    assert [name for name, *_ in twin.calls] == ["comfort_rank", "campus_status"]
    second = harness.timely.requests[1]
    assert [m["role"] for m in second["messages"]] == ["tool", "tool"]
    assert [m["tool_call_id"] for m in second["messages"]] == ["c1", "c2"]
    assert second["checkpoint_id"] == "cp-1"
    assert second["session_id"] == harness.timely.requests[0]["session_id"]
    assert "[ctx sel=BLD_D4 tab=status]" in harness.timely.requests[0]["messages"][0]["content"]
    kinds = [name for name, _ in events]
    assert kinds.count("tool") == 4 and kinds[-1] == "final"
    answer = events[-1][1]
    assert answer["flags"]["estimated"] is True and "추정" in answer["text"]
    assert answer["usage"]["estimated"] is True


async def test_second_turn_sends_only_the_new_message_with_an_identical_prefix(tmp_path) -> None:
    harness = make_harness(tmp_path, [final("안녕하세요."), final("네.")])
    session = harness.store.create("acct:20239901", "student")

    await run(harness, session, "안녕?")
    await run(harness, session, "고마워")

    first, second = harness.timely.requests
    assert second["messages"] == [{"role": "user", "content": "고마워"}]
    assert first["session_id"] == second["session_id"]
    assert first["instructions"] == second["instructions"]
    assert json.dumps(first["tools"]) == json.dumps(second["tools"])
    hashes = {json.loads(e["text"])["prefix_hash"] for e in session.journal() if e["kind"] == "request"}
    assert len(hashes) == 1


async def test_cancel_while_tools_run_rolls_to_a_new_timely_session(tmp_path) -> None:
    started = asyncio.Event()

    class SlowTwin(FakeTwin):
        async def call(self, *args, **kwargs):
            started.set()
            await asyncio.sleep(30)

    harness = make_harness(tmp_path, [tool_calls(("c1", "campus_status", {})), final("다시 시작")], SlowTwin())
    session = harness.store.create("acct:20239901", "student")
    first_session_id = session.timely_session

    task = asyncio.ensure_future(run(harness, session, "통제 있어?"))
    await asyncio.wait_for(started.wait(), 2)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert session.needs_roll is True

    await run(harness, session, "다시")
    assert harness.timely.requests[-1]["session_id"] != first_session_id
    assert harness.timely.requests[-1]["messages"][0]["content"].startswith("[이전 대화 요약]")


async def test_write_tool_waits_for_confirmation_before_calling_the_twin(tmp_path) -> None:
    twin = FakeTwin()
    harness = make_harness(tmp_path, [
        tool_calls(("w1", "restriction_create", {"target_type": "road", "target_id": "RD_057", "cause": "construction"})),
        final("적용했습니다."),
    ], twin)
    session = harness.store.create("acct:admin", "admin")
    events = []

    async def drive():
        async for event in harness.run_turn(session, text="RD_057 통제", context=None, authorization="Bearer admin"):
            events.append(event)
            if event[0] == "confirm":
                assert twin.calls == []
                assert harness.confirm("acct:admin", session.conversation_id, event[1]["confirm_id"], "approve")

    await drive()
    assert twin.calls == [("restriction_create", {"target_type": "road", "target_id": "RD_057", "cause": "construction"},
                           "admin", "Bearer admin")]
    assert events[-1][0] == "final"


async def test_student_gets_no_admin_tools_and_rejected_calls_become_errors(tmp_path) -> None:
    harness = make_harness(tmp_path, [
        tool_calls(("x1", "restriction_create", {"target_type": "road", "target_id": "RD_1", "cause": "other"})),
        final("권한이 없습니다."),
    ])
    session = harness.store.create("acct:20239901", "student")
    student_tools = {t["name"] for t in harness.load_prefix("student").tools}
    admin_tools = {t["name"] for t in harness.load_prefix("admin").tools}
    assert admin_tools - student_tools == {"simulation_overview", "restriction_create", "restriction_remove",
                                           "simulation_control", "todo"}

    await run(harness, session, "통제 걸어줘")

    tool_message = harness.timely.requests[1]["messages"][0]
    assert tool_message["content"].startswith("ERROR unknown tool restriction_create")
    assert harness.twin.calls == []


async def test_ui_action_is_validated_and_emitted(tmp_path) -> None:
    harness = make_harness(tmp_path, [
        tool_calls(("u1", "ui_action", {"action": "focus", "target": "BLD_D4"}),
                   ("u2", "ui_action", {"action": "tab", "target": "simulation"})),
        final("이동했습니다."),
    ])
    session = harness.store.create("acct:20239901", "student")

    events = await run(harness, session, "보여줘")

    assert ("action", {"action": "focus", "target": "BLD_D4", "label_ko": "건물로 이동"}) in events
    contents = [m["content"] for m in harness.timely.requests[1]["messages"]]
    assert contents[0] == "queued focus BLD_D4" and contents[1].startswith("ERROR invalid ui_action")


async def test_long_tool_output_is_capped_with_a_readable_spill_file(tmp_path) -> None:
    class BigTwin(FakeTwin):
        async def call(self, name, args, **kwargs):
            return "header | 추정값\n" + "row\n" * 3000

    harness = make_harness(tmp_path, [
        tool_calls(("b1", "comfort_rank", {"metric": "utci", "order": "cool"})),
        tool_calls(("r1", "read", {"path": "spill/0-b1.txt", "offset": 2, "limit": 2}), checkpoint="cp-2"),
        final("끝"),
    ], BigTwin())
    session = harness.store.create("acct:20239901", "student")

    await run(harness, session, "시원한 곳")

    capped = harness.timely.requests[1]["messages"][0]["content"]
    assert "full output: spill/0-b1.txt" in capped and len(capped) < 4200
    assert harness.timely.requests[2]["messages"][0]["content"] == "row\nrow\n"


async def test_twin_client_sends_the_bearer_in_meta_and_enforces_roles() -> None:
    server = MCPServer("fake-twin")
    seen = {}

    @server.tool(meta={"scnu/roles": ["student", "admin"]})
    def campus_status(ctx: Context) -> str:
        seen.update(ctx.request_context.meta or {})
        return "campus_status | 시뮬레이션 시나리오"

    client = TwinClient(server)
    await client.start()
    try:
        text = await client.call("campus_status", {}, role="student", authorization="Bearer abc", session_id="s1")
        denied = await client.bridge({"kind": "call", "name": "restriction_create", "args": {}}, role="admin",
                                     authorization="Bearer abc", session_id="s1")
        with pytest.raises(PermissionError):
            await client.call("simulation_overview", {}, role="student")
    finally:
        await client.close()
    assert text == "campus_status | 시뮬레이션 시나리오"
    assert seen["scnu/authorization"] == "Bearer abc" and seen["scnu/session"] == "s1"
    assert "not allowed" in denied
