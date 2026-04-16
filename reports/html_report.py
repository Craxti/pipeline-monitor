"""
HTML report generator using Jinja2.
"""

from __future__ import annotations

import logging
from collections import Counter
from pathlib import Path

from jinja2 import Environment, BaseLoader

from models.models import CISnapshot, BuildStatus

logger = logging.getLogger(__name__)

# ── Inline Jinja2 template ────────────────────────────────────────────────────
_TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>CI/CD Monitor Report</title>
<style>
  :root{--ok:#22c55e;--fail:#ef4444;--warn:#f59e0b;--info:#3b82f6;--bg:#0f172a;--card:#1e293b;--text:#e2e8f0;--muted:#94a3b8}
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Segoe UI',system-ui,sans-serif;background:var(--bg);color:var(--text);padding:2rem}
  h1{font-size:1.8rem;margin-bottom:.25rem}
  .subtitle{color:var(--muted);margin-bottom:2rem;font-size:.9rem}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:1rem;margin-bottom:2rem}
  .card{background:var(--card);border-radius:.75rem;padding:1.25rem;text-align:center}
  .card .num{font-size:2rem;font-weight:700}
  .card .label{color:var(--muted);font-size:.8rem;margin-top:.25rem}
  .ok{color:var(--ok)}.fail{color:var(--fail)}.warn{color:var(--warn)}.info{color:var(--info)}
  section{background:var(--card);border-radius:.75rem;padding:1.5rem;margin-bottom:1.5rem}
  h2{font-size:1.1rem;margin-bottom:1rem;border-bottom:1px solid #334155;padding-bottom:.5rem}
  table{width:100%;border-collapse:collapse;font-size:.85rem}
  th{text-align:left;padding:.5rem .75rem;color:var(--muted);font-weight:600;border-bottom:1px solid #334155}
  td{padding:.45rem .75rem;border-bottom:1px solid #1e293b}
  tr:hover td{background:#263147}
  .badge{display:inline-block;padding:.15rem .6rem;border-radius:999px;font-size:.75rem;font-weight:600}
  .badge-ok{background:#14532d;color:var(--ok)}
  .badge-fail{background:#450a0a;color:var(--fail)}
  .badge-warn{background:#451a03;color:var(--warn)}
  .badge-info{background:#1e3a5f;color:var(--info)}
  a{color:var(--info);text-decoration:none}a:hover{text-decoration:underline}
  .anomaly{background:#450a0a22;border-left:3px solid var(--fail);padding:.5rem .75rem;border-radius:.25rem;margin:.25rem 0;font-size:.85rem}
</style>
</head>
<body>
<h1>CI/CD Monitor Report</h1>
<p class="subtitle">Generated: {{ generated_at }} | Lookback: {{ lookback }}</p>

<!-- ── Summary cards ── -->
<div class="grid">
  <div class="card"><div class="num info">{{ total_builds }}</div><div class="label">Total Builds</div></div>
  <div class="card"><div class="num ok">{{ builds_ok }}</div><div class="label">Successful Builds</div></div>
  <div class="card"><div class="num fail">{{ builds_fail }}</div><div class="label">Failed Builds</div></div>
  <div class="card"><div class="num info">{{ total_tests }}</div><div class="label">Tests Parsed</div></div>
  <div class="card"><div class="num fail">{{ tests_fail }}</div><div class="label">Test Failures</div></div>
  <div class="card"><div class="num warn">{{ tests_skip }}</div><div class="label">Skipped Tests</div></div>
</div>

{% if anomalies %}
<!-- ── Anomalies ── -->
<section>
  <h2>⚠ Anomalies (critical jobs with consecutive failures)</h2>
  {% for a in anomalies %}
  <div class="anomaly">{{ a }}</div>
  {% endfor %}
</section>
{% endif %}

<!-- ── Build status ── -->
<section>
  <h2>Build / Pipeline Status</h2>
  <table>
    <thead><tr><th>Source</th><th>Job / Project</th><th>#</th><th>Status</th><th>Branch</th><th>Started</th><th>Duration</th><th>Link</th></tr></thead>
    <tbody>
    {% for b in builds %}
    <tr>
      <td>{{ b.source }}</td>
      <td>{% if b.critical %}<strong>{{ b.job_name }}</strong>{% else %}{{ b.job_name }}{% endif %}</td>
      <td>{{ b.build_number or '—' }}</td>
      <td><span class="badge {{ b.badge }}">{{ b.status }}</span></td>
      <td>{{ b.branch or '—' }}</td>
      <td>{{ b.started_at or '—' }}</td>
      <td>{{ b.duration or '—' }}</td>
      <td>{% if b.url %}<a href="{{ b.url }}" target="_blank">open</a>{% else %}—{% endif %}</td>
    </tr>
    {% else %}
    <tr><td colspan="8" style="color:var(--muted);text-align:center">No build data</td></tr>
    {% endfor %}
    </tbody>
  </table>
</section>

<!-- ── Top failures ── -->
{% if top_failures %}
<section>
  <h2>Top Failing Tests</h2>
  <table>
    <thead><tr><th>Test Name</th><th>Suite</th><th>Failures</th><th>Last Message</th></tr></thead>
    <tbody>
    {% for f in top_failures %}
    <tr>
      <td>{{ f.test_name }}</td>
      <td>{{ f.suite or '—' }}</td>
      <td class="fail"><strong>{{ f.count }}</strong></td>
      <td style="max-width:400px;word-break:break-word">{{ f.message or '—' }}</td>
    </tr>
    {% endfor %}
    </tbody>
  </table>
</section>
{% endif %}

<!-- ── Service status ── -->
{% if services %}
<section>
  <h2>Service / Docker Status</h2>
  <table>
    <thead><tr><th>Name</th><th>Kind</th><th>Status</th><th>Detail</th><th>Checked At</th></tr></thead>
    <tbody>
    {% for s in services %}
    <tr>
      <td>{{ s.name }}</td>
      <td>{{ s.kind }}</td>
      <td><span class="badge {{ s.badge }}">{{ s.status }}</span></td>
      <td>{{ s.detail or '—' }}</td>
      <td>{{ s.checked_at }}</td>
    </tr>
    {% endfor %}
    </tbody>
  </table>
</section>
{% endif %}

</body>
</html>
"""


def _status_badge(status: str) -> str:
    s = status.lower()
    if s in ("success", "passed", "up"):
        return "badge-ok"
    if s in ("failure", "failed", "error", "down"):
        return "badge-fail"
    if s in ("unstable", "degraded", "skipped"):
        return "badge-warn"
    return "badge-info"


class HtmlReporter:
    """Generate a self-contained HTML report from a CISnapshot."""

    def write(
        self,
        snapshot: CISnapshot,
        output_path: str | Path,
        lookback: str = "7 days",
        top_n: int = 10,
    ) -> Path:
        out = Path(output_path)
        out.parent.mkdir(parents=True, exist_ok=True)

        builds_ok = sum(
            1 for b in snapshot.builds if b.status_normalized == "success"
        )
        builds_fail = sum(
            1 for b in snapshot.builds if b.status_normalized == "failure"
        )
        tests_fail = sum(
            1 for t in snapshot.tests if t.status_normalized in ("failed", "error")
        )
        tests_skip = sum(1 for t in snapshot.tests if t.status_normalized == "skipped")

        # Top failures
        fail_counter: Counter = Counter()
        fail_messages: dict[str, str] = {}
        fail_suites: dict[str, str] = {}
        for t in snapshot.tests:
            if t.status_normalized in ("failed", "error"):
                fail_counter[t.test_name] += 1
                if t.failure_message and t.failure_message.strip().lower() != "null":
                    fail_messages[t.test_name] = t.failure_message[:200]
                fail_suites[t.test_name] = t.suite or ""

        top_failures = [
            {
                "test_name": name,
                "suite": fail_suites.get(name),
                "count": count,
                "message": fail_messages.get(name),
            }
            for name, count in fail_counter.most_common(top_n)
        ]

        # Anomalies: critical jobs with ≥2 consecutive failures
        anomalies: list[str] = []
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
                if s == BuildStatus.FAILURE:
                    consecutive += 1
                else:
                    consecutive = 0
            if consecutive >= 2:
                anomalies.append(
                    f"Critical job '{job}' has {consecutive} consecutive failures!"
                )

        # Prepare template context
        build_rows = []
        for b in snapshot.builds:
            dur = (
                f"{b.duration_seconds:.0f}s" if b.duration_seconds else None
            )
            started = (
                b.started_at.strftime("%Y-%m-%d %H:%M") if b.started_at else None
            )
            build_rows.append(
                {
                    "source": b.source,
                    "job_name": b.job_name,
                    "build_number": b.build_number,
                    "status": b.status,
                    "badge": _status_badge(b.status),
                    "branch": b.branch,
                    "started_at": started,
                    "duration": dur,
                    "url": b.url,
                    "critical": b.critical,
                }
            )

        svc_rows = []
        for s in snapshot.services:
            svc_rows.append(
                {
                    "name": s.name,
                    "kind": s.kind,
                    "status": s.status,
                    "badge": _status_badge(s.status),
                    "detail": s.detail,
                    "checked_at": s.checked_at.strftime("%Y-%m-%d %H:%M:%S"),
                }
            )

        env = Environment(loader=BaseLoader())
        tmpl = env.from_string(_TEMPLATE)
        html = tmpl.render(
            generated_at=snapshot.collected_at.strftime("%Y-%m-%d %H:%M UTC"),
            lookback=lookback,
            total_builds=len(snapshot.builds),
            builds_ok=builds_ok,
            builds_fail=builds_fail,
            total_tests=len(snapshot.tests),
            tests_fail=tests_fail,
            tests_skip=tests_skip,
            builds=build_rows,
            top_failures=top_failures,
            services=svc_rows,
            anomalies=anomalies,
        )

        out.write_text(html, encoding="utf-8")
        logger.info("HTML report written -> %s", out)
        return out
