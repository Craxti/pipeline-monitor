from __future__ import annotations

import os
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi import Depends
from fastapi.testclient import TestClient


class TestAuthTokenParsing:
    def test_token_from_headers_prefers_x_api_token(self) -> None:
        from web.core.auth import token_from_headers

        assert token_from_headers("abc", "Bearer xyz") == "abc"

    def test_token_from_headers_accepts_bearer(self) -> None:
        from web.core.auth import token_from_headers

        assert token_from_headers(None, "Bearer xyz") == "xyz"
        assert token_from_headers("", "bearer  xyz ") == "xyz"

    def test_token_from_headers_ignores_non_bearer_authorization(self) -> None:
        from web.core.auth import token_from_headers

        assert token_from_headers(None, "Basic xyz") == ""


class TestSharedApiTokenResolution:
    def test_env_var_overrides_config(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from web.core.auth import shared_api_token

        monkeypatch.setenv("CICD_MON_API_TOKEN", "envtok")
        assert shared_api_token({"web": {"api_token": "cfgtok"}}) == "envtok"

    def test_config_used_when_env_missing(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from web.core.auth import shared_api_token

        monkeypatch.delenv("CICD_MON_API_TOKEN", raising=False)
        assert shared_api_token({"web": {"api_token": "cfgtok"}}) == "cfgtok"

    def test_empty_when_not_configured(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from web.core.auth import shared_api_token

        monkeypatch.delenv("CICD_MON_API_TOKEN", raising=False)
        assert shared_api_token({}) == ""


class TestRequireSharedTokenDependency:
    def test_auth_disabled_when_no_token_configured(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from web.core import auth as auth_mod

        app = FastAPI()

        @app.get("/protected", dependencies=[Depends(auth_mod.require_shared_token)])
        async def _protected():
            return {"ok": True}

        monkeypatch.delenv("CICD_MON_API_TOKEN", raising=False)
        monkeypatch.setattr(auth_mod, "load_yaml_config", lambda: {"web": {"api_token": ""}})

        client = TestClient(app)
        r = client.get("/protected")
        assert r.status_code == 200

    def test_auth_rejects_when_configured_and_missing_header(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from web.core import auth as auth_mod

        app = FastAPI()

        @app.get("/protected", dependencies=[Depends(auth_mod.require_shared_token)])
        async def _protected():
            return {"ok": True}

        monkeypatch.delenv("CICD_MON_API_TOKEN", raising=False)
        monkeypatch.setattr(auth_mod, "load_yaml_config", lambda: {"web": {"api_token": "tok"}})

        client = TestClient(app)
        r = client.get("/protected")
        assert r.status_code == 401

    def test_auth_accepts_x_api_token_header(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from web.core import auth as auth_mod

        app = FastAPI()

        @app.get("/protected", dependencies=[Depends(auth_mod.require_shared_token)])
        async def _protected():
            return {"ok": True}

        monkeypatch.delenv("CICD_MON_API_TOKEN", raising=False)
        monkeypatch.setattr(auth_mod, "load_yaml_config", lambda: {"web": {"api_token": "tok"}})

        client = TestClient(app)
        r = client.get("/protected", headers={"X-API-Token": "tok"})
        assert r.status_code == 200

    def test_auth_accepts_authorization_bearer(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from web.core import auth as auth_mod

        app = FastAPI()

        @app.get("/protected", dependencies=[Depends(auth_mod.require_shared_token)])
        async def _protected():
            return {"ok": True}

        monkeypatch.delenv("CICD_MON_API_TOKEN", raising=False)
        monkeypatch.setattr(auth_mod, "load_yaml_config", lambda: {"web": {"api_token": "tok"}})

        client = TestClient(app)
        r = client.get("/protected", headers={"Authorization": "Bearer tok"})
        assert r.status_code == 200


class TestWebCoreConfig:
    def test_normalize_config_migrates_legacy_singletons(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from web.core import config as cfg_mod

        called = {"ok": False}

        def _fake_migrate(c: dict) -> None:
            called["ok"] = True

        monkeypatch.setattr(cfg_mod, "migrate_telegram_notifications", _fake_migrate)

        cfg = {"jenkins": {"url": "http://j"}, "gitlab": {"url": "http://g"}}
        out = cfg_mod.normalize_config(cfg)

        assert called["ok"] is True
        assert "jenkins" not in out
        assert "gitlab" not in out
        assert out["jenkins_instances"][0]["url"] == "http://j"
        assert out["gitlab_instances"][0]["url"] == "http://g"
        assert out["jenkins_instances"][0]["name"] == "Jenkins"
        assert out["gitlab_instances"][0]["name"] == "GitLab"

    def test_config_store_path_uses_cicd_mon_data_dir(self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
        from web.core import config as cfg_mod

        dd = tmp_path / "dd"
        dd.mkdir()
        monkeypatch.setenv("CICD_MON_DATA_DIR", str(dd))
        p = cfg_mod.config_yaml_path()
        assert p == dd / "monitor.db"

    def test_data_dir_bootstrap_from_legacy_config_yaml(self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
        from web.core import config as cfg_mod
        from web.core import paths as paths_mod

        repo = tmp_path / "repo"
        repo.mkdir()
        (repo / "config.yaml").write_text(
            "general:\n  data_dir: customd\n",
            encoding="utf-8",
        )
        monkeypatch.setattr(paths_mod, "REPO_ROOT", repo)
        p = cfg_mod.data_dir_bootstrap()
        assert p == (repo / "customd").resolve()
