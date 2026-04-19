"""
SQLite persistence layer for CI/CD Monitor.

The latest dashboard snapshot, persisted UI event feed, and daily trends buckets
live in the ``meta`` table (replacing former ``data/*.json`` files). SQLite also
accumulates historical builds/tests/services across collect cycles.

Features provided:
- `set_latest_snapshot_json` / `get_latest_snapshot_raw` — current snapshot document
- Event feed and trends history blobs in ``meta``
- `append_snapshot(snapshot)` — write builds/services into DB (called from save_snapshot)
- `query_builds(...)` — paginated historical builds with rich filtering
- `build_duration_history(job_name, limit)` — for sparklines
- `flaky_analysis(threshold, min_runs)` — for flaky detection
- `service_uptime(days)` — per-service uptime history
"""

from __future__ import annotations

import json
import logging
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Generator, Optional

from models.models import normalize_build_status

logger = logging.getLogger(__name__)

_DB_PATH: Optional[Path] = None
_SCHEMA_VERSION = 2

# ``meta`` keys for dashboard document storage (formerly data/*.json).
META_LATEST_SNAPSHOT = "latest_snapshot_json"
META_LATEST_SNAPSHOT_SEQ = "latest_snapshot_seq"
META_EVENT_FEED = "event_feed_json"
META_TRENDS_HISTORY = "trends_history_json"


def init_db(data_dir: str | Path) -> Path:
    """Create / migrate the database. Returns the DB path."""
    global _DB_PATH
    path = Path(data_dir) / "monitor.db"
    path.parent.mkdir(parents=True, exist_ok=True)
    _DB_PATH = path
    try:
        with _conn() as conn:
            _apply_schema(conn)
            _migrate_legacy_json_files(conn, Path(data_dir))
        logger.info("SQLite DB ready: %s", path)
    except Exception as exc:
        logger.error("Failed to init SQLite DB at %s: %s", path, exc)
        _DB_PATH = None
    return path


