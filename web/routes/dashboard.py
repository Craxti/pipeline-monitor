"""Dashboard HTML + core dashboard APIs (meta, trends, stream, analytics)."""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse, JSONResponse

from web.core.config import load_yaml_config
from web.core import runtime as rt
from web.services import (
    analytics_endpoints,
    build_analytics,
    correlation,
    dashboard_summary,
    instances_health_endpoint,
    meta_api,
    notifications_endpoints,
    pages,
    sources_endpoints,
    sse_endpoint,
    sse_hub,
    templates_boot,
    trends_uptime,
    trends_uptime_endpoints,
    events_endpoints,
    db_endpoints,
)
from web.services.build_filters import is_snapshot_build_enabled

from web.services import sqlite_imports as _db_opt

_SQLITE_AVAILABLE = bool(_db_opt.SQLITE_AVAILABLE)
db_stats = _db_opt.db_stats  # type: ignore[assignment]
_db_build_duration = _db_opt.build_duration_history
_db_flaky_analysis = _db_opt.flaky_analysis
_db_svc_uptime = _db_opt.service_uptime


router = APIRouter(tags=["dashboard"])

_templates = templates_boot.create_templates(base_dir=Path(__file__).resolve().parents[1])


@router.get("/", response_class=HTMLResponse)
async def dashboard(request: Request):
    """Render main dashboard page."""
    from web.services import ui_lang

    return await pages.index_page(
        request,
        templates=_templates,
        load_snapshot_async=rt.load_snapshot_async,
        load_yaml_config=load_yaml_config,
        ui_language=ui_lang.ui_lang_from_config(load_yaml_config),
    )


@router.get("/api/status", response_class=JSONResponse)
async def api_status():
    """Return high-level API status."""
    from web.services import status_endpoints
    from web.services.build_filters import inst_label_for_build_with_cfg

    return status_endpoints.api_status(
        load_snapshot=rt.load_snapshot,
        load_yaml_config=load_yaml_config,
        is_snapshot_build_enabled=is_snapshot_build_enabled,
        inst_label_for_build_with_cfg=inst_label_for_build_with_cfg,
    )


@router.get("/api/dashboard/summary", response_class=JSONResponse)
async def api_dashboard_summary():
    """Return dashboard summary payload."""
    return dashboard_summary.dashboard_summary_payload(
        load_yaml_config=load_yaml_config,
        load_snapshot=rt.load_snapshot,
        collect_state=rt.collect_state,
        instance_health=rt.get_instance_health(),
        data_revision=rt.revision_rt.revision,
    )


@router.get("/api/instances/health", response_class=JSONResponse)
async def api_instances_health():
    """Return last known instance health."""
    return instances_health_endpoint.instances_health_payload(
        collect_state=rt.collect_state,
        instances=rt.get_instance_health(),
    )


@router.get("/api/meta", response_class=JSONResponse)
async def api_meta():
    """Return meta payload for UI."""

    def _load_events(limit: int = 300):
        from web.services import event_feed_api

        return event_feed_api.load(limit=limit)

    def _correlation_last_hour():
        return correlation.correlation_last_hour(
            load_snapshot=rt.load_snapshot,
            load_events=_load_events,
            events_limit=500,
        )

    return await meta_api.meta_payload(
        load_yaml_config=load_yaml_config,
        load_snapshot_async=rt.load_snapshot_async,
        job_build_analytics=build_analytics.job_build_analytics,
        correlation_last_hour=_correlation_last_hour,
        collect_state=rt.collect_state,
        data_revision=rt.revision_rt.revision,
    )


@router.get("/api/stream/events")
async def sse_events(request: Request):
    """SSE stream of realtime events."""
    return sse_endpoint.sse_events_response(
        request,
        sse_hub_mod=sse_hub,
        queues=rt.sse_rt.queues,
        hello_event={"type": "hello", "revision": rt.revision_rt.revision},
        queue_maxsize=64,
        ping_timeout_seconds=25.0,
    )


@router.get("/api/trends", response_class=JSONResponse)
async def api_trends(days: int = 14):
    """Return trends payload."""

    def _mem_get(key: str):
        from web.services import mem_cache

        return mem_cache.mem_cache_get(rt.mem_cache_rt.store, key)

    def _mem_set(key: str, val):
        from web.services import mem_cache

        return mem_cache.mem_cache_set(
            rt.mem_cache_rt.store,
            key,
            val,
            ttl_seconds=rt.mem_cache_rt.ttl_seconds,
        )

    def _trends_compute(d: int):
        return trends_uptime.trends_compute(d, history_path=None)

    return trends_uptime_endpoints.api_trends(
        days=days,
        data_revision=rt.revision_rt.revision,
        mem_cache_get=_mem_get,
        mem_cache_set=_mem_set,
        trends_compute=_trends_compute,
    )


