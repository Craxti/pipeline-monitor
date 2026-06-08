"""Database connectivity probes (TCP / minimal protocol checks)."""

from __future__ import annotations

import socket
from typing import Any
from urllib.parse import urlparse

import requests

from models.models import ServiceStatus
from service_monitors.base import inst_label, make_service

DB_KINDS = frozenset({"postgres", "redis", "mongodb", "mysql", "elasticsearch", "kafka"})

_DEFAULT_PORTS = {
    "postgres": 5432,
    "redis": 6379,
    "mongodb": 27017,
    "mysql": 3306,
    "elasticsearch": 9200,
    "kafka": 9092,
}


def _timeout(inst: dict, default: int = 10) -> int:
    return max(3, min(120, int(inst.get("timeout_seconds") or default)))


def _host_port(inst: dict, default_port: int) -> tuple[str, int]:
    host = str(inst.get("host") or "").strip()
    port_raw = inst.get("port")
    url = str(inst.get("url") or "").strip()
    if not host and url:
        if "://" in url:
            parsed = urlparse(url)
            host = parsed.hostname or ""
            if parsed.port:
                port_raw = parsed.port
        else:
            chunk = url.split("/", 1)[0]
            if ":" in chunk:
                host, _, port_part = chunk.rpartition(":")
                if port_part.isdigit():
                    port_raw = port_part
            else:
                host = chunk
    port = int(port_raw or default_port)
    return host, port


def _tcp_probe(host: str, port: int, *, timeout: int) -> None:
    if not host:
        raise ValueError("Host is required.")
    with socket.create_connection((host, port), timeout=timeout):
        return


def _probe_redis(host: str, port: int, *, password: str, timeout: int) -> str:
    _tcp_probe(host, port, timeout=timeout)
    with socket.create_connection((host, port), timeout=timeout) as sock:
        sock.settimeout(timeout)
        if password:
            pwd = password.encode("utf-8")
            auth = f"*2\r\n$4\r\nAUTH\r\n${len(pwd)}\r\n{password}\r\n".encode("utf-8")
            sock.sendall(auth)
            chunk = sock.recv(128)
            if chunk.startswith(b"-") and b"WRONGPASS" in chunk.upper():
                raise ValueError("Redis AUTH failed (wrong password).")
        sock.sendall(b"*1\r\n$4\r\nPING\r\n")
        reply = sock.recv(128)
        if b"+PONG" not in reply and b"-NOAUTH" not in reply:
            raise ValueError(f"Unexpected Redis reply: {reply[:40]!r}")
        if b"-NOAUTH" in reply:
            return "Redis reachable (authentication required)."
        return "Redis PING ok."


def _probe_mysql(host: str, port: int, *, timeout: int) -> str:
    with socket.create_connection((host, port), timeout=timeout) as sock:
        sock.settimeout(timeout)
        banner = sock.recv(256)
        if not banner:
            raise ValueError("Empty MySQL handshake.")
        if banner[0:1] not in (b"\x0a", b"\x0b", b"\x0c", b"\x0d", b"\x0e", b"\x0f", b"\xff"):
            raise ValueError("Invalid MySQL handshake.")
    return "MySQL port open (handshake received)."


def _probe_elasticsearch(host: str, port: int, *, timeout: int, verify_ssl: bool, username: str, password: str) -> str:
    scheme = "https" if port == 443 else "http"
    url = f"{scheme}://{host}:{port}/"
    auth = (username, password) if username or password else None
    resp = requests.get(url, timeout=timeout, verify=verify_ssl, auth=auth)
    resp.raise_for_status()
    data = resp.json() if resp.content else {}
    version = ""
    if isinstance(data, dict):
        version = str(((data.get("version") or {}).get("number")) or data.get("tagline") or "").strip()
    return f"Elasticsearch reachable{(' (' + version + ')') if version else ''}."


def probe_database(inst: dict) -> dict[str, Any]:
    kind = str(inst.get("type") or "").strip().lower()
    if kind not in DB_KINDS:
        raise ValueError(f"Unsupported database type: {kind}")
    timeout = _timeout(inst)
    host, port = _host_port(inst, _DEFAULT_PORTS[kind])
    password = str(inst.get("password") or "")
    username = str(inst.get("username") or "")
    verify_ssl = inst.get("verify_ssl", True) is not False

    if kind == "postgres":
        _tcp_probe(host, port, timeout=timeout)
        detail = f"PostgreSQL reachable at {host}:{port}."
    elif kind == "mongodb":
        _tcp_probe(host, port, timeout=timeout)
        detail = f"MongoDB reachable at {host}:{port}."
    elif kind == "redis":
        detail = _probe_redis(host, port, password=password, timeout=timeout)
    elif kind == "mysql":
        detail = _probe_mysql(host, port, timeout=timeout)
    elif kind == "elasticsearch":
        detail = _probe_elasticsearch(
            host, port, timeout=timeout, verify_ssl=verify_ssl, username=username, password=password
        )
    elif kind == "kafka":
        _tcp_probe(host, port, timeout=timeout)
        detail = f"Kafka broker reachable at {host}:{port}."
    else:
        detail = f"{kind} reachable at {host}:{port}."
    return {"ok": True, "message": detail}


def test_database(inst: dict) -> dict:
    try:
        return probe_database(inst)
    except Exception as exc:
        label = inst_label(inst)
        return {"ok": False, "message": f"{label}: {exc}"}


def collect_database(inst: dict, *, timeout: int) -> list[ServiceStatus]:
    label = inst_label(inst)
    kind = str(inst.get("type") or "").strip().lower()
    try:
        probe_database({**inst, "timeout_seconds": timeout})
        return [
            make_service(
                name=label,
                kind=kind,
                status="up",
                detail=f"{kind} connection ok",
                source_instance=label,
            )
        ]
    except Exception as exc:
        return [
            make_service(
                name=label,
                kind=kind,
                status="down",
                detail=str(exc),
                source_instance=label,
            )
        ]
