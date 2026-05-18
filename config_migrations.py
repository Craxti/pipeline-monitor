"""Shared config.yaml migrations (CLI + web)."""


def migrate_telegram_notifications(cfg: dict) -> None:
    """Migrate legacy flat ``notifications.telegram`` to ``bots`` list."""
    n = cfg.setdefault("notifications", {})
    tg = n.get("telegram")
    if not tg:
        n["telegram"] = {"enabled": False, "bots": []}
        return
    if "bots" in tg:
        return
    legacy = tg
    bot_token = (legacy.get("bot_token") or "").strip()
    chat_id = (legacy.get("chat_id") or "").strip()
    enabled = bool(legacy.get("enabled", False))
    bots: list[dict] = []
    if bot_token or chat_id:
        bots.append(
            {
                "name": "Default",
                "enabled": enabled,
                "bot_token": legacy.get("bot_token", "") or "",
                "chat_id": legacy.get("chat_id", "") or "",
                "critical_only": legacy.get("critical_only", True),
                "api_base_url": (legacy.get("api_base_url") or "").strip(),
            }
        )
    n["telegram"] = {"enabled": enabled, "bots": bots}
