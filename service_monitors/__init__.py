"""External service monitor adapters (Zabbix, Prometheus, etc.)."""

from service_monitors.base import MONITOR_KINDS
from service_monitors.runner import collect_instance, collect_service_monitors

__all__ = ["MONITOR_KINDS", "collect_instance", "collect_service_monitors"]
