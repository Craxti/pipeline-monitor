"""
SQLite persistence layer for CI/CD Monitor.

The latest dashboard snapshot lives in ``meta``; persisted event feed and trends
history use dedicated SQLite tables. Historical builds/tests/services use
``dim_values`` for repeated strings (dual-write with legacy TEXT columns).
SQLite also accumulates historical builds/tests/services across collect cycles.

Features provided:
- `set_latest_snapshot_json` / `get_latest_snapshot_raw` — current snapshot document
- Event feed and trends history in compact SQLite tables
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
import gzip
from hashlib import sha1
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Generator, Optional

from models.models import normalize_build_status

logger = logging.getLogger(__name__)

_DB_PATH: Optional[Path] = None
_SCHEMA_VERSION = 6

# ``meta`` keys for dashboard document storage (formerly data/*.json).
META_LATEST_SNAPSHOT = "latest_snapshot_json"
META_LATEST_SNAPSHOT_SEQ = "latest_snapshot_seq"
META_EVENT_FEED = "event_feed_json"
META_TRENDS_HISTORY = "trends_history_json"
# Full app configuration JSON (replaces `config.yaml` in production).
META_APP_CONFIG_JSON = "app_config_json"
META_RETENTION_LAST_RUN_AT = "retention_last_run_at"
META_VACUUM_LAST_RUN_AT = "vacuum_last_run_at"


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

        -- Compact persisted event feed (one row per event).
        CREATE TABLE IF NOT EXISTS event_feed_events (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            event_id        TEXT,
            ts              TEXT NOT NULL,
            kind            TEXT,
            level           TEXT,
            title           TEXT,
            detail          TEXT,
            url             TEXT,
            critical        INTEGER DEFAULT 0,
            source          TEXT,
            source_instance TEXT,
            job_name        TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_ev_ts   ON event_feed_events(ts);
        CREATE INDEX IF NOT EXISTS idx_ev_kind ON event_feed_events(kind);

        -- One row per day trends bucket.
        CREATE TABLE IF NOT EXISTS daily_trends (
            date         TEXT PRIMARY KEY,
            ts           TEXT,
            payload_json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_daily_trends_ts ON daily_trends(ts);

        -- Shared storage for deduplicated large text payloads.
        CREATE TABLE IF NOT EXISTS text_blobs (
            hash     TEXT PRIMARY KEY,
            body     BLOB NOT NULL,
            encoding TEXT NOT NULL DEFAULT 'plain'
        );

        -- Generic dictionary for repeated string values (domain + value).
        CREATE TABLE IF NOT EXISTS dim_values (
            id     INTEGER PRIMARY KEY AUTOINCREMENT,
            domain TEXT NOT NULL,
            value  TEXT NOT NULL,
            UNIQUE(domain, value)
        );
        CREATE INDEX IF NOT EXISTS idx_dim_domain_value ON dim_values(domain, value);
    """
    )
    _ensure_compact_columns(conn)
    _backfill_epoch_columns(conn)
    _migrate_meta_blobs_to_tables(conn)
    _backfill_compact_refs(conn)
    _backfill_bts_dim_ids(conn)
    conn.execute(
        "INSERT INTO meta (key, value) VALUES ('schema_version', ?) "
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (str(_SCHEMA_VERSION),),
    )
    _migrate_dedup_keys(conn)


def _ensure_compact_columns(conn: sqlite3.Connection) -> None:
    # Epoch columns for compact sortable timestamps.
    if not _column_exists(conn, "snapshots", "collected_at_epoch"):
        conn.execute("ALTER TABLE snapshots ADD COLUMN collected_at_epoch INTEGER")
    if not _column_exists(conn, "builds", "started_at_epoch"):
        conn.execute("ALTER TABLE builds ADD COLUMN started_at_epoch INTEGER")
    if not _column_exists(conn, "tests", "timestamp_epoch"):
        conn.execute("ALTER TABLE tests ADD COLUMN timestamp_epoch INTEGER")
    if not _column_exists(conn, "services", "checked_at_epoch"):
        conn.execute("ALTER TABLE services ADD COLUMN checked_at_epoch INTEGER")
    if not _column_exists(conn, "event_feed_events", "ts_epoch"):
        conn.execute("ALTER TABLE event_feed_events ADD COLUMN ts_epoch INTEGER")
    if not _column_exists(conn, "daily_trends", "ts_epoch"):
        conn.execute("ALTER TABLE daily_trends ADD COLUMN ts_epoch INTEGER")

    # Text blob references.
    if not _column_exists(conn, "tests", "failure_message_hash"):
        conn.execute("ALTER TABLE tests ADD COLUMN failure_message_hash TEXT")
    if not _column_exists(conn, "services", "detail_hash"):
        conn.execute("ALTER TABLE services ADD COLUMN detail_hash TEXT")
    if not _column_exists(conn, "event_feed_events", "detail_hash"):
        conn.execute("ALTER TABLE event_feed_events ADD COLUMN detail_hash TEXT")

    # Compressed trends payload storage.
    if not _column_exists(conn, "daily_trends", "payload_blob"):
        conn.execute("ALTER TABLE daily_trends ADD COLUMN payload_blob BLOB")
    if not _column_exists(conn, "daily_trends", "payload_encoding"):
        conn.execute("ALTER TABLE daily_trends ADD COLUMN payload_encoding TEXT")

    # Dictionary ids for compact repeated strings in feed rows.
    if not _column_exists(conn, "event_feed_events", "kind_id"):
        conn.execute("ALTER TABLE event_feed_events ADD COLUMN kind_id INTEGER")
    if not _column_exists(conn, "event_feed_events", "level_id"):
        conn.execute("ALTER TABLE event_feed_events ADD COLUMN level_id INTEGER")
    if not _column_exists(conn, "event_feed_events", "source_id"):
        conn.execute("ALTER TABLE event_feed_events ADD COLUMN source_id INTEGER")
    if not _column_exists(conn, "event_feed_events", "job_name_id"):
        conn.execute("ALTER TABLE event_feed_events ADD COLUMN job_name_id INTEGER")

    # Dictionary ids for builds / tests / services (dual-write with legacy TEXT columns).
    if not _column_exists(conn, "builds", "source_id"):
        conn.execute("ALTER TABLE builds ADD COLUMN source_id INTEGER")
    if not _column_exists(conn, "builds", "job_name_id"):
        conn.execute("ALTER TABLE builds ADD COLUMN job_name_id INTEGER")
    if not _column_exists(conn, "builds", "status_id"):
        conn.execute("ALTER TABLE builds ADD COLUMN status_id INTEGER")
    if not _column_exists(conn, "tests", "source_id"):
        conn.execute("ALTER TABLE tests ADD COLUMN source_id INTEGER")
    if not _column_exists(conn, "tests", "suite_id"):
        conn.execute("ALTER TABLE tests ADD COLUMN suite_id INTEGER")
    if not _column_exists(conn, "tests", "test_name_id"):
        conn.execute("ALTER TABLE tests ADD COLUMN test_name_id INTEGER")
    if not _column_exists(conn, "tests", "status_id"):
        conn.execute("ALTER TABLE tests ADD COLUMN status_id INTEGER")
    if not _column_exists(conn, "services", "name_id"):
        conn.execute("ALTER TABLE services ADD COLUMN name_id INTEGER")
    if not _column_exists(conn, "services", "kind_id"):
        conn.execute("ALTER TABLE services ADD COLUMN kind_id INTEGER")
    if not _column_exists(conn, "services", "status_id"):
        conn.execute("ALTER TABLE services ADD COLUMN status_id INTEGER")

    conn.execute("CREATE INDEX IF NOT EXISTS idx_snap_epoch ON snapshots(collected_at_epoch)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_b_ts_epoch ON builds(started_at_epoch)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_t_ts_epoch ON tests(timestamp_epoch)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_svc_checked_epoch ON services(checked_at_epoch)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_ev_ts_epoch ON event_feed_events(ts_epoch)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_ev_kind_id ON event_feed_events(kind_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_daily_trends_ts_epoch ON daily_trends(ts_epoch)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_b_source_id ON builds(source_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_b_job_id ON builds(job_name_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_b_status_id ON builds(status_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_t_source_id ON tests(source_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_svc_name_id ON services(name_id)")


