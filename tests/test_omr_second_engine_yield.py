"""Tests for cooperative yielding in omr_second_engine.

#pm1026
"""

import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import omr_second_engine as ose


class FakeTree:
    def __init__(self):
        self.calls = []

    def suspend(self):
        self.calls.append("suspend")

    def resume(self):
        self.calls.append("resume")

    def kill(self):
        self.calls.append("kill")


class FakeProcess:
    pid = 4242
    returncode = 0

    def __init__(self):
        self.poll_calls = 0

    def poll(self):
        self.poll_calls += 1
        return None if self.poll_calls == 1 else 0


def test_parse_args_requires_ownership_for_multiple_jobs():
    assert ose.parse_args(["out"]).jobs == 1

    with pytest.raises(SystemExit) as exc_info:
        ose.parse_args(["out", "--jobs", "4"])
    assert exc_info.value.code == 2

    args = ose.parse_args(["out", "--jobs", "4", "--i-own-solace"])
    assert args.jobs == 4


def test_child_env_limits_threads_and_preserves_unrelated_variables(monkeypatch):
    unrelated = "MIDITUTOR_TEST_UNRELATED"
    monkeypatch.setenv(unrelated, "preserved")
    thread_variables = (
        "OMP_NUM_THREADS",
        "MKL_NUM_THREADS",
        "OPENBLAS_NUM_THREADS",
    )
    for name in thread_variables:
        monkeypatch.setenv(name, "99")

    env = ose.child_env()

    for name in thread_variables:
        assert env[name] == "4"
    assert env[unrelated] == os.environ[unrelated] == "preserved"


def test_gate_ok_enforces_idle_and_ram_gates():
    assert ose.gate_ok(ram_gb=20, idle_s=700, own_solace=False) is True
    assert ose.gate_ok(ram_gb=20, idle_s=30, own_solace=False) is False
    assert ose.gate_ok(ram_gb=20, idle_s=30, own_solace=True) is True
    assert ose.gate_ok(ram_gb=5, idle_s=700, own_solace=True) is False


def test_run_waits_for_idle_before_launch(monkeypatch, tmp_path):
    idle_values = iter([30, 30, 700])
    monkeypatch.setattr(ose, "ram_avail_gb", lambda: 20)
    monkeypatch.setattr(
        ose, "input_idle_s", lambda: next(idle_values, 700)
    )

    events = []
    sleep_calls = []
    process = FakeProcess()
    tree = FakeTree()

    def fake_sleep(seconds):
        sleep_calls.append(seconds)
        events.append("sleep")

    def fake_popen(*args, **kwargs):
        events.append("launch")
        return process

    out = tmp_path / "out"
    out.mkdir()
    page = tmp_path / "page.png"
    page.write_bytes(b"fake page")

    result = ose.run(
        "oemer",
        out,
        "fake_page",
        page,
        sleep=fake_sleep,
        popen=fake_popen,
        tree_factory=lambda pid: tree,
    )

    launch_index = events.index("launch")
    assert events[:launch_index].count("sleep") >= 2
    assert len(sleep_calls) >= 2
    assert result.startswith("ok")


def test_yielder_pauses_resumes_and_excludes_paused_time():
    tree = FakeTree()
    yielder = ose.Yielder(
        tree,
        own_solace=False,
        idle_min=10,
        page_cap_min=40,
        start_s=0,
    )

    assert yielder.step(now_s=0, idle_s=700) is None
    assert tree.calls == []

    assert yielder.step(now_s=5, idle_s=2) == "paused"
    assert tree.calls == ["suspend"]
    assert yielder.running_s == pytest.approx(5)

    assert yielder.step(now_s=10, idle_s=4) is None
    assert tree.calls == ["suspend"]
    assert yielder.running_s == pytest.approx(5)

    assert yielder.step(now_s=15, idle_s=700) == "resumed"
    assert tree.calls == ["suspend", "resume"]
    assert yielder.running_s == pytest.approx(5)

    assert yielder.step(now_s=20, idle_s=700) is None
    assert yielder.running_s == pytest.approx(10)


def test_yielder_kills_tree_after_running_time_cap():
    tree = FakeTree()
    yielder = ose.Yielder(
        tree,
        own_solace=False,
        idle_min=10,
        page_cap_min=1,
        start_s=0,
    )

    assert yielder.step(now_s=0, idle_s=700) is None
    assert yielder.step(now_s=59, idle_s=700) is None
    assert tree.calls == []

    assert yielder.step(now_s=61, idle_s=700) == "timeout"
    assert tree.calls == ["kill"]


def test_yielder_with_ownership_does_not_pause_for_input():
    tree = FakeTree()
    yielder = ose.Yielder(
        tree,
        own_solace=True,
        idle_min=10,
        page_cap_min=40,
        start_s=0,
    )

    for now_s in (0, 5, 10, 30):
        assert yielder.step(now_s=now_s, idle_s=2) is None

    assert tree.calls == []
    assert yielder.running_s == pytest.approx(30)
