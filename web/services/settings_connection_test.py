"""Connection checks for Jenkins/GitLab settings wizard."""

from __future__ import annotations

import base64
import socket
from typing import Any, Callable

import requests

from web.core.config import load_yaml_config
from web.core.settings_secrets import SETTINGS_SECRET_MASK, is_secret_settings_key

LoadConfigFn = Callable[[], dict]


def _clean_url(value: Any) -> str:
    return str(value or "").strip().rstrip("/")


def _bool(value: Any, default: bool = True) -> bool:
    if value is None:
        return default
    return bool(value)


def _safe_error(exc: Exception) -> str:
    msg = str(exc).strip()
    return msg or exc.__class__.__name__


def _is_secret_mask(value: Any) -> bool:
    return isinstance(value, str) and value.strip() == SETTINGS_SECRET_MASK


def _resolve_secret(value: Any, saved_value: Any) -> str:
    if _is_secret_mask(value) and isinstance(saved_value, str) and saved_value.strip():
        return saved_value.strip()
    return str(value or "").strip()


def _instances_key(kind: str) -> str | None:
    return {
        "jenkins": "jenkins_instances",
        "gitlab": "gitlab_instances",
        "github": "github_instances",
    }.get(kind)


def _find_ci_instance(saved: dict, kind: str, url: str, username: str = "") -> dict | None:
    key = _instances_key(kind)
    if not key:
        return None
    instances = saved.get(key) or []
    clean_url = _clean_url(url)
    if kind == "github" and not clean_url:
        clean_url = "https://github.com"
    user = str(username or "").strip()
    for inst in instances:
        if not isinstance(inst, dict):
            continue
        inst_url = _clean_url(inst.get("url") or ("https://github.com" if kind == "github" else ""))
        if inst_url != clean_url:
            continue
        if kind == "jenkins" and user and str(inst.get("username") or "").strip() != user:
            continue
        return inst
    if len(instances) == 1 and isinstance(instances[0], dict):
        return instances[0]
    return None


def _resolve_ci_payload(payload: dict[str, Any], saved: dict) -> dict[str, Any]:
    kind = str(payload.get("kind") or "").strip().lower()
    out = dict(payload)
    inst = _find_ci_instance(
        saved,
        kind,
        str(payload.get("url") or ""),
        str(payload.get("username") or ""),
    )
    if not inst:
        return out
    for field in ("token", "password", "api_key", "passhash"):
        if field in out or _is_secret_mask(out.get(field)):
            out[field] = _resolve_secret(out.get(field), inst.get(field))
    return out


def _find_monitor_instance(saved: dict, inst: dict) -> dict | None:
    sm = saved.get("service_monitors") or {}
    saved_instances = sm.get("instances") or []
    url = _clean_url(inst.get("url"))
    name = str(inst.get("name") or "").strip()
    host = str(inst.get("host") or "").strip()
    typ = str(inst.get("type") or "").strip().lower()
    for si in saved_instances:
        if not isinstance(si, dict):
            continue
        if typ and str(si.get("type") or "").strip().lower() != typ:
            continue
        if host and str(si.get("host") or "").strip() == host:
            return si
        if url and _clean_url(si.get("url")) == url:
            return si
        if name and str(si.get("name") or "").strip() == name:
            return si
    return None


def _find_docker_host(saved: dict, host: str, name: str = "") -> dict | None:
    dm = saved.get("docker_monitor") or {}
    clean_host = str(host or "").strip()
    clean_name = str(name or "").strip()
    for inst in dm.get("hosts") or []:
        if not isinstance(inst, dict):
            continue
        inst_host = str(inst.get("host") or "").strip()
        if clean_host and inst_host == clean_host:
            return inst
        if clean_name and str(inst.get("name") or "").strip() == clean_name:
            return inst
    return None


def _resolve_docker_host_payload(payload: dict[str, Any], saved: dict) -> dict[str, Any]:
    out = dict(payload)
    matched = _find_docker_host(saved, str(payload.get("host") or ""), str(payload.get("name") or ""))
    if not matched:
        return out
    out["password"] = _resolve_secret(out.get("password"), matched.get("password"))
    return out


