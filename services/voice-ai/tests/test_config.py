import json
import shutil
from pathlib import Path

import pytest

from app.config.loader import AppContext, ConfigStore, ConfigValidationError, build_app_context
from app.config.models import PersonaConfig
from app.config.schema_export import export_config_schemas


def clone_default_config_tree(tmp_path: Path) -> Path:
    source_dir = Path(__file__).resolve().parents[1] / "config" / "defaults"
    target_dir = tmp_path / "defaults"
    shutil.copytree(source_dir, target_dir)
    return target_dir / "app.json"


def test_default_config_loads(app_context: AppContext) -> None:
    assert app_context.config.service.name == "deep-space-voice"
    assert app_context.config.providers.stt.default_engine == "faster-whisper"
    assert app_context.config.providers.llm.fallback_provider == ""
    assert app_context.config.personas.default_persona_id == "eternity-infinity"
    assert app_context.config.personas.personas[0].style.tone == "cosmic"
    assert app_context.config.personas.personas[0].tools.mode == "future"
    assert app_context.config.voice.wake_word.phrase == "eternity"
    assert "dashboard" in app_context.config.features.prepared_modules


def test_settings_expose_runtime_defaults(app_context: AppContext) -> None:
    assert app_context.settings.environment == "development"
    assert app_context.settings.port == 8000


def test_presets_round_trip_without_code_changes(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    manifest_path = clone_default_config_tree(tmp_path)
    monkeypatch.setenv("DEEP_SPACE_VOICE_CONFIG_FILE", str(manifest_path))

    context = build_app_context()
    store = context.store

    providers = store.load_providers()
    providers.llm.fallback_provider = "openai_cloud"
    store.save_providers(providers)

    personas = store.load_personas()
    personas.personas.append(
        PersonaConfig(
            id="science-officer",
            name="Science Officer",
            description="Persona de test ajoutee via preset JSON.",
            tags=["science", "analysis"],
            preferred_language="en",
            improvisation=0.4,
            prompts={
                "system": "You are a concise science officer.",
                "role": "Summarize anomalies and sensor data.",
                "context": "Used for tests only.",
            },
            style={
                "tone": "analytic",
                "archetype": "science station lead",
                "cadence": "concise and evidence-first",
            },
            voice={
                "engine": "piper",
                "voice_id": "",
                "style": "measured",
                "language": "en",
                "playback_mode": "batch",
                "speaking_rate": 1.05,
                "pitch": 0.1,
                "expressive_presets": ["measured"],
            },
            memory={
                "scope": "shared",
                "retention_mode": "summary_only",
                "inject_relevant_memories": True,
            },
            tools={
                "mode": "future",
                "allowed_tools": ["analysis.scan"],
            },
        )
    )
    store.save_personas(personas)

    voice = store.load_voice()
    voice.wake_word.phrase = "infinity"
    voice.modes.default_mode = "voice_activity"
    store.save_voice(voice)

    reloaded = ConfigStore.from_manifest_path(manifest_path).load_app_config()
    assert reloaded.providers.llm.fallback_provider == "openai_cloud"
    assert reloaded.voice.wake_word.phrase == "infinity"
    assert reloaded.voice.modes.default_mode == "voice_activity"
    science_officer = next(persona for persona in reloaded.personas.personas if persona.id == "science-officer")
    assert science_officer.style.tone == "analytic"
    assert science_officer.memory.scope == "shared"
    assert science_officer.tools.allowed_tools == ["analysis.scan"]


def test_invalid_provider_reference_returns_clear_error(tmp_path: Path) -> None:
    manifest_path = clone_default_config_tree(tmp_path)
    providers_path = manifest_path.parent / "providers.json"

    with providers_path.open("r", encoding="utf-8") as file:
        providers = json.load(file)

    providers["llm"]["fallback_provider"] = "missing-provider"

    with providers_path.open("w", encoding="utf-8") as file:
        json.dump(providers, file, indent=2)
        file.write("\n")

    with pytest.raises(ConfigValidationError) as exc_info:
        ConfigStore.from_manifest_path(manifest_path).load_app_config()

    message = str(exc_info.value)
    assert "Invalid providers preset" in message
    assert "fallback_provider" in message
    assert "missing-provider" not in message or "reference one of" in message


def test_invalid_cross_file_reference_returns_clear_error(tmp_path: Path) -> None:
    manifest_path = clone_default_config_tree(tmp_path)
    personas_path = manifest_path.parent / "personas.json"

    with personas_path.open("r", encoding="utf-8") as file:
        personas = json.load(file)

    personas["personas"][0]["voice"]["engine"] = "missing-tts"

    with personas_path.open("w", encoding="utf-8") as file:
        json.dump(personas, file, indent=2)
        file.write("\n")

    with pytest.raises(ConfigValidationError) as exc_info:
        ConfigStore.from_manifest_path(manifest_path).load_app_config()

    message = str(exc_info.value)
    assert "Invalid application configuration" in message
    assert "missing-tts" in message


def test_schema_export_writes_expected_files(tmp_path: Path) -> None:
    written_files = export_config_schemas(tmp_path)
    names = {file_path.name for file_path in written_files}

    assert "app-manifest.schema.json" in names
    assert "providers.schema.json" in names
    assert "personas.schema.json" in names
    assert "voice.schema.json" in names
