"""Embedded cursor-api-proxy management (Node / npx).

Extracted from ``web.app`` to keep the main module smaller.
"""

from __future__ import annotations

import logging
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path
from urllib.parse import urlparse

import httpx

from web.core.config import config_yaml_path
from web.core.paths import REPO_ROOT

logger = logging.getLogger(__name__)

_cursor_proxy_lock = __import__("threading").Lock()
_cursor_proxy_proc: subprocess.Popen | None = None

# Cached: (config_mtime, resolved_agent_path)
_cursor_agent_resolve_cache: tuple[float, str | None] | None = None


def cursor_proxy_autostart_enabled(cfg: dict) -> bool:
    """Return whether proxy autostart is enabled.

    If False, the app does not spawn `npx cursor-api-proxy` (user runs it manually).
    Default: True.
    """
    ai = cfg.get("openai") or {}
    return ai.get("cursor_proxy_autostart", True) is not False


def cursor_proxy_should_run(cfg: dict) -> bool:
    """Return True when provider is cursor and embedded proxy should be managed."""
    ai = cfg.get("openai") or {}
    if ai.get("provider") != "cursor":
        return False
    if not cursor_proxy_autostart_enabled(cfg):
        return False
    key = (ai.get("api_key") or "").strip()
    if not key or key.lower() == "unused":
        return False
    return True


def _cursor_listen_host_port(ai: dict) -> tuple[str, int]:
    """Host/port for CURSOR_BRIDGE_* from base_url (default 127.0.0.1:8765)."""
    base = (ai.get("base_url") or "").strip()
    if not base:
        return "127.0.0.1", 8765
    u = urlparse(base)
    host = u.hostname or "127.0.0.1"
    port = u.port if u.port is not None else 8765
    return host, port


def _cursor_health_url(host: str, port: int) -> str:
    h = "127.0.0.1" if host in ("0.0.0.0", "::", "") else host
    return f"http://{h}:{port}/health"


def _stop_cursor_proxy_unlocked() -> None:
    """Terminate embedded cursor-api-proxy (kill process tree on Windows)."""
    global _cursor_proxy_proc
    if _cursor_proxy_proc is None:
        return
    pid = _cursor_proxy_proc.pid
    proc = _cursor_proxy_proc
    _cursor_proxy_proc = None
    try:
        if sys.platform == "win32":
            cr = subprocess.CREATE_NO_WINDOW if hasattr(subprocess, "CREATE_NO_WINDOW") else 0
            subprocess.run(
                ["taskkill", "/F", "/T", "/PID", str(pid)],
                capture_output=True,
                timeout=20,
                creationflags=cr,
            )
        else:
            proc.terminate()
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()
    except Exception as exc:
        logger.warning("cursor proxy stop: %s", exc)
        try:
            proc.kill()
        except Exception:
            pass


def cursor_proxy_running() -> bool:
    """Return True if embedded proxy process is alive."""
    return _cursor_proxy_proc is not None and _cursor_proxy_proc.poll() is None


def _find_npx_executable() -> str | None:
    """npx on PATH, or common Windows install paths (service may lack user PATH)."""
    w = shutil.which("npx") or shutil.which("npx.cmd")
    if w:
        return w
    if sys.platform == "win32":
        pf = os.environ.get("ProgramFiles", r"C:\Program Files")
        pf86 = os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")
        la = os.environ.get("LocalAppData", "") or ""
        for p in (
            Path(pf) / "nodejs" / "npx.cmd",
            Path(pf86) / "nodejs" / "npx.cmd",
            Path(la) / "Programs" / "nodejs" / "npx.cmd",
        ):
            if p.is_file():
                return str(p)
    return None


