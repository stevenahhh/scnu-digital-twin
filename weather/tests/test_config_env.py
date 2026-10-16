import importlib
import sys
from pathlib import Path

import pytest


@pytest.fixture
def config_module(monkeypatch, tmp_path):
    weather_dir = tmp_path / "weather"
    weather_dir.mkdir()
    config_file = weather_dir / "config.py"
    source = (Path(__file__).parents[1] / "config.py").read_text(encoding="utf-8")
    config_file.write_text(source, encoding="utf-8")
    monkeypatch.syspath_prepend(str(weather_dir))
    monkeypatch.delitem(sys.modules, "config", raising=False)
    import config

    yield importlib.reload(config)
    monkeypatch.delitem(sys.modules, "config", raising=False)


def test_dotenv_parsing_and_environment_precedence(config_module, tmp_path, monkeypatch):
    env_file = tmp_path / "weather" / ".env"
    env_file.write_text(
        "# ignored\n"
        "\n"
        "KMA_SERVICE_KEY='dotenv-key'\n"
        'AIRKOREA_SERVICE_KEY="air-key"\n'
        "WEATHER_CACHE_FILE=\n",
        encoding="utf-8",
    )
    env_file.replace(config_module.__file__.replace("config.py", ".env"))
    monkeypatch.setenv("KMA_SERVICE_KEY", "environment-key")
    monkeypatch.delenv("AIRKOREA_SERVICE_KEY", raising=False)
    monkeypatch.delenv("WEATHER_CACHE_FILE", raising=False)

    config = importlib.reload(config_module)

    assert config.KMA_SERVICE_KEY == "environment-key"
    assert config.AIRKOREA_SERVICE_KEY == "air-key"
    assert config.WEATHER_CACHE_FILE == ""


def test_relative_cache_file_resolves_against_the_repository_root(config_module, tmp_path, monkeypatch):
    monkeypatch.delenv("WEATHER_CACHE_FILE", raising=False)
    monkeypatch.chdir(tmp_path / "weather")
    config = importlib.reload(config_module)
    assert config.WEATHER_CACHE_FILE == str(tmp_path.resolve() / "weather" / "data" / "weather-cache.json")

    monkeypatch.setenv("WEATHER_CACHE_FILE", "custom/cache.json")
    config = importlib.reload(config_module)
    assert config.WEATHER_CACHE_FILE == str(tmp_path.resolve() / "custom" / "cache.json")

    absolute = tmp_path / "elsewhere" / "cache.json"
    monkeypatch.setenv("WEATHER_CACHE_FILE", str(absolute))
    config = importlib.reload(config_module)
    assert config.WEATHER_CACHE_FILE == str(absolute)


def test_defaults_fallbacks_and_numeric_parsing(config_module, monkeypatch):
    monkeypatch.delenv("KMA_SERVICE_KEY", raising=False)
    monkeypatch.delenv("AIRKOREA_SERVICE_KEY", raising=False)
    monkeypatch.setenv("WEATHER_UPSTREAM_CONNECT_TIMEOUT_S", "invalid")
    monkeypatch.setenv("WEATHER_UPSTREAM_READ_TIMEOUT_S", "4.5")
    monkeypatch.setenv("WEATHER_CACHE_TTL_KMA_CURRENT_S", "0")

    config = importlib.reload(config_module)

    assert config.KMA_SERVICE_KEY == ""
    assert config.AIRKOREA_SERVICE_KEY == ""
    assert config.WEATHER_UPSTREAM_CONNECT_TIMEOUT_S == 3
    assert config.WEATHER_UPSTREAM_READ_TIMEOUT_S == 4.5
    assert config.WEATHER_CACHE_TTL_KMA_CURRENT_S == 0
    assert config.KMA_BASE_URL == "https://apis.data.go.kr"


def test_airkorea_key_falls_back_only_when_unset(config_module, monkeypatch):
    monkeypatch.setenv("KMA_SERVICE_KEY", "shared-key")
    monkeypatch.setenv("AIRKOREA_SERVICE_KEY", "")

    config = importlib.reload(config_module)

    assert config.AIRKOREA_SERVICE_KEY == ""
