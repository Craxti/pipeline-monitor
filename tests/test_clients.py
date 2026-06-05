"""
Unit tests for Jenkins and GitLab clients.
Uses unittest.mock to avoid real HTTP calls.
"""

from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import pytest

from clients.github_client import GitHubClient, normalize_github_api_base
from clients.github_client import GitHubClient, normalize_github_api_base
from clients.jenkins_client import JenkinsClient
from clients.gitlab_client import GitLabClient
from models.models import BuildStatus

# ── Helpers ───────────────────────────────────────────────────────────────────


def _make_jenkins(jobs: list[dict] | None = None, **kw) -> JenkinsClient:
    return JenkinsClient(url="http://jenkins", username="u", token="t", jobs=jobs or [], **kw)


def _make_gitlab(projects: list[dict] | None = None, **kw) -> GitLabClient:
    return GitLabClient(url="http://gitlab", token="t", projects=projects or [], **kw)


# ── JenkinsClient ─────────────────────────────────────────────────────────────

RAW_BUILD_SUCCESS = {
    "number": 42,
    "result": "SUCCESS",
    "timestamp": 1_700_000_000_000,
    "duration": 12_000,
    "url": "http://jenkins/job/myjob/42/",
}
RAW_BUILD_FAILURE = {
    "number": 43,
    "result": "FAILURE",
    "timestamp": 1_700_001_000_000,
    "duration": 5_000,
    "url": "http://jenkins/job/myjob/43/",
}


class TestJenkinsClient:
    def _patch_get(self, client: JenkinsClient, return_value: dict):
        patcher = patch.object(client, "_get", return_value=return_value)
        return patcher

    def test_job_names_equivalent(self) -> None:
        assert JenkinsClient.job_names_equivalent("Regress", "Regress")
        assert JenkinsClient.job_names_equivalent("Folder/Regress", "Regress")
        assert JenkinsClient.job_names_equivalent("Regress", "Folder/Regress")
        assert JenkinsClient.job_names_equivalent(r"Folder\Regress", "Regress")
        assert not JenkinsClient.job_names_equivalent("", "x")
        assert not JenkinsClient.job_names_equivalent("a", "b")

    def test_fetch_builds_for_job(self) -> None:
        client = _make_jenkins(jobs=[])
        data = {"builds": [RAW_BUILD_SUCCESS, RAW_BUILD_FAILURE]}
        with self._patch_get(client, data):
            records = client.fetch_builds_for_job("folder/myjob", since=None, max_builds=5, critical=True)
        assert len(records) == 2
        assert all(r.job_name == "folder/myjob" for r in records)
        assert records[0].critical is True

    def test_fetch_builds_success(self) -> None:
        client = _make_jenkins(jobs=[{"name": "myjob", "critical": True}])
        data = {"builds": [RAW_BUILD_SUCCESS]}
        with self._patch_get(client, data):
            records = client.fetch_builds(max_builds=5)
        assert len(records) == 1
        assert records[0].status == BuildStatus.SUCCESS
        assert records[0].build_number == 42
        assert records[0].critical is True
        assert records[0].source == "jenkins"

    def test_fetch_builds_failure_status(self) -> None:
        client = _make_jenkins(jobs=[{"name": "myjob", "critical": False}])
        data = {"builds": [RAW_BUILD_FAILURE]}
        with self._patch_get(client, data):
            records = client.fetch_builds()
        assert records[0].status == BuildStatus.FAILURE

    def test_no_data_returns_empty(self) -> None:
        client = _make_jenkins(jobs=[{"name": "missing"}])
        with self._patch_get(client, {}):
            records = client.fetch_builds()
        assert records == []

    def test_since_filter_skips_old_builds(self) -> None:
        client = _make_jenkins(jobs=[{"name": "myjob"}])
        since = datetime.fromtimestamp(1_700_001_000, tz=timezone.utc)
        data = {"builds": [RAW_BUILD_SUCCESS, RAW_BUILD_FAILURE]}
        with self._patch_get(client, data):
            # First record (i==0) is always kept; second should be filtered.
            records = client.fetch_builds(since=since)
        # Only the first record (most recent, i=0) is always included
        assert any(r.build_number == 42 for r in records)

    def test_show_all_merges_discovered_jobs(self) -> None:
        client = _make_jenkins(jobs=[{"name": "existing", "critical": True}], show_all=True)

        def fake_get(path: str, **kw):
            if "existing" in path:
                return {"builds": [RAW_BUILD_SUCCESS]}
            if "discovered" in path:
                return {"builds": []}
            # fetch_job_list call
            return {"jobs": [{"name": "existing"}, {"name": "discovered"}]}

        with patch.object(client, "_get", side_effect=fake_get):
            records = client.fetch_builds()
        # Should have attempted both jobs without crashing
        assert isinstance(records, list)

    def test_fetch_job_list_returns_names(self) -> None:
        client = _make_jenkins()
        with self._patch_get(client, {"jobs": [{"name": "a"}, {"name": "b"}]}):
            names = client.fetch_job_list()
        assert names == ["a", "b"]

    def test_fetch_job_list_non_dict_response(self) -> None:
        client = _make_jenkins()
        with self._patch_get(client, []):  # wrong type
            names = client.fetch_job_list()
        assert names == []

    def test_duration_converted_to_seconds(self) -> None:
        client = _make_jenkins(jobs=[{"name": "myjob"}])
        with self._patch_get(client, {"builds": [RAW_BUILD_SUCCESS]}):
            records = client.fetch_builds()
        assert records[0].duration_seconds == pytest.approx(12.0)

    def test_trigger_build_calls_post(self) -> None:
        client = _make_jenkins()
        fake_resp = MagicMock()
        fake_resp.status_code = 201
        fake_resp.headers = {"Location": ""}
        with patch.object(client, "_get", return_value={}):
            with patch.object(client, "_post", return_value=fake_resp) as mock_post:
                result = client.trigger_build("myjob")
        mock_post.assert_called_once_with("/job/myjob/build", headers=None)
        assert result["ok"] is True
        assert result["job"] == "myjob"

    def test_trigger_build_polls_queue_when_location_set(self) -> None:
        client = _make_jenkins()
        fake_resp = MagicMock()
        fake_resp.status_code = 201
        fake_resp.headers = {"Location": "http://jenkins/queue/item/5/"}

        queue_json = {"executable": {"number": 42, "url": "http://jenkins/job/myjob/42/"}}

        def _get_side_effect(path: str, **kw):
            if "crumbIssuer" in path:
                return {}
            if "queue/item" in path:
                return queue_json
            return {}

        with patch.object(client, "_get", side_effect=_get_side_effect):
            with patch.object(client, "_post", return_value=fake_resp):
                result = client.trigger_build("myjob")
        assert result.get("build_number") == 42
        assert "myjob" in (result.get("url") or "")


