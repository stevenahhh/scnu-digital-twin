"""Account login routes; token logic lives in common.campus_auth."""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from common.campus_auth import (GUEST_DISABLED, LOGIN_FAILED, Account, authenticate, current_account,
                                guest_account, guest_enabled, issue_token)

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginRequest(BaseModel):
    id: str
    password: str = Field(min_length=8, max_length=8)


class GuestRequest(BaseModel):
    role: Literal["student", "admin"]


@router.post("/login", summary="계정 로그인")
def login(request: LoginRequest):
    account = authenticate(request.id, request.password)
    if account is None:
        raise HTTPException(status_code=401, detail=LOGIN_FAILED)
    return issue_token(account)


@router.post("/guest", summary="게스트 로그인")
def guest_login(request: GuestRequest):
    if not guest_enabled():
        raise HTTPException(status_code=403, detail=GUEST_DISABLED)
    return issue_token(guest_account(request.role))


@router.get("/me", summary="현재 로그인 계정")
def me(account: Account = Depends(current_account)):
    return account.as_dict()
