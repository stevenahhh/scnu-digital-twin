from __future__ import annotations

import asyncio
import json
import logging
import sys
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

_REPO_ROOT = str(Path(__file__).resolve().parents[2])
if _REPO_ROOT not in sys.path:  # Supports `uvicorn harness.main:app --app-dir backend` from the repository root
    sys.path.append(_REPO_ROOT)

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field

from common.campus_auth import Account, current_account
from harness import config, prefix
from harness.auth import Owner, owner_for
from harness.events import HEARTBEAT, sse
from harness.loop import Harness
from harness.mcp_client import TwinClient
from harness.sandbox import eval_status
from harness.sessions import ConversationLimit, NotFound, Session, SessionStore
from harness.timely import TimelyClient

log = logging.getLogger("harness")


def _error(status: int, code: str, message_ko: str, message_en: str, **extra: Any) -> HTTPException:
    return HTTPException(status, detail={"code": code, "message_ko": message_ko, "message_en": message_en, **extra})


def build_reference(ref_dir: Path) -> None:
    ref_dir.mkdir(parents=True, exist_ok=True)
    data = json.loads((Path(_REPO_ROOT) / "common" / "data" / "common_elemetns.json").read_text(encoding="utf-8"))
    rows = ["id\tname\ttype\tzone"]
    for element in data.get("elements", []):
        rows.append("\t".join(str(element.get(key) or "") for key in ("id", "name", "type", "zone")))
    (ref_dir / "elements.tsv").write_text("\n".join(rows) + "\n", encoding="utf-8")
    (ref_dir / "resources.md").write_text(
        "# Twin resources for eval (twin.get / twin.get_many)\n"
        "twin://elements, twin://elements/{id}, twin://zones\n"
        "twin://weather/current, twin://weather/full, twin://weather/timeline/{id}\n"
        "twin://microclimate/elements, twin://microclimate/elements/{id}/popup, twin://microclimate/zones, "
        "twin://microclimate/heatmap\n"
        "twin://simulation/restrictions, twin://traffic/parking\n"
        "Admin only: twin://simulation/status, statistics, timeline, events, agents/{id}, scenarios, "
        "restrictions/targets, network/quality; twin://energy/buildings\n"
        "Microclimate values (local_temp, tmrt, feels_like, utci, wbgt, risk_level) are model estimates (추정).\n",
        encoding="utf-8")


def default_harness() -> Harness:
    from twin_mcp.server import build_server

    store = SessionStore(config.HARNESS_DATA_DIR)
    ref_dir = config.HARNESS_DATA_DIR / "ref"
    build_reference(ref_dir)
    timely = TimelyClient.from_env() if config.TIMELY_API_KEY else None
    return Harness(store=store, twin=TwinClient(build_server()), timely=timely, ref_dir=ref_dir)


class MessageBody(BaseModel):
    text: str = Field(min_length=1)
    context: dict[str, Any] | None = None


class ConfirmBody(BaseModel):
    confirm_id: str
    decision: str = Field(pattern="^(approve|reject)$")


async def verify_prefixes(harness: Harness) -> None:
    tools = await harness.twin.list_tools()
    problems = [f"{role}: {problem}" for role in ("student", "admin")
                for problem in prefix.check_compatible(role, tools)]
    if problems:
        raise RuntimeError("frozen prefix does not match the twin MCP server:\n" + "\n".join(problems))


