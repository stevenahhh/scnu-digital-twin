from __future__ import annotations

import asyncio
import hashlib
import json
import re
import secrets
import shutil
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING, TypedDict

from common.campus_auth import Account
from harness import config, tokens

if TYPE_CHECKING:
    from harness.sandbox import EvalKernel


class NotFound(LookupError):
    """No conversation belonging to this owner exists."""


class ConversationLimit(RuntimeError):
    """The owner already has the configured number of conversations."""


class InvalidClientId(ValueError):
    """A guest client id must contain 22 to 64 URL-safe characters."""


class BudgetExceeded(RuntimeError):
    """Recorded daily usage exceeds an owner or service budget."""


class TodoItem(TypedDict):
    text: str
    done: bool


class Usage(TypedDict):
    est_input: int
    est_output: int
    est_context: int
    estimated: bool


class JournalEntry(TypedDict, total=False):
    kind: str
    at: float
    owner_key: str
    role: str
    text: str
    title: str
    epoch: int
    prefix_version: str
    prefix_tokens: int
    estimated_context: int
    needs_roll: bool
    items: list[TodoItem]
    pending_proposal: str | None
    usage: Usage


@dataclass(frozen=True, slots=True)
class ModelCall:
    messages: list[dict[str, str]] = field(default_factory=list)
    text: str = ""
    thinking: str = ""
    tool_arguments: tuple[str, ...] = ()


def owner_key(account: Account, client_id: str | None = None) -> str:
    if not account.guest:
        return f"acct:{account.id}"
    if client_id is None or re.fullmatch(r"[A-Za-z0-9_-]{22,64}", client_id) is None:
        raise InvalidClientId(client_id)
    return f"guest:{account.role}:{client_id}"


@dataclass(slots=True)
class Session:
    """Mutable conversation state; append persists every durable state transition."""

    owner_key: str
    conversation_id: str
    directory: Path
    clock: Callable[[], float] = field(repr=False)
    role: str = "student"
    epoch: int = 0
    prefix_version: str = ""
    prefix_tokens: int = 0
    estimated_context: int = 0
    title: str = ""
    updated_at: float = 0.0
    needs_roll: bool = False
    todo: list[TodoItem] = field(default_factory=list)
    pending_proposal: str | None = None
    kernel_state_lost: bool = False
    kernel: EvalKernel | None = field(default=None, repr=False)
    turn_lock: asyncio.Lock = field(default_factory=asyncio.Lock, repr=False)
    running_task: asyncio.Task[None] | None = field(default=None, repr=False)

    @property
    def owner_dir(self) -> str:
        return hashlib.sha256(self.owner_key.encode()).hexdigest()[:16]

    @property
    def work_dir(self) -> Path:
        return self.directory / "work"

    @property
    def timely_session(self) -> str:
        return f"scnu-{self.owner_dir}-{self.conversation_id}-e{self.epoch}"

    def journal(self) -> list[JournalEntry]:
        with (self.directory / "journal.jsonl").open(encoding="utf-8") as stream:
            return [json.loads(line) for line in stream]

    def _apply(self, entry: JournalEntry) -> None:
        self.role = entry.get("role", self.role)
        self.epoch = entry.get("epoch", self.epoch)
        self.prefix_version = entry.get("prefix_version", self.prefix_version)
        self.prefix_tokens = entry.get("prefix_tokens", self.prefix_tokens)
        self.estimated_context = entry.get("estimated_context", self.estimated_context)
        self.title = entry.get("title", self.title)
        self.updated_at = entry.get("at", self.updated_at)
        self.needs_roll = entry.get("needs_roll", self.needs_roll)
        self.todo = entry.get("items", self.todo)
        self.pending_proposal = entry.get("pending_proposal", self.pending_proposal)

    def _save_meta(self) -> None:
        meta = {name: getattr(self, name) for name in (
            "owner_key", "role", "epoch", "prefix_version", "prefix_tokens",
            "estimated_context", "title", "updated_at", "needs_roll",
        )}
        temporary = self.directory / "meta.json.tmp"
        temporary.write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
        temporary.replace(self.directory / "meta.json")

    def append(self, entry: JournalEntry) -> None:
        record = {**entry, "at": self.clock()}
        encoded = json.dumps(record, ensure_ascii=False)
        with (self.directory / "journal.jsonl").open("a", encoding="utf-8") as stream:
            stream.write(encoded + "\n")
        self._apply(json.loads(encoded))
        self._save_meta()


