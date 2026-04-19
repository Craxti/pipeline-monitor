"""Property-based tests: parsers tolerate fuzzed input; webhook handler invariants."""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path

import pytest
from hypothesis import given, settings, strategies as st

ROOT = Path(__file__).parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from parsers.allure_failure_text import failure_text_from_allure_case_dict
from parsers.jenkins_console_parser import extract_pytest_failure_messages
from parsers.pytest_parser import PytestXMLParser
from web.services import webhook_endpoints, webhooks


BUILD_STATUSES = ("success", "failure", "running", "aborted", "unstable", "unknown")

webhook_core = st.fixed_dictionaries(
    {
        "job": st.text(max_size=120),
        "source": st.text(max_size=40),
        "build_number": st.one_of(st.none(), st.integers(-5000, 5000)),
        "status": st.sampled_from(BUILD_STATUSES),
        "critical": st.booleans(),
        "trigger_collect": st.just(False),
        "url": st.one_of(st.none(), st.text(max_size=200)),
        "source_instance": st.one_of(st.none(), st.text(max_size=80)),
    }
)
extra_kv = st.dictionaries(
    keys=st.text(
        min_size=1,
        max_size=12,
        alphabet=st.characters(whitelist_categories=("L", "N"), min_codepoint=33, max_codepoint=126),
    ),
    values=st.recursive(
        st.one_of(st.none(), st.booleans(), st.integers(-100, 100), st.text(max_size=40)),
        lambda children: st.one_of(
            st.lists(children, max_size=3), st.dictionaries(st.text(max_size=8), children, max_size=3)
        ),
        max_leaves=20,
    ),
    max_size=6,
)


@settings(max_examples=80, deadline=None)
@given(webhook_core, extra_kv)
def test_handle_build_complete_valid_payloads(core, extra) -> None:
    """Arbitrary extra keys + core webhook fields always yield ok + persist one build."""
    payload = {**extra, **core}

    saved: list = []

    def load_snapshot():
        return None

    def save_snapshot(snap):
        saved.append(snap)

    out = webhooks.handle_build_complete(
        payload,
        load_snapshot=load_snapshot,
        save_snapshot=save_snapshot,
        is_collecting=lambda: False,
        load_cfg=dict,
        trigger_collect=lambda _cfg: None,
    )
    assert out.get("ok") is True
    assert isinstance(out.get("message"), str)
    assert len(saved) == 1
    assert len(saved[0].builds) >= 1
    rec = saved[0].builds[0]
    assert rec.job_name == core["job"]
    assert rec.status == core["status"]


def test_handle_build_complete_trigger_collect_calls_factory() -> None:
    called: list = []

    def save_snapshot(_snap):
        return None

    out = webhooks.handle_build_complete(
        {"job": "z", "status": "failure", "trigger_collect": True},
        load_snapshot=lambda: None,
        save_snapshot=save_snapshot,
        is_collecting=lambda: False,
        load_cfg=lambda: {"k": 1},
        trigger_collect=lambda cfg: called.append(cfg),
    )
    assert out.get("ok") is True
    assert "Full collect triggered" in (out.get("message") or "")
    assert called == [{"k": 1}]


def test_webhook_endpoint_invalid_json_raises_400() -> None:
    import asyncio

    from fastapi import HTTPException, Request

    async def receive():
        return {"type": "http.request", "body": b"{not-json", "more_body": False}

    scope = {
        "type": "http",
        "asgi": {"version": "3.0", "spec_version": "2.3"},
        "http_version": "1.1",
        "method": "POST",
        "scheme": "http",
        "path": "/webhook/build-complete",
        "raw_path": b"/webhook/build-complete",
        "root_path": "",
        "query_string": b"",
        "headers": [],
        "client": ("127.0.0.1", 12345),
        "server": ("127.0.0.1", 80),
    }
    req = Request(scope, receive)

    async def run():
        await webhook_endpoints.webhook_build_complete(
            req,
            load_snapshot=lambda: None,
            save_snapshot=lambda _s: None,
            is_collecting=lambda: False,
            load_cfg=dict,
            do_collect_task_factory=lambda _c: None,
            handle_build_complete=webhooks.handle_build_complete,
        )

    with pytest.raises(HTTPException) as ei:
        asyncio.run(run())
    assert ei.value.status_code == 400


@settings(max_examples=120, deadline=None)
@given(st.text(min_size=0, max_size=8000))
def test_extract_pytest_failure_messages_never_raises(blob):
    out = extract_pytest_failure_messages(blob)
    assert isinstance(out, dict)
    for k, v in out.items():
        assert isinstance(k, str)
        assert isinstance(v, str)


@settings(max_examples=80, deadline=None)
@given(
    st.recursive(
        st.one_of(st.none(), st.booleans(), st.integers(), st.text(max_size=200)),
        lambda ch: st.one_of(st.lists(ch, max_size=4), st.dictionaries(st.text(max_size=12), ch, max_size=4)),
        max_leaves=40,
    )
)
def test_failure_text_from_allure_case_dict_never_raises(obj):
    s = failure_text_from_allure_case_dict(obj if isinstance(obj, dict) else {"x": obj})
    assert isinstance(s, str)


@settings(max_examples=80, deadline=None)
@given(xml_blob=st.text(min_size=0, max_size=4000))
def test_pytest_xml_parser_parse_file_never_raises(xml_blob: str):
    with tempfile.TemporaryDirectory() as td:
        p = Path(td) / "fuzz.xml"
        p.write_text(xml_blob, encoding="utf-8", errors="surrogatepass")
        recs = PytestXMLParser().parse_file(p)
    assert isinstance(recs, list)
