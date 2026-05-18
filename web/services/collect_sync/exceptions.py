"""Exceptions for the synchronous collect pipeline."""


class CollectCancelled(Exception):
    """Raised when the user requests a stop during an in-flight collection."""
