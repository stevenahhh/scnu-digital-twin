"""Campus model edit document: what the admin web editor moved, removed or added.

One JSON document over the published campus-v2.glb. Every object is addressed by
its GLB node name (``extras.editable.id``) or ``<instanced node>#<index>`` for a
tree instance; transforms are local to the object's parent node, in scene units.
Reads are public (every screen shows the edited campus); a write needs an admin
token (the app-wide ``require_admin_for_writes``). ``revision`` guards against
two editors overwriting each other.
"""
from __future__ import annotations

import json
import math
import os
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import AfterValidator, BaseModel, Field, field_validator, model_validator

from common.campus_auth import Account, current_account

router = APIRouter(prefix="/model", tags=["model"])

_REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
_LOCK = threading.Lock()
# Scene units are about 0.62 m; the campus model spans under 1 km, so 10 km catches broken values only.
_POSITION_LIMIT = 10_000.0
_SCALE_LIMIT = 100.0


def edits_path() -> Path:
    path = Path(os.environ.get("MODEL_EDITS_FILE", "weather/data/model-edits.json"))
    return path if path.is_absolute() else _REPOSITORY_ROOT / path


def _object_id(value: str) -> str:
    if not value or len(value) > 160 or any(ord(c) < 32 or ord(c) == 127 for c in value):
        raise ValueError("object id must be 1-160 printable characters")
    return value


ObjectId = Annotated[str, AfterValidator(_object_id)]


def _finite(values: list[float], limit: float) -> list[float]:
    if any(not math.isfinite(v) or abs(v) > limit for v in values):
        raise ValueError(f"values must be finite and within {limit}")
    return values


class Transform(BaseModel):
    position: list[float] = Field(min_length=3, max_length=3)
    quaternion: list[float] = Field(min_length=4, max_length=4)
    scale: list[float] = Field(min_length=3, max_length=3)

    @field_validator("position")
    @classmethod
    def _position(cls, value: list[float]) -> list[float]:
        return _finite(value, _POSITION_LIMIT)

    @field_validator("quaternion")
    @classmethod
    def _quaternion(cls, value: list[float]) -> list[float]:
        _finite(value, 1.0 + 1e-6)
        if abs(math.hypot(*value) - 1.0) > 1e-3:
            raise ValueError("quaternion must be unit length")
        return value

    @field_validator("scale")
    @classmethod
    def _scale(cls, value: list[float]) -> list[float]:
        _finite(value, _SCALE_LIMIT)
        if any(v <= 0 for v in value):
            raise ValueError("scale must be positive")
        return value


class AddedObject(Transform):
    id: ObjectId
    prototype: ObjectId


class EditDocument(BaseModel):
    revision: int = Field(ge=0)
    transforms: dict[ObjectId, Transform] = Field(default_factory=dict, max_length=50_000)
    removed: list[ObjectId] = Field(default_factory=list, max_length=50_000)
    added: list[AddedObject] = Field(default_factory=list, max_length=10_000)

    @model_validator(mode="after")
    def _distinct(self) -> "EditDocument":
        if len(set(self.removed)) != len(self.removed):
            raise ValueError("removed lists an object twice")
        added_ids = [item.id for item in self.added]
        if len(set(added_ids)) != len(added_ids):
            raise ValueError("two added objects share an id")
        if not all(item.startswith("ADD_") for item in added_ids):
            raise ValueError("added object ids start with ADD_")
        return self


def _empty() -> dict:
    return {"version": 1, "revision": 0, "updated_at": None, "updated_by": None,
            "transforms": {}, "removed": [], "added": []}


def _read() -> dict:
    try:
        return json.loads(edits_path().read_text("utf-8"))
    except FileNotFoundError:
        return _empty()


@router.get("/edits", summary="캠퍼스 모델 편집 내용")
def get_edits():
    with _LOCK:
        return _read()


@router.put("/edits", summary="캠퍼스 모델 편집 내용 저장(관리자)")
def put_edits(document: EditDocument, account: Account = Depends(current_account)):
    with _LOCK:
        current = _read()
        if document.revision != current["revision"]:
            raise HTTPException(status_code=409, detail={
                "message": "다른 관리자가 먼저 저장했습니다. 다시 불러온 뒤 편집하세요",
                "revision": current["revision"],
            })
        saved = {
            "version": 1,
            "revision": current["revision"] + 1,
            "updated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "updated_by": account.id,
            **document.model_dump(include={"transforms", "removed", "added"}),
        }
        path = edits_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        staging = path.with_suffix(".tmp")
        staging.write_text(json.dumps(saved, ensure_ascii=False, indent=1), "utf-8")
        staging.replace(path)
        return saved