def _backfill_bts_dim_ids(conn: sqlite3.Connection) -> None:
    """Populate dim_values FK columns from legacy TEXT (safe dual-read later)."""
    rows = conn.execute(
        "SELECT id, source, job_name, status FROM builds "
        "WHERE source_id IS NULL OR job_name_id IS NULL OR status_id IS NULL"
    ).fetchall()
    for r in rows:
        sid = _dim_get_or_create_id(conn, "build_source", r["source"])
        jid = _dim_get_or_create_id(conn, "build_job_name", r["job_name"])
        stid = _dim_get_or_create_id(conn, "build_status", r["status"])
        conn.execute(
            "UPDATE builds SET source_id=COALESCE(source_id,?), job_name_id=COALESCE(job_name_id,?), "
            "status_id=COALESCE(status_id,?) WHERE id=?",
            (sid, jid, stid, r["id"]),
        )

    rows = conn.execute(
        "SELECT id, source, suite, test_name, status FROM tests "
        "WHERE source_id IS NULL OR suite_id IS NULL OR test_name_id IS NULL OR status_id IS NULL"
    ).fetchall()
    for r in rows:
        sid = _dim_get_or_create_id(conn, "test_source", r["source"])
        suid = _dim_get_or_create_id(conn, "test_suite", r["suite"])
        nid = _dim_get_or_create_id(conn, "test_test_name", r["test_name"])
        stid = _dim_get_or_create_id(conn, "test_status", r["status"])
        conn.execute(
            "UPDATE tests SET source_id=COALESCE(source_id,?), suite_id=COALESCE(suite_id,?), "
            "test_name_id=COALESCE(test_name_id,?), status_id=COALESCE(status_id,?) WHERE id=?",
            (sid, suid, nid, stid, r["id"]),
        )

    rows = conn.execute(
        "SELECT id, name, kind, status FROM services " "WHERE name_id IS NULL OR kind_id IS NULL OR status_id IS NULL"
    ).fetchall()
    for r in rows:
        nid = _dim_get_or_create_id(conn, "svc_name", r["name"])
        kid = _dim_get_or_create_id(conn, "svc_kind", r["kind"])
        stid = _dim_get_or_create_id(conn, "svc_status", r["status"])
        conn.execute(
            "UPDATE services SET name_id=COALESCE(name_id,?), kind_id=COALESCE(kind_id,?), "
            "status_id=COALESCE(status_id,?) WHERE id=?",
            (nid, kid, stid, r["id"]),
        )


def _to_epoch_seconds(value: Any) -> int | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        try:
            iv = int(value)
            return iv if iv > 0 else None
        except Exception:
            return None
    s = str(value).strip()
    if not s:
        return None
    try:
        return int(float(s))
    except Exception:
        pass
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except Exception:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    else:
        dt = dt.astimezone(timezone.utc)
    return int(dt.timestamp())


