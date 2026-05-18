"""Bridge Python logging records into runtime collect logs buffer."""

from __future__ import annotations

import logging


def _to_level(level_no: int) -> str:
    if level_no >= logging.ERROR:
        return "error"
    if level_no >= logging.WARNING:
        return "warn"
    return "info"


def _is_service_logger(logger_name: str) -> bool:
    if logger_name.startswith(("web.", "clients.", "parsers.", "docker_monitor.", "notifications.")):
        return True
    return logger_name in {"web", "clients", "parsers", "docker_monitor", "notifications", "ci_monitor"}


class RuntimeCollectLogHandler(logging.Handler):
    """Write selected log records into collect runtime log stream."""

    def __init__(self, push_log):
        super().__init__(level=logging.INFO)
        self._push_log = push_log

    def emit(self, record: logging.LogRecord) -> None:
        try:
            logger_name = str(record.name or "service")
            if not _is_service_logger(logger_name) and record.levelno < logging.WARNING:
                return
            message = record.getMessage()
            if not message:
                return
            phase = logger_name.split(".", 1)[0] or "service"
            main = f"{logger_name}"
            self._push_log(phase, main, message, _to_level(record.levelno))
        except Exception:
            # Never let log-bridge failures affect the app flow.
            return


def install_runtime_collect_log_bridge(
    *, push_log, root_logger: logging.Logger | None = None
) -> RuntimeCollectLogHandler:
    """Attach runtime collect log handler to root logger."""
    logger = root_logger or logging.getLogger()
    handler = RuntimeCollectLogHandler(push_log)
    logger.addHandler(handler)
    return handler


def uninstall_runtime_collect_log_bridge(
    handler: RuntimeCollectLogHandler | None,
    *,
    root_logger: logging.Logger | None = None,
) -> None:
    """Detach runtime collect log handler from root logger."""
    if handler is None:
        return
    logger = root_logger or logging.getLogger()
    try:
        logger.removeHandler(handler)
    except Exception:
        return
