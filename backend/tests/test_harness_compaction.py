from pathlib import Path

import pytest

from harness import config
from harness.compaction import build_seed, due, roll
from harness.sessions import SessionStore
from harness.tools.todo import todo


@pytest.mark.parametrize("role", ["student", "admin"])
def test_due_at_role_soft_and_hard_limits(tmp_path: Path, monkeypatch, role: str) -> None:
    session = SessionStore(tmp_path).create("acct:a", role)
    session.estimated_context = int(config.EPOCH_SOFT_LIMIT[role]) - 1
    assert not due(session)
    session.estimated_context += 1
    assert due(session)
    monkeypatch.setitem(config.EPOCH_SOFT_LIMIT, role, config.EPOCH_HARD_LIMIT + 100)
    session.estimated_context = int(config.EPOCH_HARD_LIMIT)
    assert due(session)


def test_seed_preserves_recent_exchanges_grounding_and_open_work(tmp_path: Path) -> None:
    session = SessionStore(tmp_path).create("acct:a", "admin")
    session.append({"kind": "user", "text": "First question"})
    session.append({"kind": "tool_result", "text": "weather | KMA obs 13:00\nBLD_D4\t34.9"})
    session.append({"kind": "assistant", "text": "First answer"})
    session.append({"kind": "user", "text": "Second question"})
    session.append({"kind": "assistant", "text": "Second answer"})
    todo(session, [{"text": "Open task", "done": False}, {"text": "Closed task", "done": True}])
    session.append({"kind": "confirm", "pending_proposal": "Close RD_057"})

    seed = build_seed(session)

    for text in ("First question", "First answer", "Second question", "Second answer",
                 "BLD_D4", "13:00", "Open task", "Close RD_057"):
        assert text in seed
    assert "Closed task" not in seed
    assert "acct:a" not in seed


def test_seed_bounds_questions_digests_and_assistant_text(tmp_path: Path) -> None:
    session = SessionStore(tmp_path).create("acct:a", "student")
    for index in range(20):
        session.append({"kind": "user", "text": f"Q{index:02}:" + "u" * 100})
        session.append({"kind": "tool_result", "text": f"source{index:02} obs 12:00\nBLD_D{index}\t1"})
        session.append({"kind": "assistant", "text": "a" * 900})
    seed = build_seed(session)
    assert len(seed) <= config.SEED_MAX_CHARS
    assert "Q00:" not in seed
    assert "source00" not in seed
    assert "a" * 601 not in seed
    assert "Q19:" in seed


def test_roll_journals_new_epoch_and_resets_context(tmp_path: Path) -> None:
    store = SessionStore(tmp_path, clock=lambda: 0.0)
    session = store.create("acct:a", "student", prefix_version="old", prefix_tokens=100)
    session.append({"kind": "user", "text": "Keep this"})
    session.append({"kind": "cancel", "needs_roll": True})
    old = session.timely_session

    seed = roll(session, prefix_version="new", prefix_tokens=200, estimate=len)

    assert session.epoch == 1
    assert session.timely_session != old
    assert session.timely_session.endswith("-e1")
    assert session.estimated_context == 200 + len(seed)
    assert not session.needs_roll
    assert session.journal()[-1]["kind"] == "compaction"
    restored = SessionStore(tmp_path).get("acct:a", session.conversation_id)
    assert restored.epoch == 1
    assert restored.prefix_version == "new"
    assert restored.estimated_context == 200 + len(seed)
