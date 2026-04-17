"""Remove inline dashboard <script> blocks (no src) from index.html.

Adds `/static/dashboard.js` after i18n include.
"""

from __future__ import annotations

from pathlib import Path


def main() -> None:
    """Strip inline dashboard scripts and add external `dashboard.js` include."""
    root = Path(__file__).resolve().parents[1]
    p = root / "web" / "templates" / "index.html"
    lines = p.read_text(encoding="utf-8").splitlines(keepends=True)
    out: list[str] = []
    i = 0
    n = len(lines)
    inserted = False
    while i < n:
        line = lines[i]
        st = line.strip()
        # Drop inline scripts only (keep Chart.js CDN, keep any <script src="...">)
        if st == "<script>" or (st.startswith("<script") and "src=" not in st and not st.endswith("/>")):
            i += 1
            while i < n and lines[i].strip() != "</script>":
                i += 1
            if i < n and lines[i].strip() == "</script>":
                i += 1
            continue
        if "{% include 'partials/i18n_core.html' %}" in line and not inserted:
            out.append(line)
            out.append('<script src="/static/dashboard.js?v=20260416" defer></script>\n')
            inserted = True
            i += 1
            continue
        out.append(line)
        i += 1
    p.write_text("".join(out), encoding="utf-8")
    print("OK:", p, "inserted=", inserted)


if __name__ == "__main__":
    main()
