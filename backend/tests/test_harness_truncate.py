from pathlib import Path

import pytest

from harness import config
from harness.tools.files import FileTools
from harness.truncate import truncate


@pytest.mark.parametrize("tool,cap", [
    ("campus_weather", config.DEFAULT_TOOL_CAP),
    ("eval", config.EVAL_TOOL_CAP), ("read", config.EVAL_TOOL_CAP),
])
def test_truncation_keeps_head_tail_and_readable_full_spill(
    tmp_path: Path, tool: str, cap: int,
) -> None:
    work = tmp_path / "work"
    (work / "spill").mkdir(parents=True)
    text = "HEAD\n" + "middle\n" * 3000 + "TAIL"
    result = truncate(text, work, round=3, call_id="call_ab12", tool=tool)
    head, tail = int(cap * 0.60), int(cap * 0.25)
    assert result.startswith(text[:head])
    assert text[-tail:] in result
    assert result.endswith(
        f"[truncated: showing {head + tail:,} of {len(text):,} chars; "
        "full output: spill/3-call_ab12.txt]"
    )
    assert len(result) <= cap
    assert (work / "spill/3-call_ab12.txt").read_text() == text
    assert FileTools(work, tmp_path / "ref").read("spill/3-call_ab12.txt", limit=1) == "HEAD\n"


def test_at_cap_passes_through_without_spill(tmp_path: Path) -> None:
    text = "x" * config.DEFAULT_TOOL_CAP
    assert truncate(text, tmp_path, round=1, call_id="abc") == text
    assert list(tmp_path.iterdir()) == []


@pytest.mark.parametrize("call_id", ["../escape", "/tmp/escape", "a/b", "a\\b"])
def test_spill_rejects_path_in_call_id(tmp_path: Path, call_id: str) -> None:
    with pytest.raises(ValueError):
        truncate("x" * 9000, tmp_path, round=1, call_id=call_id)


def test_spill_rejects_symlink_directory(tmp_path: Path) -> None:
    outside = tmp_path / "outside"
    outside.mkdir()
    work = tmp_path / "work"
    work.mkdir()
    (work / "spill").symlink_to(outside, target_is_directory=True)
    with pytest.raises(ValueError):
        truncate("x" * 9000, work, round=1, call_id="abc")
    assert list(outside.iterdir()) == []
