from __future__ import annotations

import json
from pathlib import Path

from app.config.models import AppConfig, AppManifestConfig, PersonasConfig, ProvidersConfig, VoiceConfig


SCHEMA_MODELS = {
    "app-config.schema.json": AppConfig,
    "app-manifest.schema.json": AppManifestConfig,
    "personas.schema.json": PersonasConfig,
    "providers.schema.json": ProvidersConfig,
    "voice.schema.json": VoiceConfig,
}


def export_config_schemas(output_dir: Path) -> list[Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    written_files: list[Path] = []

    for file_name, model_type in SCHEMA_MODELS.items():
        target_path = output_dir / file_name
        schema = model_type.model_json_schema()
        with target_path.open("w", encoding="utf-8") as file:
            json.dump(schema, file, indent=2, ensure_ascii=True)
            file.write("\n")
        written_files.append(target_path)

    return written_files


if __name__ == "__main__":
    default_output_dir = Path(__file__).resolve().parents[2] / "config" / "schemas"
    exported_files = export_config_schemas(default_output_dir)
    for exported_file in exported_files:
        print(exported_file)