def _backfill_epoch_columns(conn: sqlite3.Connection) -> None:
    rows = conn.execute("SELECT id,collected_at FROM snapshots WHERE collected_at_epoch IS NULL").fetchall()
    for r in rows:
        ep = _to_epoch_seconds(r["collected_at"])
        if ep is not None:
            conn.execute("UPDATE snapshots SET collected_at_epoch=? WHERE id=?", (ep, r["id"]))

    rows = conn.execute("SELECT id,started_at FROM builds WHERE started_at_epoch IS NULL").fetchall()
    for r in rows:
        ep = _to_epoch_seconds(r["started_at"])
        if ep is not None:
            conn.execute("UPDATE builds SET started_at_epoch=? WHERE id=?", (ep, r["id"]))

    rows = conn.execute("SELECT id,timestamp FROM tests WHERE timestamp_epoch IS NULL").fetchall()
    for r in rows:
        ep = _to_epoch_seconds(r["timestamp"])
        if ep is not None:
            conn.execute("UPDATE tests SET timestamp_epoch=? WHERE id=?", (ep, r["id"]))

    rows = conn.execute("SELECT id,checked_at FROM services WHERE checked_at_epoch IS NULL").fetchall()
    for r in rows:
        ep = _to_epoch_seconds(r["checked_at"])
        if ep is not None:
            conn.execute("UPDATE services SET checked_at_epoch=? WHERE id=?", (ep, r["id"]))

    rows = conn.execute("SELECT id,ts FROM event_feed_events WHERE ts_epoch IS NULL").fetchall()
    for r in rows:
        ep = _to_epoch_seconds(r["ts"])
        if ep is not None:
            conn.execute("UPDATE event_feed_events SET ts_epoch=? WHERE id=?", (ep, r["id"]))

    rows = conn.execute("SELECT date,ts FROM daily_trends WHERE ts_epoch IS NULL").fetchall()
    for r in rows:
        ep = _to_epoch_seconds(r["ts"])
        if ep is not None:
            conn.execute("UPDATE daily_trends SET ts_epoch=? WHERE date=?", (ep, r["date"]))


def _blob_put(conn: sqlite3.Connection, text: str | None) -> str | None:
    s = (text or "").strip()
    if not s:
        return None
    h = sha1(s.encode("utf-8", errors="ignore")).hexdigest()
    conn.execute(
        "INSERT OR IGNORE INTO text_blobs (hash, body, encoding) VALUES (?,?,?)",
        (h, sqlite3.Binary(s.encode("utf-8")), "plain"),
    )
    return h


def _blob_get(conn: sqlite3.Connection, h: str | None) -> str | None:
    key = (h or "").strip()
    if not key:
        return None
    row = conn.execute("SELECT body, encoding FROM text_blobs WHERE hash=?", (key,)).fetchone()
    if not row:
        return None
    body = row["body"]
    enc = str(row["encoding"] or "plain")
    try:
        raw = bytes(body) if not isinstance(body, bytes) else body
        if enc == "gzip":
            raw = gzip.decompress(raw)
        return raw.decode("utf-8", errors="replace")
    except Exception:
        return None


def _dim_get_or_create_id(conn: sqlite3.Connection, domain: str, value: Any) -> int | None:
    v = str(value or "").strip()
    if not v:
        return None
    row = conn.execute("SELECT id FROM dim_values WHERE domain=? AND value=?", (domain, v)).fetchone()
    if row:
        return int(row["id"])
    conn.execute("INSERT OR IGNORE INTO dim_values (domain, value) VALUES (?,?)", (domain, v))
    row2 = conn.execute("SELECT id FROM dim_values WHERE domain=? AND value=?", (domain, v)).fetchone()
    return int(row2["id"]) if row2 else None


def _backfill_compact_refs(conn: sqlite3.Connection) -> None:
    # Move existing long messages/details into text_blobs.
    rows = conn.execute(
        "SELECT id, failure_message FROM tests WHERE failure_message_hash IS NULL AND failure_message IS NOT NULL"
    ).fetchall()
    for r in rows:
        h = _blob_put(conn, r["failure_message"])
        if h:
            conn.execute("UPDATE tests SET failure_message_hash=?, failure_message=NULL WHERE id=?", (h, r["id"]))

    rows = conn.execute("SELECT id, detail FROM services WHERE detail_hash IS NULL AND detail IS NOT NULL").fetchall()
    for r in rows:
        h = _blob_put(conn, r["detail"])
        if h:
            conn.execute("UPDATE services SET detail_hash=?, detail=NULL WHERE id=?", (h, r["id"]))

    rows = conn.execute(
        "SELECT id, detail, kind, level, source, job_name "
        "FROM event_feed_events "
        "WHERE detail_hash IS NULL OR kind_id IS NULL OR level_id IS NULL OR source_id IS NULL OR job_name_id IS NULL"
    ).fetchall()
    for r in rows:
        h = _blob_put(conn, r["detail"])
        kind_id = _dim_get_or_create_id(conn, "event_kind", r["kind"])
        level_id = _dim_get_or_create_id(conn, "event_level", r["level"])
        source_id = _dim_get_or_create_id(conn, "event_source", r["source"])
        job_name_id = _dim_get_or_create_id(conn, "event_job_name", r["job_name"])
        conn.execute(
            "UPDATE event_feed_events SET detail_hash=COALESCE(detail_hash,?), "
            "detail=CASE WHEN detail_hash IS NULL THEN NULL ELSE detail END, "
            "kind_id=COALESCE(kind_id,?), level_id=COALESCE(level_id,?), "
            "source_id=COALESCE(source_id,?), job_name_id=COALESCE(job_name_id,?) "
            "WHERE id=?",
            (h, kind_id, level_id, source_id, job_name_id, r["id"]),
        )

    # Compress legacy plain JSON trends rows.
    rows = conn.execute(
        "SELECT date, payload_json FROM daily_trends "
        "WHERE (payload_blob IS NULL OR payload_encoding IS NULL OR payload_encoding='') "
        "AND payload_json IS NOT NULL AND payload_json <> ''"
    ).fetchall()
    for r in rows:
        raw = str(r["payload_json"]).encode("utf-8")
        conn.execute(
            "UPDATE daily_trends SET payload_blob=?, payload_encoding=?, payload_json='' WHERE date=?",
            (sqlite3.Binary(gzip.compress(raw)), "gzip", r["date"]),
        )


