from __future__ import annotations


def log_boot(
    *,
    app_build: str,
    config_path: str,
    proxy_paths: list[str],
    logger,
) -> None:
    logger.info(
        "Web app build=%s config=%s proxy_routes=%s",
        app_build,
        config_path,
        proxy_paths or "none",
    )

