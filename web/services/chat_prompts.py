"""Centralized AI assistant prompts/messages (single source of truth)."""

from __future__ import annotations

from collections.abc import Mapping


CHAT_TEXTS: dict[str, dict[str, str]] = {
    "en": {
        "system_base": (
            "You are an AI assistant embedded in a CI/CD monitoring dashboard. "
            "You help engineers understand build failures, test results, service statuses, "
            "Docker container issues, and CI/CD logs.\n"
            "Rules:\n"
            "- Be concise and actionable.\n"
            "- When analyzing logs, highlight errors, root causes, and suggest fixes.\n"
            "- Use markdown formatting (bold, code blocks, lists) for readability.\n"
            "- Answer in the same language the user writes in.\n"
            "- When a Docker container is down or misbehaving, mention its name clearly so "
            "the dashboard can offer a restart button.\n"
            "- When a CI job needs re-running, mention the job name clearly so the dashboard "
            "can offer a re-run button.\n"
            "- If the user asks to collect/refresh data, say 'collect' or 'refresh data'.\n"
            "- The client sends the exact browser page and tab in «Current UI location». "
            "Treat that as where the user is now: on Settings, focus on app config fields and "
            "CI monitor settings; on a dashboard tab, focus on that tab (builds, tests, services, ...).\n"
        ),
        "runbook_focus_tests": (
            "Analyze failed tests: provide a diagnosis plan, top root-cause candidates, " "and the first checks to run."
        ),
        "empty_response_cursor": (
            "Cursor: empty response from proxy (check data/cursor_proxy.log). "
            "Verify CURSOR_API_KEY, Cursor Agent availability, and proxy logs."
        ),
        "empty_response_generic": "Model returned an empty response. Try again or switch model.",
        "cursor_upstream_unreachable": (
            "Cursor: failed to reach LLM upstream (often 127.0.0.1:8765 without running proxy). "
            "Cursor does not expose a public direct chat HTTP API for crsr token usage in third-party apps. "
            "Options: (1) install Cursor Agent CLI, run `npx cursor-api-proxy`, "
            "set CURSOR_API_KEY for the proxy process, "
            "keep base URL http://127.0.0.1:8765/v1; "
            "(2) switch provider to Gemini/OpenRouter with a single API key."
        ),
        "geo_block_suffix": (
            "Geo-block: provider still sees a blocked region. "
            "Try switching provider to Gemini or OpenRouter in Settings -> AI Assistant."
        ),
        "frontend_empty_cursor": (
            "No text in response. For Cursor provider, install Cursor Agent CLI or set a valid path in Settings -> AI."
        ),
    },
    "ru": {
        "system_base": (
            "Ты AI-ассистент внутри CI/CD дашборда. "
            "Помогаешь инженерам разбирать падения сборок, результаты тестов, статусы сервисов, "
            "проблемы Docker-контейнеров и CI/CD логи.\n"
            "Правила:\n"
            "- Пиши кратко и по делу.\n"
            "- При анализе логов выделяй ошибки, вероятные причины и конкретные шаги фикса.\n"
            "- Используй markdown (списки, code blocks, выделения), чтобы ответ читался легче.\n"
            "- Отвечай на языке пользователя.\n"
            "- Если контейнер down/нестабилен, явно упоминай имя контейнера для кнопки перезапуска.\n"
            "- Если джоб нужно перезапустить, явно указывай имя джоба для кнопки rerun.\n"
            "- Если пользователь просит обновить данные, явно скажи collect / refresh data.\n"
            "- Клиент передает точное место в UI через «Current UI location». "
            "На Settings фокусируйся на полях настроек монитора (SQLite/Settings), "
            "на вкладках дашборда — на соответствующей вкладке (builds/tests/services и т.д.).\n"
        ),
        "runbook_focus_tests": (
            "Разобрать упавшие тесты: дай план диагностики, выдели топ причин " "и что проверить в первую очередь."
        ),
        "empty_response_cursor": (
            "Cursor: пустой ответ от прокси (см. data/cursor_proxy.log). "
            "Проверьте CURSOR_API_KEY, Cursor Agent и лог прокси."
        ),
        "empty_response_generic": "Модель вернула пустой ответ. Попробуйте снова или смените модель.",
        "cursor_upstream_unreachable": (
            "Cursor: не удалось подключиться к upstream LLM (часто это 127.0.0.1:8765 без запущенного прокси). "
            "У Cursor нет публичного прямого chat HTTP API для токена crsr в сторонних приложениях. "
            "Варианты: (1) установить Cursor Agent CLI, запустить `npx cursor-api-proxy`, "
            "задать CURSOR_API_KEY в окружении процесса прокси, оставить base URL http://127.0.0.1:8765/v1; "
            "(2) переключиться на Gemini/OpenRouter с единым ключом."
        ),
        "geo_block_suffix": (
            "Geo-блокировка: провайдер все еще видит неподдерживаемый регион. "
            "Переключите провайдера на Gemini или OpenRouter в Настройки -> AI Assistant."
        ),
        "frontend_empty_cursor": (
            "Нет текста в ответе. Для Cursor провайдера установите Cursor Agent CLI "
            "или укажите корректный путь в Настройки -> AI."
        ),
    },
}


def resolve_lang(explicit_lang: str | None, user_messages: list[dict] | None = None) -> str:
    v = str(explicit_lang or "").strip().lower()
    if v in ("ru", "en"):
        return v
    for m in reversed(user_messages or []):
        txt = str((m or {}).get("content") or "")
        if any("\u0400" <= ch <= "\u04ff" for ch in txt):
            return "ru"
    return "en"


def get_text(key: str, *, lang: str = "en", default: str = "") -> str:
    lang_code = resolve_lang(lang)
    if key in CHAT_TEXTS.get(lang_code, {}):
        return CHAT_TEXTS[lang_code][key]
    if key in CHAT_TEXTS.get("en", {}):
        return CHAT_TEXTS["en"][key]
    return default


def get_frontend_prompts_bundle() -> Mapping[str, Mapping[str, str]]:
    """Safe subset for frontend usage (no provider internals)."""
    return {
        "en": {
            "runbook_focus_tests": CHAT_TEXTS["en"]["runbook_focus_tests"],
            "frontend_empty_cursor": CHAT_TEXTS["en"]["frontend_empty_cursor"],
        },
        "ru": {
            "runbook_focus_tests": CHAT_TEXTS["ru"]["runbook_focus_tests"],
            "frontend_empty_cursor": CHAT_TEXTS["ru"]["frontend_empty_cursor"],
        },
    }
