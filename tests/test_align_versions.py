"""Tests for scripts/align_versions.py (bar alignment of Easy and Harder versions for My mix)."""
import importlib.util
import json
import sys
from pathlib import Path

import pytest

SCRIPTS = Path(__file__).resolve().parent.parent / "scripts"
sys.path.insert(0, str(SCRIPTS))
_spec = importlib.util.spec_from_file_location("align_versions", SCRIPTS / "align_versions.py")
av = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(av)


def note(step, octave, dur=1, alter=None, staff=1, chord=False, grace=False):
    return ("<note>" + ("<chord/>" if chord else "") + ("<grace/>" if grace else "") +
            f"<pitch><step>{step}</step>" + (f"<alter>{alter}</alter>" if alter else "") +
            f"<octave>{octave}</octave></pitch><duration>{dur}</duration><staff>{staff}</staff></note>")


def score(fifths, bars, key_at=None):
    """bars: list of note-xml strings, one per measure; key_at {measure number: fifths} changes the key."""
    out = []
    for n, body in enumerate(bars, 1):
        attrs = f"<divisions>1</divisions><key><fifths>{fifths}</fifths></key><staves>2</staves>" if n == 1 else ""
        if key_at and n in key_at:
            attrs += f"<key><fifths>{key_at[n]}</fifths></key>"
        out.append(f'<measure number="{n}">' + (f"<attributes>{attrs}</attributes>" if attrs else "") + body + "</measure>")
    return ('<?xml version="1.0"?><score-partwise version="4.0"><part-list><score-part id="P1">'
            '<part-name>Piano</part-name></score-part></part-list><part id="P1">' + "".join(out) +
            "</part></score-partwise>")


def write(tmp_path, name, xml):
    p = tmp_path / name
    p.write_text(xml, encoding="utf-8")
    return p


def line(*notes):
    return "".join(note(s, 4) for s in notes)


def test_semis_signs():
    assert av.semis_between(2, 0) == -2
    assert av.semis_between(0, 2) == 2
    assert av.semis_between(6, 0) == -6
    assert av.semis_between(0, 6) == -6
    assert av.semis_between(0, 0) == 0
    assert all(-6 <= av.semis_between(a, b) <= 5 for a in range(-7, 8) for b in range(-7, 8))


def test_melody_takes_top_note_over_staves_and_skips_graces(tmp_path):
    bar = (note("C", 4) + note("E", 4, chord=True) + note("G", 2, grace=True) + note("D", 4) +
           "<backup><duration>2</duration></backup>" + note("A", 5, staff=2) + note("B", 2, staff=2))
    p = write(tmp_path, "a.musicxml", score(0, [bar]))
    assert av.parse_bars(p)[0]["melody"] == [9, 2]  # A5 over C/E, then D4 over B2


def test_bar_cost():
    assert av.bar_cost([0, 4, 7], [0, 4, 7]) == 0
    assert av.bar_cost([], []) == 0
    assert av.bar_cost([0], []) == 1
    assert av.bar_cost([0, 4, 7, 4], [0, 2, 4, 5, 7, 5, 4]) < 0.5
    assert av.bar_cost([0, 4], [1, 3]) == 1


def test_dtw_identical_is_diagonal():
    bars = [[0], [2], [4], [5], [7]]
    assert av.dtw(bars, bars) == [(i, i) for i in range(5)]


def test_dtw_inserted_harder_bar_maps_to_same_easy_bar():
    easy = [[0], [2], [4], [5], [7]]
    harder = [[0], [2], [4], [4], [5], [7]]
    assert av.dtw(easy, harder) == [(0, 0), (1, 1), (2, 2), (2, 3), (3, 4), (4, 5)]


def test_sections_cut_on_four_bar_boundaries_and_cover_everything():
    path = [[i, i] for i in range(1, 11)]
    secs = av.sections_from_path(path)
    assert [s["easy"] for s in secs] == [[1, 4], [5, 8], [9, 10]]
    assert [s["harder"] for s in secs] == [[1, 4], [5, 8], [9, 10]]
    assert secs[0]["cost"] == 0


def test_sections_never_cut_on_a_non_diagonal_step():
    # harder bar 5 doubles easy bar 4: the step into easy bar 5 is diagonal, the repeat is not
    path = [[1, 1], [2, 2], [3, 3], [4, 4], [4, 5], [5, 6], [6, 7]]
    secs = av.sections_from_path(path, [0, 0, 0, 0, 0.5, 0.5, 0])
    assert [s["easy"] for s in secs] == [[1, 4], [5, 6]]
    assert [s["harder"] for s in secs] == [[1, 5], [6, 7]]
    assert secs[0]["cost"] == 0.1


def test_key_change_inside_is_flagged(tmp_path):
    p = write(tmp_path, "k.musicxml", score(0, [line("C")] * 3, key_at={3: 2}))
    assert av.key_changes(av.parse_bars(p))
    p = write(tmp_path, "s.musicxml", score(0, [line("C")] * 3))
    assert not av.key_changes(av.parse_bars(p))


