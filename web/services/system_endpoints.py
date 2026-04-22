"""Endpoints for host system runtime metrics."""

from __future__ import annotations

import os
from datetime import datetime, timezone


def _disk_path_for_host() -> str:
    """Pick a meaningful root path for disk stats on the current OS."""
    if os.name == "nt":
        drv = (os.environ.get("SystemDrive") or "C:").strip()
        if not drv.endswith("\\"):
            drv = f"{drv}\\"
        return drv
    return "/"


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
    disk = psutil.disk_usage(_disk_path_for_host())
    cpu_count = max(1, int(psutil.cpu_count() or 1))
    procs: list[dict] = []
    for p in psutil.process_iter(["pid", "name", "memory_percent", "cpu_percent"]):
        try:
            info = p.info
            cpu_raw = float(info.get("cpu_percent") or 0.0)
            # Process CPU from psutil may exceed 100 on multi-core hosts.
            # Normalize to the same 0..100 scale as overall CPU gauge.
            cpu_norm = max(0.0, min(100.0, cpu_raw / float(cpu_count)))
            procs.append(
                {
                    "pid": int(info.get("pid") or 0),
                    "name": str(info.get("name") or ""),
                    "cpu_percent": cpu_norm,
                    "cpu_percent_raw": cpu_raw,
                    "memory_percent": float(info.get("memory_percent") or 0.0),
                }
            )
        except Exception:
            continue
    procs.sort(key=lambda x: (x.get("cpu_percent", 0.0), x.get("memory_percent", 0.0)), reverse=True)
    return {
        "ok": True,
        "updated_at": datetime.now(tz=timezone.utc).isoformat(),
        # Small blocking sample produces stabler readings than interval=0.0.
        "cpu_percent": float(psutil.cpu_percent(interval=0.2)),
        "cpu_count": cpu_count,
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
        "process_count": int(len(psutil.pids())),
        "top_processes": procs[:12],
    }
