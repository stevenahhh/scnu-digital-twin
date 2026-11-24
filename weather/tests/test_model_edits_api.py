from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from weather.api.app import create_app


@pytest.fixture
def api(tmp_path, monkeypatch):
    monkeypatch.setenv("SCNU_AUTH_SECRET", "model-edits-test-secret")
    monkeypatch.delenv("SCNU_AUTH_GUEST_ENABLED", raising=False)
    monkeypatch.setenv("WEATHER_ENERGY_DB", str(tmp_path / "edits.sqlite3"))
    monkeypatch.setenv("MODEL_EDITS_FILE", str(tmp_path / "model-edits.json"))
    with TestClient(create_app()) as client:
        yield client


def token(api: TestClient, account_id: str) -> dict:
    response = api.post("/auth/login", json={"id": account_id, "password": "12341234"})
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['token']}"}


def document(**overrides) -> dict:
    body = {
        "revision": 0,
        "transforms": {"OC0101": {"position": [1.5, 2, -3], "quaternion": [0, 0.7071, 0, 0.7071], "scale": [1, 2, 1]}},
        "removed": ["SD-B1-S2"],
        "added": [{"id": "ADD_1", "prototype": "Trees_ginkgo#3", "position": [10, 0, 10], "quaternion": [0, 0, 0, 1], "scale": [1, 1, 1]}],
    }
    body.update(overrides)
    return body


def test_empty_document_before_any_save(api) -> None:
    response = api.get("/model/edits")

    assert response.status_code == 200
    assert response.json() == {"version": 1, "revision": 0, "updated_at": None, "updated_by": None,
                               "transforms": {}, "removed": [], "added": []}


def test_admin_saves_and_everyone_reads_back(api, tmp_path) -> None:
    saved = api.put("/model/edits", json=document(), headers=token(api, "admin"))

    assert saved.status_code == 200
    body = saved.json()
    assert body["revision"] == 1
    assert body["updated_by"] == "admin"
    assert body["updated_at"].endswith("Z")
    assert body["transforms"]["OC0101"]["scale"] == [1, 2, 1]
    assert body["removed"] == ["SD-B1-S2"]
    assert body["added"][0]["prototype"] == "Trees_ginkgo#3"
    assert api.get("/model/edits").json() == body
    assert json.loads((tmp_path / "model-edits.json").read_text("utf-8")) == body


def test_writes_need_an_admin(api) -> None:
    assert api.put("/model/edits", json=document()).status_code == 401
    assert api.put("/model/edits", json=document(), headers=token(api, "20239901")).status_code == 403
    assert api.get("/model/edits").json()["revision"] == 0


def test_stale_revision_is_a_conflict(api) -> None:
    admin = token(api, "admin")
    assert api.put("/model/edits", json=document(), headers=admin).status_code == 200

    stale = api.put("/model/edits", json=document(removed=[]), headers=admin)

    assert stale.status_code == 409
    assert stale.json()["detail"]["revision"] == 1
    assert api.get("/model/edits").json()["removed"] == ["SD-B1-S2"]


@pytest.mark.parametrize("bad", [
    {"transforms": {"OC0101": {"position": [1, 2], "quaternion": [0, 0, 0, 1], "scale": [1, 1, 1]}}},
    {"transforms": {"OC0101": {"position": [1, 2, 3], "quaternion": [0, 0, 0, 1], "scale": [0, 1, 1]}}},
    {"transforms": {"OC0101": {"position": [1e9, 2, 3], "quaternion": [0, 0, 0, 1], "scale": [1, 1, 1]}}},
    {"transforms": {"bad\nid": {"position": [1, 2, 3], "quaternion": [0, 0, 0, 1], "scale": [1, 1, 1]}}},
    {"removed": ["OC0101", "OC0101"]},
    {"added": [{"id": "OC0101", "prototype": "OC0102", "position": [0, 0, 0], "quaternion": [0, 0, 0, 1], "scale": [1, 1, 1]}]},
])
def test_malformed_documents_are_rejected(api, bad) -> None:
    response = api.put("/model/edits", json=document(**bad), headers=token(api, "admin"))

    assert response.status_code == 422
    assert api.get("/model/edits").json()["revision"] == 0
