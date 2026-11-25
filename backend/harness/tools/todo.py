from __future__ import annotations

from typing import TypedDict

from harness.sessions import Session, TodoItem


class Checklist(TypedDict):
    items: list[TodoItem]


class InvalidChecklist(ValueError):
    """A checklist must contain at most eight text/boolean items."""


def todo(session: Session, items: list[TodoItem]) -> Checklist:
    if len(items) > 8 or any(
        set(item) != {"text", "done"} or not isinstance(item["text"], str)
        or not isinstance(item["done"], bool) for item in items
    ):
        raise InvalidChecklist(items)
    session.append({"kind": "todo", "items": items})
    return {"items": [item.copy() for item in session.todo]}
