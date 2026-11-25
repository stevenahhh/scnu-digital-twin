from __future__ import annotations

from typing import Final, TypedDict, Unpack

from mcp import MCPError
from mcp.server.auth.middleware.bearer_auth import BearerAuthBackend
from mcp.server.auth.provider import AccessToken, TokenVerifier
from mcp.server.context import CallNext, HandlerResult, ServerRequestContext
from mcp.server.mcpserver import Context, MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.server.streamable_http import EventStore
from mcp.server.transport_security import TransportSecuritySettings
from starlette.applications import Starlette
from starlette.middleware.authentication import AuthenticationMiddleware

from common.campus_auth import Account, verify_token

PUBLIC_META: Final = {"scnu/roles": ["student", "admin"], "scnu/write": False}
ADMIN_META: Final = {"scnu/roles": ["admin"], "scnu/write": False}
WRITE_META: Final = {"scnu/roles": ["admin"], "scnu/write": True}
PUBLIC_SIMULATION: Final = "twin://simulation/restrictions"


def authorization(ctx: Context) -> str:
    headers = ctx.headers or {}
    value = headers.get("authorization") or (ctx.request_context.meta or {}).get("scnu/authorization", "")
    return value if isinstance(value, str) else ""


def caller(ctx: Context) -> Account | None:
    scheme, _, token = authorization(ctx).partition(" ")
    return verify_token(token.strip()) if scheme.lower() == "bearer" and token.strip() else None


def require_admin(ctx: Context) -> str:
    account = caller(ctx)
    if account is None or account.role != "admin":
        raise ToolError("관리자 권한이 필요합니다")
    return authorization(ctx)


class CampusTokenVerifier(TokenVerifier):
    async def verify_token(self, token: str) -> AccessToken | None:
        account = verify_token(token)
        if account is None:
            return None
        return AccessToken(token=token, client_id=account.id, subject=account.id, scopes=[account.role])


class HTTPOptions(TypedDict, total=False):
    streamable_http_path: str
    json_response: bool
    stateless_http: bool
    event_store: EventStore | None
    retry_interval: int | None
    max_request_body_size: int
    session_idle_timeout: float | None
    max_sessions: int | None
    transport_security: TransportSecuritySettings | None
    host: str


class TwinMCPServer(MCPServer):
    def streamable_http_app(self, **options: Unpack[HTTPOptions]) -> Starlette:
        app = super().streamable_http_app(**options)
        # Authentication is optional for public reads; item-level gates enforce admin access.
        app.add_middleware(AuthenticationMiddleware, backend=BearerAuthBackend(CampusTokenVerifier()))
        return app


async def resource_authorization(ctx: ServerRequestContext, call_next: CallNext) -> HandlerResult:
    params = ctx.params or {}
    uri = str(params.get("uri", ""))
    admin_resource = ctx.method == "resources/read" and (
        uri.startswith("twin://energy/") or
        (uri.startswith("twin://simulation/") and uri != PUBLIC_SIMULATION)
    )
    admin_prompt = ctx.method == "prompts/get" and str(params.get("name", "")).startswith("admin_")
    if admin_resource or admin_prompt:
        context = Context(request_context=ctx)
        scheme, _, token = authorization(context).partition(" ")
        access = await CampusTokenVerifier().verify_token(token.strip()) if scheme.lower() == "bearer" and token.strip() else None
        if access is None or "admin" not in access.scopes:
            raise MCPError(code=-32001, message="관리자 권한이 필요합니다")
    return await call_next(ctx)
