"""
Telegram notification module.

Uses the requests library directly (no heavy telegram-bot dependency at runtime)
so the tool works even if python-telegram-bot is not installed.
"""

from __future__ import annotations

import logging
from collections import defaultdict

import ipaddress
import socket
from urllib.parse import urlparse

import requests

from models.models import CISnapshot, BuildStatus

logger = logging.getLogger(__name__)

def _telegram_send_message_url(bot_token: str, api_base_url: str | None) -> str:
    base = (api_base_url or "").strip().rstrip("/")
    if not base:
        base = "https://api.telegram.org"
    else:
        # SSRF guard: only allow http(s) and block internal IP ranges.
        ok, why = _is_safe_outbound_url(base)
        if not ok:
            logger.warning("Telegram: blocked api_base_url (%s), falling back to default.", why)
            base = "https://api.telegram.org"
    return f"{base}/bot{bot_token}/sendMessage"


def _is_safe_outbound_url(url: str) -> tuple[bool, str]:
    try:
        u = urlparse(str(url).strip())
    except Exception:
        return False, "invalid url"
    if u.scheme not in ("http", "https"):
        return False, f"scheme '{u.scheme}' not allowed"
    if not u.hostname:
        return False, "missing hostname"
    if u.username or u.password:
        return False, "userinfo not allowed"
    host = u.hostname.strip().lower()
    if host == "localhost":
        return False, "localhost blocked"

    port = u.port or (443 if u.scheme == "https" else 80)
    try:
        infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except Exception:
        return False, "dns resolution failed"

    for info in infos:
        ip_str = info[4][0]
        try:
            ip = ipaddress.ip_address(ip_str)
        except ValueError:
            continue
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_multicast
            or ip.is_reserved
            or ip.is_unspecified
        ):
            return False, f"ip {ip} blocked"
    return True, "ok"


class TelegramNotifier:
    """Send alerts to a Telegram chat when critical jobs fail."""

    def __init__(
        self,
        bot_token: str,
        chat_id: str,
        critical_only: bool = True,
        api_base_url: str | None = None,
    ) -> None:
        self.bot_token = bot_token
        self.chat_id = str(chat_id)
        self.critical_only = critical_only
        self._url = _telegram_send_message_url(bot_token, api_base_url)

    # ── public ───────────────────────────────────────────────────────────────

    def notify(self, snapshot: CISnapshot) -> None:
        """Evaluate snapshot and send messages for failures."""
        if not self.bot_token or not self.chat_id:
            logger.warning("Telegram: bot_token or chat_id not set, skipping.")
            return

        messages = self._build_messages(snapshot)
        for msg in messages:
            self._send(msg)

    def send_text(self, text: str) -> bool:
        """Send an arbitrary text message. Returns True on success."""
        return self._send(text)

    # ── internals ────────────────────────────────────────────────────────────

    def _build_messages(self, snapshot: CISnapshot) -> list[str]:
        msgs: list[str] = []

        # ── failed builds ─────────────────────────────────────────────────
        failed_builds = [
            b for b in snapshot.builds
            if b.status == BuildStatus.FAILURE
            and (not self.critical_only or b.critical)
        ]
        if failed_builds:
            lines = ["🔴 *CI/CD Alert — Failed Builds*\n"]
            for b in failed_builds:
                crit = " ⚠ CRITICAL" if b.critical else ""
                link = f"[open]({b.url})" if b.url else ""
                lines.append(
                    f"• `{b.source}` / `{b.job_name}` #{b.build_number or '?'}"
                    f"{crit} {link}"
                )
            msgs.append("\n".join(lines))

        # ── failed services ────────────────────────────────────────────────
        down_svcs = [s for s in snapshot.services if s.status == "down"]
        if down_svcs:
            lines = ["🔴 *Service Down Alert*\n"]
            for s in down_svcs:
                lines.append(f"• `{s.name}` ({s.kind}) — {s.detail or 'no detail'}")
            msgs.append("\n".join(lines))

        return msgs

    def _send(self, text: str) -> bool:
        payload = {
            "chat_id": self.chat_id,
            "text": text,
            "parse_mode": "Markdown",
            "disable_web_page_preview": True,
        }
        try:
            resp = requests.post(self._url, json=payload, timeout=10)
            resp.raise_for_status()
            logger.info("Telegram: message sent to %s", self.chat_id)
            return True
        except requests.RequestException as exc:
            logger.error("Telegram: failed to send message: %s", exc)
            return False


def notify_telegram_from_config(snapshot: CISnapshot, tg_cfg: dict | None) -> None:
    """Send alerts using legacy flat config or multi-bot ``notifications.telegram.bots``."""
    if not tg_cfg or not tg_cfg.get("enabled"):
        return
    bots = tg_cfg.get("bots")
    if bots is None:
        notifier = TelegramNotifier(
            tg_cfg.get("bot_token", ""),
            tg_cfg.get("chat_id", ""),
            critical_only=tg_cfg.get("critical_only", True),
            api_base_url=(tg_cfg.get("api_base_url") or "").strip() or None,
        )
        notifier.notify(snapshot)
        return
    for b in bots:
        if not isinstance(b, dict) or not b.get("enabled", True):
            continue
        token = (b.get("bot_token") or "").strip()
        chat = (b.get("chat_id") or "").strip()
        if not token or not chat:
            continue
        notifier = TelegramNotifier(
            token,
            chat,
            critical_only=b.get("critical_only", True),
            api_base_url=(b.get("api_base_url") or "").strip() or None,
        )
        notifier.notify(snapshot)