SPELL = [("C", None), ("C", 1), ("D", None), ("D", 1), ("E", None), ("F", None), ("F", 1), ("G", None),
         ("G", 1), ("A", None), ("A", 1), ("B", None)]


def midi_line(*midis):
    return "".join(note(SPELL[m % 12][0], m // 12 - 1, alter=SPELL[m % 12][1]) for m in midis)


def make_library(tmp_path, harder_key_at=None):
    easy = [(60, 64, 67), (62, 65, 69), (64, 67, 71), (65, 69, 72), (67, 71, 74), (69, 72, 76), (71, 74, 77), (72, 76, 79)]
    write(tmp_path, "easy.musicxml", score(0, [midi_line(*b) for b in easy]))
    # the same tune a tone higher, in D major
    write(tmp_path, "harder.musicxml", score(2, [midi_line(*(m + 2 for m in b)) for b in easy], key_at=harder_key_at))
    group = {"title": "T", "extra": 7, "versions": [{"file": "easy.musicxml", "label": "Easy"},
                                                    {"file": "harder.musicxml", "label": "Harder"}]}
    (tmp_path / "versions.json").write_text(json.dumps({"t": group, "other": {"title": "O", "versions": []}}), encoding="utf-8")
    return tmp_path / "versions.json"


def test_gate_refusal_exits_2_and_writes_nothing(tmp_path, monkeypatch, capsys):
    vpath = make_library(tmp_path)
    before = vpath.read_text(encoding="utf-8")
    monkeypatch.setattr(av, "gate_ok", lambda **kw: False)
    monkeypatch.setattr(av, "ram_avail_gb", lambda: 1.0)
    monkeypatch.setattr(av, "input_idle_s", lambda: 0.0)
    assert av.main(["t", "--library", str(tmp_path)]) == 2
    assert "gate closed" in capsys.readouterr().err
    assert vpath.read_text(encoding="utf-8") == before
    assert not list(tmp_path.glob("*.tmp"))


def open_gate(monkeypatch):
    monkeypatch.setattr(av, "ram_avail_gb", lambda: 64.0)
    monkeypatch.setattr(av, "input_idle_s", lambda: 0.0)


def test_full_run_writes_align_and_keeps_other_keys(tmp_path, monkeypatch):
    vpath = make_library(tmp_path)
    open_gate(monkeypatch)
    assert av.main(["t", "--library", str(tmp_path), "--own-solace"]) == 0
    data = json.loads(vpath.read_text(encoding="utf-8"))
    group = data["t"]
    assert group["extra"] == 7 and group["title"] == "T" and len(group["versions"]) == 2
    assert data["other"] == {"title": "O", "versions": []}
    al = group["align"]["harder.musicxml"]
    assert al["semis"] == -2
    assert al["bars"] == [[i, i] for i in range(1, 9)]
    assert [s["easy"] for s in al["sections"]] == [[1, 4], [5, 8]]
    assert [s["harder"] for s in al["sections"]] == [[1, 4], [5, 8]]
    assert all(s["cost"] == 0 for s in al["sections"])


def test_dry_run_prints_and_writes_nothing(tmp_path, monkeypatch, capsys):
    vpath = make_library(tmp_path)
    before = vpath.read_text(encoding="utf-8")
    open_gate(monkeypatch)
    assert av.main(["t", "--library", str(tmp_path), "--own-solace", "--dry-run"]) == 0
    assert '"semis": -2' in capsys.readouterr().out
    assert vpath.read_text(encoding="utf-8") == before


def test_key_change_inside_harder_is_skipped(tmp_path, monkeypatch, capsys):
    vpath = make_library(tmp_path, harder_key_at={5: 3})
    open_gate(monkeypatch)
    assert av.main(["t", "--library", str(tmp_path), "--own-solace"]) == 0
    assert "key changes inside harder.musicxml; not mixable until repaired" in capsys.readouterr().out
    assert "align" not in json.loads(vpath.read_text(encoding="utf-8"))["t"]


def test_mixable_false_and_my_mix_are_not_aligned(tmp_path, monkeypatch):
    vpath = make_library(tmp_path)
    data = json.loads(vpath.read_text(encoding="utf-8"))
    data["t"]["versions"][1]["mixable"] = False
    data["t"]["versions"].append({"file": "harder.musicxml", "label": "My mix"})
    vpath.write_text(json.dumps(data), encoding="utf-8")
    open_gate(monkeypatch)
    assert av.main(["t", "--library", str(tmp_path), "--own-solace"]) == 0
    assert "align" not in json.loads(vpath.read_text(encoding="utf-8"))["t"]


def test_gate_is_checked_without_own_solace(tmp_path, monkeypatch):
    make_library(tmp_path)
    monkeypatch.setattr(av, "ram_avail_gb", lambda: 64.0)
    monkeypatch.setattr(av, "input_idle_s", lambda: 5.0)
    assert av.main(["t", "--library", str(tmp_path)]) == 2
    with pytest.raises(SystemExit):
        av.main([])