@router.get("/api/trends/history-summary", response_class=JSONResponse)
async def api_trends_history_summary(days: int = 30, source: str = "", instance: str = ""):
    """Return aggregated history KPIs for trends dashboard."""

    def _mem_get(key: str):
        from web.services import mem_cache

        return mem_cache.mem_cache_get(rt.mem_cache_rt.store, key)

    def _mem_set(key: str, val):
        from web.services import mem_cache

        return mem_cache.mem_cache_set(
            rt.mem_cache_rt.store,
            key,
            val,
            ttl_seconds=rt.mem_cache_rt.ttl_seconds,
        )

    cache_key = f"trends:hist:{days}:{source}:{instance}:{rt.revision_rt.revision}"
    cached = _mem_get(cache_key)
    if cached is not None:
        return JSONResponse(content=cached)

    from web.services import event_feed_api

    payload = trends_uptime.trends_history_summary(
        days,
        trends_compute=lambda d: trends_uptime.trends_compute(d, history_path=None),
        event_feed_load=lambda lim: event_feed_api.load(limit=lim),
        source_filter=source,
        instance_filter=instance,
    )
    _mem_set(cache_key, payload)
    return JSONResponse(content=payload)


@router.get("/api/uptime", response_class=JSONResponse)
async def api_uptime(days: int = 30):
    """Return uptime payload."""

    def _mem_get(key: str):
        from web.services import mem_cache

        return mem_cache.mem_cache_get(rt.mem_cache_rt.store, key)

    def _mem_set(key: str, val):
        from web.services import mem_cache

        return mem_cache.mem_cache_set(
            rt.mem_cache_rt.store,
            key,
            val,
            ttl_seconds=rt.mem_cache_rt.ttl_seconds,
        )

    def _uptime_compute(d: int):
        return trends_uptime.uptime_compute(
            d,
            history_path=None,
            sqlite_available=_SQLITE_AVAILABLE,
            db_svc_uptime=_db_svc_uptime if _SQLITE_AVAILABLE else None,
        )

    return trends_uptime_endpoints.api_uptime(
        days=days,
        data_revision=rt.revision_rt.revision,
        mem_cache_get=_mem_get,
        mem_cache_set=_mem_set,
        uptime_compute=_uptime_compute,
    )


@router.get("/api/db/stats", response_class=JSONResponse)
async def api_db_stats():
    """Return SQLite diagnostics (if available)."""
    return db_endpoints.api_db_stats(sqlite_available=_SQLITE_AVAILABLE, db_stats=db_stats)


@router.get("/api/sources", response_class=JSONResponse)
async def api_sources():
    """Return configured sources list."""
    return sources_endpoints.api_sources(
        load_snapshot=rt.load_snapshot,
        load_yaml_config=load_yaml_config,
        is_snapshot_build_enabled=is_snapshot_build_enabled,
    )


@router.get("/api/notifications", response_class=JSONResponse)
async def api_notifications(since_id: int = 0, limit: int = 50):
    """Return notifications since id."""
    return notifications_endpoints.api_notifications(
        notify_state=rt.notify_state,
        since_id=since_id,
        limit=limit,
    )


@router.get("/api/events/persisted", response_class=JSONResponse)
async def api_events_persisted(limit: int = 250):
    """Return persisted event feed entries."""

    def _event_feed_load(lim: int = 300):
        from web.services import event_feed_api

        return event_feed_api.load(limit=lim)

    return events_endpoints.api_events_persisted(
        event_feed_load=_event_feed_load,
        limit=limit,
    )


@router.get("/api/analytics/sparklines", response_class=JSONResponse)
async def api_analytics_sparklines(jobs: str = "", limit_per_job: int = 12):
    """Return per-job build duration sparklines."""
    return analytics_endpoints.api_analytics_sparklines(
        sqlite_available=_SQLITE_AVAILABLE,
        db_build_duration=_db_build_duration,
        jobs=jobs,
        limit_per_job=limit_per_job,
    )


@router.get("/api/analytics/flaky", response_class=JSONResponse)
async def api_analytics_flaky(threshold: float = 0.4, min_runs: int = 4, days: int = 30):
    """Return flaky analysis based on history."""
    return analytics_endpoints.api_analytics_flaky(
        sqlite_available=_SQLITE_AVAILABLE,
        db_flaky_analysis=_db_flaky_analysis,
        threshold=threshold,
        min_runs=min_runs,
        days=days,
    )
