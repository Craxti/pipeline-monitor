"""
Helpers to extract human-readable failure text from Allure JSON shapes.

Allure versions / exporters differ: `statusDetails` may be a dict, a string,
nested objects, or missing while the message lives in other top-level keys.
"""

from __future__ import annotations

import json
from typing import Any


def _as_text_fragment(value: Any, *, max_len: int) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        s = value.strip()
        return s[:max_len] if max_len > 0 else s
    if isinstance(value, (int, float, bool)):
        s = str(value).strip()
        return s[:max_len] if max_len > 0 else s
    if isinstance(value, dict):
        # Prefer common keys if present (avoid dumping huge arbitrary dicts).
        for k in ("message", "trace", "actual", "expected", "reason", "detail"):
            inner = value.get(k)
            if isinstance(inner, str) and inner.strip():
                s = inner.strip()
                return s[:max_len] if max_len > 0 else s
        try:
            s = json.dumps(value, ensure_ascii=False)
        except Exception:
            s = str(value)
        s = s.strip()
        return s[:max_len] if max_len > 0 else s
    if isinstance(value, list):
        parts: list[str] = []
        for x in value:
            frag = _as_text_fragment(x, max_len=max(0, max_len - sum(len(p) + 2 for p in parts)))
            if frag:
                parts.append(frag)
            if max_len > 0 and sum(len(p) + 2 for p in parts) >= max_len:
                break
        s = " | ".join(parts).strip()
        return s[:max_len] if max_len > 0 else s
    s = str(value).strip()
    return s[:max_len] if max_len > 0 else s


_FAIL_STEP_STATUSES = frozenset({"failed", "broken"})


def failure_text_from_allure_steps(steps: Any, *, max_len: int = 4000, _depth: int = 0) -> str:
    """
    Walk Allure `steps` (and similar lists): failures often live on a nested step
    while the test root has empty `statusDetails`.
    """
    if not steps or not isinstance(steps, list) or _depth > 60:
        return ""
    for st in steps:
        if not isinstance(st, dict):
            continue
        nm = _as_text_fragment(st.get("name"), max_len=400)
        subst = str(st.get("status") or "").strip().lower()
        nested = failure_text_from_allure_steps(st.get("steps"), max_len=max_len, _depth=_depth + 1)
        if nested:
            block = f"{nm}\n{nested}".strip() if nm else nested
            return block[:max_len] if max_len > 0 else block
        if subst in _FAIL_STEP_STATUSES:
            det = failure_text_from_status_details(st.get("statusDetails"), max_len=max_len)
            if det:
                block = f"{nm}\n{det}".strip() if nm else det
                return block[:max_len] if max_len > 0 else block
    return ""


def failure_text_from_allure_stages(case: dict[str, Any] | None, *, max_len: int = 4000) -> str:
    """Collect failure text from stage lists.

    Covers `steps`, `beforeStages`, `afterStages`, and `children` (Allure 2 JSON shapes).
    """
    if not case:
        return ""
    for key in ("steps", "beforeStages", "afterStages", "children"):
        frag = failure_text_from_allure_steps(case.get(key), max_len=max_len)
        if frag:
            return frag
    return ""


def failure_text_from_status_details(status_details: Any, *, max_len: int = 4000) -> str:
    """Extract a readable message/trace pair from Allure `statusDetails`."""
    if not status_details:
        return ""
    if isinstance(status_details, str):
        s = status_details.strip()
        return s[:max_len] if max_len > 0 else s
    if not isinstance(status_details, dict):
        return _as_text_fragment(status_details, max_len=max_len)

    msg = _as_text_fragment(status_details.get("message"), max_len=max_len)
    tr = _as_text_fragment(
        status_details.get("trace"),
        max_len=max(0, max_len - len(msg) - 2),
    )
    if msg and tr:
        joined = f"{msg}\n{tr}".strip()
        return joined[:max_len] if max_len > 0 else joined
    return (msg or tr).strip()


def failure_text_from_allure_case_dict(case: dict[str, Any] | None, *, max_len: int = 4000) -> str:
    """
    Best-effort extraction for Jenkins Allure `test-cases/<uid>.json` payloads
    (and similar shapes).
    """
    if not case:
        return ""

    parts: list[str] = []

    def add(fragment: str) -> None:
        frag = (fragment or "").strip()
        if not frag:
            return
        parts.append(frag)

    add(failure_text_from_status_details(case.get("statusDetails"), max_len=max_len))

    for k in ("statusMessage", "statusTrace", "description", "message", "trace"):
        add(_as_text_fragment(case.get(k), max_len=max_len))

    if not "".join(parts).strip():
        add(failure_text_from_allure_stages(case, max_len=max_len))

    out = "\n".join([p for p in parts if p]).strip()
    return out[:max_len] if max_len > 0 else out


def failure_text_from_allure_result_item(
    item: dict[str, Any] | None,
    *,
    max_len: int = 4000,
) -> str:
    """Single test object from `*-result.json` (allure-results)."""
    if not item:
        return ""
    parts: list[str] = []
    root = failure_text_from_status_details(
        item.get("statusDetails"),
        max_len=max_len,
    ).strip()
    if root:
        parts.append(root)
    staged = failure_text_from_allure_stages(
        item,
        max_len=max(0, max_len - len(root) - 2) if max_len else max_len,
    )
    if staged:
        parts.append(staged)
    out = "\n".join(parts).strip()
    return out[:max_len] if max_len > 0 else out