def _column_exists(conn: sqlite3.Connection, table: str, column: str) -> bool:
    rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
    for r in rows:
        if str(r["name"]) == column:
            return True
    return False


def _build_test_dedup_key(
    *,
    source: Any,
    suite: Any,
    test_name: Any,
    timestamp: Any,
    file_path: Any,
) -> str:
    ts = ""
    if timestamp:
        try:
            ts = timestamp.isoformat() if hasattr(timestamp, "isoformat") else str(timestamp)
        except Exception:
            ts = str(timestamp)
    # Keep key stable and compact: source/suite/name + best-effort test execution timestamp.
    # file_path is included to separate similarly named tests in different files.
    raw = f"{source or ''}|{suite or ''}|{test_name or ''}|{ts}|{file_path or ''}"
    return sha1(raw.encode("utf-8", errors="ignore")).hexdigest()


def _migrate_dedup_keys(conn: sqlite3.Connection) -> None:
    # Builds: keep one row per logical build record.
    conn.execute(
        """
        DELETE FROM builds
        WHERE id NOT IN (
            SELECT MIN(id)
            FROM builds
            WHERE source IS NOT NULL AND job_name IS NOT NULL AND build_number IS NOT NULL
            GROUP BY source, job_name, build_number
        )
        """
    )
    conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS ux_build_unique " "ON builds(source, job_name, build_number)")

    # Tests: add stable hash key and deduplicate old rows before creating unique index.
    if not _column_exists(conn, "tests", "dedup_key"):
        conn.execute("ALTER TABLE tests ADD COLUMN dedup_key TEXT")
    missing_rows = conn.execute(
        "SELECT id, source, suite, test_name, timestamp, file_path "
        "FROM tests WHERE dedup_key IS NULL OR dedup_key = ''"
    ).fetchall()
    for r in missing_rows:
        conn.execute(
            "UPDATE tests SET dedup_key=? WHERE id=?",
            (
                _build_test_dedup_key(
                    source=r["source"],
                    suite=r["suite"],
                    test_name=r["test_name"],
                    timestamp=r["timestamp"],
                    file_path=r["file_path"],
                ),
                r["id"],
            ),
        )
    conn.execute(
        """
        DELETE FROM tests
        WHERE id NOT IN (
            SELECT MIN(id)
            FROM tests
            WHERE dedup_key IS NOT NULL AND dedup_key <> ''
            GROUP BY dedup_key
        )
        """
    )
    conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS ux_tests_dedup_key " "ON tests(dedup_key)")


