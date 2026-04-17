from __future__ import annotations

import uuid

from fastapi import Request


async def add_request_id_middleware(request: Request, call_next):
    rid = (request.headers.get("x-request-id") or "").strip() or str(uuid.uuid4())
    request.state.request_id = rid
    response = await call_next(request)
    response.headers["X-Request-ID"] = rid
    return response


def rid(request: Request | None) -> str:
    if request is None:
        return "-"
    return getattr(request.state, "request_id", "-")

