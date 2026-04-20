from __future__ import annotations

from web.services.chat_prompts import get_frontend_prompts_bundle, get_text, resolve_lang


def test_system_prompt_is_centralized() -> None:
    txt = get_text("system_base", lang="en")
    assert "CI/CD monitoring dashboard" in txt
    assert "Answer in the same language" in txt


def test_frontend_prompt_bundle_contains_ru_en_runbook_seed() -> None:
    p = get_frontend_prompts_bundle()
    assert "runbook_focus_tests" in p["ru"]
    assert "runbook_focus_tests" in p["en"]
    assert "Разобрать упавшие тесты" in p["ru"]["runbook_focus_tests"]
    assert "Analyze failed tests" in p["en"]["runbook_focus_tests"]


def test_lang_resolution_prefers_explicit_then_message_content() -> None:
    assert resolve_lang("ru", [{"content": "hello"}]) == "ru"
    assert resolve_lang("", [{"content": "привет"}]) == "ru"
    assert resolve_lang("", [{"content": "hello"}]) == "en"
