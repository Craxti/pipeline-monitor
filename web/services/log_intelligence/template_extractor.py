"""Drain-style log template extraction (stdlib only)."""

from __future__ import annotations

import hashlib
import re

_UUID_RE = re.compile(
    r"\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b",
    re.I,
)
_HEX_RE = re.compile(r"\b0x[0-9a-f]+\b", re.I)
_IP_RE = re.compile(r"\b\d{1,3}(?:\.\d{1,3}){3}\b")
_NUM_RE = re.compile(r"\b\d+\b")
_TS_PREFIX_RE = re.compile(r"^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}[.\dZ+\-: ]*\s*")
_LEVEL_RE = re.compile(r"\b(ERROR|WARN|WARNING|INFO|DEBUG|TRACE|FATAL|CRITICAL)\b", re.I)


def extract_template(line: str) -> str:
    """Normalize a log line into a stable event template."""
    s = (line or "").strip()
    if not s:
        return ""
    s = _TS_PREFIX_RE.sub("", s)
    s = _UUID_RE.sub("<UUID>", s)
    s = _HEX_RE.sub("<HEX>", s)
    s = _IP_RE.sub("<IP>", s)
    s = _NUM_RE.sub("<N>", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s[:280]


def template_id(template: str) -> str:
    """Stable short id for a template string."""
    h = hashlib.sha1(template.encode("utf-8", errors="replace")).hexdigest()[:12]
    return f"tpl_{h}"


def infer_level(line: str, template: str) -> str:
    """Rough log severity from content."""
    blob = f"{line} {template}".lower()
    if any(x in blob for x in ("fatal", "panic", "traceback", "exception", " error", "error:", "failed")):
        return "error"
    if any(x in blob for x in (" warn", "warning", "deprecated")):
        return "warn"
    m = _LEVEL_RE.search(line or "")
    if m:
        lv = m.group(1).lower()
        if lv in ("error", "fatal", "critical"):
            return "error"
        if lv in ("warn", "warning"):
            return "warn"
    return "info"
