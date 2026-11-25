from __future__ import annotations

import json
from typing import Any

HEARTBEAT = b": keep-alive\n\n"


def sse(event: str, data: dict[str, Any]) -> bytes:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n".encode()