class SessionStore:
    def __init__(
        self, data_dir: Path = config.HARNESS_DATA_DIR, *,
        clock: Callable[[], float] = time.time,
        estimate: Callable[[str], int] = tokens.estimate,
    ) -> None:
        self.data_dir, self.clock, self.estimate = Path(data_dir), clock, estimate
        self._sessions: dict[tuple[str, str], Session] = {}
        for name in ("sessions", "ref", "usage"):
            (self.data_dir / name).mkdir(parents=True, exist_ok=True)

    def create(
        self, owner_key: str, role: str, *, prefix_version: str = "", prefix_tokens: int = 0,
    ) -> Session:
        owner_dir = hashlib.sha256(owner_key.encode()).hexdigest()[:16]
        parent = self.data_dir / "sessions" / owner_dir
        parent.mkdir(parents=True, exist_ok=True)
        if sum(path.is_dir() for path in parent.iterdir()) >= config.MAX_CONVERSATIONS_PER_OWNER:
            raise ConversationLimit(owner_key)
        sid = secrets.token_urlsafe(9)
        session = Session(owner_key, sid, parent / sid, self.clock)
        for name in ("spill", "out", "tmp"):
            (session.work_dir / name).mkdir(parents=True, exist_ok=True)
        session.append({
            "kind": "created", "owner_key": owner_key, "role": role,
            "prefix_version": prefix_version, "prefix_tokens": prefix_tokens,
            "estimated_context": prefix_tokens,
        })
        self._sessions[owner_key, sid] = session
        return session

    def get(self, owner_key: str, conversation_id: str) -> Session:
        if re.fullmatch(r"[A-Za-z0-9_-]{12}", conversation_id) is None:
            raise NotFound(conversation_id)
        cached = self._sessions.get((owner_key, conversation_id))
        if cached is not None:
            return cached
        owner_dir = hashlib.sha256(owner_key.encode()).hexdigest()[:16]
        directory = self.data_dir / "sessions" / owner_dir / conversation_id
        if not (directory / "journal.jsonl").is_file():
            raise NotFound(conversation_id)
        session = Session(owner_key, conversation_id, directory, self.clock, kernel_state_lost=True)
        entries = session.journal()
        if not entries or entries[0].get("owner_key") != owner_key:
            raise NotFound(conversation_id)
        for entry in entries:
            session._apply(entry)
        session._save_meta()
        self._sessions[owner_key, conversation_id] = session
        return session

    def list(self, owner_key: str) -> list[Session]:
        owner_dir = hashlib.sha256(owner_key.encode()).hexdigest()[:16]
        found = []
        for journal in sorted((self.data_dir / "sessions" / owner_dir).glob("*/journal.jsonl")):
            try:
                found.append(self.get(owner_key, journal.parent.name))
            except NotFound:
                continue
        return sorted(found, key=lambda session: session.updated_at, reverse=True)

    def delete(self, session: Session) -> None:
        self._sessions.pop((session.owner_key, session.conversation_id), None)
        shutil.rmtree(session.directory, ignore_errors=True)

    async def reap(self) -> int:
        removed = 0
        for journal in (self.data_dir / "sessions").glob("*/*/journal.jsonl"):
            with journal.open(encoding="utf-8") as stream:
                key = json.loads(next(stream))["owner_key"]
            session = self.get(key, journal.parent.name)
            retention = config.RETENTION_S["guest" if key.startswith("guest:") else "account"]
            if self.clock() - session.updated_at < retention or session.turn_lock.locked():
                continue
            if session.running_task is not None and not session.running_task.done():
                continue
            if session.kernel is not None:
                await session.kernel.close()
            shutil.rmtree(session.directory)
            del self._sessions[key, session.conversation_id]
            removed += 1
        return removed

    def _day(self) -> Path:
        day = datetime.fromtimestamp(self.clock(), timezone.utc).date().isoformat()
        return self.data_dir / "usage" / f"{day}.json"

    def check_budget(self, session: Session) -> None:
        path = self._day()
        counts = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
        kind = "guest" if session.owner_key.startswith("guest:") else session.role
        if counts.get(session.owner_dir, 0) > config.DAILY_BUDGET[kind] or sum(counts.values()) > config.DAILY_BUDGET_TOTAL:
            raise BudgetExceeded(session.owner_dir)

    def record_usage(self, session: Session, call: ModelCall) -> Usage:
        delta = tokens.estimate_messages(call.messages)
        output = sum(self.estimate(text) for text in (call.text, call.thinking, *call.tool_arguments))
        usage: Usage = {
            "est_input": session.estimated_context + delta, "est_output": output,
            "est_context": session.estimated_context + delta + output, "estimated": True,
        }
        session.append({"kind": "usage", "usage": usage, "estimated_context": usage["est_context"]})
        path = self._day()
        counts = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
        counts[session.owner_dir] = counts.get(session.owner_dir, 0) + usage["est_input"] + output
        temporary = path.with_suffix(".json.tmp")
        temporary.write_text(json.dumps(counts), encoding="utf-8")
        temporary.replace(path)
        self.check_budget(session)
        return usage
