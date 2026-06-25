def test_root_endpoint(client) -> None:
    response = client.get("/")

    assert response.status_code == 200
    payload = response.json()
    assert payload["message"] == "deep-space-voice service is ready"
    assert payload["dashboard"] == "/dashboard"
    assert payload["health"] == "/health"


def test_health_endpoint(client) -> None:
    response = client.get("/health")

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    assert payload["service"] == "deep-space-voice"
    assert "api" in payload["modules"]


def test_api_health_endpoint(client) -> None:
    response = client.get("/api/v1/health")

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    assert payload["environment"] == "development"
