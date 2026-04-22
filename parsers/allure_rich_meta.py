"""Extract Allure description and image attachment metadata from Jenkins Allure case JSON."""

from __future__ import annotations

import re
from html import unescape
from typing import Any

_IMG_TYPE_PREFIX = "image/"
_IMG_EXT_RE = re.compile(r"\.(png|jpe?g|gif|webp|bmp|svg)\s*$", re.I)
_LOOSE_IMAGE_TYPES = frozenset({"", "application/octet-stream", "binary", "octet-stream"})


def _html_block_newlines(html: str) -> str:
    """Turn common HTML block / line-break tags into newlines before tag stripping."""
    s = html
    s = re.sub(r"(?is)<\s*br\s*/?>", "\n", s)
    s = re.sub(r"(?is)</\s*(p|div|li|tr|h[1-6]|ul|ol|table|thead|tbody|section|article)\s*>", "\n", s)
    s = re.sub(r"(?is)<\s*(p|div|tr|h[1-6]|li)\b[^>]*>", "\n", s)
    return s


def _strip_html(html: str, *, max_len: int) -> str:
    s = re.sub(r"<script[^>]*>[\s\S]*?</script>", " ", html, flags=re.I)
    s = re.sub(r"<style[^>]*>[\s\S]*?</style>", " ", s, flags=re.I)
    s = _html_block_newlines(s)
    s = re.sub(r"<[^>]+>", " ", s)
    s = unescape(s)
    s = s.replace("\r\n", "\n").replace("\r", "\n")
    lines = []
    for line in s.split("\n"):
        line = re.sub(r"[ \t\xa0]+", " ", line).strip()
        if line:
            lines.append(line)
    s = "\n".join(lines)
    s = re.sub(r"\n{3,}", "\n\n", s).strip()
    if max_len > 0 and len(s) > max_len:
        return s[: max_len - 1] + "…"
    return s


def allure_plain_description_from_case(case: dict[str, Any] | None, *, max_len: int = 12000) -> str | None:
    """User-facing description (HTML stripped)."""
    if not case:
        return None
    html = case.get("descriptionHtml")
    if isinstance(html, str) and html.strip():
        t = _strip_html(html, max_len=max_len)
        return t or None
    desc = case.get("description")
    if isinstance(desc, str) and desc.strip():
        if "<" in desc and ">" in desc:
            t = _strip_html(desc, max_len=max_len)
            return t or None
        t = desc.strip()
        return (t[:max_len] + "…") if max_len > 0 and len(t) > max_len else t
    return None


def _attachment_is_image_like(att: dict[str, Any]) -> bool:
    typ = str(att.get("type") or "").strip().lower()
    if typ.startswith(_IMG_TYPE_PREFIX):
        return True
    src = str(att.get("source") or "").strip()
    name = str(att.get("name") or "").strip()
    path = src or name
    if not path:
        return False
    if typ in _LOOSE_IMAGE_TYPES or not typ:
        return bool(_IMG_EXT_RE.search(path))
    return False


def _collect_attachment_dicts_from_steps(node: dict[str, Any], depth: int) -> list[dict[str, Any]]:
    if depth > 60 or not isinstance(node, dict):
        return []
    found: list[dict[str, Any]] = []
    for att in node.get("attachments") or []:
        if isinstance(att, dict):
            found.append(att)
    for key in ("steps", "beforeStages", "afterStages", "children"):
        ch = node.get(key)
        if not isinstance(ch, list):
            continue
        for item in ch:
            if isinstance(item, dict):
                found.extend(_collect_attachment_dicts_from_steps(item, depth + 1))
    return found


def _iter_all_attachment_dicts(case: dict[str, Any]) -> list[dict[str, Any]]:
    """Root + nested step/stage attachments (Allure often stores screenshots only on steps)."""
    out: list[dict[str, Any]] = []
    for att in case.get("attachments") or []:
        if isinstance(att, dict):
            out.append(att)
    for key in ("steps", "beforeStages", "afterStages", "children"):
        ch = case.get(key)
        if not isinstance(ch, list):
            continue
        for item in ch:
            if isinstance(item, dict):
                out.extend(_collect_attachment_dicts_from_steps(item, 0))
    return out


def allure_image_attachments_from_case(case: dict[str, Any] | None) -> list[dict[str, str]]:
    """Return image-like attachments (``source`` under ``allure/data``).

    Includes ``image/*`` plus common screenshot filenames when MIME is missing
    (typical for Allure step attachments).
    """
    if not case:
        return []
    out: list[dict[str, str]] = []
    seen: set[str] = set()
    for att in _iter_all_attachment_dicts(case):
        if not _attachment_is_image_like(att):
            continue
        src = str(att.get("source") or "").strip()
        if not src or ".." in src or src.startswith("/"):
            continue
        if src in seen:
            continue
        seen.add(src)
        raw_typ = str(att.get("type") or "").strip().lower()
        if raw_typ.startswith(_IMG_TYPE_PREFIX):
            typ = raw_typ
        else:
            low = src.lower()
            if low.endswith(".png"):
                typ = "image/png"
            elif low.endswith(".gif"):
                typ = "image/gif"
            elif low.endswith(".webp"):
                typ = "image/webp"
            elif low.endswith(".bmp"):
                typ = "image/bmp"
            elif low.endswith(".svg"):
                typ = "image/svg+xml"
            else:
                typ = "image/jpeg"
        name = str(att.get("name") or "").strip() or src
        out.append({"name": name, "type": typ, "source": src})
    return out


def normalize_allure_data_relative_path(source: str) -> str | None:
    """Return safe path relative to ``.../allure/data/`` for GET, or None."""
    s = (source or "").strip().replace("\\", "/")
    if not s or ".." in s or s.startswith("/"):
        return None
    if "/" in s:
        if ".." in s:
            return None
        if re.match(r"^attachments/[\w./\-]+$", s) or re.match(r"^test-cases/[\w./\-]+$", s):
            return s
        return None
    if re.match(r"^[\w.\-]+$", s):
        return f"attachments/{s}"
    return None