def _resolve_monitor_inst(inst: dict[str, Any], saved: dict) -> dict[str, Any]:
    out = dict(inst)
    matched = _find_monitor_instance(saved, out)
    if not matched:
        return out
    for key in list(out.keys()):
        if is_secret_settings_key(key):
            out[key] = _resolve_secret(out.get(key), matched.get(key))
    for key, saved_val in matched.items():
        if is_secret_settings_key(key) and key not in out:
            out[key] = str(saved_val or "").strip()
    return out


def _resolve_test_payload(payload: dict[str, Any], load_cfg: LoadConfigFn = load_yaml_config) -> dict[str, Any]:
    saved = load_cfg() or {}
    kind = str(payload.get("kind") or "").strip().lower()
    if kind in {"jenkins", "gitlab", "github"}:
        return _resolve_ci_payload(payload, saved)
    if kind == "docker_host":
        return _resolve_docker_host_payload(payload, saved)
    inst = payload.get("instance") if isinstance(payload.get("instance"), dict) else payload
    if not isinstance(inst, dict):
        return payload
    resolved = _resolve_monitor_inst(inst, saved)
    if isinstance(payload.get("instance"), dict):
        out = dict(payload)
        out["instance"] = resolved
        return out
    return resolved


def _masked_secret_error(field: str = "token") -> dict[str, Any]:
    return {
        "ok": False,
        "message": f"{field.capitalize()} is hidden — re-enter it or save settings before testing.",
    }


def _basic_auth_header(username: str, password: str) -> dict[str, str]:
    raw = f"{username}:{password}".encode("utf-8")
    token = base64.b64encode(raw).decode("ascii")
    return {"Authorization": f"Basic {token}"}


def check_connection(
    payload: dict[str, Any],
    *,
    load_cfg: LoadConfigFn = load_yaml_config,
) -> dict[str, Any]:
    """Validate credentials against Jenkins, GitLab, GitHub, or service monitors."""
    payload = _resolve_test_payload(payload if isinstance(payload, dict) else {}, load_cfg)
    kind = str(payload.get("kind") or "").strip().lower()
    if kind in {"jenkins", "gitlab", "github"}:
        if kind == "jenkins":
            return _test_jenkins(payload)
        if kind == "gitlab":
            return _test_gitlab(payload)
        return _test_github(payload)
    if kind == "http":
        return _test_http(payload)
    if kind == "docker_host":
        return _test_docker_host(payload)

    from service_monitors.base import MONITOR_KINDS
    from service_monitors.runner import check_service_monitor_connection

    _direct_kinds = {"jenkins", "gitlab", "github", "http", "docker_host"}
    if kind and kind not in MONITOR_KINDS and kind not in _direct_kinds:
        return {
            "ok": False,
            "message": "Unsupported kind. Use jenkins/gitlab/github or a service monitor type.",
        }

    inst = payload.get("instance") if isinstance(payload.get("instance"), dict) else payload
    monitor_type = str(inst.get("type") or kind or "").strip().lower()
    if not monitor_type:
        return {
            "ok": False,
            "message": "Unsupported kind. Use jenkins/gitlab/github or a service monitor type.",
        }
    inst = dict(inst)
    inst["type"] = monitor_type
    return check_service_monitor_connection(inst)


def _test_jenkins(payload: dict[str, Any]) -> dict[str, Any]:
    base = _clean_url(payload.get("url"))
    user = str(payload.get("username") or "").strip()
    token = str(payload.get("token") or "").strip()
    verify_ssl = _bool(payload.get("verify_ssl"), default=True)

    if not base:
        return {"ok": False, "message": "Jenkins URL is required."}
    if not user:
        return {"ok": False, "message": "Jenkins username is required."}
    if not token:
        return {"ok": False, "message": "Jenkins token is required."}
    if _is_secret_mask(token):
        return _masked_secret_error("token")

    url = f"{base}/api/json?tree=jobs[name]&depth=1"
    headers = _basic_auth_header(user, token)
    try:
        resp = requests.get(url, headers=headers, timeout=10, verify=verify_ssl)
        if resp.status_code in (401, 403):
            return {"ok": False, "message": f"Jenkins auth failed ({resp.status_code})."}
        resp.raise_for_status()
        data = resp.json() if resp.content else {}
        jobs = data.get("jobs") if isinstance(data, dict) else None
        jobs_count = len(jobs) if isinstance(jobs, list) else 0
        return {"ok": True, "message": f"Jenkins connected. Visible jobs: {jobs_count}."}
    except UnicodeEncodeError as exc:
        return {"ok": False, "message": f"Jenkins credentials contain invalid characters: {_safe_error(exc)}"}
    except requests.RequestException as exc:
        return {"ok": False, "message": f"Jenkins connection failed: {_safe_error(exc)}"}
    except Exception as exc:
        return {"ok": False, "message": f"Jenkins response is invalid: {_safe_error(exc)}"}


