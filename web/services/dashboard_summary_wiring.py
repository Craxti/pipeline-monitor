from __future__ import annotations

from typing import Any


def dashboard_summary_payload(
    *,
    dashboard_summary_mod,
    load_yaml_config,
    load_snapshot,
    collect_state: dict,
    instance_health: list,
    data_revision: int,
) -> dict[str, Any]:
    return dashboard_summary_mod.dashboard_summary_payload(
        load_yaml_config=load_yaml_config,
        load_snapshot=load_snapshot,
        collect_state=collect_state,
        instance_health=instance_health,
        data_revision=data_revision,
    )

