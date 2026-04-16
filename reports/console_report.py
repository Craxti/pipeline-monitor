"""
Console (terminal) report using Rich for coloured output.
"""

from __future__ import annotations

import logging
from collections import Counter

from rich import box
from rich.console import Console
from rich.panel import Panel
from rich.table import Table
from rich.text import Text

from models.models import CISnapshot, BuildStatus

logger = logging.getLogger(__name__)
console = Console()

_STATUS_STYLE: dict[str, str] = {
    BuildStatus.SUCCESS: "bold green",
    BuildStatus.FAILURE: "bold red",
    BuildStatus.RUNNING: "bold blue",
    BuildStatus.ABORTED: "dim",
    BuildStatus.UNSTABLE: "bold yellow",
    BuildStatus.UNKNOWN: "dim",
    "passed": "green",
    "failed": "bold red",
    "error": "red",
    "skipped": "yellow",
    "up": "bold green",
    "down": "bold red",
    "degraded": "bold yellow",
}


def _style(value: str) -> Text:
    return Text(value, style=_STATUS_STYLE.get(value, ""))


class ConsoleReporter:
    """Print a CISnapshot to the terminal."""

    def print_short(self, snapshot: CISnapshot) -> None:
        """One-liner summary."""
        builds_ok = sum(
            1 for b in snapshot.builds if b.status == BuildStatus.SUCCESS
        )
        builds_fail = sum(
            1 for b in snapshot.builds if b.status == BuildStatus.FAILURE
        )
        tests_fail = sum(1 for t in snapshot.tests if t.status == "failed")
        svc_down = sum(1 for s in snapshot.services if s.status == "down")

        summary = (
            f"Builds [green]{builds_ok} OK[/green] [red]{builds_fail} FAIL[/red]  |  "
            f"Test failures [red]{tests_fail}[/red]  |  "
            f"Services down [red]{svc_down}[/red]"
        )
        console.print(
            Panel(summary, title="[bold]CI/CD Monitor - Short Summary[/bold]",
                  border_style="blue")
        )

    def print_detailed(self, snapshot: CISnapshot, top_n: int = 10) -> None:
        """Full detailed view."""
        # ── Header ────────────────────────────────────────────────────────
        console.rule("[bold blue]CI/CD Monitor Report[/bold blue]", characters="-")
        console.print(
            f"  Collected at: [dim]{snapshot.collected_at.strftime('%Y-%m-%d %H:%M UTC')}[/dim]\n"
        )

        # ── Builds ────────────────────────────────────────────────────────
        if snapshot.builds:
            t = Table(
                "Source", "Job / Project", "#", "Status", "Branch",
                "Started", "Duration", "Critical",
                title="[bold]Builds / Pipelines[/bold]",
                box=box.SIMPLE_HEAVY,
                show_lines=False,
            )
            for b in snapshot.builds:
                t.add_row(
                    b.source,
                    f"[bold]{b.job_name}[/bold]" if b.critical else b.job_name,
                    str(b.build_number or "—"),
                    _style(b.status),
                    b.branch or "—",
                    b.started_at.strftime("%m-%d %H:%M") if b.started_at else "—",
                    f"{b.duration_seconds:.0f}s" if b.duration_seconds else "—",
                    "[bold red]YES[/bold red]" if b.critical else "no",
                )
            console.print(t)
        else:
            console.print("[dim]  No build data.[/dim]\n")

        # ── Top failing tests ─────────────────────────────────────────────
        if snapshot.tests:
            fail_counter: Counter = Counter()
            fail_msg: dict[str, str] = {}
            for tr in snapshot.tests:
                if tr.status_normalized in ("failed", "error"):
                    fail_counter[tr.test_name] += 1
                    if tr.failure_message and tr.failure_message.strip().lower() != "null":
                        fail_msg[tr.test_name] = tr.failure_message[:120]

            if fail_counter:
                ft = Table(
                    "Test Name", "Failures", "Last Message",
                    title=f"[bold]Top {top_n} Failing Tests[/bold]",
                    box=box.SIMPLE_HEAVY,
                )
                for name, cnt in fail_counter.most_common(top_n):
                    ft.add_row(
                        name,
                        Text(str(cnt), style="bold red"),
                        fail_msg.get(name, "—"),
                    )
                console.print(ft)

            total = len(snapshot.tests)
            passed = sum(1 for tr in snapshot.tests if tr.status_normalized == "passed")
            failed = sum(1 for tr in snapshot.tests if tr.status_normalized in ("failed", "error"))
            skipped = sum(1 for tr in snapshot.tests if tr.status_normalized == "skipped")
            console.print(
                f"  Tests total: [bold]{total}[/bold]  "
                f"passed [green]{passed}[/green]  "
                f"failed [red]{failed}[/red]  "
                f"skipped [yellow]{skipped}[/yellow]\n"
            )
        else:
            console.print("[dim]  No test data.[/dim]\n")

        # ── Services ──────────────────────────────────────────────────────
        if snapshot.services:
            st = Table(
                "Name", "Kind", "Status", "Detail",
                title="[bold]Services / Containers[/bold]",
                box=box.SIMPLE_HEAVY,
            )
            for s in snapshot.services:
                st.add_row(
                    s.name, s.kind, _style(s.status), s.detail or "—"
                )
            console.print(st)

        # ── Anomalies ────────────────────────────────────────────────────
        from collections import defaultdict
        job_statuses: dict[str, list[str]] = defaultdict(list)
        for b in sorted(
            snapshot.builds,
            key=lambda x: x.started_at or snapshot.collected_at,
        ):
            if b.critical:
                job_statuses[b.job_name].append(b.status)

        for job, statuses in job_statuses.items():
            consecutive = 0
            for s in statuses:
                consecutive = consecutive + 1 if s == BuildStatus.FAILURE else 0
            if consecutive >= 2:
                console.print(
                    f"[bold red](!!) ANOMALY:[/bold red] Critical job "
                    f"[bold]'{job}'[/bold] has "
                    f"[red]{consecutive}[/red] consecutive failures!"
                )