def _test_gitlab(payload: dict[str, Any]) -> dict[str, Any]:
    base = _clean_url(payload.get("url"))
    token = str(payload.get("token") or "").strip()
    verify_ssl = _bool(payload.get("verify_ssl"), default=True)

    if not base:
        return {"ok": False, "message": "GitLab URL is required."}
    if not token:
        return {"ok": False, "message": "GitLab token is required."}
    if _is_secret_mask(token):
        return _masked_secret_error("token")

    url = f"{base}/api/v4/user"
    headers = {"PRIVATE-TOKEN": token}
    try:
        resp = requests.get(url, headers=headers, timeout=10, verify=verify_ssl)
        if resp.status_code in (401, 403):
            return {"ok": False, "message": f"GitLab auth failed ({resp.status_code})."}
        resp.raise_for_status()
        data = resp.json() if resp.content else {}
        username = str((data or {}).get("username") or "").strip()
        if username:
            return {"ok": True, "message": f"GitLab connected as '{username}'."}
        return {"ok": True, "message": "GitLab connected."}
    except UnicodeEncodeError as exc:
        return {"ok": False, "message": f"GitLab token contains invalid characters: {_safe_error(exc)}"}
    except requests.RequestException as exc:
        return {"ok": False, "message": f"GitLab connection failed: {_safe_error(exc)}"}
    except Exception as exc:
        return {"ok": False, "message": f"GitLab response is invalid: {_safe_error(exc)}"}


def _test_github(payload: dict[str, Any]) -> dict[str, Any]:
    from clients.github_client import GitHubClient, normalize_github_api_base

    base = _clean_url(payload.get("url")) or "https://github.com"
    token = str(payload.get("token") or "").strip()
    verify_ssl = _bool(payload.get("verify_ssl"), default=True)

    if not token:
        return {"ok": False, "message": "GitHub token is required."}
    if _is_secret_mask(token):
        return _masked_secret_error("token")

    api_base = normalize_github_api_base(base)
    try:
        client = GitHubClient(url=base, token=token, verify_ssl=verify_ssl)
        login = client.fetch_user_login()
        if login:
            return {"ok": True, "message": f"GitHub connected as '{login}' ({api_base})."}
        return {"ok": True, "message": f"GitHub API reachable ({api_base})."}
    except requests.RequestException as exc:
        return {"ok": False, "message": f"GitHub connection failed: {_safe_error(exc)}"}
    except Exception as exc:
        return {"ok": False, "message": f"GitHub response is invalid: {_safe_error(exc)}"}


def _test_http(payload: dict[str, Any]) -> dict[str, Any]:
    url = _clean_url(payload.get("url"))
    verify_ssl = _bool(payload.get("verify_ssl"), default=True)
    if not url:
        return {"ok": False, "message": "HTTP URL is required."}
    if not url.startswith(("http://", "https://")):
        url = f"https://{url}"
    try:
        resp = requests.get(url, timeout=10, verify=verify_ssl, allow_redirects=True)
        return {
            "ok": True,
            "message": f"HTTP reachable ({resp.status_code}) — {url}.",
        }
    except requests.RequestException as exc:
        return {"ok": False, "message": f"HTTP check failed: {_safe_error(exc)}"}


def _test_docker_host(payload: dict[str, Any]) -> dict[str, Any]:
    host = str(payload.get("host") or "").strip()
    port = int(payload.get("port") or 2375)
    password = str(payload.get("password") or "").strip()
    if not host:
        return {"ok": False, "message": "Docker host address is required."}
    if _is_secret_mask(password):
        return _masked_secret_error("password")
    try:
        with socket.create_connection((host, port), timeout=10):
            pass
        auth_note = " (credentials not verified)" if password else ""
        return {"ok": True, "message": f"Docker API port {port} reachable on {host}{auth_note}."}
    except OSError as exc:
        return {"ok": False, "message": f"Docker host unreachable: {_safe_error(exc)}"}
