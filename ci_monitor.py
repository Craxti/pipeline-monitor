#!/usr/bin/env python3
"""
CI/CD Monitor — main entry point.

Usage examples:
  python ci_monitor.py collect --config config.yaml
  python ci_monitor.py collect --config config.yaml --from yesterday --format all
  python ci_monitor.py report  --format html
  python ci_monitor.py web
  python ci_monitor.py docker-check
"""

from __future__ import annotations

import logging
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

import click
import yaml

from models.models import CISnapshot
from clients.jenkins_client import JenkinsClient
from clients.gitlab_client import GitLabClient
from parsers.pytest_parser import PytestXMLParser
from parsers.allure_parser import AllureJsonParser
from parsers.jenkins_console_parser import JenkinsConsoleParser
from parsers.jenkins_allure_parser import JenkinsAllureParser
from reports.csv_report import CsvReporter
from reports.html_report import HtmlReporter
from reports.console_report import ConsoleReporter
from config_migrations import migrate_telegram_notifications
from notifications.telegram_notifier import notify_telegram_from_config
from docker_monitor.monitor import DockerMonitor
from web.app import save_snapshot


# ── Optional hardcoded Jenkins overrides ──────────────────────────────────────
#
# If you want to run without putting credentials/jobs into config.yaml, you can
# set these constants прямо в коде. When set, they override every Jenkins
# instance in config.
#
# IMPORTANT: Hardcoding tokens is risky. Prefer environment variables when
# possible, but this is provided per your request.

JENKINS_USER: str = ""  # e.g. "myuser"
JENKINS_TOKEN: str = ""  # e.g. "11a8b3...."
# For Jenkins with self-signed/internal TLS certs you may need to disable SSL verification.
# Set to False to skip cert validation (not recommended for public internet).
JENKINS_VERIFY_SSL: bool | None = None  # True/False to override; None = use config/default

# If non-empty, only these Jenkins jobs will be collected (for all instances).
# Each entry becomes {"name": <job>, "critical": False, "parse_console": True}.
# If you want allowlist to apply only to one Jenkins instance, set
# JENKINS_ALLOWLIST_INSTANCE_NAME to that instance's `name` from config.yaml.
JENKINS_ALLOWLIST_INSTANCE_NAME: str = ""  # e.g. "ProofTech Jenkins"
JENKINS_JOBS_ALLOWLIST: list[str] = [
]


# ── Logging setup ─────────────────────────────────────────────────────────────

def _setup_logging(level: str = "INFO") -> None:
    logging.basicConfig(
        level=getattr(logging, level.upper(), logging.INFO),
        format="%(asctime)s  %(levelname)-8s  %(name)s — %(message)s",
        datefmt="%H:%M:%S",
    )


# ── Config helpers ────────────────────────────────────────────────────────────

def _load_config(path: str) -> dict:
    p = Path(path)
    if not p.exists():
        click.echo(f"[error] Config file not found: {p}", err=True)
        sys.exit(1)
    with p.open(encoding="utf-8") as fh:
        cfg = yaml.safe_load(fh) or {}
    return _normalize_config(cfg)


def _normalize_config(cfg: dict) -> dict:
    """Migrate legacy single jenkins/gitlab keys to multi-instance lists."""
    if "jenkins" in cfg and "jenkins_instances" not in cfg:
        inst = dict(cfg.pop("jenkins"))
        inst.setdefault("name", "Jenkins")
        cfg["jenkins_instances"] = [inst]
    if "gitlab" in cfg and "gitlab_instances" not in cfg:
        inst = dict(cfg.pop("gitlab"))
        inst.setdefault("name", "GitLab")
        cfg["gitlab_instances"] = [inst]
    migrate_telegram_notifications(cfg)
    return cfg


def _parse_since(from_arg: str) -> datetime | None:
    """Convert --from argument to a timezone-aware datetime."""
    now = datetime.now(tz=timezone.utc)
    mapping = {
        "yesterday": now - timedelta(days=1),
        "today": now.replace(hour=0, minute=0, second=0),
        "week": now - timedelta(weeks=1),
        "month": now - timedelta(days=30),
        "all": None,
    }
    if from_arg in mapping:
        return mapping[from_arg]
    # Try ISO date: 2024-01-15
    try:
        return datetime.fromisoformat(from_arg).replace(tzinfo=timezone.utc)
    except ValueError:
        # Try "Nd" for N days
        if from_arg.endswith("d"):
            try:
                days = int(from_arg[:-1])
                return now - timedelta(days=days)
            except ValueError:
                pass
    click.echo(f"[warning] Cannot parse --from '{from_arg}', defaulting to 7 days.")
    return now - timedelta(days=7)


