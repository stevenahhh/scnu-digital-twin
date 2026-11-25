from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from simulation.main import app
from weather.api.app import create_app as create_weather_app


@pytest.fixture
def key_file(tmp_path, monkeypatch):
    monkeypatch.delenv("SCNU_AUTH_SECRET", raising=False)
    monkeypatch.delenv("SCNU_AUTH_TOKEN_TTL_S", raising=False)
    monkeypatch.delenv("SCNU_AUTH_GUEST_ENABLED", raising=False)
    path = tmp_path / "campus-auth.key"
    monkeypatch.setenv("SCNU_AUTH_SECRET_FILE", str(path))
    return path


def weather_token(account_id: str) -> str:
    with TestClient(create_weather_app()) as weather:
        response = weather.post("/auth/login", json={"id": account_id, "password": "12341234"})
    assert response.status_code == 200
    return response.json()["token"]


def test_simulation_writes_require_admin_token_from_weather_login(key_file) -> None:
    student = {"Authorization": f"Bearer {weather_token('20239901')}"}
    admin = {"Authorization": f"Bearer {weather_token('admin')}"}

    with TestClient(app) as simulation:
        anonymous = simulation.post("/api/simulation/pause")
        forbidden = simulation.post("/api/simulation/pause", headers=student)
        allowed = simulation.post("/api/simulation/start", headers=admin,
                                  json={"counts": {"car": 1, "person": 1, "scooter": 1}})
        reset = simulation.post("/api/simulation/reset", headers=admin)
        status = simulation.get("/api/simulation/status")

    assert key_file.exists()
    assert anonymous.status_code == 401
    assert anonymous.json() == {"detail": "로그인이 필요합니다"}
    assert anonymous.headers["www-authenticate"] == "Bearer"
    assert forbidden.status_code == 403
    assert forbidden.json() == {"detail": "관리자 권한이 필요합니다"}
    assert allowed.status_code == 200
    assert allowed.json()["status"] == "running"
    assert reset.json()["status"] == "stopped"
    assert status.status_code == 200


def test_simulation_websocket_needs_no_token(key_file) -> None:
    with TestClient(app) as simulation, simulation.websocket_connect("/ws/simulation") as websocket:
        assert websocket.receive_json()["type"] == "simulation_update"
