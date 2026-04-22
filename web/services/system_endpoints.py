"""Endpoints for host system runtime metrics."""

from __future__ import annotations

from datetime import datetime, timezone


def system_metrics_payload() -> dict:
    """Return host CPU/memory/disk/process metrics for live monitoring."""
    try:
        import psutil  # type: ignore
    except Exception as exc:  # pragma: no cover - exercised when dependency missing
        return {
            "ok": False,
            "error": f"psutil unavailable: {exc}",
            "updated_at": datetime.now(tz=timezone.utc).isoformat(),
            "cpu_percent": None,
            "memory": {},
            "disk": {},
            "process_count": 0,
            "top_processes": [],
        }

    vm = psutil.virtual_memory()
    disk = psutil.disk_usage("/")
    procs: list[dict] = []
    for p in psutil.process_iter(["pid", "name", "memory_percent", "cpu_percent"]):
        try:
            info = p.info
            procs.append(
                {
                    "pid": int(info.get("pid") or 0),
                    "name": str(info.get("name") or ""),
                    "cpu_percent": float(info.get("cpu_percent") or 0.0),
                    "memory_percent": float(info.get("memory_percent") or 0.0),
                }
            )
        except Exception:
            continue
    procs.sort(key=lambda x: (x.get("cpu_percent", 0.0), x.get("memory_percent", 0.0)), reverse=True)
    return {
        "ok": True,
        "updated_at": datetime.now(tz=timezone.utc).isoformat(),
        "cpu_percent": float(psutil.cpu_percent(interval=0.0)),
        "memory": {
            "total": int(vm.total),
            "used": int(vm.used),
            "available": int(vm.available),
            "percent": float(vm.percent),
        },
        "disk": {
            "total": int(disk.total),
            "used": int(disk.used),
            "free": int(disk.free),
            "percent": float(disk.percent),
        },
        "process_count": int(len(procs)),
        "top_processes": procs[:12],
    }