@contextmanager
def _conn() -> Generator[sqlite3.Connection, None, None]:
    if _DB_PATH is None:
        raise RuntimeError("DB not initialized — call init_db() first")
    conn = sqlite3.connect(str(_DB_PATH), timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _apply_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS meta (
            key   TEXT PRIMARY KEY,
            value TEXT
        );

        CREATE TABLE IF NOT EXISTS snapshots (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            collected_at TEXT    NOT NULL,
            builds_count INTEGER DEFAULT 0,
            tests_count  INTEGER DEFAULT 0,
            svcs_count   INTEGER DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_snap_ts ON snapshots(collected_at);

        CREATE TABLE IF NOT EXISTS builds (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            snapshot_id      INTEGER REFERENCES snapshots(id),
            source           TEXT,
            job_name         TEXT,
            build_number     INTEGER,
            status           TEXT,
            started_at       TEXT,
            duration_seconds REAL,
            branch           TEXT,
            commit_sha       TEXT,
            url              TEXT,
            critical         INTEGER DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_b_job    ON builds(job_name);
        CREATE INDEX IF NOT EXISTS idx_b_status ON builds(status);
        CREATE INDEX IF NOT EXISTS idx_b_ts     ON builds(started_at);
        CREATE INDEX IF NOT EXISTS idx_b_snap   ON builds(snapshot_id);

        CREATE TABLE IF NOT EXISTS tests (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            snapshot_id      INTEGER REFERENCES snapshots(id),
            source           TEXT,
            suite            TEXT,
            test_name        TEXT,
            status           TEXT,
            duration_seconds REAL,
            failure_message  TEXT,
            timestamp        TEXT,
            file_path        TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_t_name ON tests(test_name);
        CREATE INDEX IF NOT EXISTS idx_t_stat ON tests(status);

        CREATE TABLE IF NOT EXISTS services (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            snapshot_id INTEGER REFERENCES snapshots(id),
            name        TEXT,
            kind        TEXT,
            status      TEXT,
            detail      TEXT,
            checked_at  TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_svc_name ON services(name);
        CREATE INDEX IF NOT EXISTS idx_svc_stat ON services(status);

        -- Collector state for incremental runs (persisted across restarts).
        -- Keyed by "kind|instance|entity" (e.g. jenkins|https://jenkins|job/path).
        CREATE TABLE IF NOT EXISTS collector_state (
            key        TEXT PRIMARY KEY,
            value      TEXT,
            updated_at TEXT
        );
    """
    )
    conn.execute(
        "INSERT INTO meta (key, value) VALUES ('schema_version', ?) "
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (str(_SCHEMA_VERSION),),
    )


def _meta_get(conn: sqlite3.Connection, key: str) -> Optional[str]:
    row = conn.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
    if not row:
        return None
    v = row[0]
    return None if v is None else str(v)


def _meta_set(conn: sqlite3.Connection, key: str, value: str) -> None:
    conn.execute(
        "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (key, value),
    )


def _snapshot_seq_get(conn: sqlite3.Connection) -> int:
    raw = _meta_get(conn, META_LATEST_SNAPSHOT_SEQ)
    if not raw:
        return 0
    try:
        return int(raw)
    except ValueError:
        return 0


def _migrate_legacy_json_files(conn: sqlite3.Connection, data_dir: Path) -> None:
    """One-time import from legacy ``snapshot.json`` / ``event_feed.json`` / ``trends.json``."""
    snap = (_meta_get(conn, META_LATEST_SNAPSHOT) or "").strip()
    if not snap:
        legacy = data_dir / "snapshot.json"
        if legacy.is_file():
            try:
                body = legacy.read_text(encoding="utf-8")
                _meta_set(conn, META_LATEST_SNAPSHOT, body)
                _meta_set(conn, META_LATEST_SNAPSHOT_SEQ, str(_snapshot_seq_get(conn) + 1))
            except OSError:
                pass

    ev = (_meta_get(conn, META_EVENT_FEED) or "").strip()
    if not ev:
        legacy = data_dir / "event_feed.json"
        if legacy.is_file():
            try:
                body = legacy.read_text(encoding="utf-8").strip()
                if body:
                    _meta_set(conn, META_EVENT_FEED, body)
                else:
                    _meta_set(conn, META_EVENT_FEED, "[]")
            except OSError:
                pass

    tr = (_meta_get(conn, META_TRENDS_HISTORY) or "").strip()
    if not tr:
        legacy = data_dir / "trends.json"
        if legacy.is_file():
            try:
                body = legacy.read_text(encoding="utf-8").strip()
                if body:
                    _meta_set(conn, META_TRENDS_HISTORY, body)
                else:
                    _meta_set(conn, META_TRENDS_HISTORY, "[]")
            except OSError:
                pass


def ensure_database_initialized(*, data_dir: str | Path | None = None) -> bool:
    """Open SQLite under ``general.data_dir`` (or explicit ``data_dir``). Returns False on failure."""
    if data_dir is not None:
        try:
            init_db(data_dir)
        except Exception:
            logger.debug("init_db(%s) failed", data_dir, exc_info=True)
        return _DB_PATH is not None
    if _DB_PATH is not None:
        return True
    try:
        from web.core.config import load_yaml_config

        cfg = load_yaml_config()
        init_db(cfg.get("general", {}).get("data_dir", "data"))
    except Exception:
        logger.debug("ensure_database_initialized (yaml) failed", exc_info=True)
    return _DB_PATH is not None


def is_db_ready() -> bool:
    return _DB_PATH is not None


def get_latest_snapshot_store_seq() -> int:
    """Return ``latest_snapshot_seq`` (0 if DB unavailable). Cheap cache invalidation probe."""
    if _DB_PATH is None:
        return 0
    try:
        with _conn() as conn:
            return _snapshot_seq_get(conn)
    except Exception as exc:
        logger.debug("get_latest_snapshot_store_seq failed: %s", exc)
        return 0


def get_latest_snapshot_raw() -> tuple[Optional[str], int]:
    """Return ``(json_text, store_seq)`` for the latest dashboard snapshot."""
    if _DB_PATH is None:
        return None, 0
    try:
        with _conn() as conn:
            body = _meta_get(conn, META_LATEST_SNAPSHOT)
            seq = _snapshot_seq_get(conn)
            return (body if (body or "").strip() else None), seq
    except Exception as exc:
        logger.debug("get_latest_snapshot_raw failed: %s", exc)
        return None, 0


def get_latest_snapshot_model() -> Any:
    """Parse latest snapshot JSON into ``CISnapshot``, or ``None``."""
    raw, _seq = get_latest_snapshot_raw()
    if not raw:
        return None
    try:
        from models.models import CISnapshot

        return CISnapshot.model_validate_json(raw)
    except Exception as exc:
        logger.warning("get_latest_snapshot_model parse failed: %s", exc)
        return None


def set_latest_snapshot_json(body: str) -> int:
    """Persist full snapshot JSON; returns monotonic ``store_seq`` for cache invalidation."""
    if _DB_PATH is None:
        return 0
    try:
        with _conn() as conn:
            _meta_set(conn, META_LATEST_SNAPSHOT, body)
            seq = _snapshot_seq_get(conn) + 1
            _meta_set(conn, META_LATEST_SNAPSHOT_SEQ, str(seq))
        return seq
    except Exception as exc:
        logger.warning("set_latest_snapshot_json failed: %s", exc)
        return 0


def _event_feed_list(conn: sqlite3.Connection) -> list[Any]:
    raw = (_meta_get(conn, META_EVENT_FEED) or "").strip()
    if not raw:
        return []
    try:
        cur = json.loads(raw)
        return cur if isinstance(cur, list) else []
    except json.JSONDecodeError:
        return []


def event_feed_load_list(limit: int = 300) -> list[dict[str, Any]]:
    if _DB_PATH is None:
        return []
    try:
        with _conn() as conn:
            cur = _event_feed_list(conn)
        return cur[-limit:] if limit > 0 else cur  # type: ignore[return-value]
    except Exception as exc:
        logger.debug("event_feed_load_list failed: %s", exc)
        return []


def event_feed_append_slimmed(entries: list[dict[str, Any]], *, max_entries: int) -> None:
    if _DB_PATH is None or not entries:
        return
    try:
        with _conn() as conn:
            cur = _event_feed_list(conn)
            for e in entries:
                cur.append(e)
            if max_entries > 0 and len(cur) > max_entries:
                cur = cur[-max_entries:]
            _meta_set(conn, META_EVENT_FEED, json.dumps(cur, ensure_ascii=False))
    except Exception as exc:
        logger.warning("event_feed_append_slimmed failed: %s", exc)


def trends_history_load_list() -> list[dict[str, Any]]:
    if _DB_PATH is None:
        return []
    try:
        with _conn() as conn:
            raw = (_meta_get(conn, META_TRENDS_HISTORY) or "").strip()
        if not raw:
            return []
        data = json.loads(raw)
        return data if isinstance(data, list) else []
    except Exception as exc:
        logger.debug("trends_history_load_list failed: %s", exc)
        return []


def trends_history_save_list(history: list[dict[str, Any]]) -> None:
    if _DB_PATH is None:
        return
    try:
        with _conn() as conn:
            _meta_set(conn, META_TRENDS_HISTORY, json.dumps(history, ensure_ascii=False, indent=2))
    except Exception as exc:
        logger.warning("trends_history_save_list failed: %s", exc)


def append_snapshot(snapshot: Any) -> None:
    """Write a CISnapshot into the DB. Silently skips if DB not initialized."""
    if _DB_PATH is None:
        return
    try:
        with _conn() as conn:
            cur = conn.execute(
                "INSERT INTO snapshots (collected_at, builds_count, tests_count, svcs_count) " "VALUES (?,?,?,?)",
                (
                    snapshot.collected_at.isoformat() if snapshot.collected_at else datetime.utcnow().isoformat(),
                    len(snapshot.builds),
                    len(snapshot.tests),
                    len(snapshot.services),
                ),
            )
            snap_id = cur.lastrowid

            for b in snapshot.builds:
                conn.execute(
                    "INSERT INTO builds (snapshot_id,source,job_name,build_number,status,"
                    "started_at,duration_seconds,branch,commit_sha,url,critical) "
                    "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                    (
                        snap_id,
                        b.source,
                        b.job_name,
                        b.build_number,
                        (
                            b.status
                            if isinstance(b.status, str)
                            else (b.status.value if hasattr(b.status, "value") else str(b.status))
                        ),
                        b.started_at.isoformat() if b.started_at else None,
                        b.duration_seconds,
                        b.branch,
                        b.commit_sha,
                        b.url,
                        1 if b.critical else 0,
                    ),
                )

            for t in snapshot.tests:
                conn.execute(
                    "INSERT INTO tests (snapshot_id,source,suite,test_name,status,"
                    "duration_seconds,failure_message,timestamp,file_path) "
                    "VALUES (?,?,?,?,?,?,?,?,?)",
                    (
                        snap_id,
                        t.source,
                        t.suite,
                        t.test_name,
                        t.status,
                        t.duration_seconds,
                        t.failure_message[:2000] if t.failure_message else None,
                        t.timestamp.isoformat() if t.timestamp else None,
                        t.file_path,
                    ),
                )

            for sv in snapshot.services:
                conn.execute(
                    "INSERT INTO services (snapshot_id,name,kind,status,detail,checked_at) " "VALUES (?,?,?,?,?,?)",
                    (
                        snap_id,
                        sv.name,
                        sv.kind,
                        sv.status,
                        sv.detail,
                        sv.checked_at.isoformat() if sv.checked_at else None,
                    ),
                )

        logger.debug("SQLite: appended snapshot #%s", snap_id)
    except Exception as exc:
        logger.warning("SQLite append_snapshot failed (non-fatal): %s", exc)


def get_collector_state_int(key: str, default: int = 0) -> int:
    """Return integer collector state value by key (or default if absent/invalid)."""
    if _DB_PATH is None:
        return default
    try:
        with _conn() as conn:
            row = conn.execute(
                "SELECT value FROM collector_state WHERE key=?",
                (str(key),),
            ).fetchone()
        if not row:
            return default
        try:
            return int(row["value"])
        except Exception:
            return default
    except Exception as exc:
        logger.debug("SQLite get_collector_state_int failed: %s", exc)
        return default


def set_collector_state_int(key: str, value: int) -> None:
    """Set integer collector state value by key (upsert)."""
    if _DB_PATH is None:
        return
    try:
        with _conn() as conn:
            conn.execute(
                "INSERT INTO collector_state (key,value,updated_at) VALUES (?,?,?) "
                "ON CONFLICT(key) DO UPDATE SET value=excluded.value, "
                "updated_at=excluded.updated_at",
                (
                    str(key),
                    str(int(value)),
                    datetime.now(tz=timezone.utc).isoformat(),
                ),
            )
    except Exception as exc:
        logger.debug("SQLite set_collector_state_int failed: %s", exc)


def build_duration_history(job_name: str, limit: int = 20) -> list[dict]:
    """Return the last N duration/status values for a job (oldest first, for sparklines)."""
    if _DB_PATH is None:
        return []
    try:
        with _conn() as conn:
            rows = conn.execute(
                "SELECT duration_seconds, status, build_number, started_at "
                "FROM builds WHERE job_name=? AND duration_seconds IS NOT NULL "
                "ORDER BY started_at DESC LIMIT ?",
                (job_name, limit),
            ).fetchall()
        # Return oldest first
        return [{"d": r["duration_seconds"], "s": r["status"], "n": r["build_number"]} for r in reversed(rows)]
    except Exception as exc:
        logger.debug("SQLite build_duration_history failed: %s", exc)
        return []


def query_builds_history(
    job: str = "",
    source: str = "",
    status: str = "",
    page: int = 1,
    per_page: int = 50,
    days: int = 90,
) -> dict:
    """Paginated historical builds from SQLite (across multiple snapshots)."""
    if _DB_PATH is None:
        return {"items": [], "total": 0, "has_more": False}
    try:
        cutoff = (datetime.now(tz=timezone.utc) - timedelta(days=days)).isoformat()
        conditions = ["started_at >= ?"]
        params: list[Any] = [cutoff]
        if job:
            conditions.append("job_name LIKE ?")
            params.append(f"%{job}%")
        if source:
            conditions.append("source = ?")
            params.append(source)
        if status:
            conditions.append("status = ?")
            params.append(normalize_build_status(status))
        where = " AND ".join(conditions)
        with _conn() as conn:
            total = conn.execute(f"SELECT COUNT(*) FROM builds WHERE {where}", params).fetchone()[0]
            rows = conn.execute(
                f"SELECT * FROM builds WHERE {where} ORDER BY started_at DESC LIMIT ? OFFSET ?",
                params + [per_page, (page - 1) * per_page],
            ).fetchall()
        items = [dict(r) for r in rows]
        return {
            "items": items,
            "total": total,
            "has_more": (page * per_page) < total,
        }
    except Exception as exc:
        logger.debug("SQLite query_builds_history failed: %s", exc)
        return {"items": [], "total": 0, "has_more": False}


def flaky_analysis(threshold: float = 0.4, min_runs: int = 4, days: int = 30) -> list[dict]:
    """Detect flaky jobs (alternating success/failure) using historical DB data."""
    if _DB_PATH is None:
        return []
    try:
        cutoff = (datetime.now(tz=timezone.utc) - timedelta(days=days)).isoformat()
        with _conn() as conn:
            rows = conn.execute(
                "SELECT job_name, source, status, started_at FROM builds "
                "WHERE started_at >= ? AND status IN ('success','failure') "
                "ORDER BY job_name, started_at",
                (cutoff,),
            ).fetchall()

        # Group by job
        by_job: dict[str, list] = {}
        for r in rows:
            (by_job.setdefault((r["job_name"], r["source"]), [])).append(r["status"])

        flaky = []
        for (job, src), statuses in by_job.items():
            if len(statuses) < min_runs:
                continue
            flips = sum(1 for i in range(1, len(statuses)) if statuses[i] != statuses[i - 1])
            rate = flips / (len(statuses) - 1)
            if rate >= threshold and flips >= 2:
                flaky.append(
                    {
                        "job": job,
                        "src": src,
                        "flips": flips,
                        "total": len(statuses),
                        "flip_rate": round(rate, 2),
                        "last_status": statuses[-1],
                    }
                )
        return sorted(flaky, key=lambda x: -x["flip_rate"])
    except Exception as exc:
        logger.debug("SQLite flaky_analysis failed: %s", exc)
        return []


def service_uptime(days: int = 30) -> dict[str, list[dict]]:
    """Per-service uptime derived from the services table (daily bucket)."""
    if _DB_PATH is None:
        return {}
    try:
        cutoff = (datetime.now(tz=timezone.utc) - timedelta(days=days)).isoformat()
        with _conn() as conn:
            rows = conn.execute(
                "SELECT name, status, substr(checked_at,1,10) as day "
                "FROM services WHERE checked_at >= ? "
                "GROUP BY name, day ORDER BY name, day",
                (cutoff,),
            ).fetchall()

        result: dict[str, list] = {}
        for r in rows:
            result.setdefault(r["name"], []).append({"date": r["day"], "status": r["status"]})
        return result
    except Exception as exc:
        logger.debug("SQLite service_uptime failed: %s", exc)
        return {}


def db_stats() -> dict:
    """Return DB statistics for diagnostics."""
    if _DB_PATH is None:
        return {"enabled": False}
    try:
        with _conn() as conn:
            snap_count = conn.execute("SELECT COUNT(*) FROM snapshots").fetchone()[0]
            build_count = conn.execute("SELECT COUNT(*) FROM builds").fetchone()[0]
            svc_count = conn.execute("SELECT COUNT(*) FROM services").fetchone()[0]
            oldest = conn.execute("SELECT MIN(started_at) FROM builds").fetchone()[0]
        size_mb = round(_DB_PATH.stat().st_size / 1024 / 1024, 2)
        return {
            "enabled": True,
            "path": str(_DB_PATH),
            "size_mb": size_mb,
            "snapshots": snap_count,
            "builds": build_count,
            "services": svc_count,
            "oldest_build": oldest,
        }
    except Exception as exc:
        return {"enabled": True, "error": str(exc)}
