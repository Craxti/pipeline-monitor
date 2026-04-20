"""Service layer for Trends KPI summary payload."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

from web.services import trends_uptime


TrendsComputeFn = Callable[[int], list]
EventFeedLoadFn = Callable[[int], list[dict]]


@dataclass(frozen=True)
class TrendsKPIService:
    """Compute Trends KPI summary with explicit dependency boundary."""

    trends_compute: TrendsComputeFn
    event_feed_load: EventFeedLoadFn

    def history_summary(
        self,
        *,
        days: int,
        source_filter: str = "",
        instance_filter: str = "",
    ) -> dict:
        return trends_uptime.trends_history_summary(
            days,
            trends_compute=self.trends_compute,
            event_feed_load=self.event_feed_load,
            source_filter=source_filter,
            instance_filter=instance_filter,
        )
