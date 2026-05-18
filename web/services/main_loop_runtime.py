"""Runtime container for main asyncio loop reference."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass


@dataclass
class MainLoopRuntime:
    """Holds reference to the main event loop (set at startup)."""

    loop: asyncio.AbstractEventLoop | None = None
