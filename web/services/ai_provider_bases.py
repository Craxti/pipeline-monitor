from __future__ import annotations


PROVIDER_BASES: dict[str, str] = {
    "gemini": "https://generativelanguage.googleapis.com/v1beta/openai/",
    "openrouter": "https://openrouter.ai/api/v1",
    "cursor": "http://127.0.0.1:8765/v1",
    "ollama": "http://127.0.0.1:11434/v1",
}

