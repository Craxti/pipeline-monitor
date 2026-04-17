"""Replace inline onclick= in dashboard template with data-dash-action.

Also adds overlay dismiss attributes.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INDEX = ROOT / "web" / "templates" / "index.html"

PAIRS: list[tuple[str, str]] = [
    (
        ' onclick="if(event.target===this)closeRunbook()"',
        ' data-dash-overlay-dismiss="closeRunbook"',
    ),
    (
        ' onclick="if(event.target===this)closeDiffModal()"',
        ' data-dash-overlay-dismiss="closeDiffModal"',
    ),
    (
        ' onclick="if(event.target===this)closeStagesModal()"',
        ' data-dash-overlay-dismiss="closeStagesModal"',
    ),
    (
        ' onclick="if(event.target===this)closeLogModal()"',
        ' data-dash-overlay-dismiss="closeLogModal"',
    ),
    (' onclick="event.stopPropagation()"', ""),
    (
        " onclick=\"goToInTab('builds','panel-builds');"
        "document.getElementById('f-bstatus').value='failure';"
        "resetBuilds();\"",
        ' data-dash-action="runbookFocusBuildFailures"',
    ),
    (
        " onclick=\"goToInTab('tests','panel-tests');"
        "document.getElementById('f-tstatus').value='failed';"
        "resetTests();\"",
        ' data-dash-action="runbookFocusTestFailures"',
    ),
    (
        " onclick=\"goToInTab('services','panel-svcs');"
        "document.getElementById('sv-problems-only').checked=true;"
        "toggleSvcProblemsOnly(true);\"",
        ' data-dash-action="runbookFocusServicesProblems"',
    ),
]


def _args_attr(args: list) -> str:
    """Format JSON args attribute for dashboard actions."""
    return f" data-dash-args='{json.dumps(args)}'"


def main() -> None:
    """Patch dashboard template to remove inline `onclick=` handlers."""
    text = INDEX.read_text(encoding="utf-8")
    for old, new in PAIRS:
        text = text.replace(old, new)

    text = re.sub(
        r" onclick=\"loadTrends\((\d+),this\)\"",
        lambda m: (
            f' data-dash-action="loadTrends"{_args_attr([int(m.group(1))])}'
        ),
        text,
    )
    text = re.sub(
        r" onclick=\"setTrendsSize\('([^']+)',this\)\"",
        lambda m: (
            f' data-dash-action="setTrendsSize"{_args_attr([m.group(1)])}'
        ),
        text,
    )
    text = re.sub(
        r" onclick=\"(\w+)\('([^']*)'\)\"",
        lambda m: (
            f' data-dash-action="{m.group(1)}"{_args_attr([m.group(2)])}'
        ),
        text,
    )
    text = re.sub(
        r' onclick="(\w+)\((-?\d+)\)"',
        lambda m: (
            f' data-dash-action="{m.group(1)}"{_args_attr([int(m.group(2))])}'
        ),
        text,
    )
    text = re.sub(
        r" onclick=\"filterBuilds\('([^']*)','([^']*)'\)\"",
        lambda m: (
            f' data-dash-action="filterBuilds"{_args_attr([m.group(1), m.group(2)])}'
        ),
        text,
    )
    text = re.sub(
        r" onclick=\"goToInTab\('([^']+)','([^']+)'\)\"",
        lambda m: (
            f' data-dash-action="goToInTab"{_args_attr([m.group(1), m.group(2)])}'
        ),
        text,
    )
    text = re.sub(
        r" onclick=\"toggleChartFullscreen\('([^']+)',(\d+)\)\"",
        lambda m: (
            " data-dash-action=\"toggleChartFullscreen\""
            f"{_args_attr([m.group(1), int(m.group(2))])}"
        ),
        text,
    )
    text = re.sub(r' onclick="(\w+)\(\)"', r' data-dash-action="\1"', text)

    if "onclick=" in text:
        bad = [ln for ln in text.splitlines() if "onclick=" in ln]
        raise SystemExit("Still has onclick:\n" + "\n".join(bad[:40]))

    INDEX.write_text(text, encoding="utf-8")
    print("OK:", INDEX)


if __name__ == "__main__":
    main()