def create_app(harness_factory: Callable[[], Harness] = default_harness, *, check_prefix: bool = True) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        harness = harness_factory()
        await harness.twin.start()
        if check_prefix:
            await verify_prefixes(harness)
        app.state.harness = harness
        try:
            yield
        finally:
            for session in list(harness.kernels.values()):
                await harness.close_kernel(session)
            await harness.twin.close()
            if harness.timely is not None:
                await harness.timely.aclose()

    app = FastAPI(title="SCNU twin assistant harness", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware, allow_origin_regex=config.HARNESS_CORS_ORIGIN_REGEX, allow_credentials=False,
        allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "Accept", "X-Assistant-Client"])

    def owner(request: Request, account: Account = Depends(current_account)) -> Owner:
        return owner_for(account, request.headers.get("X-Assistant-Client"))

    def harness_of(request: Request) -> Harness:
        return request.app.state.harness

    def session_of(sid: str, request: Request, who: Owner = Depends(owner)) -> Session:
        try:
            return harness_of(request).store.get(who.key, sid)
        except NotFound:
            raise _error(404, "session_not_found", "대화를 찾을 수 없습니다", "Conversation not found") from None

    @app.get("/health")
    async def health(request: Request) -> dict:
        harness = harness_of(request)
        return {"status": "ok", "llm": "ready" if harness.timely else "key_missing", "eval": eval_status(),
                "model": config.HARNESS_MODEL, "twin": config.summary()["twin"]}

    @app.post("/chat/sessions", status_code=201)
    async def create_session(request: Request, who: Owner = Depends(owner)) -> dict:
        try:
            session = harness_of(request).store.create(who.key, who.role)
        except ConversationLimit:
            raise _error(429, "conversation_limit", "대화는 최대 5개까지 만들 수 있습니다",
                         "Too many conversations") from None
        return {"session_id": session.conversation_id, "role": session.role, "epoch": session.epoch,
                "limits": {"max_user_chars": config.MAX_USER_CHARS, "max_rounds": config.MAX_ROUNDS}}

    @app.get("/chat/sessions")
    async def list_sessions(request: Request, who: Owner = Depends(owner)) -> dict:
        return {"sessions": [{"session_id": s.conversation_id, "title": s.title, "updated_at": s.updated_at}
                             for s in harness_of(request).store.list(who.key)]}

    @app.get("/chat/sessions/{sid}/messages")
    async def history(session: Session = Depends(session_of)) -> dict:
        return {"messages": [{"role": e["kind"], "text": e.get("text", "")} for e in session.journal()
                             if e["kind"] in ("user", "assistant")]}

    @app.get("/chat/tools")
    async def tools(request: Request, who: Owner = Depends(owner)) -> dict:
        return {"role": who.role, "tools": [t["name"] for t in harness_of(request).load_prefix(who.role).tools]}

    @app.get("/chat/prompts")
    async def prompts(request: Request, who: Owner = Depends(owner)) -> dict:
        listed = await harness_of(request).twin.list_prompts()
        return {"prompts": [{"name": p.name, "title": p.title or p.name, "description": p.description or ""}
                            for p in listed if who.role == "admin" or not p.name.startswith("admin_")]}

    @app.post("/chat/sessions/{sid}/messages")
    async def post_message(body: MessageBody, request: Request, who: Owner = Depends(owner),
                           session: Session = Depends(session_of)) -> StreamingResponse:
        harness = harness_of(request)
        if harness.timely is None:
            raise _error(503, "llm_key_missing", "AI 서비스 키가 설정되지 않았습니다", "TIMELY_API_KEY is not set")
        if len(body.text) > config.MAX_USER_CHARS:
            raise _error(413, "message_too_long", "질문은 2,000자 이하로 입력해 주세요", "Message too long")
        if session.turn_lock.locked() or harness.owner_runs.get(who.key, 0) >= config.MAX_RUNS_PER_OWNER:
            raise _error(409, "run_in_progress", "이전 답변을 만드는 중입니다", "A run is already in progress")
        authorization = request.headers.get("Authorization")
        queue: asyncio.Queue[bytes | None] = asyncio.Queue()

        async def produce() -> None:
            harness.owner_runs[who.key] = harness.owner_runs.get(who.key, 0) + 1
            try:
                async with session.turn_lock:
                    async for event, data in harness.run_turn(session, text=body.text, context=body.context,
                                                              authorization=authorization):
                        await queue.put(sse(event, data))
            except asyncio.CancelledError:
                raise
            except Exception:
                log.exception("turn failed")
                await queue.put(sse("error", {"code": "internal", "message_ko": "답변을 만드는 중 문제가 발생했습니다"}))
            finally:
                harness.owner_runs[who.key] -= 1
                await queue.put(sse("end", {}))
                await queue.put(None)

        task = asyncio.create_task(produce())
        session.running_task = task

        async def stream() -> AsyncIterator[bytes]:
            try:
                while True:
                    try:
                        item = await asyncio.wait_for(queue.get(), config.HEARTBEAT_S)
                    except asyncio.TimeoutError:
                        yield HEARTBEAT
                        continue
                    if item is None:
                        return
                    yield item
            finally:
                if not task.done():
                    task.cancel()

        return StreamingResponse(stream(), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    @app.post("/chat/sessions/{sid}/cancel", status_code=202)
    async def cancel(session: Session = Depends(session_of)) -> dict:
        if session.running_task is not None and not session.running_task.done():
            session.running_task.cancel()
        return {"cancelled": True}

    @app.post("/chat/sessions/{sid}/confirm", status_code=204)
    async def confirm(body: ConfirmBody, request: Request, who: Owner = Depends(owner),
                      session: Session = Depends(session_of)) -> Response:
        if who.role != "admin":
            raise HTTPException(403, detail="관리자 권한이 필요합니다")
        if not harness_of(request).confirm(who.key, session.conversation_id, body.confirm_id, body.decision):
            raise _error(404, "confirm_not_found", "확인 요청이 만료되었습니다", "Confirmation not pending")
        return Response(status_code=204)

    @app.delete("/chat/sessions/{sid}", status_code=204)
    async def delete(request: Request, session: Session = Depends(session_of)) -> Response:
        harness = harness_of(request)
        if session.running_task is not None and not session.running_task.done():
            session.running_task.cancel()
        await harness.close_kernel(session)
        harness.store.delete(session)
        return Response(status_code=204)

    return app


app = create_app()
