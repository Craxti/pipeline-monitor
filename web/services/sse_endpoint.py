from __future__ import annotations

from fastapi import Request
from fastapi.responses import StreamingResponse


def sse_events_response(
    request: Request,
    *,
    sse_hub_mod,
    queues,
    hello_event: dict,
    queue_maxsize: int = 64,
    ping_timeout_seconds: float = 25.0,
) -> StreamingResponse:
    return StreamingResponse(
        sse_hub_mod.events_generator(
            request,
            queues,
            hello_event=hello_event,
            queue_maxsize=queue_maxsize,
            ping_timeout_seconds=ping_timeout_seconds,
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )

