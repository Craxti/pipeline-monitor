"""Connection checks for Jenkins/GitLab settings wizard."""

from __future__ import annotations

from typing import Any

import requests


def _clean_url(value: Any) -> str:
    return str(value or "").strip().rstrip("/")


def _bool(value: Any, default: bool = True) -> bool:
    if value is None:
        return default
    return bool(value)


def _safe_error(exc: Exception) -> str:
    msg = str(exc).strip()
    return msg or exc.__class__.__name__


def check_connection(payload: dict[str, Any]) -> dict[str, Any]:
    """Validate credentials against Jenkins or GitLab API."""
    kind = str(payload.get("kind") or "").strip().lower()
    if kind not in {"jenkins", "gitlab"}:
        return {"ok": False, "message": "Unsupported kind. Use 'jenkins' or 'gitlab'."}

    if kind == "jenkins":
        return _test_jenkins(payload)
    return _test_gitlab(payload)


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

    url = f"{base}/api/json?tree=jobs[name]&depth=1"
    try:
        resp = requests.get(url, auth=(user, token), timeout=10, verify=verify_ssl)
        if resp.status_code in (401, 403):
            return {"ok": False, "message": f"Jenkins auth failed ({resp.status_code})."}
        resp.raise_for_status()
        data = resp.json() if resp.content else {}
        jobs = data.get("jobs") if isinstance(data, dict) else None
        jobs_count = len(jobs) if isinstance(jobs, list) else 0
        return {"ok": True, "message": f"Jenkins connected. Visible jobs: {jobs_count}."}
    except requests.RequestException as exc:
        return {"ok": False, "message": f"Jenkins connection failed: {_safe_error(exc)}"}
    except Exception as exc:  # non-json response or unexpected format
        return {"ok": False, "message": f"Jenkins response is invalid: {_safe_error(exc)}"}


def _test_gitlab(payload: dict[str, Any]) -> dict[str, Any]:
    base = _clean_url(payload.get("url"))
    token = str(payload.get("token") or "").strip()
    verify_ssl = _bool(payload.get("verify_ssl"), default=True)

    if not base:
        return {"ok": False, "message": "GitLab URL is required."}
    if not token:
        return {"ok": False, "message": "GitLab token is required."}

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
    except requests.RequestException as exc:
        return {"ok": False, "message": f"GitLab connection failed: {_safe_error(exc)}"}
    except Exception as exc:
        return {"ok": False, "message": f"GitLab response is invalid: {_safe_error(exc)}"}