# ── Snapshot persistence ──────────────────────────────────────────────────────

def _snapshot_path(cfg: dict) -> Path:
    data_dir = Path(cfg.get("general", {}).get("data_dir", "data"))
    data_dir.mkdir(parents=True, exist_ok=True)
    return data_dir / "snapshot.json"


def _load_snapshot(cfg: dict) -> CISnapshot:
    p = _snapshot_path(cfg)
    if p.exists():
        try:
            return CISnapshot.model_validate_json(p.read_text(encoding="utf-8"))
        except Exception:
            pass
    return CISnapshot()


def _save_snapshot(snapshot: CISnapshot, cfg: dict) -> None:
    p = _snapshot_path(cfg)
    p.write_text(snapshot.model_dump_json(indent=2), encoding="utf-8")
    save_snapshot(snapshot)  # also write to web/data location


# ── CLI root ──────────────────────────────────────────────────────────────────

@click.group()
@click.option("--config", "-c", default="config.yaml", show_default=True,
              help="Path to YAML config file.")
@click.option("--log-level", default=None, help="Override log level (DEBUG/INFO/WARNING).")
@click.pass_context
def cli(ctx: click.Context, config: str, log_level: Optional[str]) -> None:
    """CI/CD Monitor — collect, report, and watch your pipelines."""
    ctx.ensure_object(dict)
    cfg = _load_config(config)
    log_lvl = log_level or cfg.get("general", {}).get("log_level", "INFO")
    _setup_logging(log_lvl)
    ctx.obj["cfg"] = cfg


# ── collect command ───────────────────────────────────────────────────────────

@cli.command()
@click.option("--from", "from_arg", default="week", show_default=True,
              help="How far back: yesterday | today | week | month | Nd | YYYY-MM-DD | all")
@click.option("--format", "fmt", default="console",
              type=click.Choice(["console", "csv", "html", "all"], case_sensitive=False),
              show_default=True, help="Output format(s).")