def _migrate_meta_blobs_to_tables(conn: sqlite3.Connection) -> None:
    # Legacy event feed list in meta -> event_feed_events rows.
    ev_count = int(conn.execute("SELECT COUNT(*) FROM event_feed_events").fetchone()[0])
    if ev_count == 0:
        raw_ev = (_meta_get(conn, META_EVENT_FEED) or "").strip()
        if raw_ev:
            try:
                items = json.loads(raw_ev)
                if isinstance(items, list):
                    for e in items:
                        if not isinstance(e, dict):
                            continue
                        ts = str(e.get("ts") or datetime.now(tz=timezone.utc).isoformat())
                        ts_epoch = _to_epoch_seconds(ts)
                        detail_hash = _blob_put(conn, e.get("detail"))
                        kind_id = _dim_get_or_create_id(conn, "event_kind", e.get("kind"))
                        level_id = _dim_get_or_create_id(conn, "event_level", e.get("level"))
                        source_id = _dim_get_or_create_id(conn, "event_source", e.get("source"))
                        job_name_id = _dim_get_or_create_id(conn, "event_job_name", e.get("job_name"))
                        conn.execute(
                            "INSERT INTO event_feed_events "
                            "(event_id,ts,ts_epoch,kind,level,title,detail,detail_hash,url,critical,"
                            "source,source_instance,job_name,kind_id,level_id,source_id,job_name_id) "
                            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                            (
                                e.get("id"),
                                ts,
                                ts_epoch,
                                e.get("kind"),
                                e.get("level"),
                                e.get("title"),
                                None,
                                detail_hash,
                                e.get("url"),
                                1 if e.get("critical") else 0,
                                e.get("source"),
                                e.get("source_instance"),
                                e.get("job_name"),
                                kind_id,
                                level_id,
                                source_id,
                                job_name_id,
                            ),
                        )
            except Exception:
                logger.debug("event_feed meta migration skipped", exc_info=True)

    # Legacy trends list in meta -> one row per day in daily_trends.
    tr_count = int(conn.execute("SELECT COUNT(*) FROM daily_trends").fetchone()[0])
    if tr_count == 0:
        raw_tr = (_meta_get(conn, META_TRENDS_HISTORY) or "").strip()
        if raw_tr:
            try:
                items = json.loads(raw_tr)
                if isinstance(items, list):
                    for item in items:
                        if not isinstance(item, dict):
                            continue
                        day = str(item.get("date") or "").strip()
                        if not day:
                            continue
                        ts = str(item.get("ts") or "")
                        ts_epoch = _to_epoch_seconds(ts)
                        payload_raw = json.dumps(item, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
                        payload_blob = sqlite3.Binary(gzip.compress(payload_raw))
                        conn.execute(
                            "INSERT OR REPLACE INTO daily_trends "
                            "(date, ts, ts_epoch, payload_json, payload_blob, payload_encoding) "
                            "VALUES (?,?,?,?,?,?)",
                            (
                                day,
                                ts,
                                ts_epoch,
                                "",
                                payload_blob,
                                "gzip",
                            ),
                        )
            except Exception:
                logger.debug("trends meta migration skipped", exc_info=True)


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
    """Open SQLite (``CICD_MON_DATA_DIR`` / ``general.data_dir`` in legacy yaml / ``data``). Returns False on failure."""
    if data_dir is not None:
        try:
            init_db(data_dir)
        except Exception:
            logger.debug("init_db(%s) failed", data_dir, exc_info=True)
        return _DB_PATH is not None
    if _DB_PATH is not None:
        return True
    try:
        import os

        from web.core.config import data_dir_bootstrap

        init_db(data_dir_bootstrap())
    except Exception:
        logger.debug("ensure_database_initialized (bootstrap) failed", exc_info=True)
    return _DB_PATH is not None


def get_app_config_from_db() -> dict | None:
    """Load JSON app config from ``meta``; ``None`` if missing or not initialized."""
    if _DB_PATH is None:
        return None
    try:
        with _conn() as conn:
            raw = _meta_get(conn, META_APP_CONFIG_JSON)
    except Exception as exc:
        logger.debug("get_app_config_from_db failed: %s", exc)
        return None
    if not (raw or "").strip():
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return None


def set_app_config_to_db(cfg: dict) -> None:
    """Serialize and store the full app configuration in ``meta`` (requires ``init_db`` first)."""
    if _DB_PATH is None:
        raise RuntimeError("DB not initialized")
    with _conn() as conn:
        _meta_set(conn, META_APP_CONFIG_JSON, json.dumps(cfg, ensure_ascii=False, separators=(",", ":")))


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


def _event_feed_list(conn: sqlite3.Connection, *, limit: int = 0) -> list[Any]:
    if limit > 0:
        rows = conn.execute(
            "SELECT e.event_id,e.ts,e.kind,e.level,e.title,e.detail,e.detail_hash,e.url,e.critical,"
            "e.source,e.source_instance,e.job_name, "
            "dk.value AS kind_v, dl.value AS level_v, ds.value AS source_v, dj.value AS job_v "
            "FROM event_feed_events e "
            "LEFT JOIN dim_values dk ON dk.id=e.kind_id "
            "LEFT JOIN dim_values dl ON dl.id=e.level_id "
            "LEFT JOIN dim_values ds ON ds.id=e.source_id "
            "LEFT JOIN dim_values dj ON dj.id=e.job_name_id "
            "ORDER BY COALESCE(e.ts_epoch,0) DESC, e.id DESC LIMIT ?",
            (limit,),
        ).fetchall()
        rows = list(reversed(rows))
    else:
        rows = conn.execute(
            "SELECT e.event_id,e.ts,e.kind,e.level,e.title,e.detail,e.detail_hash,e.url,e.critical,"
            "e.source,e.source_instance,e.job_name, "
            "dk.value AS kind_v, dl.value AS level_v, ds.value AS source_v, dj.value AS job_v "
            "FROM event_feed_events e "
            "LEFT JOIN dim_values dk ON dk.id=e.kind_id "
            "LEFT JOIN dim_values dl ON dl.id=e.level_id "
            "LEFT JOIN dim_values ds ON ds.id=e.source_id "
            "LEFT JOIN dim_values dj ON dj.id=e.job_name_id "
            "ORDER BY COALESCE(e.ts_epoch,0) ASC, e.id ASC"
        ).fetchall()
    out: list[dict[str, Any]] = []
    for r in rows:
        e: dict[str, Any] = {
            "id": r["event_id"],
            "ts": r["ts"],
            "kind": r["kind"] or r["kind_v"],
            "level": r["level"] or r["level_v"],
            "title": r["title"],
            "detail": r["detail"] if r["detail"] is not None else _blob_get(conn, r["detail_hash"]),
        }
        if r["url"]:
            e["url"] = r["url"]
        if int(r["critical"] or 0):
            e["critical"] = True
        src = r["source"] or r["source_v"]
        if src:
            e["source"] = src
        if r["source_instance"]:
            e["source_instance"] = r["source_instance"]
        job_name = r["job_name"] or r["job_v"]
        if job_name:
            e["job_name"] = job_name
        out.append(e)
    return out


def event_feed_load_list(limit: int = 300) -> list[dict[str, Any]]:
    if _DB_PATH is None:
        return []
    try:
        with _conn() as conn:
            return _event_feed_list(conn, limit=limit)
    except Exception as exc:
        logger.debug("event_feed_load_list failed: %s", exc)
        return []


def event_feed_append_slimmed(entries: list[dict[str, Any]], *, max_entries: int) -> None:
    if _DB_PATH is None or not entries:
        return
    try:
        with _conn() as conn:
            for e in entries:
                ts = str(e.get("ts") or datetime.now(tz=timezone.utc).isoformat())
                ts_epoch = _to_epoch_seconds(ts)
                detail_hash = _blob_put(conn, e.get("detail"))
                kind_id = _dim_get_or_create_id(conn, "event_kind", e.get("kind"))
                level_id = _dim_get_or_create_id(conn, "event_level", e.get("level"))
                source_id = _dim_get_or_create_id(conn, "event_source", e.get("source"))
                job_name_id = _dim_get_or_create_id(conn, "event_job_name", e.get("job_name"))
                conn.execute(
                    "INSERT INTO event_feed_events "
                    "(event_id,ts,ts_epoch,kind,level,title,detail,detail_hash,url,critical,source,source_instance,job_name,"
                    "kind_id,level_id,source_id,job_name_id) "
                    "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (
                        e.get("id"),
                        ts,
                        ts_epoch,
                        e.get("kind"),
                        e.get("level"),
                        e.get("title"),
                        None,
                        detail_hash,
                        e.get("url"),
                        1 if e.get("critical") else 0,
                        e.get("source"),
                        e.get("source_instance"),
                        e.get("job_name"),
                        kind_id,
                        level_id,
                        source_id,
                        job_name_id,
                    ),
                )
            if max_entries > 0:
                total = int(conn.execute("SELECT COUNT(*) FROM event_feed_events").fetchone()[0])
                overflow = total - max_entries
                if overflow > 0:
                    conn.execute(
                        "DELETE FROM event_feed_events WHERE id IN ("
                        "SELECT id FROM event_feed_events ORDER BY COALESCE(ts_epoch,0) ASC, id ASC LIMIT ?"
                        ")",
                        (overflow,),
                    )
    except Exception as exc:
        logger.warning("event_feed_append_slimmed failed: %s", exc)


