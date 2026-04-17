"""UI language selection helpers."""

from __future__ import annotations

from web.schemas import MonitorGeneralConfig


def ui_lang_from_config(load_yaml_config) -> str:
    """Return UI language from config, defaulting to 'en'."""
    cfg = load_yaml_config()
    gen = MonitorGeneralConfig.model_validate(cfg.get("general") or {})
    lang = str(gen.ui_language).strip().lower()[:5]
    return lang if lang in ("ru", "en") else "en"
