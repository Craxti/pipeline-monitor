from __future__ import annotations

import asyncio
from dataclasses import dataclass, field


@dataclass
class SSERuntime:
    queues: set[asyncio.Queue] = field(default_factory=set)


async def broadcast_async(sse_hub_mod, rt: SSERuntime, payload: dict) -> None:
    return await sse_hub_mod.broadcast_async(rt.queues, payload)

