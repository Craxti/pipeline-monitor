"""Global store of per-container log intelligence models."""

from __future__ import annotations

import threading
from typing import Any

from web.services.log_intelligence.container_model import ContainerLogModel
from web.services.log_intelligence.persistence import load_watched_models, save_watched_models


class LogIntelStore:
    """Thread-safe registry of container models."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._models: dict[str, ContainerLogModel] = {}
        self._watched: set[str] = set()
        self._loaded = False

    def load_persisted(self) -> None:
        with self._lock:
            if self._loaded:
                return
            watched, models = load_watched_models()
            self._watched = watched
            for key, model in models.items():
                self._models[key] = model
            self._loaded = True

    def is_watched(self, key: str) -> bool:
        with self._lock:
            return key in self._watched

    def set_watched(self, key: str, watched: bool) -> bool:
        with self._lock:
            if watched:
                self._watched.add(key)
            else:
                self._watched.discard(key)
            self._persist_locked()
            return watched

    def _persist_locked(self) -> None:
        save_watched_models(watched=set(self._watched), models=self._models)

    def _maybe_persist(self, key: str) -> None:
        with self._lock:
            if key in self._watched:
                self._persist_locked()

    def get_or_create(self, *, container: str, docker_host: str = "") -> ContainerLogModel:
        key = f"{docker_host or ''}::{container}"
        with self._lock:
            m = self._models.get(key)
            if m is None:
                m = ContainerLogModel(container=container, docker_host=docker_host or "")
                self._models[key] = m
            return m

    def get(self, key: str) -> ContainerLogModel | None:
        with self._lock:
            return self._models.get(key)

    def list_summaries(self, services: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
        """Merge snapshot docker services with trained models."""
        by_key: dict[str, dict[str, Any]] = {}
        if services:
            for sv in services:
                if str(sv.get("kind") or "") != "docker":
                    continue
                name = str(sv.get("name") or "").strip()
                if not name:
                    continue
                host = str(sv.get("source_instance") or "")
                key = f"{host}::{name}"
                by_key[key] = {
                    "key": key,
                    "container": name,
                    "docker_host": host,
                    "status": str(sv.get("status") or ""),
                    "clusters": 0,
                    "events": 0,
                    "transitions": 0,
                    "anomalies_open": 0,
                    "last_trained_at": None,
                    "model_ready": False,
                    "watched": False,
                }
        with self._lock:
            watched = set(self._watched)
            for key, model in self._models.items():
                st = by_key.get(key, {}).get("status", "")
                by_key[key] = {
                    "key": key,
                    "container": model.container,
                    "docker_host": model.docker_host,
                    "status": st,
                }
                by_key[key].update(model.summary(status=st))
            for key, row in by_key.items():
                row["watched"] = key in watched
        items = list(by_key.values())
        items.sort(
            key=lambda x: (
                -int(x.get("watched") or 0),
                -int(x.get("anomalies_open") or 0),
                str(x.get("container") or ""),
            )
        )
        return items

    def ingest(
        self,
        *,
        container: str,
        docker_host: str,
        text: str,
        source: str = "docker",
    ) -> int:
        m = self.get_or_create(container=container, docker_host=docker_host)
        n = m.ingest_text(text, source=source)
        if n:
            self._maybe_persist(m.key)
        return n


log_intel_store = LogIntelStore()
