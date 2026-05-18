from __future__ import annotations

from web.services import snapshot_docker_inplace as m


def test_norm_host_label() -> None:
    assert m._norm_host_label("") == "local"
    assert m._norm_host_label("local") == "local"
    assert m._norm_host_label("  remote  ") == "remote"


def test_norm_container_name() -> None:
    assert m._norm_container_name("/Foo") == "foo"
    assert m._norm_container_name("Bar") == "bar"
