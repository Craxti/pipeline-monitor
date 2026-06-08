from __future__ import annotations

from unittest.mock import MagicMock, patch

from web.core.settings_secrets import SETTINGS_SECRET_MASK
from web.services import settings_connection_test as sct


def test_gitlab_resolves_masked_token_from_saved_config() -> None:
    saved = {
        "gitlab_instances": [
            {"name": "GL", "url": "https://gitlab.example.com", "token": "glpat-real-secret"},
        ]
    }
    payload = {
        "kind": "gitlab",
        "url": "https://gitlab.example.com",
        "token": SETTINGS_SECRET_MASK,
        "verify_ssl": True,
    }
    resolved = sct._resolve_test_payload(payload, load_cfg=lambda: saved)
    assert resolved["token"] == "glpat-real-secret"


def test_gitlab_test_uses_saved_token_when_ui_sends_mask() -> None:
    saved = {
        "gitlab_instances": [
            {"name": "GL", "url": "https://gitlab.example.com", "token": "glpat-real-secret"},
        ]
    }
    payload = {
        "kind": "gitlab",
        "url": "https://gitlab.example.com",
        "token": SETTINGS_SECRET_MASK,
        "verify_ssl": True,
    }
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.content = b'{"username":"devuser"}'
    mock_resp.json.return_value = {"username": "devuser"}
    mock_resp.raise_for_status = MagicMock()

    with patch("web.services.settings_connection_test.requests.get", return_value=mock_resp) as get:
        out = sct.check_connection(payload, load_cfg=lambda: saved)

    assert out["ok"] is True
    assert "devuser" in out["message"]
    get.assert_called_once()
    headers = get.call_args.kwargs["headers"]
    assert headers["PRIVATE-TOKEN"] == "glpat-real-secret"


def test_gitlab_mask_without_saved_match_returns_clear_error() -> None:
    out = sct.check_connection(
        {"kind": "gitlab", "url": "https://gitlab.example.com", "token": SETTINGS_SECRET_MASK},
        load_cfg=lambda: {"gitlab_instances": []},
    )
    assert out["ok"] is False
    assert "token" in out["message"].lower()
