from __future__ import annotations


def instances_health_payload(*, collect_state: dict, instances: list) -> dict:
    return {
        "last_collected_at": collect_state.get("last_collected_at"),
        "instances": list(instances),
    }

