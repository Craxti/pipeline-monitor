"""Incremental per-container log model (clustering + correlation + anomalies)."""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from web.services.log_intelligence.template_extractor import (
    extract_template,
    infer_level,
    template_id,
)


def _now_iso() -> str:
    return datetime.now(tz=timezone.utc).isoformat()


@dataclass
class ClusterState:
    id: str
    template: str
    count: int = 0
    level: str = "info"
    first_seen: str = ""
    last_seen: str = ""
    samples: list[str] = field(default_factory=list)


@dataclass
class AnomalyRecord:
    id: str
    ts: str
    kind: str
    severity: str
    title: str
    detail: str
    template_id: str = ""
    acknowledged: bool = False


class ContainerLogModel:
    """Live-updated model for one Docker container's logs."""

    MAX_EVENTS = 4000
    MAX_ANOMALIES = 200
    MAX_SAMPLES = 3
    MAX_GRAPH_NODES = 500
    MAX_GRAPH_EDGES = 800

    def __init__(self, *, container: str, docker_host: str = "") -> None:
        self.container = container
        self.docker_host = docker_host or ""
        self.key = f"{self.docker_host}::{self.container}"
        self.created_at = _now_iso()
        self.last_trained_at: str | None = None
        self.lines_ingested = 0
        self._last_template: str | None = None
        self._seen_templates: set[str] = set()
        self._rate_window: deque[tuple[float, str]] = deque(maxlen=500)
        self.clusters: dict[str, ClusterState] = {}
        self.transitions: dict[tuple[str, str], int] = {}
        self.anomalies: deque[AnomalyRecord] = deque(maxlen=self.MAX_ANOMALIES)
        self.recent_events: deque[dict[str, Any]] = deque(maxlen=self.MAX_EVENTS)
        self._anomaly_seq = 0

    def ingest_text(self, text: str, *, source: str = "docker") -> int:
        """Parse log blob; return number of new lines processed."""
        if not text:
            return 0
        n = 0
        for raw in text.splitlines():
            line = raw.strip()
            if not line:
                continue
            self._ingest_line(line, source=source)
            n += 1
        if n:
            self.last_trained_at = _now_iso()
        return n

    def _ingest_line(self, line: str, *, source: str) -> None:
        tpl = extract_template(line)
        if not tpl:
            return
        tid = template_id(tpl)
        lvl = infer_level(line, tpl)
        now = _now_iso()
        mono = datetime.now(tz=timezone.utc).timestamp()
        self.lines_ingested += 1

        cl = self.clusters.get(tid)
        if cl is None:
            cl = ClusterState(id=tid, template=tpl, first_seen=now, level=lvl)
            self.clusters[tid] = cl
        cl.count += 1
        cl.last_seen = now
        if lvl == "error" or (lvl == "warn" and cl.level == "info"):
            cl.level = lvl
        if len(cl.samples) < self.MAX_SAMPLES and line not in cl.samples:
            cl.samples.append(line[:400])

        if self._last_template and self._last_template != tid:
            key = (self._last_template, tid)
            self.transitions[key] = int(self.transitions.get(key, 0)) + 1
        self._last_template = tid

        self.recent_events.append(
            {
                "ts": now,
                "template_id": tid,
                "level": lvl,
                "line": line[:500],
                "source": source,
            }
        )
        self._rate_window.append((mono, tid))
        is_new_tpl = tid not in self._seen_templates
        self._check_anomalies(tid=tid, tpl=tpl, lvl=lvl, line=line, now=now, is_new_tpl=is_new_tpl)
        self._seen_templates.add(tid)

    def _check_anomalies(self, *, tid: str, tpl: str, lvl: str, line: str, now: str, is_new_tpl: bool) -> None:
        if is_new_tpl and self.lines_ingested > 30:
            self._push_anomaly(
                kind="new_pattern",
                severity="warn",
                title=f"New log pattern in {self.container}",
                detail=tpl[:200],
                template_id=tid,
                now=now,
            )
        if lvl == "error":
            recent_err = sum(1 for e in list(self.recent_events)[-40:] if e.get("level") == "error")
            if recent_err >= 8:
                self._push_anomaly(
                    kind="error_burst",
                    severity="critical",
                    title=f"Error burst in {self.container}",
                    detail=f"{recent_err} errors in last 40 events",
                    template_id=tid,
                    now=now,
                )
        if len(self._rate_window) >= 60:
            span = self._rate_window[-1][0] - self._rate_window[0][0]
            if span > 0 and span < 120:
                rate = len(self._rate_window) / span
                if rate > 25:
                    self._push_anomaly(
                        kind="rate_spike",
                        severity="warn",
                        title=f"High log rate in {self.container}",
                        detail=f"~{rate:.1f} events/s over {span:.0f}s",
                        template_id=tid,
                        now=now,
                    )
        cl = self.clusters.get(tid)
        if cl and cl.count == 1 and lvl == "error":
            self._push_anomaly(
                kind="first_error",
                severity="critical",
                title=f"First-seen error in {self.container}",
                detail=line[:240],
                template_id=tid,
                now=now,
            )

    def _push_anomaly(
        self,
        *,
        kind: str,
        severity: str,
        title: str,
        detail: str,
        template_id: str,
        now: str,
    ) -> None:
        if self.anomalies:
            last = self.anomalies[-1]
            if last.kind == kind and last.template_id == template_id:
                if (datetime.fromisoformat(now) - datetime.fromisoformat(last.ts)).total_seconds() < 90:
                    return
        self._anomaly_seq += 1
        self.anomalies.append(
            AnomalyRecord(
                id=f"anom_{self._anomaly_seq}",
                ts=now,
                kind=kind,
                severity=severity,
                title=title,
                detail=detail,
                template_id=template_id,
            )
        )

    def summary(self, *, status: str = "") -> dict[str, Any]:
        open_anom = sum(1 for a in self.anomalies if not a.acknowledged)
        return {
            "key": self.key,
            "container": self.container,
            "docker_host": self.docker_host,
            "status": status,
            "clusters": len(self.clusters),
            "events": self.lines_ingested,
            "transitions": len(self.transitions),
            "anomalies_open": open_anom,
            "last_trained_at": self.last_trained_at,
            "model_ready": self.lines_ingested >= 20,
            "created_at": self.created_at,
        }

    def detail_payload(self) -> dict[str, Any]:
        clusters = sorted(
            self.clusters.values(),
            key=lambda c: c.count,
            reverse=True,
        )
        nodes, edges = self._correlation_graph()
        anomalies = list(self.anomalies)[-50:]
        return {
            "key": self.key,
            "container": self.container,
            "docker_host": self.docker_host,
            "lines_ingested": self.lines_ingested,
            "last_trained_at": self.last_trained_at,
            "pipeline": {
                "clustering": {
                    "status": "ready" if self.lines_ingested >= 20 else "warming",
                    "clusters": len(self.clusters),
                    "description": "Templates grouped by normalized log patterns",
                },
                "correlation": {
                    "status": "ready" if len(self.transitions) >= 3 else "warming",
                    "edges": len(self.transitions),
                    "description": "Directed edges = temporal template transitions",
                },
                "anomaly": {
                    "status": "ready" if self.lines_ingested >= 50 else "warming",
                    "open": sum(1 for a in self.anomalies if not a.acknowledged),
                    "description": "Streaming checks on new patterns, bursts, and rates",
                },
            },
            "clusters": [
                {
                    "id": c.id,
                    "template": c.template,
                    "count": c.count,
                    "level": c.level,
                    "first_seen": c.first_seen,
                    "last_seen": c.last_seen,
                    "samples": c.samples,
                }
                for c in clusters
            ],
            "correlation": {"nodes": nodes, "edges": edges},
            "anomalies": [
                {
                    "id": a.id,
                    "ts": a.ts,
                    "kind": a.kind,
                    "severity": a.severity,
                    "title": a.title,
                    "detail": a.detail,
                    "template_id": a.template_id,
                    "acknowledged": a.acknowledged,
                }
                for a in anomalies
            ],
            "recent_events": list(self.recent_events)[-120:],
        }

    def _correlation_graph(self) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        in_deg: dict[str, int] = {}
        out_deg: dict[str, int] = {}
        for (a, b), w in self.transitions.items():
            out_deg[a] = out_deg.get(a, 0) + w
            in_deg[b] = in_deg.get(b, 0) + w
            in_deg.setdefault(a, in_deg.get(a, 0))
            out_deg.setdefault(b, out_deg.get(b, 0))

        node_ids: set[str] = set(self.clusters.keys())
        for a, b in self.transitions:
            node_ids.add(a)
            node_ids.add(b)

        ranked = sorted(
            node_ids,
            key=lambda tid: (
                -(self.clusters[tid].count if tid in self.clusters else 0),
                tid,
            ),
        )
        if len(ranked) > self.MAX_GRAPH_NODES:
            ranked = ranked[: self.MAX_GRAPH_NODES]

        nodes: list[dict[str, Any]] = []
        for tid in ranked:
            cl = self.clusters.get(tid)
            tpl = (cl.template if cl else tid)[:80]
            inde = in_deg.get(tid, 0)
            outd = out_deg.get(tid, 0)
            role = "normal"
            if outd >= 3 and inde <= 1:
                role = "root"
            elif inde >= 3 and outd <= 1:
                role = "leaf"
            elif inde >= 2 and outd >= 2:
                role = "hub"
            nodes.append(
                {
                    "id": tid,
                    "label": tpl[:48] + ("…" if len(tpl) > 48 else ""),
                    "count": cl.count if cl else 0,
                    "level": cl.level if cl else "info",
                    "role": role,
                    "in_degree": inde,
                    "out_degree": outd,
                }
            )

        edges: list[dict[str, Any]] = []
        edge_items = sorted(self.transitions.items(), key=lambda x: -x[1])
        if len(edge_items) > self.MAX_GRAPH_EDGES:
            edge_items = edge_items[: self.MAX_GRAPH_EDGES]
        for (a, b), w in edge_items:
            edges.append(
                {
                    "from": a,
                    "to": b,
                    "weight": w,
                    "label": str(w),
                    "title": f"{w} transitions",
                }
            )
        return nodes, edges

    def pop_new_anomalies(self) -> list[AnomalyRecord]:
        """Return anomalies not yet pushed to notifications."""
        out = [a for a in self.anomalies if not a.acknowledged and not getattr(a, "_notified", False)]
        for a in out:
            a._notified = True  # type: ignore[attr-defined]
        return out

    def to_storage_dict(self) -> dict[str, Any]:
        return {
            "container": self.container,
            "docker_host": self.docker_host,
            "created_at": self.created_at,
            "last_trained_at": self.last_trained_at,
            "lines_ingested": self.lines_ingested,
            "last_template": self._last_template,
            "seen_templates": sorted(self._seen_templates),
            "rate_window": [[mono, tid] for mono, tid in self._rate_window],
            "anomaly_seq": self._anomaly_seq,
            "clusters": [
                {
                    "id": c.id,
                    "template": c.template,
                    "count": c.count,
                    "level": c.level,
                    "first_seen": c.first_seen,
                    "last_seen": c.last_seen,
                    "samples": list(c.samples),
                }
                for c in self.clusters.values()
            ],
            "transitions": [[list(pair), weight] for pair, weight in self.transitions.items()],
            "anomalies": [
                {
                    "id": a.id,
                    "ts": a.ts,
                    "kind": a.kind,
                    "severity": a.severity,
                    "title": a.title,
                    "detail": a.detail,
                    "template_id": a.template_id,
                    "acknowledged": a.acknowledged,
                }
                for a in self.anomalies
            ],
            "recent_events": list(self.recent_events),
        }

    @classmethod
    def from_storage_dict(cls, data: dict[str, Any]) -> ContainerLogModel:
        m = cls(
            container=str(data.get("container") or ""),
            docker_host=str(data.get("docker_host") or ""),
        )
        m.created_at = str(data.get("created_at") or m.created_at)
        m.last_trained_at = data.get("last_trained_at")
        m.lines_ingested = int(data.get("lines_ingested") or 0)
        last_tpl = data.get("last_template")
        m._last_template = str(last_tpl) if last_tpl else None
        m._seen_templates = set(data.get("seen_templates") or [])
        rw: deque[tuple[float, str]] = deque(maxlen=500)
        for row in data.get("rate_window") or []:
            if isinstance(row, (list, tuple)) and len(row) >= 2:
                rw.append((float(row[0]), str(row[1])))
        m._rate_window = rw
        m._anomaly_seq = int(data.get("anomaly_seq") or 0)
        m.clusters = {}
        for row in data.get("clusters") or []:
            if not isinstance(row, dict):
                continue
            cid = str(row.get("id") or "")
            if not cid:
                continue
            m.clusters[cid] = ClusterState(
                id=cid,
                template=str(row.get("template") or cid),
                count=int(row.get("count") or 0),
                level=str(row.get("level") or "info"),
                first_seen=str(row.get("first_seen") or ""),
                last_seen=str(row.get("last_seen") or ""),
                samples=list(row.get("samples") or []),
            )
        m.transitions = {}
        for row in data.get("transitions") or []:
            if not isinstance(row, (list, tuple)) or len(row) < 2:
                continue
            pair = row[0]
            if not isinstance(pair, (list, tuple)) or len(pair) < 2:
                continue
            m.transitions[(str(pair[0]), str(pair[1]))] = int(row[1] or 0)
        m.anomalies = deque(maxlen=m.MAX_ANOMALIES)
        for row in data.get("anomalies") or []:
            if not isinstance(row, dict):
                continue
            m.anomalies.append(
                AnomalyRecord(
                    id=str(row.get("id") or ""),
                    ts=str(row.get("ts") or ""),
                    kind=str(row.get("kind") or ""),
                    severity=str(row.get("severity") or ""),
                    title=str(row.get("title") or ""),
                    detail=str(row.get("detail") or ""),
                    template_id=str(row.get("template_id") or ""),
                    acknowledged=bool(row.get("acknowledged")),
                )
            )
        m.recent_events = deque(data.get("recent_events") or [], maxlen=m.MAX_EVENTS)
        return m
