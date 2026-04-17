"""Instances health endpoint payload helper."""

from __future__ import annotations


def instances_health_payload(*, collect_state: dict, instances: list) -> dict:
    """Build payload for `/api/instances/health`."""
    return {
        "last_collected_at": collect_state.get("last_collected_at"),
        "instances": list(instances),
    }
