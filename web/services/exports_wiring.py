"""Wiring wrappers for exports module."""

from __future__ import annotations


def to_csv_bytes(exports_mod, headers: list[str], rows: list[list]) -> bytes:
    """Build CSV bytes from headers + rows."""
    return exports_mod.to_csv_bytes(headers, rows)


def to_xlsx_bytes(
    exports_mod,
    headers: list[str],
    rows: list[list],
    sheet_name: str = "Data",
) -> bytes:
    """Build XLSX bytes from headers + rows."""
    return exports_mod.to_xlsx_bytes(headers, rows, sheet_name)
