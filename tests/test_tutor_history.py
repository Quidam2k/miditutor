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


# ---- #5517 teacher summary

def fol(t, step, bar, expected, result="advance", played=None):
    return [ev("noteon", t, note=played or 60, velocity=60, source="hardware"),
            ev("follow", t + 1, result=result, step=step, bar=bar, note=played, expected=expected)]


def test_midi_names():
    assert [th._midi(n) for n in ("C4", "Bb3", "C#5", "Db3", 61, "x", None)] == [60, 58, 73, 49, 61, None, None]


def test_wrong_how_restrike_near_other():
    lines = [ev("piece", T0 - 10, piece="Tune")]
    lines += fol(T0, 0, 1, ["C4"]) + fol(T0 + 500, 1, 1, ["E4"])
    lines += fol(T0 + 900, 1, 1, ["E4"], "wrong", played=60)   # C4 again: the note before
    lines += fol(T0 + 1200, 1, 1, ["E4"], "wrong", played=65)  # F4: next door to E4
    lines += fol(T0 + 1500, 1, 1, ["E4"], "wrong", played=72)  # C5: other
    p = th.summarize_day(lines)["sessions"][0]["pieces"][0]
    assert p["wrong_bars"] == [[1, 3]]
    assert p["wrong_how"] == [[1, 1, 1, 1]]


def test_slow_bars_need_eight_gaps_and_skip_breaks():
    lines = [ev("piece", T0 - 10, piece="Tune")]
    t = T0
    for step in range(12):
        gap = {5: 3000, 9: 60_000}.get(step, 500)  # step 5 hesitates; step 9 is a break
        t += gap
        lines += fol(t, step, 1 + step // 4, ["C4"])
    p = th.summarize_day(lines)["sessions"][0]["pieces"][0]
    assert p["slow_bars"] == [[2, 1]]
    assert th._slow_bars([(500, 1)] * 7) == []


def _write_lib(tmp_path, match="exact"):
    (tmp_path / "review").mkdir()
    (tmp_path / "tune.musicxml").write_text(
        "<score-partwise><work><work-title>Tune</work-title></work></score-partwise>")
    layout = {"match": match, "score": "tune.musicxml", "systems": [
        {"page": "01.png", "measures": [1, 4]},
        {"page": "01.png", "measures": [5, 8]},
        {"page": "02.png", "measures": [9, 12]}]}
    (tmp_path / "review" / "tune.layout.json").write_text(json.dumps(layout))


def test_last_lesson_date(tmp_path):
    assert th.last_lesson_date(str(tmp_path)) is None
    (tmp_path / "lesson-notebook.jsonl").write_text(
        '{"date": "2024-04-01"}\nnot json\n{"date": "2024-05-01"}\n[1]\n{"date": "soon"}\n')
    assert th.last_lesson_date(str(tmp_path)) == "2024-05-01"


def test_bar_places_by_title_and_slug(tmp_path):
    _write_lib(tmp_path)
    bp = th.bar_places(str(tmp_path))
    assert bp["tune"][10] == (2, 1, 2)
    assert bp["tune"][6] == (1, 2, 2)
    assert th._title_key("Tune (from KA)") == "tune"


def test_bar_places_skips_inexact(tmp_path):
    _write_lib(tmp_path, match="approx")
    assert th.bar_places(str(tmp_path)) == {}


def test_ordinal():
    got = [th.ordinal(n) for n in (1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 111)]
    assert got == ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "101st", "111th"]


def _sess(day, acc, bars, loops=(), how=(), slow=(), span=(1, 12)):
    return {"day": day, "start": day + "T10:00:00", "minutes": 20.0, "notes": 100, "accuracy": acc,
            "pieces": [{"piece": "Tune", "notes": 100, "laps": 5, "clean_laps": 2, "bars": list(span),
                        "loops": list(loops), "wrong_bars": bars, "wrong_how": list(how),
                        "slow_bars": list(slow)},
                       {"piece": None, "notes": 1, "laps": 0, "clean_laps": 0, "loops": [], "wrong_bars": []}]}


