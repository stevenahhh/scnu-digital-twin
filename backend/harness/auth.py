from __future__ import annotations

from dataclasses import dataclass

from fastapi import HTTPException

from common.campus_auth import Account
from harness.sessions import InvalidClientId, owner_key


@dataclass(frozen=True)
class Owner:
    key: str
    role: str
    guest: bool


def owner_for(account: Account, client_id: str | None) -> Owner:
    try:
        key = owner_key(account, client_id)
    except InvalidClientId:
        raise HTTPException(400, detail={
            "code": "client_id_required",
            "message_ko": "게스트 세션에는 X-Assistant-Client 헤더가 필요합니다",
            "message_en": "Guest sessions need an X-Assistant-Client header",
        }) from None
    return Owner(key, account.role, account.guest)
