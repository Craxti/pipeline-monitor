"""Request-id middleware helpers."""

from __future__ import annotations

import logging
import time
import uuid

from fastapi import Request
from web.core.logging_setup import bind_request_id, reset_request_id

logger = logging.getLogger(__name__)


async def add_request_id_middleware(request: Request, call_next):
    """Attach/propagate `X-Request-ID` for per-request logging."""
    request_id = (request.headers.get("x-request-id") or "").strip() or str(uuid.uuid4())
    request.state.request_id = request_id
    token = bind_request_id(request_id)
    started = time.monotonic()
    try:
        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        elapsed_ms = int((time.monotonic() - started) * 1000)
        client = request.client.host if request.client else "-"
        logger.info(
            "HTTP %s %s -> %s (%d ms) client=%s",
            request.method,
            request.url.path,
            response.status_code,
            elapsed_ms,
            client,
        )
        return response
    finally:
        reset_request_id(token)


def rid(request: Request | None) -> str:
    """Return request id stored in middleware, or '-'."""
    if request is None:
        return "-"
    return getattr(request.state, "request_id", "-")