@click.option("--short", is_flag=True, help="Short console summary (overrides --format for console).")
@click.option("--notify", is_flag=True, help="Send notifications after collection.")
@click.pass_context
def collect(ctx: click.Context, from_arg: str, fmt: str, short: bool, notify: bool) -> None:
    """Collect CI/CD data and optionally generate reports."""
    cfg: dict = ctx.obj["cfg"]
    since = _parse_since(from_arg)
    snapshot = CISnapshot()

    # ── Jenkins instances ─────────────────────────────────────────────────
    for inst in cfg.get("jenkins_instances", []):
        if not inst.get("enabled", True):
            continue
        username = JENKINS_USER or inst.get("username", "")
        token = JENKINS_TOKEN or inst.get("token", "")
        verify_ssl = (
            bool(inst.get("verify_ssl", True))
            if JENKINS_VERIFY_SSL is None
            else bool(JENKINS_VERIFY_SSL)
        )
        jobs = inst.get("jobs", [])
        allowlist_applies = bool(JENKINS_JOBS_ALLOWLIST) and (
            not JENKINS_ALLOWLIST_INSTANCE_NAME
            or (inst.get("name", "") == JENKINS_ALLOWLIST_INSTANCE_NAME)
        )
        # If user asked to "show all jobs" for this instance, do not force an allowlist.
        # Otherwise the UI toggle becomes confusing (show_all does nothing).
        if bool(inst.get("show_all_jobs", False)):
            allowlist_applies = False
        if allowlist_applies:
            jobs = [{"name": n, "critical": False, "parse_console": True} for n in JENKINS_JOBS_ALLOWLIST]
        logging.getLogger(__name__).info(
            "Jenkins instance '%s' url=%s user=%s verify_ssl=%s jobs=%d allowlist=%s show_all=%s",
            inst.get("name", "Jenkins"),
            inst.get("url", ""),
            username or "(empty)",
            verify_ssl,
            len(jobs),
            "on" if allowlist_applies else "off",
            bool(inst.get("show_all_jobs", False)),
        )
        client = JenkinsClient(
            url=inst["url"],
            username=username,
            token=token,
            jobs=jobs,
            timeout=15,
            show_all=inst.get("show_all_jobs", False),
            verify_ssl=verify_ssl,
        )
        snapshot.builds.extend(
            client.fetch_builds(since=since, max_builds=inst.get("max_builds", 10))
        )
        if inst.get("parse_console", False):
            console_parser = JenkinsConsoleParser(
                url=inst["url"],
                username=username,
                token=token,
                jobs=(
                    jobs
                    if jobs
                    else (
                        [{"name": n, "critical": False, "parse_console": True} for n in JenkinsClient(
                            url=inst["url"],
                            username=username,
                            token=token,
                            jobs=[],
                            timeout=15,
                            show_all=False,
                            verify_ssl=verify_ssl,
                        ).fetch_job_list()[: max(1, int(inst.get("console_jobs_limit", 25) or 25))]]
                        if inst.get("show_all_jobs", False)
                        else []
                    )
                ),
                max_builds=inst.get("console_builds", 5),
                verify_ssl=verify_ssl,
            )
            snapshot.tests.extend(console_parser.fetch_tests())

        if inst.get("parse_allure", False):
            allure_parser = JenkinsAllureParser(
                url=inst["url"],
                username=username,
                token=token,
                jobs=(
                    jobs
                    if jobs
                    else (
                        [{"name": n, "critical": False, "parse_allure": True} for n in JenkinsClient(
                            url=inst["url"],
                            username=username,
                            token=token,
                            jobs=[],
                            timeout=15,
                            show_all=False,
                            verify_ssl=verify_ssl,
                        ).fetch_job_list()[: max(1, int(inst.get("allure_jobs_limit", 25) or 25))]]
                        if inst.get("show_all_jobs", False)
                        else []
                    )
                ),
                max_builds=int(inst.get("allure_builds", inst.get("console_builds", 5)) or 5),
                verify_ssl=verify_ssl,
            )
            snapshot.tests.extend(allure_parser.fetch_tests())

    # ── GitLab instances ──────────────────────────────────────────────────
    for inst in cfg.get("gitlab_instances", []):
        if not inst.get("enabled", True):
            continue
        client = GitLabClient(
            url=inst.get("url", "https://gitlab.com"),
            token=inst.get("token", ""),
            projects=inst.get("projects", []),
            show_all=inst.get("show_all_projects", False),
        )
        snapshot.builds.extend(
            client.fetch_builds(since=since, max_builds=inst.get("max_pipelines", 10))
        )

    # ── Test parsers ──────────────────────────────────────────────────────
    p_cfg = cfg.get("parsers", {})
    pytest_parser = PytestXMLParser()
    allure_parser = AllureJsonParser()

    for d in p_cfg.get("pytest_xml_dirs", []):
        snapshot.tests.extend(pytest_parser.parse_directory(d))

    for d in p_cfg.get("allure_json_dirs", []):
        snapshot.tests.extend(allure_parser.parse_directory(d))

    # ── Docker / HTTP ─────────────────────────────────────────────────────
    dm_cfg = cfg.get("docker_monitor", {})
    if dm_cfg.get("enabled"):
        monitor = DockerMonitor(
            containers=dm_cfg.get("containers", []),
            http_checks=dm_cfg.get("http_checks", []),
            timeout=dm_cfg.get("timeout_seconds", 5),
            show_all=dm_cfg.get("show_all_containers", False),
        )
        snapshot.services = monitor.check_all()

    _save_snapshot(snapshot, cfg)
    click.echo(
        f"[collect] builds={len(snapshot.builds)}, "
        f"tests={len(snapshot.tests)}, services={len(snapshot.services)}"
    )

    # ── Reports ───────────────────────────────────────────────────────────
    _emit_reports(snapshot, cfg, fmt, short, since)

    # ── Notifications ─────────────────────────────────────────────────────
    if notify:
        _notify(snapshot, cfg)


# ── report command ────────────────────────────────────────────────────────────

@cli.command()
@click.option("--format", "fmt", default="console",
              type=click.Choice(["console", "csv", "html", "all"], case_sensitive=False))
@click.option("--short", is_flag=True)
@click.pass_context
def report(ctx: click.Context, fmt: str, short: bool) -> None:
    """Generate reports from the last collected snapshot."""
    cfg: dict = ctx.obj["cfg"]
    snapshot = _load_snapshot(cfg)
    if not snapshot.builds and not snapshot.tests and not snapshot.services:
        click.echo("[report] No data found. Run 'collect' first.")
        return
    _emit_reports(snapshot, cfg, fmt, short, since=None)


# ── web command ───────────────────────────────────────────────────────────────

