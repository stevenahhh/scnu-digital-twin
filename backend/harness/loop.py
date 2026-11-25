from __future__ import annotations

import asyncio
import json
import logging
import re
import secrets
import time
from collections import OrderedDict
from collections.abc import AsyncIterator, Callable
from pathlib import Path
from typing import Any

from harness import compaction, config, prefix
from harness.guard import apply_guard
from harness.mcp_client import WRITE_TOOLS, NotAllowed, TwinClient
from harness.sandbox import EvalKernel, eval_status
from harness.sessions import BudgetExceeded, ModelCall, Session, SessionStore
from harness.timely import TimelyClient, TimelyError, prefix_hash
from harness.tokens import estimate
from harness.tools.files import FileTools, InvalidPage, InvalidPath
from harness.tools.todo import InvalidChecklist, todo
from harness.truncate import truncate

log = logging.getLogger("harness")

PARALLEL_SAFE = frozenset({"find_place", "campus_weather", "building_status", "comfort_rank", "campus_status",
                           "simulation_overview", "ui_action", "read", "search"})
VIEW_PRESETS = frozenset({"overview", "gate", "d4", "engineering", "library", "life-science", "headquarters",
                          "humanities"})
TABS = {"student": frozenset({"building", "status"}),
        "admin": frozenset({"building", "status", "energy", "simulation"})}
BUDGET_NOTE = "\n[tool budget exhausted: answer with what you have]"
ACTION_LABELS = {"focus": "건물로 이동", "view": "시점 변경", "home": "처음 시점", "tab": "탭 열기", "time": "장면 시각 변경"}

Event = tuple[str, dict[str, Any]]


def ctx_line(context: dict | None) -> str:
    if not context:
        return ""
    fields = []
    for key in ("t", "sel", "tab", "view", "clock"):
        value = context.get(key)
        if value:
            fields.append(f"{key}={re.sub(r'[^0-9A-Za-z_:+.-]', '', str(value))[:32]}")
    return ("[ctx " + " ".join(fields) + "]")[: config.MAX_CONTEXT_LINE_CHARS] if fields else ""


def _prefix_tokens(p: prefix.Prefix) -> int:
    return estimate(p.instructions) + estimate(p.tools_json)


def _confirm_summary(name: str, args: dict) -> str:
    if name == "restriction_create":
        access = {"vehicles": "차량만 제한", "all": "전체 통제"}.get(args.get("access", "vehicles"), "")
        cause = {"construction": "공사", "event": "행사", "other": "기타"}.get(args.get("cause", ""), "")
        return f"{args.get('target_id', '')} · {cause} · {access}"
    if name == "restriction_remove":
        return f"{args.get('restriction_id', '')} 통제 해제"
    return f"시뮬레이션 {args.get('action', '')} {args.get('scenario') or args.get('multiplier') or ''}".strip()


