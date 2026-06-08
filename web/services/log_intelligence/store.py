"""Global store of per-service analysis models (clustering + correlation)."""

from __future__ import annotations

import threading
from typing import Any

from web.services.log_intelligence.container_model import ContainerLogModel
from web.services.log_intelligence.persistence import load_watched_models, save_watched_models
from web.services.log_intelligence import registry
from web.services.log_intelligence.service_keys import make_service_key, parse_service_key


class LogIntelStore:
    """Thread-safe registry of service event models."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._models: dict[str, ContainerLogModel] = {}
        self._loaded = False
        self._last_status: dict[str, str] = {}

    def load_persisted(self) -> None:
        with self._lock:
            if self._loaded:
                return
            watched, models = load_watched_models()
            for key, model in models.items():
                self._models[key] = model
            registry.migrate_legacy_watched(watched)
            self._loaded = True

    def is_enabled(self, key: str) -> bool:
        return registry.is_enabled(key)

    def is_registered(self, key: str) -> bool:
        return registry.is_registered(key)

    def _persist_locked(self) -> None:
        registry_keys = {e["service_key"] for e in registry.list_entries()}
        save_watched_models(watched=registry_keys, models=self._models)

    def _maybe_persist(self, key: str) -> None:
        with self._lock:
            if registry.is_enabled(key):
                self._persist_locked()

    def get_or_create(
        self,
        *,
        name: str,
        kind: str = "docker",
        source_instance: str = "",
        container: str | None = None,
        docker_host: str | None = None,
    ) -> ContainerLogModel:
        svc_name = str(name or container or "").strip()
        svc_kind = str(kind or "docker").strip().lower() or "docker"
        host = str(source_instance if source_instance is not None else (docker_host or "")).strip()
        key = make_service_key(kind=svc_kind, name=svc_name, source_instance=host)
        with self._lock:
            m = self._models.get(key)
            if m is None:
                m = ContainerLogModel(container=svc_name, docker_host=host, service_kind=svc_kind)
                self._models[key] = m
            return m

    def get(self, key: str) -> ContainerLogModel | None:
        with self._lock:
            m = self._models.get(key)
            if m is not None:
                return m
            try:
                host, kind, name = parse_service_key(key)
                nk = make_service_key(kind=kind, name=name, source_instance=host)
                return self._models.get(nk)
            except ValueError:
                return None

    def remove_model(self, key: str) -> None:
        with self._lock:
            self._models.pop(key, None)
            self._last_status.pop(key, None)
            self._persist_locked()

    def list_registry_summaries(self, services: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
        """Return only user-created analysis models with runtime stats."""
        status_by_key: dict[str, str] = {}
        if services:
            for sv in services:
                kind = str(sv.get("kind") or "unknown").strip().lower()
                name = str(sv.get("name") or "").strip()
                if not name:
                    continue
                host = str(sv.get("source_instance") or "")
                key = make_service_key(kind=kind, name=name, source_instance=host)
                status_by_key[key] = str(sv.get("status") or "")

        entries = registry.list_entries()
        items: list[dict[str, Any]] = []
        with self._lock:
            for entry in entries:
                key = str(entry.get("service_key") or "")
                model = self._models.get(key)
                st = status_by_key.get(key, "")
                if model is not None:
                    row = {
                        "id": entry.get("id"),
                        "display_name": entry.get("display_name"),
                        "key": key,
                        "container": model.container,
                        "service_name": model.container,
                        "service_kind": model.service_kind,
                        "docker_host": model.docker_host,
                        "source_instance": model.docker_host,
                        "status": st,
                        "enabled": bool(entry.get("enabled")),
                    }
                    row.update(model.summary(status=st))
                else:
                    row = {
                        "id": entry.get("id"),
                        "display_name": entry.get("display_name"),
                        "key": key,
                        "container": entry.get("service_name"),
                        "service_name": entry.get("service_name"),
                        "service_kind": entry.get("service_kind"),
                        "docker_host": entry.get("source_instance"),
                        "source_instance": entry.get("source_instance"),
                        "status": st,
                        "enabled": bool(entry.get("enabled")),
                        "clusters": 0,
                        "events": 0,
                        "transitions": 0,
                        "anomalies_open": 0,
                        "last_trained_at": None,
                        "model_ready": False,
                    }
                items.append(row)

        items.sort(
            key=lambda x: (
                -int(x.get("enabled") or 0),
                -int(x.get("anomalies_open") or 0),
                str(x.get("display_name") or ""),
            )
        )
        return items

    def list_summaries(self, services: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
        return self.list_registry_summaries(services)

    def create_registry_model(
        self,
        *,
        display_name: str,
        service_key: str,
        enabled: bool = True,
    ) -> dict[str, Any]:
        entry = registry.create_entry(
            display_name=display_name,
            service_key=service_key,
            enabled=enabled,
        )
        host = str(entry.get("source_instance") or "")
        kind = str(entry.get("service_kind") or "docker")
        name = str(entry.get("service_name") or "")
        self.get_or_create(name=name, kind=kind, source_instance=host)
        if enabled:
            self._maybe_persist(entry["service_key"])
        return entry

    def update_registry_model(self, model_id: int, **fields: Any) -> dict[str, Any] | None:
        entry = registry.update_entry(model_id, **fields)
        if entry:
            self._persist_locked()
        return entry

    def delete_registry_model(self, model_id: int) -> dict[str, Any] | None:
        entry = registry.delete_entry(model_id)
        if entry:
            self.remove_model(str(entry.get("service_key") or ""))
        return entry

    def ingest(
        self,
        *,
        name: str,
        kind: str = "docker",
        source_instance: str = "",
        text: str,
        source: str | None = None,
        container: str | None = None,
        docker_host: str | None = None,
    ) -> int:
        svc_name = str(name or container or "").strip()
        svc_kind = str(kind or "docker").strip().lower() or "docker"
        host = str(source_instance if source_instance is not None else (docker_host or "")).strip()
        key = make_service_key(kind=svc_kind, name=svc_name, source_instance=host)
        if not registry.is_enabled(key):
            return 0
        m = self.get_or_create(name=svc_name, kind=svc_kind, source_instance=host)
        n = m.ingest_text(text, source=source or kind)
        if n:
            self._maybe_persist(m.key)
        return n

    def ingest_line(
        self,
        *,
        name: str,
        kind: str,
        source_instance: str,
        line: str,
        source: str | None = None,
    ) -> int:
        line = str(line or "").strip()
        if not line:
            return 0
        return self.ingest(
            name=name,
            kind=kind,
            source_instance=source_instance,
            text=line + "\n",
            source=source or kind,
        )

    def train_ingest(
        self,
        *,
        name: str,
        kind: str,
        source_instance: str,
        text: str,
        source: str | None = None,
    ) -> int:
        """Ingest for manual training — registered model required, ignores enabled flag."""
        if not registry.is_registered(make_service_key(kind=kind, name=name, source_instance=source_instance)):
            return 0
        m = self.get_or_create(name=name, kind=kind, source_instance=source_instance)
        n = m.ingest_text(text, source=source or kind)
        if n:
            with self._lock:
                self._persist_locked()
        return n

    def persist_all(self) -> None:
        with self._lock:
            self._persist_locked()

    def note_service_status(
        self,
        *,
        name: str,
        kind: str,
        source_instance: str,
        status: str,
        detail: str = "",
    ) -> tuple[int, str | None]:
        """Ingest status transition as synthetic event; return (lines, prev_status)."""
        key = make_service_key(kind=kind, name=name, source_instance=source_instance)
        if not registry.is_enabled(key):
            return 0, None
        st = str(status or "").strip().lower()
        with self._lock:
            prev = self._last_status.get(key)
            if prev == st and not detail:
                return 0, prev
            self._last_status[key] = st
        lvl = "info"
        if st == "down":
            lvl = "ERROR"
        elif st in ("degraded", "unknown"):
            lvl = "WARN"
        elif st == "up":
            lvl = "INFO"
        line = f"[{lvl}] service_status={st}"
        if detail:
            line += f" detail={str(detail).strip()[:400]}"
        if prev and prev != st:
            line += f" prev={prev}"
        n = self.ingest_line(name=name, kind=kind, source_instance=source_instance, line=line)
        return n, prev


log_intel_store = LogIntelStore()
