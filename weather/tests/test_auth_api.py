from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from weather.api.app import create_app

LOGIN_FAILED = "아이디 또는 비밀번호가 올바르지 않습니다"


def scenario_payload() -> dict:
    return {"building_id": "D4", "name": "auth check", "weather_preset": "clear", "arrays": [{
        "id": "array-1", "roof_id": "D4-roof-west", "roof_zone_id": "D4-roof-west-main",
        "module_id": "module-default-441wp", "origin_x_m": 24.5, "origin_y_m": 63.0,
        "rows": 2, "columns": 2, "azimuth_deg": 180, "tilt_deg": 25, "orientation": "portrait",
        "module_width_m": 1.05, "module_length_m": 2.1, "module_efficiency_percent": 20,
        "module_nominal_power_wp": 441, "inter_panel_gap_m": 0.02,
    }]}


@pytest.fixture
def api(tmp_path, monkeypatch):
    monkeypatch.setenv("SCNU_AUTH_SECRET", "weather-auth-test-secret")
    monkeypatch.delenv("SCNU_AUTH_GUEST_ENABLED", raising=False)
    monkeypatch.delenv("SCNU_AUTH_TOKEN_TTL_S", raising=False)
    monkeypatch.setenv("WEATHER_ENERGY_DB", str(tmp_path / "auth.sqlite3"))
    with TestClient(create_app()) as client:
        yield client


def bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def login(api: TestClient, account_id: str) -> str:
    response = api.post("/auth/login", json={"id": account_id, "password": "12341234"})
    assert response.status_code == 200
    return response.json()["token"]


@pytest.mark.parametrize(("account_id", "role", "name"), [
    ("20239901", "student", "학생"),
    ("admin", "admin", "관리자"),
])
def test_seed_accounts_log_in(api, account_id, role, name) -> None:
    response = api.post("/auth/login", json={"id": account_id, "password": "12341234"})

    assert response.status_code == 200
    body = response.json()
    assert body["token_type"] == "bearer"
    assert body["expires_at"].endswith("Z")
    assert body["account"] == {"id": account_id, "name": name, "role": role, "guest": False}
    assert api.get("/auth/me", headers=bearer(body["token"])).json() == body["account"]


@pytest.mark.parametrize("credentials", [
    {"id": "admin", "password": "12341235"},
    {"id": "nobody99", "password": "12341234"},
])
def test_wrong_credentials_share_one_401(api, credentials) -> None:
    response = api.post("/auth/login", json=credentials)

    assert response.status_code == 401
    assert response.json() == {"detail": LOGIN_FAILED}


@pytest.mark.parametrize("password", ["1234123", "123412345", ""])
def test_password_must_be_exactly_eight_characters(api, password) -> None:
    assert api.post("/auth/login", json={"id": "admin", "password": password}).status_code == 422


@pytest.mark.parametrize("role", ["student", "admin"])
def test_guest_login_issues_guest_account(api, role) -> None:
    response = api.post("/auth/guest", json={"role": role})

    assert response.status_code == 200
    account = response.json()["account"]
    assert account == {"id": f"guest-{role}", "name": "게스트", "role": role, "guest": True}
    assert api.get("/auth/me", headers=bearer(response.json()["token"])).json() == account


@pytest.mark.parametrize("flag", ["0", "false"])
def test_guest_login_can_be_disabled(api, monkeypatch, flag) -> None:
    monkeypatch.setenv("SCNU_AUTH_GUEST_ENABLED", flag)

    response = api.post("/auth/guest", json={"role": "admin"})

    assert response.status_code == 403
    assert response.json() == {"detail": "게스트 로그인이 꺼져 있습니다"}


@pytest.mark.parametrize("headers", [{}, {"Authorization": "Bearer not-a-token"}])
def test_me_rejects_missing_or_invalid_token(api, headers) -> None:
    assert api.get("/auth/me", headers=headers).status_code == 401


def test_expired_token_is_rejected(api, monkeypatch) -> None:
    monkeypatch.setenv("SCNU_AUTH_TOKEN_TTL_S", "-1")
    token = login(api, "admin")

    assert api.get("/auth/me", headers=bearer(token)).status_code == 401
    assert api.post("/energy/scenarios", json=scenario_payload(), headers=bearer(token)).status_code == 401


def test_energy_writes_require_admin(api) -> None:
    anonymous = api.post("/energy/scenarios", json=scenario_payload())
    student = api.post("/energy/scenarios", json=scenario_payload(), headers=bearer(login(api, "20239901")))
    admin = api.post("/energy/scenarios", json=scenario_payload(), headers=bearer(login(api, "admin")))

    assert anonymous.status_code == 401
    assert anonymous.json() == {"detail": "로그인이 필요합니다"}
    assert anonymous.headers["www-authenticate"] == "Bearer"
    assert student.status_code == 403
    assert student.json() == {"detail": "관리자 권한이 필요합니다"}
    assert admin.status_code == 201
    assert api.get("/energy/buildings").status_code == 200


def test_preflight_allows_authorization_header(api) -> None:
    response = api.options("/energy/scenarios", headers={
        "Origin": "http://localhost:5173",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization,content-type",
    })

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"
    assert "authorization" in response.headers["access-control-allow-headers"].lower()
