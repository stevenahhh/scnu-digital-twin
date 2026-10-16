from fastapi.testclient import TestClient

from simulation.main import app


def test_lan_origin_is_allowed_for_preflight():
    with TestClient(app) as client:
        response = client.options(
            "/health",
            headers={
                "Origin": "http://192.168.0.10:5173",
                "Access-Control-Request-Method": "GET",
            },
        )
    assert response.headers["access-control-allow-origin"] == "http://192.168.0.10:5173"


def test_unlisted_external_origin_is_not_allowed_for_preflight():
    with TestClient(app) as client:
        response = client.options(
            "/health",
            headers={
                "Origin": "https://example.com",
                "Access-Control-Request-Method": "GET",
            },
        )
    assert "access-control-allow-origin" not in response.headers
