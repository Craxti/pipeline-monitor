"""Static files mounting helper."""

from __future__ import annotations

from pathlib import Path

from starlette.staticfiles import StaticFiles


def mount_static_if_present(*, app, base_dir: Path) -> None:
    """Mount `/static` if `<base_dir>/static` exists."""
    static_dir = base_dir / "static"
    if static_dir.is_dir():
        app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")