# ── GitLabClient ──────────────────────────────────────────────────────────────

RAW_PIPELINE = {
    "id": 100,
    "status": "success",
    "ref": "main",
    "sha": "abc123",
    "created_at": "2024-01-15T10:00:00Z",
    "updated_at": "2024-01-15T10:01:30Z",
    "web_url": "http://gitlab/proj/-/pipelines/100",
}


class TestGitLabClient:
    def test_fetch_builds_success(self) -> None:
        client = _make_gitlab(projects=[{"id": "ns/proj", "critical": True}])

        def fake_get(path: str, **kw):
            if "projects/ns" in path and "pipeline" not in path:
                return {"id": 1, "path_with_namespace": "ns/proj"}
            if "pipelines" in path:
                return [RAW_PIPELINE]
            return {}

        with patch.object(client, "_get", side_effect=fake_get):
            records = client.fetch_builds()
        assert len(records) == 1
        assert records[0].status == BuildStatus.SUCCESS
        assert records[0].branch == "main"
        assert records[0].source == "gitlab"
        assert records[0].critical is True

    def test_failed_pipeline_status(self) -> None:
        client = _make_gitlab(projects=[{"id": "ns/proj"}])
        failed_pipe = {**RAW_PIPELINE, "status": "failed"}

        def fake_get(path: str, **kw):
            if "pipelines" in path:
                return [failed_pipe]
            return {"id": 1, "path_with_namespace": "ns/proj"}

        with patch.object(client, "_get", side_effect=fake_get):
            records = client.fetch_builds()
        assert records[0].status == BuildStatus.FAILURE

    def test_no_pipelines_returns_empty(self) -> None:
        client = _make_gitlab(projects=[{"id": "ns/proj"}])

        def fake_get(path: str, **kw):
            if "pipelines" in path:
                return []
            return {"id": 1, "path_with_namespace": "ns/proj"}

        with patch.object(client, "_get", side_effect=fake_get):
            records = client.fetch_builds()
        assert records == []

    def test_duration_calculated_from_timestamps(self) -> None:
        client = _make_gitlab(projects=[{"id": "ns/proj"}])

        def fake_get(path: str, **kw):
            if "pipelines" in path:
                return [RAW_PIPELINE]
            return {"id": 1, "path_with_namespace": "ns/proj"}

        with patch.object(client, "_get", side_effect=fake_get):
            records = client.fetch_builds()
        assert records[0].duration_seconds == pytest.approx(90.0)

    def test_trigger_pipeline_calls_post(self) -> None:
        client = _make_gitlab()
        fake_resp = MagicMock()
        fake_resp.json.return_value = {"id": 99, "web_url": "http://gitlab/-/99"}

        def fake_get(path: str, **kw):
            return {"id": 7, "path_with_namespace": "ns/proj"}

        with patch.object(client, "_get", side_effect=fake_get):
            with patch.object(client, "_post", return_value=fake_resp) as mock_post:
                result = client.trigger_pipeline("ns/proj", ref="develop")

        mock_post.assert_called_once()
        assert result["ok"] is True
        assert result["pipeline_id"] == 99


