"""In-memory SSE hub utilities (broadcast + per-client generator)."""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncGenerator

from fastapi import Request


async def broadcast_async(queues: set[asyncio.Queue], payload: dict) -> None:
    """Best-effort broadcast to all client queues (drops oldest on full)."""
    for q in list(queues):
        try:
            q.put_nowait(payload)
        except asyncio.QueueFull:
            try:
                q.get_nowait()
            except Exception:
                pass
            try:
                q.put_nowait(payload)
            except Exception:
                pass


def events_generator(
    request: Request,
    queues: set[asyncio.Queue],
    *,
    hello_event: dict,
    queue_maxsize: int = 64,
    ping_timeout_seconds: float = 25.0,
) -> AsyncGenerator[str, None]:
    """Create an SSE event generator tied to the request lifetime."""

    async def _gen() -> AsyncGenerator[str, None]:
        q: asyncio.Queue = asyncio.Queue(maxsize=queue_maxsize)
        queues.add(q)
        try:
            yield f"data: {json.dumps(hello_event)}\n\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    ev = await asyncio.wait_for(q.get(), timeout=ping_timeout_seconds)
                    yield f"data: {json.dumps(ev)}\n\n"
                except asyncio.TimeoutError:
                    yield ": ping\n\n"
        finally:
            queues.discard(q)

    return _gen()
