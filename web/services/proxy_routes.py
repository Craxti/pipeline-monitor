from __future__ import annotations


def proxy_paths_for_app(app) -> list[str]:
    return sorted(
        {
            getattr(r, "path", "")
            for r in getattr(app, "routes", [])
            if getattr(r, "path", "") and "proxy" in getattr(r, "path", "")
        }
    )

