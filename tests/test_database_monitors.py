from __future__ import annotations

from unittest.mock import MagicMock, patch

from service_monitors import databases
from web.services import settings_connection_test as sct


def test_postgres_tcp_probe_ok() -> None:
    with patch("service_monitors.databases._tcp_probe") as probe:
        out = databases.test_database({"type": "postgres", "name": "pg", "host": "10.0.0.1", "port": 5432})
    assert out["ok"] is True
    probe.assert_called_once()


def test_postgres_missing_host_fails() -> None:
    out = databases.test_database({"type": "postgres", "name": "pg"})
    assert out["ok"] is False


def test_redis_ping_ok() -> None:
    class FakeSock:
        def __init__(self, *args, **kwargs):
            self._buf = b"+PONG\r\n"

        def settimeout(self, _t):
            return None

        def sendall(self, data):
            return None

        def recv(self, n):
            return self._buf

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

    with patch("service_monitors.databases.socket.create_connection", return_value=FakeSock()):
        out = databases.test_database({"type": "redis", "name": "cache", "host": "127.0.0.1", "port": 6379})
    assert out["ok"] is True


def test_http_connection_check() -> None:
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    with patch("web.services.settings_connection_test.requests.get", return_value=mock_resp):
        out = sct.check_connection({"kind": "http", "url": "https://example.com/health"})
    assert out["ok"] is True
    assert "200" in out["message"]


def test_kafka_tcp_probe_ok() -> None:
    with patch("service_monitors.databases._tcp_probe") as probe:
        out = databases.test_database({"type": "kafka", "name": "bus", "host": "10.0.0.2", "port": 9092})
    assert out["ok"] is True
    probe.assert_called_once()


def test_docker_host_tcp_check() -> None:
    with patch("web.services.settings_connection_test.socket.create_connection") as conn:
        out = sct.check_connection({"kind": "docker_host", "host": "10.0.0.5", "port": 2375})
    assert out["ok"] is True
    conn.assert_called_once()
