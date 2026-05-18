"""App-wide constants used by routes and services."""

from __future__ import annotations


# Bumped when API surface changes; visible in /api/chat/status so you know the process reloaded.
APP_BUILD = "2026-04-03+multi-telegram-ollama"


# Shown when provider=cursor but no agent binary/bundle was resolved (before calling the proxy).
CURSOR_AGENT_UNAVAILABLE_MSG = (
    "Cursor Agent не найден на этом компьютере (ни в PATH, ни в настройке «Путь к Cursor Agent», "
    "ни после авто-поиска по типичным папкам). Без отдельного пакета Cursor Agent CLI чат через "
    "cursor-api-proxy работать не будет — редактор Cursor его не подставляет. "
    "Варианты: установить CLI по документации https://cursor.com/docs/cli/overview , "
    "либо указать каталог с agent.cmd + node.exe + index.js в Настройках → AI, "
    "либо переключить провайдера на Gemini или OpenRouter. Лог: data/cursor_proxy.log"
)