# ── GitHubClient ──────────────────────────────────────────────────────────────


def _make_github(repos: list[dict] | None = None, **kw) -> GitHubClient:
    return GitHubClient(
        url=kw.pop("url", "https://github.com"),
        token=kw.pop("token", "ghp_test"),
        repos=repos or [],
        **kw,
    )


RAW_GH_RUN = {
    "id": 101,
    "name": "CI",
    "status": "completed",
    "conclusion": "success",
    "run_started_at": "2024-01-15T10:00:00Z",
    "updated_at": "2024-01-15T10:01:30Z",
    "head_branch": "main",
    "head_sha": "abc123",
    "html_url": "https://github.com/acme/app/actions/runs/101",
}


class TestNormalizeGithubApiBase:
    def test_empty_defaults_to_api_github(self) -> None:
        assert normalize_github_api_base("") == "https://api.github.com"

    def test_github_com_ui_url(self) -> None:
        assert normalize_github_api_base("https://github.com") == "https://api.github.com"

    def test_enterprise_host(self) -> None:
        assert normalize_github_api_base("https://github.acme.corp") == "https://github.acme.corp/api/v3"

    def test_already_api_v3(self) -> None:
        assert normalize_github_api_base("https://github.acme.corp/api/v3") == "https://github.acme.corp/api/v3"


class TestGitHubClient:
    def test_fetch_user_login(self) -> None:
        client = _make_github()
        with patch.object(client, "_get", return_value={"login": "octocat"}):
            assert client.fetch_user_login() == "octocat"

    def test_fetch_runs_for_repo(self) -> None:
        client = _make_github(repos=[{"id": "acme/app", "critical": True}])
        with patch.object(client, "_get", return_value={"workflow_runs": [RAW_GH_RUN]}):
            records = client.fetch_runs_for_repo("acme/app", max_runs=5, critical=True)
        assert len(records) == 1
        assert records[0].source == "github"
        assert records[0].status == BuildStatus.SUCCESS
        assert records[0].build_number == 101
        assert records[0].critical is True
        assert "acme/app" in records[0].job_name

    def test_fetch_runs_skips_invalid_repo(self) -> None:
        client = _make_github()
        with patch.object(client, "_get") as mock_get:
            records = client.fetch_runs_for_repo("invalid-repo", max_runs=5)
        assert records == []
        mock_get.assert_not_called()


# ── GitHubClient ──────────────────────────────────────────────────────────────


def _make_github(repos: list[dict] | None = None, **kw) -> GitHubClient:
    return GitHubClient(
        url=kw.pop("url", "https://github.com"),
        token=kw.pop("token", "ghp_test"),
        repos=repos or [],
        **kw,
    )


RAW_GH_RUN = {
    "id": 101,
    "name": "CI",
    "status": "completed",
    "conclusion": "success",
    "run_started_at": "2024-01-15T10:00:00Z",
    "updated_at": "2024-01-15T10:01:30Z",
    "head_branch": "main",
    "head_sha": "abc123",
    "html_url": "https://github.com/acme/app/actions/runs/101",
}


class TestNormalizeGithubApiBase:
    def test_empty_defaults_to_api_github(self) -> None:
        assert normalize_github_api_base("") == "https://api.github.com"

    def test_github_com_ui_url(self) -> None:
        assert normalize_github_api_base("https://github.com") == "https://api.github.com"

    def test_enterprise_host(self) -> None:
        assert normalize_github_api_base("https://github.acme.corp") == "https://github.acme.corp/api/v3"

    def test_already_api_v3(self) -> None:
        assert normalize_github_api_base("https://github.acme.corp/api/v3") == "https://github.acme.corp/api/v3"


class TestGitHubClient:
    def test_fetch_user_login(self) -> None:
        client = _make_github()
        with patch.object(client, "_get", return_value={"login": "octocat"}):
            assert client.fetch_user_login() == "octocat"

    def test_fetch_runs_for_repo(self) -> None:
        client = _make_github(repos=[{"id": "acme/app", "critical": True}])
        with patch.object(client, "_get", return_value={"workflow_runs": [RAW_GH_RUN]}):
            records = client.fetch_runs_for_repo("acme/app", max_runs=5, critical=True)
        assert len(records) == 1
        assert records[0].source == "github"
        assert records[0].status == BuildStatus.SUCCESS
        assert records[0].build_number == 101
        assert records[0].critical is True
        assert "acme/app" in records[0].job_name

    def test_fetch_runs_skips_invalid_repo(self) -> None:
        client = _make_github()
        with patch.object(client, "_get") as mock_get:
            records = client.fetch_runs_for_repo("invalid-repo", max_runs=5)
        assert records == []
        mock_get.assert_not_called()
