import sys
from shutil import copytree
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app.config.loader import build_app_context
from app.main import create_app


@pytest.fixture()
def config_root(tmp_path: Path) -> Path:
    source_root = Path(__file__).resolve().parents[1] / "config" / "defaults"
    target_root = tmp_path / "config" / "defaults"
    copytree(source_root, target_root)
    return target_root


@pytest.fixture()
def client(monkeypatch: pytest.MonkeyPatch, config_root: Path) -> TestClient:
    config_path = config_root / "app.json"
    monkeypatch.setenv("DEEP_SPACE_VOICE_CONFIG_FILE", str(config_path))
    app = create_app()
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture()
def app_context(monkeypatch: pytest.MonkeyPatch, config_root: Path):
    config_path = config_root / "app.json"
    monkeypatch.setenv("DEEP_SPACE_VOICE_CONFIG_FILE", str(config_path))
    return build_app_context()
