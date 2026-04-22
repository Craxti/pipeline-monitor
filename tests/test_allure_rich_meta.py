from __future__ import annotations

from parsers.allure_rich_meta import (
    allure_image_attachments_from_case,
    allure_plain_description_from_case,
    normalize_allure_data_relative_path,
)


def test_normalize_attachment_single_segment() -> None:
    assert normalize_allure_data_relative_path("abc.png") == "attachments/abc.png"


def test_normalize_rejects_traversal() -> None:
    assert normalize_allure_data_relative_path("attachments/../x") is None
    assert normalize_allure_data_relative_path("/abs") is None


def test_plain_description_from_html() -> None:
    d = allure_plain_description_from_case({"descriptionHtml": "<p>Hello <b>world</b></p>"}, max_len=100)
    assert d and "Hello" in d and "world" in d


def test_plain_description_preserves_paragraph_breaks() -> None:
    html = "<p>Шаг 1. Открыть сайт.</p><p>Шаг 2. Переход в интеграции.</p>"
    d = allure_plain_description_from_case({"descriptionHtml": html}, max_len=500)
    assert d
    assert "Шаг 1" in d and "Шаг 2" in d
    assert "\n" in d


def test_image_attachments_nested_steps_octet_stream() -> None:
    case = {
        "attachments": [],
        "steps": [
            {
                "name": "screenshot",
                "attachments": [
                    {"name": "page", "type": "", "source": "a1b2-screenshot.png"},
                    {"name": "log", "type": "text/plain", "source": "x.txt"},
                ],
            }
        ],
    }
    out = allure_image_attachments_from_case(case)
    assert len(out) == 1
    assert out[0]["source"] == "a1b2-screenshot.png"
    assert out[0]["type"] == "image/png"


def test_image_attachments_filters_non_images() -> None:
    case = {
        "attachments": [
            {"name": "a", "type": "image/png", "source": "x.png"},
            {"name": "b", "type": "text/plain", "source": "y.txt"},
        ]
    }
    out = allure_image_attachments_from_case(case)
    assert len(out) == 1
    assert out[0]["source"] == "x.png"
