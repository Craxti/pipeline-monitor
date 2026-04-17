"""Request-id middleware helpers."""

from __future__ import annotations

import uuid

from fastapi import Request


async def add_request_id_middleware(request: Request, call_next):
    """Attach/propagate `X-Request-ID` for per-request logging."""
    request_id = (request.headers.get("x-request-id") or "").strip() or str(uuid.uuid4())
    request.state.request_id = request_id
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    return response


def rid(request: Request | None) -> str:
    """Return request id stored in middleware, or '-'."""
    if request is None:
        return "-"
    return getattr(request.state, "request_id", "-")