@cli.command()
@click.pass_context
def web(ctx: click.Context) -> None:
    """Start the FastAPI web dashboard."""
    import os
    import uvicorn

    proj_root = Path(__file__).resolve().parent
    # Ensure this repo is on sys.path and cwd matches repo root so `import web` loads
    # our package, not another `web` from site-packages when cwd differs.
    os.chdir(proj_root)
    pr = str(proj_root)
    if pr not in sys.path:
        sys.path.insert(0, pr)

    w_cfg = ctx.obj["cfg"].get("web", {})
    host = w_cfg.get("host", "0.0.0.0")
    port = int(w_cfg.get("port", 8000))
    click.echo(f"[web] Starting dashboard at http://{host}:{port}")
    reload = bool(w_cfg.get("live_reload", True))
    if reload:
        click.echo(
            "[web] live_reload is on (uvicorn --reload). "
            "Only the `web/` tree is watched — edits under `parsers/`, `data/`, etc. do not reload the server."
        )
        click.echo(
            "[web] If the browser never loads or keeps spinning, set `web.live_reload: false` in config.yaml "
            "(constant reloads from IDE/indexers interrupt connections)."
        )
        uvicorn.run(
            "web.app:app",
            host=host,
            port=port,
            reload=True,
            reload_dirs=[str(proj_root / "web")],
            reload_excludes=[
                "**/__pycache__/**",
                "**/.pytest_cache/**",
                "**/.git/**",
                "**/*.pyc",
            ],
        )
    else:
        from web.app import app as fastapi_app

        uvicorn.run(fastapi_app, host=host, port=port)


# ── docker-check command ──────────────────────────────────────────────────────

@cli.command("docker-check")
@click.pass_context
def docker_check(ctx: click.Context) -> None:
    """Run Docker/HTTP health checks and print results."""
    cfg: dict = ctx.obj["cfg"]
    dm_cfg = cfg.get("docker_monitor", {})
    monitor = DockerMonitor(
        containers=dm_cfg.get("containers", []),
        http_checks=dm_cfg.get("http_checks", []),
        timeout=dm_cfg.get("timeout_seconds", 5),
        show_all=dm_cfg.get("show_all_containers", False),
    )
    statuses = monitor.check_all()
    if not statuses:
        click.echo("[docker-check] No services checked (configure docker_monitor in config.yaml).")
        return
    for s in statuses:
        icon = "✅" if s.status == "up" else "❌"
        click.echo(f"  {icon}  {s.name} [{s.kind}] — {s.status}  {s.detail or ''}")


# ── notify command ────────────────────────────────────────────────────────────

@cli.command()
@click.pass_context
def notify(ctx: click.Context) -> None:
    """Send notifications for the last collected snapshot."""
    cfg: dict = ctx.obj["cfg"]
    snapshot = _load_snapshot(cfg)
    _notify(snapshot, cfg)


# ── internal helpers ──────────────────────────────────────────────────────────

def _emit_reports(
    snapshot: CISnapshot,
    cfg: dict,
    fmt: str,
    short: bool,
    since: datetime | None,
) -> None:
    r_cfg = cfg.get("reports", {})
    out_dir = Path(r_cfg.get("output_dir", "data"))
    lookback = f"since {since.strftime('%Y-%m-%d') if since else 'all time'}"
    top_n = cfg.get("parsers", {}).get("top_failures", 10)

    if fmt in ("console", "all"):
        reporter = ConsoleReporter()
        if short or r_cfg.get("console_mode") == "short":
            reporter.print_short(snapshot)
        else:
            reporter.print_detailed(snapshot, top_n=top_n)

    if fmt in ("csv", "all"):
        path = out_dir / r_cfg.get("csv_filename", "ci_report.csv")
        CsvReporter().write(snapshot, path)
        click.echo(f"[report] CSV -> {path}")

    if fmt in ("html", "all"):
        path = out_dir / r_cfg.get("html_filename", "ci_report.html")
        HtmlReporter().write(snapshot, path, lookback=lookback, top_n=top_n)
        click.echo(f"[report] HTML -> {path}")


def _notify(snapshot: CISnapshot, cfg: dict) -> None:
    tg_cfg = cfg.get("notifications", {}).get("telegram", {})
    if not tg_cfg.get("enabled"):
        click.echo("[notify] Notifications disabled (set notifications.telegram.enabled: true).")
        return
    notify_telegram_from_config(snapshot, tg_cfg)
    click.echo("[notify] Telegram notifications sent (if any bots configured).")


# ── entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    cli()