def _nodejs_install_dirs() -> list[Path]:
    if sys.platform != "win32":
        return []
    out: list[Path] = []
    for base in (
        Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "nodejs",
        Path(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")) / "nodejs",
        Path(os.environ.get("LocalAppData", "")) / "Programs" / "nodejs",
    ):
        if (base / "node.exe").is_file():
            out.append(base.resolve())
    return out


def _prepend_nodejs_to_env(env: dict[str, str], npx_executable: str) -> None:
    dirs: list[str] = []
    npx_p = Path(npx_executable).resolve()
    if npx_p.parent.is_dir() and (npx_p.parent / "node.exe").is_file():
        dirs.append(str(npx_p.parent))
    node = shutil.which("node") or (shutil.which("node.exe") if sys.platform == "win32" else None)
    if node:
        dirs.append(str(Path(node).resolve().parent))
    for d in _nodejs_install_dirs():
        s = str(d)
        if s not in dirs:
            dirs.append(s)
    seen: set[str] = set()
    ordered: list[str] = []
    for d in dirs:
        if d and d not in seen:
            seen.add(d)
            ordered.append(d)
    if not ordered:
        return
    sep = ";" if sys.platform == "win32" else ":"
    env["PATH"] = sep.join(ordered) + sep + env.get("PATH", "")


_CURSOR_AGENT_WALK_SKIP_DIRS = frozenset(
    {
        "extensions",
        "CachedData",
        "CachedExtensionVSIXs",
        "logs",
        "WebStorage",
        "Crashpad",
        "GPUCache",
        "Code Cache",
        "node_modules",
        "site-packages",
        "Lib",
        "Miniconda3",
        "Anaconda3",
        ".git",
        "WindowsApps",
    }
)


def _walk_windows_agent_cmd_bundle(root: Path, max_depth: int) -> str | None:
    if not root.is_dir():
        return None
    try:
        root = root.resolve()
    except OSError:
        return None
    try:
        for dirpath, dirnames, filenames in os.walk(str(root), topdown=True):
            rel = Path(dirpath)
            try:
                depth = len(rel.relative_to(root).parts)
            except ValueError:
                depth = 0
            if depth > max_depth:
                dirnames[:] = []
                continue
            dirnames[:] = [d for d in dirnames if d not in _CURSOR_AGENT_WALK_SKIP_DIRS and not d.startswith(".")]
            if "agent.cmd" not in filenames:
                continue
            p = Path(dirpath) / "agent.cmd"
            d = p.parent
            if (d / "node.exe").is_file() and (d / "index.js").is_file():
                return str(p.resolve())
    except OSError:
        return None
    return None


def _iter_windows_agent_search_roots() -> list[tuple[Path, int]]:
    out: list[tuple[Path, int]] = []
    seen: set[str] = set()

    def add(p: Path, depth: int) -> None:
        try:
            key = str(p.resolve())
        except OSError:
            key = str(p)
        if key in seen:
            return
        seen.add(key)
        out.append((p, depth))

    home = Path.home()
    la = os.environ.get("LOCALAPPDATA", "") or ""
    ad = os.environ.get("APPDATA", "") or ""
    pf = os.environ.get("ProgramFiles", r"C:\Program Files")
    pf86 = os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")

    for p, d in (
        (home / ".cursor", 8),
        (Path(la) / "cursor-agent", 6),
        (home / "cursor", 6),
        (home / "AppData" / "Local" / "cursor-agent", 6),
        (Path(pf) / "cursor-agent", 5),
        (Path(pf) / "Cursor Agent", 5),
        (Path(pf86) / "cursor-agent", 5),
        (Path(pf86) / "Cursor Agent", 5),
        (Path(ad) / "Cursor", 5),
        (Path(ad) / "cursor-agent", 5),
    ):
        add(p, d)

    lp = Path(la) / "Programs"
    if lp.is_dir():
        try:
            for child in sorted(lp.iterdir(), key=lambda x: x.name.lower()):
                if not child.is_dir():
                    continue
                n = child.name.lower()
                depth = 7 if ("cursor" in n or "agent" in n) else 4
                add(child, depth)
        except OSError:
            pass
    return out


def _find_windows_agent_bundle_cmd() -> str | None:
    for root, depth in _iter_windows_agent_search_roots():
        p = _walk_windows_agent_cmd_bundle(root, depth)
        if p:
            return p
    return None


def _find_cursor_agent_executable() -> str | None:
    for name in ("agent", "agent.cmd", "agent.exe"):
        w = shutil.which(name)
        if w:
            return str(Path(w).resolve())
    if sys.platform == "win32":
        return _find_windows_agent_bundle_cmd()
    return None


def _resolve_cursor_agent_from_config(cfg: dict) -> str | None:
    ai = cfg.get("openai") or {}
    manual = (ai.get("cursor_agent_bin") or "").strip()
    if manual:
        mp = Path(manual)
        if mp.is_file():
            return str(mp.resolve())
        if mp.is_dir():
            for name in ("agent.cmd", "agent.exe", "agent"):
                c = mp / name
                if c.is_file():
                    return str(c.resolve())
    return _find_cursor_agent_executable()


def resolve_cursor_agent_cached(cfg: dict) -> str | None:
    """Resolve Cursor Agent binary path, caching by `config.yaml` mtime."""
    global _cursor_agent_resolve_cache
    cpath = config_yaml_path()
    try:
        mtime = cpath.stat().st_mtime
    except OSError:
        mtime = 0.0
    if _cursor_agent_resolve_cache is not None and _cursor_agent_resolve_cache[0] == mtime:
        return _cursor_agent_resolve_cache[1]
    resolved = _resolve_cursor_agent_from_config(cfg)
    _cursor_agent_resolve_cache = (mtime, resolved)
    return resolved


def _apply_cursor_agent_env(env: dict[str, str], agent_path: str) -> None:
    p = Path(agent_path).resolve()
    env["CURSOR_AGENT_BIN"] = str(p)
    parent = p.parent
    if sys.platform == "win32":
        node_exe = parent / "node.exe"
        index_js = parent / "index.js"
        if node_exe.is_file() and index_js.is_file():
            env["CURSOR_AGENT_NODE"] = str(node_exe)
            env["CURSOR_AGENT_SCRIPT"] = str(index_js)
    sep = ";" if sys.platform == "win32" else ":"
    env["PATH"] = str(parent) + sep + env.get("PATH", "")


def cursor_proxy_log_path(cfg: dict) -> Path:
    """Return path for embedded proxy log file."""
    dd = (cfg.get("general", {}) or {}).get("data_dir", "data")
    return REPO_ROOT / str(dd) / "cursor_proxy.log"


def _cursor_proxy_is_missing_node_npx(message: str) -> bool:
    low = (message or "").lower()
    return ("npx" in low and "not found" in low) or ("node" in low and "not found" in low)


def _start_cursor_proxy_unlocked(cfg: dict) -> tuple[bool, str]:
    global _cursor_proxy_proc
    ai = cfg.get("openai") or {}
    key = (ai.get("api_key") or "").strip()
    if not key:
        return False, "Cursor proxy: api_key is empty"
    npx = _find_npx_executable()
    if not npx:
        return False, "Cursor proxy: npx not found"

    _stop_cursor_proxy_unlocked()

    log_path = cursor_proxy_log_path(cfg)
    log_path.parent.mkdir(parents=True, exist_ok=True)

    host, port = _cursor_listen_host_port(ai)
    env = dict(os.environ)
    env["CURSOR_API_KEY"] = key
    env["CURSOR_BRIDGE_HOST"] = host
    env["CURSOR_BRIDGE_PORT"] = str(port)
    _prepend_nodejs_to_env(env, npx)

    agent_path = resolve_cursor_agent_cached(cfg)
    if agent_path:
        _apply_cursor_agent_env(env, agent_path)

    cr = subprocess.CREATE_NO_WINDOW if hasattr(subprocess, "CREATE_NO_WINDOW") else 0
    try:
        with log_path.open("ab") as lf:
            _cursor_proxy_proc = subprocess.Popen(
                [npx, "-y", "cursor-api-proxy"],
                cwd=str(REPO_ROOT),
                stdout=lf,
                stderr=lf,
                env=env,
                creationflags=cr,
            )
    except Exception as exc:
        _cursor_proxy_proc = None
        return False, f"Cursor proxy spawn failed: {exc}"

    health = _cursor_health_url(host, port)
    t0 = time.monotonic()
    while time.monotonic() - t0 < 3.0:
        if _cursor_proxy_proc is None or _cursor_proxy_proc.poll() is not None:
            return False, "Cursor proxy exited immediately"
        try:
            r = httpx.get(health, timeout=0.6)
            if r.status_code == 200:
                return True, f"Cursor proxy запущен (PID {_cursor_proxy_proc.pid}), {health} OK."
        except Exception:
            pass
        time.sleep(0.2)
    if _cursor_proxy_proc is None or _cursor_proxy_proc.poll() is not None:
        return False, "Cursor proxy exited"
    return True, (
        f"Cursor proxy запущен (PID {_cursor_proxy_proc.pid}), но /health пока не ответил — "
        f"проверьте лог {log_path}"
    )


def shutdown_embedded_cursor_proxy() -> None:
    """Stop embedded proxy process (if running)."""
    with _cursor_proxy_lock:
        _stop_cursor_proxy_unlocked()


def sync_cursor_proxy_from_config(cfg: dict) -> dict:
    """Start or stop embedded cursor-api-proxy according to config. Thread-safe."""
    with _cursor_proxy_lock:
        if not cursor_proxy_should_run(cfg):
            was_running = cursor_proxy_running()
            _stop_cursor_proxy_unlocked()
            msg = ""
            ai = cfg.get("openai") or {}
            if ai.get("provider") != "cursor":
                msg = "Cursor proxy disabled: provider != cursor"
            elif not cursor_proxy_autostart_enabled(cfg):
                msg = "Cursor proxy autostart disabled"
            else:
                msg = "Cursor proxy disabled"
            return {
                "managed": True,
                "running": False,
                "ok": True,
                "message": msg,
                "was_running": was_running,
            }

        ok, msg = _start_cursor_proxy_unlocked(cfg)
        running = cursor_proxy_running()
        warn = (not ok) and (not running) and _cursor_proxy_is_missing_node_npx(msg)
        return {"managed": True, "running": running, "ok": ok, "warning": warn, "message": msg}
