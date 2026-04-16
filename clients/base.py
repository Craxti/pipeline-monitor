"""
Abstract base class for all CI/CD system clients.
"""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from datetime import datetime
from typing import Any

import requests
from requests.adapters import HTTPAdapter
import urllib3
from urllib3.util.retry import Retry

from models.models import BuildRecord

logger = logging.getLogger(__name__)

# Many internal CI installations use self-signed certs and run with verify_ssl=false.
# Avoid flooding logs with InsecureRequestWarning in that mode.
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)


class BaseCIClient(ABC):
    """Common HTTP session setup and abstract interface for all adapters."""

    def __init__(
        self,
        url: str,
        token: str,
        timeout: int = 15,
        verify_ssl: bool = True,
    ) -> None:
        self.base_url = url.rstrip("/")
        self.token = token
        self.timeout = timeout
        self.verify_ssl = verify_ssl
        self.session = self._build_session()

    # ── internal helpers ────────────────────────────────────────────────────

    def _build_session(self) -> requests.Session:
        session = requests.Session()
        retry = Retry(total=3, backoff_factor=0.5, status_forcelist=[500, 502, 503])
        adapter = HTTPAdapter(max_retries=retry)
        session.mount("http://", adapter)
        session.mount("https://", adapter)
        return session

    def _get(self, path: str, **kwargs: Any) -> dict | list:
        url = f"{self.base_url}{path}"
        resp: requests.Response | None = None
        try:
            kwargs.setdefault("verify", self.verify_ssl)
            resp = self.session.get(url, timeout=self.timeout, **kwargs)
            resp.raise_for_status()
            return resp.json()
        except requests.RequestException as exc:
            logger.error("GET %s failed: %s", url, exc)
            return {}
        except Exception as exc:
            # Most common: Jenkins returns HTML login page (200) -> JSON decode fails.
            ct = (resp.headers.get("content-type") if resp is not None else None) or ""
            snippet = ""
            try:
                if resp is not None and isinstance(resp.text, str):
                    snippet = resp.text.strip().replace("\r", "")[:240]
            except Exception:
                snippet = ""
            logger.error(
                "GET %s returned non-JSON (content-type=%s): %s%s",
                url,
                ct,
                exc,
                f" | body: {snippet!r}" if snippet else "",
            )
            return {}

    def _post(self, path: str, **kwargs: Any) -> requests.Response:
        url = f"{self.base_url}{path}"
        kwargs.setdefault("verify", self.verify_ssl)
        resp = self.session.post(url, timeout=self.timeout, **kwargs)
        resp.raise_for_status()
        return resp

    def _get_text(self, path: str, **kwargs: Any) -> str:
        """GET and return decoded text (for console logs, traces, etc.)."""
        url = f"{self.base_url}{path}"
        kwargs.setdefault("verify", self.verify_ssl)
        resp = self.session.get(url, timeout=self.timeout, **kwargs)
        resp.raise_for_status()
        return resp.text

    # ── public interface ────────────────────────────────────────────────────

    @abstractmethod
    def fetch_builds(
        self,
        since: datetime | None = None,
        max_builds: int = 10,
    ) -> list[BuildRecord]:
        """Return a list of BuildRecord objects from the CI system."""
