from __future__ import annotations

import asyncio
import hashlib
import json
from pathlib import Path

import pytest

from common.campus_auth import Account
from harness import config
from harness.sessions import (
    BudgetExceeded,
    ConversationLimit,
    InvalidClientId,
    ModelCall,
    NotFound,
    SessionStore,
    owner_key,
)


def test_account_and_guest_owner_keys() -> None:
    assert owner_key(Account("123", "Student", "student")) == "acct:123"
    client = "a" * 22
    assert owner_key(Account("guest", "Guest", "admin", True), client) == f"guest:admin:{client}"


@pytest.mark.parametrize("client", [None, "", "a" * 21, "a" * 65, "../" + "a" * 22])
def test_guest_requires_valid_client_id(client: str | None) -> None:
    with pytest.raises(InvalidClientId):
        owner_key(Account("guest", "Guest", "student", True), client)


def test_owner_isolation_and_server_generated_layout(tmp_path: Path) -> None:
    store = SessionStore(tmp_path, clock=lambda: 100.0)
    first = store.create("acct:first", "student")
    second = store.create("acct:second", "admin")
    digest = hashlib.sha256(b"acct:first").hexdigest()[:16]
    assert first.directory == tmp_path / "sessions" / digest / first.conversation_id
    assert first.timely_session == f"scnu-{digest}-{first.conversation_id}-e0"
    assert first.conversation_id != second.conversation_id
    assert {p.name for p in first.work_dir.iterdir()} == {"spill", "out", "tmp"}
    assert first.kernel is None
    for foreign in (second.conversation_id, "../" + first.conversation_id, "/tmp/x"):
        with pytest.raises(NotFound):
            store.get("acct:first", foreign)


def test_restart_replays_journal_even_with_stale_meta(tmp_path: Path) -> None:
    store = SessionStore(tmp_path, clock=lambda: 100.0)
    session = store.create("acct:a", "admin", prefix_version="v1", prefix_tokens=20)
    meta = (session.directory / "meta.json").read_bytes()
    session.append({"kind": "user", "text": "Question"})
    before = (session.directory / "journal.jsonl").read_bytes()
    session.append({"kind": "cancel", "needs_roll": True})
    session.append({"kind": "todo", "items": [{"text": "Check weather", "done": False}]})
    (session.directory / "meta.json").write_bytes(meta)

    restored = SessionStore(tmp_path, clock=lambda: 101.0).get("acct:a", session.conversation_id)

    assert restored.needs_roll
    assert restored.todo == [{"text": "Check weather", "done": False}]
    assert restored.prefix_version == "v1"
    assert restored.estimated_context == 20
    assert restored.kernel_state_lost
    assert restored.kernel is None
    assert (restored.directory / "journal.jsonl").read_bytes().startswith(before)
    assert restored.journal()[1]["text"] == "Question"
    assert json.loads((restored.directory / "meta.json").read_text())["needs_roll"]


def test_conversation_limit_survives_restart(tmp_path: Path) -> None:
    store = SessionStore(tmp_path)
    for _ in range(config.MAX_CONVERSATIONS_PER_OWNER):
        store.create("acct:a", "student")
    with pytest.raises(ConversationLimit):
        SessionStore(tmp_path).create("acct:a", "student")
    assert store.create("acct:b", "student").owner_key == "acct:b"


def test_retention_uses_activity_and_owner_kind(tmp_path: Path) -> None:
    now = [100.0]
    store = SessionStore(tmp_path, clock=lambda: now[0])
    account = store.create("acct:a", "student")
    guest = store.create("guest:admin:" + "a" * 22, "admin")
    now[0] += config.RETENTION_S["guest"] - 1
    account.append({"kind": "user", "text": "Still active"})
    now[0] += 1
    assert asyncio.run(store.reap()) == 1
    with pytest.raises(NotFound):
        store.get(guest.owner_key, guest.conversation_id)
    assert store.get(account.owner_key, account.conversation_id) is account
    now[0] += config.RETENTION_S["account"]
    assert asyncio.run(SessionStore(tmp_path, clock=lambda: now[0]).reap()) == 1


def test_usage_counts_context_delta_thinking_and_arguments(tmp_path: Path) -> None:
    store = SessionStore(tmp_path, clock=lambda: 0.0)
    session = store.create("acct:a", "student", prefix_tokens=10)
    usage = store.record_usage(session, ModelCall(
        messages=[{"role": "user", "content": "abc"}],
        text="def", thinking="ghi", tool_arguments=("jkl",),
    ))
    assert usage == {"est_input": 15, "est_output": 3, "est_context": 18, "estimated": True}
    assert session.journal()[-1]["usage"] == usage
    day = json.loads((tmp_path / "usage" / "1970-01-01.json").read_text())
    assert day == {session.owner_dir: 18}
    restored = SessionStore(tmp_path, clock=lambda: 0.0).get("acct:a", session.conversation_id)
    assert restored.estimated_context == 18


@pytest.mark.parametrize("owner,role,budget", [
    ("acct:s", "student", "student"), ("acct:a", "admin", "admin"),
    ("guest:admin:" + "a" * 22, "admin", "guest"),
])
def test_budget_charges_overage_then_blocks_until_next_day(
    tmp_path: Path, owner: str, role: str, budget: str,
) -> None:
    now = [0.0]
    store = SessionStore(tmp_path, clock=lambda: now[0], estimate=lambda text: len(text))
    session = store.create(owner, role)
    store.record_usage(session, ModelCall(text="x" * int(config.DAILY_BUDGET[budget])))
    with pytest.raises(BudgetExceeded):
        store.record_usage(session, ModelCall(text="x"))
    with pytest.raises(BudgetExceeded):
        SessionStore(tmp_path, clock=lambda: now[0]).check_budget(session)
    assert session.journal()[-1]["usage"]["est_output"] == 1
    now[0] = 86400.0
    store.check_budget(session)


def test_total_budget_combines_different_owners(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(config, "DAILY_BUDGET_TOTAL", 5)
    store = SessionStore(tmp_path, clock=lambda: 0.0, estimate=len)
    first = store.create("acct:a", "student")
    second = store.create("acct:b", "admin")
    store.record_usage(first, ModelCall(text="123"))
    with pytest.raises(BudgetExceeded):
        store.record_usage(second, ModelCall(text="456"))
    with pytest.raises(BudgetExceeded):
        store.check_budget(first)