def trends_history_load_list() -> list[dict[str, Any]]:
    if _DB_PATH is None:
        return []
    try:
        with _conn() as conn:
            rows = conn.execute(
                "SELECT date, ts, payload_json, payload_blob, payload_encoding FROM daily_trends ORDER BY date ASC"
            ).fetchall()
        out: list[dict[str, Any]] = []
        for r in rows:
            payload: Any = {}
            blob = r["payload_blob"]
            encoding = str(r["payload_encoding"] or "")
            if blob is not None and encoding:
                try:
                    raw = bytes(blob) if not isinstance(blob, bytes) else blob
                    if encoding == "gzip":
                        raw = gzip.decompress(raw)
                    payload = json.loads(raw.decode("utf-8"))
                except Exception:
                    payload = {}
            if not isinstance(payload, dict):
                try:
                    payload = json.loads(r["payload_json"] or "{}")
                except Exception:
                    payload = {}
            if not isinstance(payload, dict):
                payload = {}
            if not payload.get("date"):
                payload["date"] = r["date"]
            if r["ts"] and not payload.get("ts"):
                payload["ts"] = r["ts"]
            out.append(payload)
        return out
    except Exception as exc:
        logger.debug("trends_history_load_list failed: %s", exc)
        return []


def trends_history_save_list(history: list[dict[str, Any]]) -> None:
    if _DB_PATH is None:
        return
    try:
        with _conn() as conn:
            conn.execute("DELETE FROM daily_trends")
            for item in history:
                if not isinstance(item, dict):
                    continue
                day = str(item.get("date") or "").strip()
                if not day:
                    continue
                ts = str(item.get("ts") or "")
                ts_epoch = _to_epoch_seconds(ts)
                payload_raw = json.dumps(item, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
                conn.execute(
                    "INSERT OR REPLACE INTO daily_trends "
                    "(date, ts, ts_epoch, payload_json, payload_blob, payload_encoding) "
                    "VALUES (?,?,?,?,?,?)",
                    (
                        day,
                        ts,
                        ts_epoch,
                        "",
                        sqlite3.Binary(gzip.compress(payload_raw)),
                        "gzip",
                    ),
                )
    except Exception as exc:
        logger.warning("trends_history_save_list failed: %s", exc)


def append_snapshot(snapshot: Any) -> None:
    """Write a CISnapshot into the DB. Silently skips if DB not initialized."""
    if _DB_PATH is None:
        return
    try:
        with _conn() as conn:
            collected_at_iso = (
                snapshot.collected_at.isoformat() if snapshot.collected_at else datetime.utcnow().isoformat()
            )
            collected_at_epoch = _to_epoch_seconds(collected_at_iso)
            cur = conn.execute(
                "INSERT INTO snapshots (collected_at, collected_at_epoch, builds_count, tests_count, svcs_count) "
                "VALUES (?,?,?,?,?)",
                (
                    collected_at_iso,
                    collected_at_epoch,
                    len(snapshot.builds),
                    len(snapshot.tests),
                    len(snapshot.services),
                ),
            )
            snap_id = cur.lastrowid

            for b in snapshot.builds:
                started_at_iso = b.started_at.isoformat() if b.started_at else None
                started_at_epoch = _to_epoch_seconds(started_at_iso)
                status_str = (
                    b.status
                    if isinstance(b.status, str)
                    else (b.status.value if hasattr(b.status, "value") else str(b.status))
                )
                source_id = _dim_get_or_create_id(conn, "build_source", b.source)
                job_name_id = _dim_get_or_create_id(conn, "build_job_name", b.job_name)
                status_id = _dim_get_or_create_id(conn, "build_status", status_str)
                conn.execute(
                    "INSERT OR IGNORE INTO builds (snapshot_id,source,job_name,build_number,status,"
                    "started_at,started_at_epoch,duration_seconds,branch,commit_sha,url,critical,"
                    "source_id,job_name_id,status_id) "
                    "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (
                        snap_id,
                        b.source,
                        b.job_name,
                        b.build_number,
                        status_str,
                        started_at_iso,
                        started_at_epoch,
                        b.duration_seconds,
                        b.branch,
                        b.commit_sha,
                        b.url,
                        1 if b.critical else 0,
                        source_id,
                        job_name_id,
                        status_id,
                    ),
                )

            for t in snapshot.tests:
                dedup_key = _build_test_dedup_key(
                    source=t.source,
                    suite=t.suite,
                    test_name=t.test_name,
                    timestamp=t.timestamp,
                    file_path=t.file_path,
                )
                failure_hash = _blob_put(conn, t.failure_message[:2000] if t.failure_message else None)
                ts_iso = t.timestamp.isoformat() if t.timestamp else None
                ts_epoch = _to_epoch_seconds(ts_iso)
                source_id = _dim_get_or_create_id(conn, "test_source", t.source)
                suite_id = _dim_get_or_create_id(conn, "test_suite", t.suite)
                test_name_id = _dim_get_or_create_id(conn, "test_test_name", t.test_name)
                status_id = _dim_get_or_create_id(conn, "test_status", t.status)
                conn.execute(
                    "INSERT OR IGNORE INTO tests (snapshot_id,source,suite,test_name,status,"
                    "duration_seconds,failure_message,failure_message_hash,timestamp,timestamp_epoch,file_path,dedup_key,"
                    "source_id,suite_id,test_name_id,status_id) "
                    "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (
                        snap_id,
                        t.source,
                        t.suite,
                        t.test_name,
                        t.status,
                        t.duration_seconds,
                        None,
                        failure_hash,
                        ts_iso,
                        ts_epoch,
                        t.file_path,
                        dedup_key,
                        source_id,
                        suite_id,
                        test_name_id,
                        status_id,
                    ),
                )

            for sv in snapshot.services:
                checked_at_iso = sv.checked_at.isoformat() if sv.checked_at else None
                checked_at_epoch = _to_epoch_seconds(checked_at_iso)
                detail_hash = _blob_put(conn, sv.detail)
                name_id = _dim_get_or_create_id(conn, "svc_name", sv.name)
                kind_id = _dim_get_or_create_id(conn, "svc_kind", sv.kind)
                status_id = _dim_get_or_create_id(conn, "svc_status", sv.status)
                conn.execute(
                    "INSERT INTO services (snapshot_id,name,kind,status,detail,detail_hash,checked_at,checked_at_epoch,"
                    "name_id,kind_id,status_id) "
                    "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                    (
                        snap_id,
                        sv.name,
                        sv.kind,
                        sv.status,
                        None,
                        detail_hash,
                        checked_at_iso,
                        checked_at_epoch,
                        name_id,
                        kind_id,
                        status_id,
                    ),
                )

        logger.debug("SQLite: appended snapshot #%s", snap_id)
        _run_retention_cleanup_if_due()
    except Exception as exc:
        logger.warning("SQLite append_snapshot failed (non-fatal): %s", exc)


