from __future__ import annotations

import math
from typing import Any

from harness import config

MESSAGE_OVERHEAD = 4
TOOL_CALL_OVERHEAD = 12


def _is_hangul(ch: str) -> bool:
    return "\uac00" <= ch <= "\ud7a3"


def estimate(text: str) -> int:
    ascii_chars = sum(1 for ch in text if ord(ch) < 128)
    hangul = sum(1 for ch in text if _is_hangul(ch))
    other = len(text) - ascii_chars - hangul
    return math.ceil(ascii_chars / config.TOKENS_PER_ASCII_DIVISOR + hangul * config.TOKENS_PER_HANGUL
                     + other * config.TOKENS_PER_OTHER)


def estimate_messages(messages: list[dict[str, Any]]) -> int:
    total = 0
    for message in messages:
        total += estimate(str(message.get("content") or "")) + MESSAGE_OVERHEAD
        if message.get("tool_call_id"):
            total += TOOL_CALL_OVERHEAD
    return total
