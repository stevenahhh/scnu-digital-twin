from __future__ import annotations

import os
import re
from pathlib import Path

from harness.config import DEFAULT_TOOL_CAP, EVAL_TOOL_CAP
from harness.tools.files import InvalidPath


def truncate(
    text: str, work_dir: Path, *, round: int, call_id: str, tool: str = "",
) -> str:
    """Cap one tool result and retain its complete body in the session jail."""
    cap = EVAL_TOOL_CAP if tool in {"eval", "read"} else DEFAULT_TOOL_CAP
    if len(text) <= cap:
        return text
    if round < 0 or re.fullmatch(r"[A-Za-z0-9_-]{1,128}", call_id) is None:
        raise InvalidPath(call_id)
    spill = work_dir / "spill"
    if spill.is_symlink():
        raise InvalidPath(str(spill))
    spill.mkdir(parents=True, exist_ok=True)
    name = f"{round}-{call_id}.txt"
    descriptor = os.open(spill, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        file_descriptor = os.open(
            name, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600, dir_fd=descriptor,
        )
    finally:
        os.close(descriptor)
    with os.fdopen(file_descriptor, "w", encoding="utf-8") as stream:
        stream.write(text)
    head, tail = int(cap * 0.60), int(cap * 0.25)
    marker = f"[truncated: showing {head + tail:,} of {len(text):,} chars; full output: spill/{name}]"
    return f"{text[:head]}\n{text[-tail:]}\n{marker}"
