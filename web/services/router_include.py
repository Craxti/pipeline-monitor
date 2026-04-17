from __future__ import annotations


def include_routers(app, routers: list) -> None:
    for r in routers:
        app.include_router(r)

