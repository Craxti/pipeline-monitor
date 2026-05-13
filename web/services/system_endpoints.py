"""Endpoints for host system runtime metrics."""

from __future__ import annotations

import os
from datetime import datetime, timezone


def _running_in_container() -> bool:
    try:
        if os.path.exists("/.dockerenv"):
            return True
        cg = "/proc/1/cgroup"
        if os.path.exists(cg):
            txt = open(cg, "r", encoding="utf-8", errors="ignore").read().lower()
            if any(x in txt for x in ("docker", "kubepods", "containerd")):
                return True
    except Exception:
        return False
    return False


def _host_procfs_path() -> str:
    """
    Optional host /proc mount path for Docker deployments.
    Example compose mount: /proc:/hostfs/proc:ro
    """
    env = (os.environ.get("CIMON_PROCFS_PATH") or "").strip()
    cand = env or "/hostfs/proc"
    return cand if os.path.isdir(cand) else ""


def _disk_path_for_host() -> str:
    """Pick a meaningful root path for disk stats on the current OS."""
    if os.name == "nt":
        drv = (os.environ.get("SystemDrive") or "C:").strip()
        if not drv.endswith("\\"):
            drv = f"{drv}\\"
        return drv
    if os.path.isdir("/hostfs"):
        return "/hostfs"
    return "/"


def system_metrics_payload() -> dict:
    """Return host CPU/memory/disk/process metrics for live monitoring."""
    now_iso = datetime.now(tz=timezone.utc).isoformat()
    in_container = _running_in_container()
    try:
        import psutil  # type: ignore
    except Exception as exc:  # pragma: no cover - exercised when dependency missing
        return {
            "ok": False,
            "error": f"psutil unavailable: {exc}",
            "updated_at": now_iso,
            "cpu_percent": None,
            "memory": {},
            "disk": {},
            "process_count": 0,
            "top_processes": [],
            "scope": "container" if in_container else "host",
            "scope_note": "Container scope (psutil unavailable)." if in_container else "",
        }

    procfs = _host_procfs_path() if in_container else ""
    prev_procfs = getattr(psutil, "PROCFS_PATH", "")
    using_host_procfs = bool(procfs and hasattr(psutil, "PROCFS_PATH"))
    try:
        if using_host_procfs:
            psutil.PROCFS_PATH = procfs  # type: ignore[attr-defined]

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
        scope = "host" if (not in_container or using_host_procfs) else "container"
        scope_note = ""
        if in_container and not using_host_procfs:
            scope_note = "Container scope. Mount /proc:/hostfs/proc:ro to read host metrics."
        return {
            "ok": True,
            "updated_at": now_iso,
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
            "scope": scope,
            "scope_note": scope_note,
        }
    finally:
        if using_host_procfs:
            psutil.PROCFS_PATH = prev_procfs  # type: ignore[attr-defined]
