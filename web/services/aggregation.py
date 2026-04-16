"""Snapshot-derived aggregations for the dashboard (counts, summaries).

Heavy logic remains in ``web.app`` (e.g. ``/api/dashboard/summary``); extract
incrementally when stabilising public JSON shapes with Pydantic.
"""