def _get_history_retention_days() -> int:
    """
    Read retention setting from config.
    `general.history_retention_days`:
    - 0 => keep everything (no delete)
    - N>0 => delete history older than N days
    """
    try:
        from web.core.config import load_yaml_config

        cfg = load_yaml_config() or {}
    except Exception:
        return 0
    try:
        raw = (cfg.get("general") or {}).get("history_retention_days", 0) or 0
        return max(0, int(raw))
    except Exception:
        return 0


def _run_retention_cleanup_if_due() -> None:
    if _DB_PATH is None:
        return

    retention_days = _get_history_retention_days()
    if retention_days <= 0:
        return

    try:
        now_dt = datetime.now(tz=timezone.utc)
        now_iso = now_dt.isoformat()
        with _conn() as conn:
            last_run_raw = _meta_get(conn, META_RETENTION_LAST_RUN_AT)
            if last_run_raw:
                try:
                    last_dt = datetime.fromisoformat(last_run_raw)
                    if (datetime.now(tz=timezone.utc) - last_dt) < timedelta(hours=24):
                        return
                except Exception:
                    pass

            cutoff_dt = now_dt - timedelta(days=retention_days)
            cutoff_iso = cutoff_dt.isoformat()
            cutoff_epoch = int(cutoff_dt.timestamp())

            old_snapshot_ids = [
                int(r["id"])
                for r in conn.execute(
                    "SELECT id FROM snapshots WHERE "
                    "(collected_at_epoch IS NOT NULL AND collected_at_epoch < ?) "
                    "OR (collected_at_epoch IS NULL AND collected_at < ?)",
                    (cutoff_epoch, cutoff_iso),
                ).fetchall()
            ]
            if old_snapshot_ids:
                placeholders = ",".join("?" for _ in old_snapshot_ids)
                conn.execute(f"DELETE FROM builds WHERE snapshot_id IN ({placeholders})", old_snapshot_ids)
                conn.execute(f"DELETE FROM tests WHERE snapshot_id IN ({placeholders})", old_snapshot_ids)
                conn.execute(f"DELETE FROM services WHERE snapshot_id IN ({placeholders})", old_snapshot_ids)
                conn.execute(f"DELETE FROM snapshots WHERE id IN ({placeholders})", old_snapshot_ids)

            _meta_set(conn, META_RETENTION_LAST_RUN_AT, now_iso)
            _run_incremental_vacuum_if_due(conn, now_dt=now_dt)
    except Exception as exc:
        logger.debug("Retention cleanup skipped: %s", exc)