class Harness:
    def __init__(self, *, store: SessionStore, twin: TwinClient, timely: TimelyClient | None, ref_dir: Path,
                 prefix_loader: Callable[[str], prefix.Prefix] = prefix.load,
                 kernel_factory: Callable[..., EvalKernel] = EvalKernel) -> None:
        self.store, self.twin, self.timely, self.ref_dir = store, twin, timely, ref_dir
        self.load_prefix = prefix_loader
        self.kernel_factory = kernel_factory
        self.kernels: OrderedDict[tuple[str, str], Session] = OrderedDict()
        self.pending: dict[str, tuple[str, str, asyncio.Future[str]]] = {}
        self.streams = asyncio.Semaphore(config.MAX_TIMELY_STREAMS)
        self.owner_runs: dict[str, int] = {}

    def confirm(self, owner_key: str, conversation_id: str, confirm_id: str, decision: str) -> bool:
        entry = self.pending.get(confirm_id)
        if entry is None or entry[:2] != (owner_key, conversation_id) or entry[2].done():
            return False
        entry[2].set_result(decision)
        return True

    async def close_kernel(self, session: Session) -> None:
        self.kernels.pop((session.owner_key, session.conversation_id), None)
        if session.kernel is not None:
            await session.kernel.close()
            session.kernel = None

    async def _kernel(self, session: Session, authorization: str | None) -> EvalKernel:
        key = (session.owner_key, session.conversation_id)
        if session.kernel is None:
            limits = config.EVAL_LIMITS[session.role]
            role = session.role

            async def bridge(request: dict) -> str:
                return await self.twin.bridge(request, role=role, authorization=authorization,
                                              session_id=session.conversation_id)

            session.kernel = self.kernel_factory(
                session.work_dir, bridge=bridge, ref_dir=self.ref_dir, timeout_s=limits["timeout_s"],
                output_cap=200_000, max_calls=limits["calls"], cpu_s=limits["cpu_s"], file_mb=limits["file_mb"],
                memory_mb=limits["memory_mb"])
            while len(self.kernels) >= config.MAX_LIVE_KERNELS:
                _, oldest = self.kernels.popitem(last=False)
                await self.close_kernel(oldest)
        self.kernels[key] = session
        self.kernels.move_to_end(key)
        return session.kernel

    async def _eval(self, session: Session, args: dict, authorization: str | None) -> str:
        if eval_status() != "on":
            return "ERROR eval is off on this server"
        limits = config.EVAL_LIMITS[session.role]
        restarted = session.kernel is None and session.kernel_state_lost
        kernel = await self._kernel(session, authorization)
        session.kernel_state_lost = False
        timeout = min(int(args.get("timeout_s") or limits["timeout_s"]), limits["max_timeout_s"])
        result = await kernel.run(str(args.get("code", "")), timeout_s=timeout)
        text = ("kernel restarted: state lost\n" if restarted else "") + result.stdout
        if result.error:
            text += f"\nERROR {result.error.strip()}"
            session.kernel_state_lost = "state lost" in result.error
        return text or "(no output)"

    def _ui_action(self, session: Session, args: dict) -> tuple[str, Event | None]:
        action, target = args.get("action"), str(args.get("target") or "")
        valid = (
            (action == "focus" and re.fullmatch(r"BLD_[A-Za-z0-9_]+", target))
            or (action == "view" and target in VIEW_PRESETS)
            or action == "home"
            or (action == "tab" and target in TABS[session.role])
            or (action == "time" and (target == "live" or re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", target)))
        )
        if not valid:
            return f"ERROR invalid ui_action {action} {target}", None
        return f"queued {action} {target}".strip(), ("action", {"action": action, "target": target,
                                                                "label_ko": ACTION_LABELS[action]})

    async def _write_tool(self, session: Session, name: str, args: dict, authorization: str | None,
                          emit: Callable[[Event], None]) -> str:
        if session.role != "admin":
            return f"ERROR not allowed for role {session.role}: {name}"
        confirm_id = secrets.token_urlsafe(9)
        future: asyncio.Future[str] = asyncio.get_running_loop().create_future()
        self.pending[confirm_id] = (session.owner_key, session.conversation_id, future)
        summary = _confirm_summary(name, args)
        session.append({"kind": "confirm", "text": summary, "pending_proposal": summary})
        emit(("confirm", {"confirm_id": confirm_id, "tool": name, "args": args, "summary_ko": summary,
                          "expires_in_s": config.CONFIRM_TIMEOUT_S}))
        try:
            decision = await asyncio.wait_for(future, config.CONFIRM_TIMEOUT_S)
        except asyncio.TimeoutError:
            decision = "timeout"
        finally:
            self.pending.pop(confirm_id, None)
        session.append({"kind": "confirm", "text": decision, "pending_proposal": None})
        if decision != "approve":
            return "rejected_by_user"
        return await self.twin.call(name, args, role=session.role, authorization=authorization,
                                    session_id=session.conversation_id)

    async def _run_tool(self, session: Session, tools: frozenset[str], call: dict, round_no: int,
                        authorization: str | None, digests: list[str], emit: Callable[[Event], None]) -> str:
        name, args = call["name"], call.get("args") or {}
        call_id = re.sub(r"[^A-Za-z0-9_-]", "", call.get("tool_call_id", "")) or secrets.token_hex(4)
        started = time.monotonic()
        emit(("tool", {"call_id": call_id, "name": name, "state": "start"}))
        state = "ok"
        try:
            if name not in tools:
                text, state = f"ERROR unknown tool {name}", "error"
            elif name in WRITE_TOOLS:
                text = await self._write_tool(session, name, args, authorization, emit)
            elif name == "ui_action":
                text, event = self._ui_action(session, args)
                if event:
                    emit(event)
            elif name == "eval":
                text = await self._eval(session, args, authorization)
            elif name in ("read", "search"):
                files = FileTools(session.work_dir, self.ref_dir)
                text = (files.read(args["path"], args.get("offset", 1), args.get("limit", 200)) if name == "read"
                        else files.search(args["pattern"], args.get("path"), args.get("limit", 50))) or "(no match)"
            elif name == "todo":
                checklist = todo(session, args.get("items") or [])
                emit(("todo", checklist))
                text = json.dumps(checklist, ensure_ascii=False)
            else:
                text = await self.twin.call(name, args, role=session.role, authorization=authorization,
                                            session_id=session.conversation_id)
                digests.append(text)
        except (InvalidPath, InvalidPage, InvalidChecklist, NotAllowed, KeyError, re.error) as exc:
            text, state = f"ERROR {type(exc).__name__}: {exc}", "error"
        if text.startswith("ERROR"):
            state = "error"
        capped = truncate(text, session.work_dir, round=round_no, call_id=call_id, tool=name)
        session.append({"kind": "tool_call", "text": json.dumps({"name": name, "args": args}, ensure_ascii=False)})
        session.append({"kind": "tool_result", "text": capped})
        emit(("tool", {"call_id": call_id, "name": name, "state": state,
                       "ms": int((time.monotonic() - started) * 1000)}))
        return capped

    async def _execute(self, session: Session, tools: frozenset[str], calls: list[dict], round_no: int,
                       authorization: str | None, digests: list[str], emit: Callable[[Event], None]) -> list[str]:
        calls = calls[: config.MAX_TOOL_CALLS_PER_TURN]
        if all(call["name"] in PARALLEL_SAFE for call in calls):
            return list(await asyncio.gather(*(
                self._run_tool(session, tools, call, round_no, authorization, digests, emit) for call in calls)))
        return [await self._run_tool(session, tools, call, round_no, authorization, digests, emit) for call in calls]

    async def _with_events(self, work: Any, queue: asyncio.Queue[Event]) -> AsyncIterator[Event | tuple[str, Any]]:
        task = asyncio.ensure_future(work)
        try:
            while not task.done() or not queue.empty():
                getter = asyncio.ensure_future(queue.get())
                done, _ = await asyncio.wait({task, getter}, return_when=asyncio.FIRST_COMPLETED)
                if getter in done:
                    yield getter.result()
                else:
                    getter.cancel()
            yield ("__result__", task.result())
        finally:
            if not task.done():
                task.cancel()

    async def run_turn(self, session: Session, *, text: str, context: dict | None,
                       authorization: str | None) -> AsyncIterator[Event]:
        role = session.role
        p = self.load_prefix(role)
        tools_list = p.tools
        tool_names = frozenset(tool["name"] for tool in tools_list)
        run_id = secrets.token_urlsafe(6)
        try:
            self.store.check_budget(session)
        except BudgetExceeded:
            yield "error", {"code": "budget_exceeded", "message_ko": "오늘 사용할 수 있는 도우미 한도를 모두 사용했습니다"}
            return

        seed = None
        if not session.prefix_version:
            session.append({"kind": "prefix", "prefix_version": p.version, "prefix_tokens": _prefix_tokens(p),
                            "estimated_context": _prefix_tokens(p)})
        elif session.needs_roll or session.prefix_version != p.version or compaction.due(session):
            seed = compaction.roll(session, prefix_version=p.version, prefix_tokens=_prefix_tokens(p))
        yield "run", {"run_id": run_id, "epoch": session.epoch}

        user_text = (text + ("\n" + ctx_line(context) if ctx_line(context) else ""))
        content = (f"[이전 대화 요약]\n{seed}\n[/이전 대화 요약]\n\n" if seed else "") + user_text
        session.append({"kind": "user", "text": text, "title": session.title or text[:40]})
        delta: list[dict] = [{"role": "user", "content": content}]
        checkpoint: str | None = None
        digests: list[str] = []
        awaiting_results = False
        queue: asyncio.Queue[Event] = asyncio.Queue()
        try:
            for round_no in range(config.MAX_ROUNDS):
                yield "status", {"state": "thinking", "label_ko": "생각하는 중"}
                session.append({"kind": "request", "text": json.dumps({
                    "timely_session": session.timely_session, "prefix_hash": prefix_hash(p.instructions, tools_list),
                    "delta_roles": [m["role"] for m in delta], "checkpoint": bool(checkpoint)})})
                log.info("timely request session=%s prefix=%s delta=%s", session.timely_session,
                         prefix_hash(p.instructions, tools_list), [m["role"] for m in delta])
                streamed, thinking, final, calls = "", "", None, None
                async with self.streams:
                    async for event in self.timely.stream(
                            session_id=session.timely_session, instructions=p.instructions, tools=tools_list,
                            messages=delta, checkpoint_id=checkpoint,
                            reasoning_effort=config.REASONING_EFFORT.get(role)):
                        kind = event.get("type")
                        if kind == "token" and event.get("content"):
                            streamed += event["content"]
                            yield "token", {"text": event["content"]}
                        elif kind == "thinking":
                            thinking += event.get("content") or ""
                        elif kind == "tool_call_required":
                            calls = event.get("tool_calls") or []
                            checkpoint = (event.get("configurable") or {}).get("checkpoint_id") or checkpoint
                        elif kind == "final_response":
                            final = event.get("message") or ""
                call = ModelCall(messages=delta, text=final if final is not None else streamed, thinking=thinking,
                                 tool_arguments=tuple(json.dumps(c.get("args") or {}, ensure_ascii=False)
                                                      for c in calls or ()))
                try:
                    usage = self.store.record_usage(session, call)
                except BudgetExceeded:
                    usage = session.journal()[-1].get("usage")
                if final is not None or not calls:
                    answer, flags = apply_guard(final if final is not None else streamed, digests)
                    session.append({"kind": "assistant", "text": answer})
                    yield "final", {"text": answer, "flags": flags, "usage": usage}
                    return
                awaiting_results = True
                yield "status", {"state": "tool", "label_ko": "캠퍼스 데이터 확인 중"}
                work = self._execute(session, tool_names, calls, round_no, authorization, digests, queue.put_nowait)
                results: list[str] = []
                async for item in self._with_events(work, queue):
                    if item[0] == "__result__":
                        results = item[1]
                    else:
                        yield item
                if round_no == config.MAX_ROUNDS - 2 and results:
                    results[-1] += BUDGET_NOTE
                delta = [{"role": "tool", "tool_call_id": c["tool_call_id"], "name": c["name"], "content": r}
                         for c, r in zip(calls, results)]
                awaiting_results = False
            yield "error", {"code": "round_limit", "message_ko": "도구 호출 한도에 도달해 답변을 마치지 못했습니다"}
        except asyncio.CancelledError:
            if awaiting_results:
                session.append({"kind": "cancel", "needs_roll": True})
            raise
        except TimelyError as exc:
            log.warning("timely failure: %s", exc)
            if awaiting_results or checkpoint:
                session.append({"kind": "error", "needs_roll": True})
            yield "error", {"code": "llm_upstream_unavailable", "message_ko": "AI 서비스 응답이 지연되고 있습니다. 잠시 후 다시 시도해 주세요",
                            "retry_after_s": 30}
        except BudgetExceeded:
            yield "error", {"code": "budget_exceeded", "message_ko": "오늘 사용할 수 있는 도우미 한도를 모두 사용했습니다"}
