from __future__ import annotations


def to_csv_bytes(exports_mod, headers: list[str], rows: list[list]) -> bytes:
    return exports_mod.to_csv_bytes(headers, rows)


def to_xlsx_bytes(exports_mod, headers: list[str], rows: list[list], sheet_name: str = "Data") -> bytes:
    return exports_mod.to_xlsx_bytes(headers, rows, sheet_name)

