"""Test result parsers (pytest/allure)."""

from .allure_parser import AllureJsonParser
from .pytest_parser import PytestXMLParser

__all__ = ["PytestXMLParser", "AllureJsonParser"]
