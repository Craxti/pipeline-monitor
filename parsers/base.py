"""
Abstract base class for all test-report parsers.
"""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from pathlib import Path

from models.models import TestRecord

logger = logging.getLogger(__name__)


class BaseParser(ABC):
    """Interface every parser must implement."""

    @abstractmethod
    def parse_file(self, path: Path) -> list[TestRecord]:
        """Parse a single report file and return TestRecord list."""

    def parse_directory(self, directory: str | Path) -> list[TestRecord]:
        """Recursively parse all matching files in a directory."""
        dir_path = Path(directory)
        if not dir_path.is_dir():
            logger.warning("Parser: directory not found: %s", dir_path)
            return []
        records: list[TestRecord] = []
        for file in dir_path.rglob(self.glob_pattern):
            try:
                records.extend(self.parse_file(file))
            except Exception as exc:
                logger.error("Failed to parse %s: %s", file, exc)
        return records

    @property
    @abstractmethod
    def glob_pattern(self) -> str:
        """Glob pattern used by parse_directory (e.g. '*.xml')."""
