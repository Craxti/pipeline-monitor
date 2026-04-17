from __future__ import annotations

import asyncio
from dataclasses import dataclass


@dataclass
class MainLoopRuntime:
    loop: asyncio.AbstractEventLoop | None = None

