"""Centralized logging configuration for CLI and web runtime."""

from __future__ import annotations

import contextvars
import logging
import sys
from collections.abc import Iterable

_request_id_ctx: contextvars.ContextVar[str] = contextvars.ContextVar("request_id", default="-")


class _RequestIdFilter(logging.Filter):
    """Inject request id into every log record."""

    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = _request_id_ctx.get("-") or "-"
        return True


def bind_request_id(request_id: str):
    """Bind request id into context for downstream log records."""
    return _request_id_ctx.set((request_id or "-").strip() or "-")


def reset_request_id(token) -> None:
    """Reset request-id context token set by ``bind_request_id``."""
    if token is not None:
        _request_id_ctx.reset(token)


def clear_request_id() -> None:
    """Clear request-id context (used by non-web/background flows)."""
    _request_id_ctx.set("-")


def _set_logger_level(name: str, level: int) -> None:
    logging.getLogger(name).setLevel(level)


def _configure_external_loggers(level: int) -> None:
    _set_logger_level("uvicorn.error", level)
    _set_logger_level("uvicorn.access", max(level, logging.INFO))
    _set_logger_level("urllib3.connectionpool", max(level, logging.WARNING))


def configure_logging(level: str = "INFO", *, force: bool = True, extra_noisy_loggers: Iterable[str] = ()) -> None:
    """
    Configure global logging in a readable, single-line format.

    Example:
    ``12:55:31 | INFO     | web.routes.collect | rid=ab12 | Collect requested``
    """
    lvl = getattr(logging, str(level or "INFO").upper(), logging.INFO)
    handler = logging.StreamHandler(stream=sys.stdout)
    handler.addFilter(_RequestIdFilter())
    handler.setFormatter(
        logging.Formatter(
            fmt="%(asctime)s | %(levelname)-8s | %(name)s | rid=%(request_id)s | %(message)s",
            datefmt="%H:%M:%S",
        )
    )
    logging.basicConfig(level=lvl, handlers=[handler], force=force)
    _configure_external_loggers(lvl)
    for logger_name in extra_noisy_loggers:
        _set_logger_level(logger_name, lvl)
