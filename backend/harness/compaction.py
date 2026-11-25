from __future__ import annotations

import re
from collections.abc import Callable

from harness import config, tokens
from harness.sessions import Session


def due(session: Session) -> bool:
    return (
        session.estimated_context >= config.EPOCH_SOFT_LIMIT[session.role]
        or session.estimated_context >= config.EPOCH_HARD_LIMIT
    )


def build_seed(session: Session) -> str:
    """Build bounded recall from journal evidence, without a model request."""
    questions: list[str] = []
    grounding: list[str] = []
    exchanges: list[list[str]] = []
    for entry in session.journal():
        kind, text = entry["kind"], entry.get("text", "")
        if kind == "user":
            questions.append(text.replace("\n", " ")[:80])
            exchanges.append(["user: " + text])
        elif kind == "assistant" and exchanges:
            exchanges[-1].append("assistant: " + text[:600])
        elif kind == "tool_result" and text:
            header = text.splitlines()[0]
            ids = list(dict.fromkeys(re.findall(r"\b(?:BLD|RD|ND|CW|RST)_[A-Za-z0-9_]+\b", text)))
            grounding.append((header + " " + " ".join(ids)).strip())
    open_items = [item["text"] for item in session.todo if not item["done"]]
    sections = []
    if open_items:
        sections.append("Open todo:\n" + "\n".join(open_items))
    if session.pending_proposal:
        sections.append("Pending proposal:\n" + session.pending_proposal)
    if exchanges:
        sections.append("Recent exchanges:\n" + "\n".join(line for exchange in exchanges[-2:] for line in exchange))
    if grounding:
        sections.append("Grounding:\n" + "\n".join(grounding[-8:]))
    if questions:
        sections.append("Earlier questions:\n" + "\n".join(questions[-12:]))
    return "\n\n".join(sections)[:config.SEED_MAX_CHARS]


def roll(
    session: Session, *, prefix_version: str | None = None,
    prefix_tokens: int | None = None, estimate: Callable[[str], int] = tokens.estimate,
) -> str:
    """Advance the remote epoch at a turn boundary and return its seed."""
    seed = build_seed(session)
    prefix = session.prefix_tokens if prefix_tokens is None else prefix_tokens
    session.append({
        "kind": "compaction", "text": seed, "epoch": session.epoch + 1,
        "prefix_version": session.prefix_version if prefix_version is None else prefix_version,
        "prefix_tokens": prefix, "estimated_context": prefix + estimate(seed), "needs_roll": False,
    })
    return seed
