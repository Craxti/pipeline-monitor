"""
Docker container and HTTP service health monitor.

Falls back gracefully if the docker SDK is not installed.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

import ipaddress
import socket
from urllib.parse import urlparse

import requests

from models.models import ServiceStatus

logger = logging.getLogger(__name__)


def _resolve_docker_container(client: object, name: str):
    """
    Return a docker.Container for *name*.

    Tries ``containers.get(name)`` first, then scans ``containers.list(all=True)``
    for an exact name match (case-insensitive) or a matching id / short-id prefix.
    """
    from docker.errors import NotFound  # type: ignore

    raw = (name or "").strip().lstrip("/")
    if not raw:
        raise ValueError("Empty container name")

    try:
        return client.containers.get(raw)
    except NotFound:
        pass

    raw_lower = raw.lower()
    candidates = client.containers.list(all=True)
    for c in candidates:
        if c.name == raw or c.name.lower() == raw_lower:
            return c
    # Match full container id or common 12-char short id
    for c in candidates:
        cid = c.id or ""
        if raw == cid or (len(raw) >= 12 and cid.startswith(raw)):
            return c
    raise ValueError(f"Container not found: {raw}")


class DockerMonitor:
    """Check Docker containers and HTTP endpoints."""

    def __init__(
        self,
        containers: list[str] | None = None,
        http_checks: list[dict] | None = None,
        timeout: int = 5,
        show_all: bool = False,
    ) -> None:
        self.containers = containers or []
        self.http_checks = http_checks or []
        self.timeout = timeout
        self.show_all = show_all

    # ── public ───────────────────────────────────────────────────────────────

    def check_all(self) -> list[ServiceStatus]:
        results: list[ServiceStatus] = []
        results.extend(self._check_docker())
        results.extend(self._check_http())
        return results

    @staticmethod
    def container_action(
        container_name: str,
        action: str,
        *,
        timeout: int = 10,
    ) -> dict:
        """
        Start, stop, or restart a container by name.

        action: "start" | "stop" | "restart"
        """
        import docker  # type: ignore

        act = action.lower().strip()
        if act not in ("start", "stop", "restart"):
            raise ValueError(f"Invalid action: {action!r}")

        client = docker.from_env()
        try:
            ctr = _resolve_docker_container(client, container_name)
        except ValueError as exc:
            raise ValueError(str(exc)) from exc

        if act == "start":
            ctr.start()
        elif act == "stop":
            ctr.stop(timeout=timeout)
        else:
            ctr.restart(timeout=timeout)
        ctr.reload()
        return {
            "ok": True,
            "name": container_name,
            "status": ctr.status,
            "action": act,
        }

    @staticmethod
    def restart_container(container_name: str, timeout: int = 10) -> dict:
        """Restart a Docker container by name (backward compatible)."""
        return DockerMonitor.container_action(container_name, "restart", timeout=timeout)

    @staticmethod
    def container_logs_tail(
        container_name: str,
        *,
        tail: int = 3000,
        timestamps: bool = True,
    ) -> str:
        """Return recent container stdout/stderr as text (for UI log viewer)."""
        import docker  # type: ignore

        client = docker.from_env()
        try:
            ctr = _resolve_docker_container(client, container_name)
        except ValueError as exc:
            raise ValueError(str(exc)) from exc
        raw = ctr.logs(tail=tail, timestamps=timestamps)
        return raw.decode("utf-8", errors="replace")

    @staticmethod
    def iter_container_logs_stream(
        container_name: str,
        *,
        follow: bool = True,
        tail: int = 200,
        timestamps: bool = True,
    ):
        """
        Yield bytes chunks from docker logs (stream=True).
        Use for StreamingResponse; stops when the stream ends or container is removed.
        """
        import docker  # type: ignore

        client = docker.from_env()
        try:
            ctr = _resolve_docker_container(client, container_name)
        except ValueError as exc:
            yield (str(exc) + "\n").encode("utf-8")
            return
        try:
            stream = ctr.logs(
                stream=True,
                follow=follow,
                tail=tail,
                timestamps=timestamps,
            )
            for chunk in stream:
                yield chunk
        except Exception as exc:
            logger.error("Docker log stream failed: %s", exc)
            yield f"\n[stream error: {exc}]\n".encode("utf-8")

    # ── Docker ───────────────────────────────────────────────────────────────

    def _check_docker(self) -> list[ServiceStatus]:
        try:
            import docker  # type: ignore
        except ImportError:
            logger.warning("docker SDK not installed; skipping container checks.")
            return []

        statuses: list[ServiceStatus] = []
        try:
            client = docker.from_env()
            running = client.containers.list(all=True)
            for ctr in running:
                if not self.show_all and self.containers and ctr.name not in self.containers:
                    continue
                if not self.show_all and not self.containers:
                    continue
                state = ctr.status  # running | exited | paused | ...
                svc_status = "up" if state == "running" else "down"
                statuses.append(
                    ServiceStatus(
                        name=ctr.name,
                        kind="docker",
                        status=svc_status,
                        detail=f"state={state}",
                        checked_at=datetime.now(tz=timezone.utc),
                    )
                )
        except Exception as exc:
            logger.error("Docker check failed: %s", exc)

        return statuses

    # ── HTTP health checks ────────────────────────────────────────────────────

    def _check_http(self) -> list[ServiceStatus]:
        statuses: list[ServiceStatus] = []
        for endpoint in self.http_checks:
            name = endpoint.get("name", endpoint.get("url", "unknown"))
            url = endpoint.get("url", "")
            if not url:
                continue
            status, detail = self._http_ping(url)
            statuses.append(
                ServiceStatus(
                    name=name,
                    kind="http",
                    status=status,
                    detail=detail,
                    checked_at=datetime.now(tz=timezone.utc),
                )
            )
        return statuses

    def _http_ping(self, url: str) -> tuple[str, str]:
        safe, why = _is_safe_outbound_url(url)
        if not safe:
            return "down", f"Blocked URL (SSRF): {why}"
        try:
            resp = requests.get(url, timeout=self.timeout, allow_redirects=False)
            if resp.status_code < 400:
                return "up", f"HTTP {resp.status_code}"
            return "degraded", f"HTTP {resp.status_code}"
        except requests.ConnectionError:
            return "down", "Connection refused"
        except requests.Timeout:
            return "down", f"Timeout after {self.timeout}s"
        except requests.RequestException as exc:
            return "down", str(exc)


def _is_safe_outbound_url(url: str) -> tuple[bool, str]:
    """
    Basic SSRF mitigation for user-configured URLs.
    - Allow only http(s)
    - Disallow credentials in URL
    - Resolve hostname and block internal/private/link-local/multicast/loopback ranges
    """
    try:
        u = urlparse(str(url).strip())
    except Exception:
        return False, "invalid url"
    if u.scheme not in ("http", "https"):
        return False, f"scheme '{u.scheme}' not allowed"
    if not u.hostname:
        return False, "missing hostname"
    if u.username or u.password:
        return False, "userinfo not allowed"
    host = u.hostname.strip().lower()
    if host == "localhost":
        return False, "localhost blocked"

    port = u.port or (443 if u.scheme == "https" else 80)
    try:
        infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except Exception:
        return False, "dns resolution failed"

    for info in infos:
        ip_str = info[4][0]
        try:
            ip = ipaddress.ip_address(ip_str)
        except ValueError:
            continue
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_multicast
            or ip.is_reserved
            or ip.is_unspecified
        ):
            return False, f"ip {ip} blocked"

    return True, "ok"
