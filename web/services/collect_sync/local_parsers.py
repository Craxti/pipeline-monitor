"""Local test parsers used by the sync collection runner."""

from __future__ import annotations


def parse_local_test_dirs(*, cfg: dict, snapshot, logger, check_cancelled=None) -> None:
    """Parse configured local directories (pytest/allure) into snapshot."""
    from parsers.pytest_parser import PytestXMLParser
    from parsers.allure_parser import AllureJsonParser

    p_cfg = cfg.get("parsers", {})
    pytest_parser = PytestXMLParser()
    allure_parser = AllureJsonParser()
    for d in p_cfg.get("pytest_xml_dirs", []):
        if check_cancelled:
            check_cancelled()
        try:
            snapshot.tests.extend(pytest_parser.parse_directory(d))
        except Exception as exc:
            logger.error("pytest parser failed for %s: %s", d, exc)
    for d in p_cfg.get("allure_json_dirs", []):
        if check_cancelled:
            check_cancelled()
        try:
            snapshot.tests.extend(allure_parser.parse_directory(d))
        except Exception as exc:
            logger.error("allure parser failed for %s: %s", d, exc)
