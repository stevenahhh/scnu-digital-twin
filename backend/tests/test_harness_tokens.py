from __future__ import annotations

import importlib

from harness.tokens import estimate, estimate_messages


def test_estimate_weights_ascii_hangul_and_other_characters() -> None:
    assert estimate("") == 0
    assert estimate("abc") == 1
    assert estimate("abcd") == 2
    assert estimate("가나다") == 4
    assert estimate("°°") == 3
    assert estimate("ab가") == 2


def test_messages_add_per_message_and_per_tool_call_overhead() -> None:
    messages = [{"role": "user", "content": "abc"}, {"role": "tool", "content": "abc", "tool_call_id": "t1"}]
    assert estimate_messages(messages) == (1 + 4) + (1 + 4 + 12)


def test_config_reads_the_environment_and_never_exposes_the_key(monkeypatch) -> None:
    monkeypatch.setenv("TIMELY_API_KEY", "secret-value")
    monkeypatch.setenv("HARNESS_PORT", "9123")
    import harness.config as config

    config = importlib.reload(config)
    assert config.TIMELY_API_KEY == "secret-value"
    assert config.HARNESS_PORT == 9123
    assert config.HARNESS_MODEL == "claude-sonnet-5-5"
    assert "secret-value" not in repr(config.summary())

    monkeypatch.delenv("TIMELY_API_KEY")
    assert importlib.reload(config).summary()["llm"] == "key_missing"
