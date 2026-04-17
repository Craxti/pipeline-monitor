"""Runtime container for SSE subscriber queues."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field


@dataclass
class SSERuntime:
    """Holds active subscriber queues."""
    queues: set[asyncio.Queue] = field(default_factory=set)


async def broadcast_async(sse_hub_mod, rt: SSERuntime, payload: dict) -> None:
    """Broadcast payload to all SSE subscribers."""
    return await sse_hub_mod.broadcast_async(rt.queues, payload)