def _fake_history(monkeypatch, sessions):
    monkeypatch.setattr(th, "history", lambda root, days=7, piece=None: {"sessions": sessions})


def test_teacher_trend(tmp_path, monkeypatch):
    _write_lib(tmp_path)
    (tmp_path / "lesson-notebook.jsonl").write_text('{"date": "2024-05-01"}\n')
    on_lesson_day = _sess("2024-05-01", 0.1, [[3, 99]])
    s = [_sess("2024-05-02", 0.6, [[10, 3], [5, 2]], [{"firstBar": 1, "lastBar": 8, "laps": 4}],
               [[10, 1, 2, 0], [5, 0, 0, 2]], [[7, 2]]),
         _sess("2024-05-03", 0.7, [[10, 2]], [{"firstBar": 7, "lastBar": 7, "laps": 2}], [[10, 0, 0, 2]], [[7, 2]]),
         _sess("2024-05-04", 0.75, [[5, 2]]),
         _sess("2024-05-04", 0.8, [[11, 1]])]
    _fake_history(monkeypatch, [on_lesson_day] + s)
    out = th.teacher("x", library=str(tmp_path), today=date(2024, 5, 10))
    assert out.startswith("# Practice May 2 – May 10 (since the May 1 lesson)\n")
    assert "Based on 4 sessions on 3 days, 80 minutes in all." in out
    assert "snapshot" not in out
    assert "Right notes: 60% in the first session, 80% in the latest." in out
    assert "Looped (app bar numbers): bars 1–8 (4 times), bar 7 (2 times)." in out
    assert "page 2, line 1, 2nd bar: 5 wrong notes (1 replayed the note before, 2 hit a key next door, 2 other wrong notes)" in out
    assert "page 1, line 2, 1st bar: 4 wrong notes (2 other wrong notes)" in out
    assert "Slowed down most at: page 1, line 2, 3rd bar." in out
    assert "No misses on May 4 where he missed before: page 2, line 1, 2nd bar." in out
    assert "99" not in out


def test_teacher_thin_week_is_a_snapshot(tmp_path, monkeypatch):
    _fake_history(monkeypatch, [_sess("2024-05-08", 0.5, [[20, 4]]), _sess("2024-05-09", 0.9, [])])
    out = th.teacher("x", library=str(tmp_path), since="2024-05-08", today=date(2024, 5, 10))
    assert out.startswith("# Practice May 8 – May 10\n")
    assert "Based on 2 sessions on 2 days" in out
    assert "snapshot, not a trend" in out
    assert "Right notes" not in out and "No misses on" not in out
    assert "bar 20 as the app counts (no page map for this piece yet): 4 wrong notes" in out


def test_teacher_empty(tmp_path, monkeypatch):
    _fake_history(monkeypatch, [])
    out = th.teacher("x", library=str(tmp_path), today=date(2024, 5, 10))
    assert out.startswith("# Practice May 4 – May 10\n")
    assert "No practice logged in these days." in out


def test_teacher_lesson_today_and_bad_dates(tmp_path, monkeypatch):
    _fake_history(monkeypatch, [])
    (tmp_path / "lesson-notebook.jsonl").write_text('{"date": "2024-05-10"}\n{"date": "2024-13-01"}\n')
    out = th.teacher("x", library=str(tmp_path), today=date(2024, 5, 10))
    assert out == "# Practice (since the May 10 lesson)\n\nNo practice logged since that lesson yet.\n"
    assert th.valid_day("2024-02-30") is None and th.valid_day("2024-02-29") == date(2024, 2, 29)


def test_cli_rejects_impossible_since():
    import pytest
    with pytest.raises(SystemExit):
        th.main(["teacher", "--since", "2024-02-30", "--no-pull"])


def test_bar_places_keeps_file_name_map_when_score_unreadable(tmp_path):
    _write_lib(tmp_path)
    (tmp_path / "tune.musicxml").write_text("<not xml")
    assert th.bar_places(str(tmp_path))["tune"][10] == (2, 1, 2)
