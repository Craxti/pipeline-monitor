"""Router inclusion helpers."""

from __future__ import annotations


def include_routers(app, routers: list) -> None:
    """Include a list of FastAPI routers into an app."""
    for r in routers:
        app.include_router(r)
