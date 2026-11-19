"""#5853 tutor_history: synthetic day logs only (never copies of his real sessions)."""
import json
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import tutor_history as th  # noqa: E402

T0 = 1_800_000_000_000  # an arbitrary ms epoch
MIN = 60_000


def ev(kind, t, **kw):
    return json.dumps({"kind": kind, "timestamp": t, **kw})


def note(t, bar, result="advance", vel=60, source="hardware"):
    return [ev("noteon", t, note=60, velocity=vel, source=source),
            ev("follow", t + 1, result=result, bar=bar, velocity=vel)]


def hints(t, keys="always", bare=False, **kw):
    return ev("hints", t, piece="Tune", bar=1, keys=keys, names="always", mini="always",
              bare=bare, trainingWheels=False, showKeyboard=keys != "none", **kw)


def day_lines():
    lines = [ev("piece", T0 - 5000, piece="Tune"), ev("loop", T0 - 4000, firstBar=1, lastBar=2)]
    lines += note(T0, 1) + note(T0 + 1000, 2, "wrong", vel=90) + note(T0 + 2000, 2, "wrong")
    lines += [ev("lap-spoiled", T0 + 2100, first=True), ev("lap", T0 + 2200, lap=1, firstBar=1, lastBar=2)]
    lines += note(T0 + 3000, 1) + [ev("celebrate", T0 + 3100, what="lap"), ev("lap", T0 + 3200, lap=2)]
    lines += ["{not json", "[1, 2]"]
    # 20 min later: a second session, hints now known; lights off for bars 5-7.
    t = T0 + 20 * MIN
    lines += [hints(t - 10), ev("piece", t - 5, piece="Other")]
    lines += note(t, 4)
    lines += [ev("hints", t + 500, piece="Other", bar=5, keys="none", names="always", mini="none",
                 bare=False, trainingWheels=True, showKeyboard=False)]
    lines += note(t + 1000, 5) + note(t + 2000, 7, "wrong") + note(t + 2500, 6)
    lines += note(t + 3000, 9, source="inject")  # a test note: not his
    lines += [ev("bare-done", t + 4000, label="Other", cleared=2, misses=1, early=True, ms=4000)]
    return lines


def test_sessions_split_on_a_ten_minute_gap():
    out = th.summarize_day(day_lines())
    assert out["bad_lines"] == 2
    first, second = out["sessions"]
    assert first["notes"] == 4 and second["notes"] == 4  # the injected note is not his
    assert first["follow"] == {"advance": 2, "wrong": 2}
    assert (first["right"], first["wrong"], first["accuracy"]) == (2, 2, 0.5)
    assert first["wrong_bars"] == [[2, 2]]
    assert first["velocity"] == {"min": 60, "median": 60, "max": 90}


def test_laps_and_loops_per_piece():
    first = th.summarize_day(day_lines())["sessions"][0]
    (tune,) = first["pieces"]
    assert tune["piece"] == "Tune" and tune["bars"] == [1, 2]
    assert (tune["laps"], tune["clean_laps"], tune["spoiled_laps"]) == (2, 1, 1)
    assert tune["loops"] == [{"firstBar": 1, "lastBar": 2, "laps": 2}]


def test_hints_unknown_until_logged_never_guessed():
    first, second = th.summarize_day(day_lines())["sessions"]
    assert [h["known"] for h in first["hints"]] == [False]
    assert first["hints"][0]["keys"] == "unknown"
    assert first["help_off_bars"] == []
    keys = [(h["piece"], h["keys"], h["notes"]) for h in second["hints"]]
    assert keys == [("Other", "always", 1), ("Other", "none", 3)]


def test_help_off_bars_and_bare_runs():
    second = th.summarize_day(day_lines())["sessions"][1]
    assert second["help_off_bars"] == [[5, 7]]
    assert second["bare_runs"] == [{"label": "Other", "cleared": 2, "misses": 1, "early": True, "ms": 4000}]
    assert second["wrong"] == 1 and second["right"] == 3  # the injected note's follow is not counted


def test_whole_lines_keeps_a_half_written_line_back():
    assert th.whole_lines(b'{"a":1}\n{"b"') == b'{"a":1}\n'
    assert th.whole_lines(b'{"b"') == b""


def test_parse_wc_only_day_logs():
    text = " 120 2026-11-01.jsonl\n  9 x.png\n 5 ../etc.jsonl\n 129 total\n"
    assert th.parse_wc(text) == {"2026-11-01.jsonl": 120}


def test_files_and_history_query(tmp_path):
    day = date.today().isoformat()
    (tmp_path / "logs").mkdir()
    (tmp_path / "logs" / f"{day}.jsonl").write_text("\n".join(day_lines()) + "\n", encoding="utf-8")
    assert th.summarize_days(str(tmp_path)) == [day]
    rows = (tmp_path / "sessions.jsonl").read_text(encoding="utf-8").splitlines()
    assert len(rows) == 2 and json.loads(rows[0])["pieces"][0]["piece"] == "Other"  # newest first
    got = th.history(str(tmp_path), days=1, piece="tune")
    assert len(got["sessions"]) == 1 and got["days"][0]["sessions"] == 1
    assert got["mirror"]["days_mirrored"] == 1


def test_pull_appends_only_new_whole_lines(tmp_path, monkeypatch):
    remote = {"2026-11-01.jsonl": b'{"kind":"a"}\n{"kind":"b"}\n{"kin'}
    calls = []

    def fake_ssh(host, cmd, connect_timeout, timeout):
        calls.append(cmd)
        if "wc -c" in cmd:
            return "".join(f"{len(v)} {k}\n" for k, v in remote.items()).encode()
        start = int(cmd.split("tail -c +")[1].split()[0])
        return remote["2026-11-01.jsonl"][start - 1:]

    monkeypatch.setattr(th, "_ssh", fake_ssh)
    assert th.pull(str(tmp_path), "mac") == {"2026-11-01": 26}
    remote["2026-11-01.jsonl"] += b'd":"c"}\n'
    assert th.pull(str(tmp_path), "mac") == {"2026-11-01": len(b'{"kind":"c"}\n')}
    mirror = (tmp_path / "logs" / "2026-11-01.jsonl").read_bytes()
    assert mirror == b'{"kind":"a"}\n{"kind":"b"}\n{"kind":"c"}\n'
    assert all(c.split("&& ")[1].split()[0] in ("wc", "tail") for c in calls)  # read-only on the Mac


def test_pull_unreachable_logs_and_returns(tmp_path, monkeypatch):
    def down(*a, **k):
        raise th.SshError("timeout after 8s")

    monkeypatch.setattr(th, "_ssh", down)
    assert th.pull(str(tmp_path), "mac") == {}
    assert "unreachable" in (tmp_path / "pull.log").read_text(encoding="utf-8")


def test_pull_never_shrinks_a_mirror(tmp_path, monkeypatch):
    (tmp_path / "logs").mkdir()
    (tmp_path / "logs" / "2026-11-01.jsonl").write_bytes(b'{"kind":"a"}\n{"kind":"b"}\n')
    monkeypatch.setattr(th, "_ssh", lambda *a, **k: b"5 2026-11-01.jsonl\n")
    assert th.pull(str(tmp_path), "mac") == {}
    assert "remote shrank" in (tmp_path / "pull.log").read_text(encoding="utf-8")