def _run_incremental_vacuum_if_due(conn: sqlite3.Connection, *, now_dt: datetime) -> None:
    last_run_raw = _meta_get(conn, META_VACUUM_LAST_RUN_AT)
    if last_run_raw:
        try:
            last_dt = datetime.fromisoformat(last_run_raw)
            if (now_dt - last_dt) < timedelta(days=7):
                return
        except Exception:
            pass
    try:
        conn.execute("PRAGMA auto_vacuum = INCREMENTAL")
        conn.execute("PRAGMA incremental_vacuum(2000)")
        _meta_set(conn, META_VACUUM_LAST_RUN_AT, now_dt.isoformat())
    except Exception:
        logger.debug("incremental vacuum skipped", exc_info=True)


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
                "SELECT b.duration_seconds, COALESCE(b.status, st.value) AS status, b.build_number, b.started_at "
                "FROM builds b "
                "LEFT JOIN dim_values st ON st.id = b.status_id AND st.domain = 'build_status' "
                "LEFT JOIN dim_values jn ON jn.id = b.job_name_id AND jn.domain = 'build_job_name' "
                "WHERE COALESCE(b.job_name, jn.value) = ? AND b.duration_seconds IS NOT NULL "
                "ORDER BY COALESCE(b.started_at_epoch,0) DESC, b.started_at DESC LIMIT ?",
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
        cutoff_epoch = _to_epoch_seconds(cutoff) or 0
        conditions = [
            "((b.started_at_epoch IS NOT NULL AND b.started_at_epoch >= ?) "
            "OR (b.started_at_epoch IS NULL AND b.started_at >= ?))"
        ]
        params: list[Any] = [cutoff_epoch, cutoff]
        if job:
            conditions.append("COALESCE(b.job_name, b_job.value) LIKE ?")
            params.append(f"%{job}%")
        if source:
            conditions.append("COALESCE(b.source, b_src.value) = ?")
            params.append(source)
        if status:
            conditions.append("COALESCE(b.status, b_st.value) = ?")
            params.append(normalize_build_status(status))
        where = " AND ".join(conditions)
        base_from = (
            "FROM builds b "
            "LEFT JOIN dim_values b_src ON b_src.id = b.source_id AND b_src.domain = 'build_source' "
            "LEFT JOIN dim_values b_job ON b_job.id = b.job_name_id AND b_job.domain = 'build_job_name' "
            "LEFT JOIN dim_values b_st ON b_st.id = b.status_id AND b_st.domain = 'build_status' "
        )
        select_cols = (
            "b.id, b.snapshot_id, COALESCE(b.source, b_src.value) AS source, "
            "COALESCE(b.job_name, b_job.value) AS job_name, b.build_number, "
            "COALESCE(b.status, b_st.value) AS status, b.started_at, b.started_at_epoch, "
            "b.duration_seconds, b.branch, b.commit_sha, b.url, b.critical"
        )
        with _conn() as conn:
            total = conn.execute(f"SELECT COUNT(*) {base_from} WHERE {where}", params).fetchone()[0]
            rows = conn.execute(
                f"SELECT {select_cols} {base_from} WHERE {where} "
                "ORDER BY COALESCE(b.started_at_epoch,0) DESC, b.started_at DESC LIMIT ? OFFSET ?",
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
        cutoff_epoch = _to_epoch_seconds(cutoff) or 0
        with _conn() as conn:
            rows = conn.execute(
                "SELECT COALESCE(b.job_name, jn.value) AS job_name, COALESCE(b.source, src.value) AS source, "
                "COALESCE(b.status, st.value) AS status, b.started_at FROM builds b "
                "LEFT JOIN dim_values src ON src.id = b.source_id AND src.domain = 'build_source' "
                "LEFT JOIN dim_values jn ON jn.id = b.job_name_id AND jn.domain = 'build_job_name' "
                "LEFT JOIN dim_values st ON st.id = b.status_id AND st.domain = 'build_status' "
                "WHERE ((b.started_at_epoch IS NOT NULL AND b.started_at_epoch >= ?) "
                "OR (b.started_at_epoch IS NULL AND b.started_at >= ?)) "
                "AND COALESCE(b.status, st.value) IN ('success','failure') "
                "ORDER BY COALESCE(b.job_name, jn.value), COALESCE(b.started_at_epoch,0), b.started_at",
                (cutoff_epoch, cutoff),
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
        cutoff_epoch = _to_epoch_seconds(cutoff) or 0
        with _conn() as conn:
            rows = conn.execute(
                "SELECT COALESCE(s.name, nv.value) AS name, COALESCE(s.status, st.value) AS status, "
                "COALESCE(substr(s.checked_at,1,10), date(s.checked_at_epoch, 'unixepoch')) AS day "
                "FROM services s "
                "LEFT JOIN dim_values nv ON nv.id = s.name_id AND nv.domain = 'svc_name' "
                "LEFT JOIN dim_values st ON st.id = s.status_id AND st.domain = 'svc_status' "
                "WHERE ((s.checked_at_epoch IS NOT NULL AND s.checked_at_epoch >= ?) "
                "OR (s.checked_at_epoch IS NULL AND s.checked_at >= ?)) "
                "GROUP BY COALESCE(s.name, nv.value), day ORDER BY COALESCE(s.name, nv.value), day",
                (cutoff_epoch, cutoff),
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
            oldest = conn.execute(
                "SELECT COALESCE(MIN(started_at), datetime(MIN(started_at_epoch), 'unixepoch')) FROM builds"
            ).fetchone()[0]
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


def clear_runtime_data() -> dict[str, int]:
    """
    Clear collected runtime data while keeping application configuration/secrets.

    This removes snapshots, builds/tests/services history, event feed, trends and
    collector cursors. Credentials remain in config storage.
    """
    if _DB_PATH is None:
        return {
            "snapshots": 0,
            "builds": 0,
            "tests": 0,
            "services": 0,
            "events": 0,
            "trends": 0,
            "collector_state": 0,
        }
    with _conn() as conn:
        counts = {
            "snapshots": int(conn.execute("SELECT COUNT(*) FROM snapshots").fetchone()[0]),
            "builds": int(conn.execute("SELECT COUNT(*) FROM builds").fetchone()[0]),
            "tests": int(conn.execute("SELECT COUNT(*) FROM tests").fetchone()[0]),
            "services": int(conn.execute("SELECT COUNT(*) FROM services").fetchone()[0]),
            "events": int(conn.execute("SELECT COUNT(*) FROM event_feed_events").fetchone()[0]),
            "trends": int(conn.execute("SELECT COUNT(*) FROM daily_trends").fetchone()[0]),
            "collector_state": int(conn.execute("SELECT COUNT(*) FROM collector_state").fetchone()[0]),
        }
        conn.execute("DELETE FROM builds")
        conn.execute("DELETE FROM tests")
        conn.execute("DELETE FROM services")
        conn.execute("DELETE FROM snapshots")
        conn.execute("DELETE FROM event_feed_events")
        conn.execute("DELETE FROM daily_trends")
        conn.execute("DELETE FROM text_blobs")
        conn.execute("DELETE FROM dim_values")
        conn.execute("DELETE FROM collector_state")
        _meta_set(conn, META_EVENT_FEED, "[]")
        _meta_set(conn, META_TRENDS_HISTORY, "[]")
        _meta_set(conn, META_LATEST_SNAPSHOT, "")
        _meta_set(conn, META_LATEST_SNAPSHOT_SEQ, str(_snapshot_seq_get(conn) + 1))
        _meta_set(conn, META_RETENTION_LAST_RUN_AT, "")
        _meta_set(conn, META_VACUUM_LAST_RUN_AT, "")
        return counts
