from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass

from fastapi import HTTPException

from common.campus_auth import Account

CLIENT_ID = re.compile(r"^[A-Za-z0-9_-]{22,64}$")


@dataclass(frozen=True)
class Owner:
    key: str
    role: str
    guest: bool

    @property
    def dir(self) -> str:
        return hashlib.sha256(self.key.encode()).hexdigest()[:16]


def owner_for(account: Account, client_id: str | None) -> Owner:
    if not account.guest:
        return Owner(f"acct:{account.id}", account.role, False)
    if not client_id or not CLIENT_ID.match(client_id):
        raise HTTPException(400, detail={
            "code": "client_id_required",
            "message_ko": "게스트 세션에는 X-Assistant-Client 헤더가 필요합니다",
            "message_en": "Guest sessions need an X-Assistant-Client header",
        })
    return Owner(f"guest:{account.role}:{client_id}", account.role, True)
