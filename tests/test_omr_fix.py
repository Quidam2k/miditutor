"""Tests for scripts/omr_fix.py (repairs applied to OMR MusicXML scores)."""
import importlib.util
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

import pytest

SCRIPTS = Path(__file__).resolve().parent.parent / "scripts"
sys.path.insert(0, str(SCRIPTS))
_spec = importlib.util.spec_from_file_location("omr_fix", SCRIPTS / "omr_fix.py")
omr_fix = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(omr_fix)

HEADER = """<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
"""
FOOTER = "  </part>\n</score-partwise>\n"


def _note(pitch, dur, staff, voice=1, chord=False, rest=False):
    head = "<chord/>" if chord else ""
    if rest:
        body = "<rest/>"
    else:
        step, octave = pitch[0], pitch[-1]
        alter = "<alter>1</alter>" if "#" in pitch else ""
        body = f"<pitch><step>{step}</step>{alter}<octave>{octave}</octave></pitch>"
    return f"<note>{head}{body}<duration>{int(dur * 2)}</duration><voice>{voice}</voice><staff>{staff}</staff></note>"


def _measure(number, staff1, staff2, first=False):
    attrs = ""
    if first:
        attrs = ("<attributes><divisions>2</divisions><key><fifths>0</fifths></key>"
                 "<time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves>"
                 "<clef number=\"1\"><sign>G</sign><line>2</line></clef>"
                 "<clef number=\"2\"><sign>F</sign><line>4</line></clef></attributes>")
    return (f'<measure number="{number}">{attrs}{staff1}'
            f"<backup><duration>8</duration></backup>{staff2}</measure>\n")


def _score(measures):
    body = "".join(_measure(i + 1, m[0], m[1], first=i == 0) for i, m in enumerate(measures))
    return HEADER + body + FOOTER


def _write(tmp_path, text, name="piece.musicxml"):
    path = tmp_path / name
    path.write_text(text, encoding="utf-8")
    return path


def _root(text):
    return ET.fromstring(text.encode("utf-8"))


def _measures(root):
    return list(root.find("part"))


def _lane_total(measure, staff, voice="1"):
    total = 0
    for note in measure.findall("note"):
        if note.findtext("staff") == str(staff) and note.findtext("voice") == voice:
            if note.find("chord") is None:
                total += int(note.findtext("duration"))
    return total


BASE = [
    (_note("C5", 4, 1), _note("C3", 4, 2)),
    (_note("D5", 4, 1), _note("D3", 4, 2)),
    (_note("E5", 4, 1), _note("E3", 4, 2)),
]


def test_set_time_changes_meter_and_logs_old_value():
    logs = []
    out = omr_fix.apply_edits(_root(_score(BASE)),
                              [{"op": "set_time", "measure": 1, "beats": 3, "beat_type": 4}],
                              logs.append)
    time = out.find("part/measure/attributes/time")
    assert time.findtext("beats") == "3" and time.findtext("beat-type") == "4"
    assert any("was 4/4" in line for line in logs), logs


def test_delete_measure_renumbers_remaining_measures():
    out = omr_fix.apply_edits(_root(_score(BASE)), [{"op": "delete_measure", "measure": 2}])
    numbers = [m.get("number") for m in _measures(out)]
    assert numbers == ["1", "2"]
    assert _measures(out)[1].find("note/pitch/step").text == "E"


def test_transpose_note_octave_down_and_error_when_missing():
    edit = {"op": "transpose_note", "measure": 1, "staff": 1, "pitch": "C5", "semitones": -12}
    out = omr_fix.apply_edits(_root(_score(BASE)), [edit])
    octave = _measures(out)[0].find("note/pitch/octave")
    assert octave.text == "4"
    with pytest.raises(ValueError):
        omr_fix.apply_edits(_root(_score(BASE)),
                            [dict(edit, pitch="G6")])


def test_delete_note_chord_member_removes_only_that_note():
    text = _score([(_note("C5", 4, 1) + _note("E5", 4, 1, chord=True), _note("C3", 4, 2))])
    out = omr_fix.apply_edits(_root(text), [{"op": "delete_note", "measure": 1, "staff": 1,
                                             "pitch": "E5"}])
    staff1 = [n for n in _measures(out)[0].findall("note") if n.findtext("staff") == "1"]
    assert len(staff1) == 1
    assert staff1[0].find("pitch/step").text == "C"


def test_delete_note_standalone_bass_becomes_rest():
    out = omr_fix.apply_edits(_root(_score(BASE)), [{"op": "delete_note", "measure": 1,
                                                    "staff": 2, "pitch": "C3"}])
    bass = [n for n in _measures(out)[0].findall("note") if n.findtext("staff") == "2"][0]
    assert bass.find("rest") is not None and bass.find("pitch") is None
    assert bass.findtext("duration") == "8"


def test_split_measure_inserts_second_measure_and_keeps_lane_lengths():
    edit = {"op": "split_measure", "measure": 2,
            "first": {"staves": {"1": {"1": [{"notes": ["D5"], "dur": "2"}, {"rest": True, "dur": "2"}]},
                                 "2": {"1": [{"notes": ["D3"], "dur": "4"}]}}},
            "second": {"staves": {"1": {"1": [{"notes": ["F5"], "dur": "4"}]},
                                  "2": {"1": [{"notes": ["F3"], "dur": "4"}]}}}}
    out = omr_fix.apply_edits(_root(_score(BASE)), [edit])
    measures = _measures(out)
    assert len(measures) == 4
    assert [m.get("number") for m in measures] == ["1", "2", "3", "4"]
    for measure in measures:
        assert _lane_total(measure, 1) == 8 and _lane_total(measure, 2) == 8


def test_replace_measure_builds_chord_and_eighths():
    staves = {"1": {"1": [{"notes": ["C5", "E5"], "dur": "2"},
                          {"notes": ["D5"], "dur": "1/2"}, {"notes": ["D5"], "dur": "1/2"}]},
              "2": {"1": [{"rest": True, "dur": "4"}]}}
    out = omr_fix.apply_edits(_root(_score(BASE)),
                              [{"op": "replace_measure", "measure": 1, "staves": staves}])
    notes = _measures(out)[0].findall("note")
    assert notes[1].find("chord") is not None
    assert [n.findtext("type") for n in notes[2:4]] == ["eighth", "eighth"]
    assert len(_measures(out)[0].findall("backup")) == 1


def test_replace_measure_keeps_ties_and_fingering_of_matching_notes():
    root = _root(_score(BASE))
    old = _measures(root)[0].find("note")
    old.insert(list(old).index(old.find("voice")), ET.fromstring('<tie type="start"/>'))
    old.append(ET.fromstring('<notations><tied type="start"/><tuplet type="start"/><technical>'
                             '<fingering>4</fingering></technical></notations>'))
    staves = {"1": {"1": [{"notes": ["C5"], "dur": "3"}, {"rest": True, "dur": "1"}]},
              "2": {"1": [{"notes": ["C3"], "dur": "4"}]}}
    out = omr_fix.apply_edits(root, [{"op": "replace_measure", "measure": 1, "staves": staves}])
    note = _measures(out)[0].find("note")
    assert note.find("tie").get("type") == "start"
    assert note.find("notations/technical/fingering").text == "4"
    assert note.find("notations/tuplet") is None
    names = [child.tag for child in note]
    assert names.index("tie") < names.index("voice") < names.index("notations")


def test_unsupported_duration_raises():
    staves = {"1": {"1": [{"notes": ["C5"], "dur": "5/7"}]}}
    with pytest.raises(ValueError):
        omr_fix.apply_edits(_root(_score(BASE)),
                            [{"op": "replace_measure", "measure": 1, "staves": staves}])


def test_measure_references_are_original_positions():
    edits = [{"op": "delete_measure", "measure": 1},
             {"op": "set_time", "measure": 2, "beats": 3, "beat_type": 4}]
    out = omr_fix.apply_edits(_root(_score(BASE)), edits)
    measures = _measures(out)
    assert measures[0].find("attributes/time").findtext("beats") == "3"
    assert measures[0].find("note/pitch/step").text == "D"


def test_main_writes_orig_once_and_dry_run_writes_nothing(tmp_path):
    piece = _write(tmp_path, _score(BASE))
    original = piece.read_bytes()
    edits = _write(tmp_path, '{"edits": [{"op": "delete_measure", "measure": 3}]}', "edits.json")
    assert omr_fix.main([str(piece), str(edits), "--dry-run"]) == 0
    assert piece.read_bytes() == original
    assert not (tmp_path / "piece.musicxml.orig").exists()
    assert omr_fix.main([str(piece), str(edits)]) == 0
    orig = tmp_path / "piece.musicxml.orig"
    assert orig.read_bytes() == original
    again = _write(tmp_path, '{"edits": [{"op": "delete_measure", "measure": 1}]}', "again.json")
    assert omr_fix.main([str(piece), str(again)]) == 0
    assert orig.read_bytes() == original


def test_main_rejects_bad_edit_and_leaves_file_alone(tmp_path):
    piece = _write(tmp_path, _score(BASE))
    original = piece.read_bytes()
    bad = _write(tmp_path, '{"edits": [{"op": "delete_measure", "measure": 99}]}', "bad.json")
    assert omr_fix.main([str(piece), str(bad)]) != 0
    assert piece.read_bytes() == original
    unknown = _write(tmp_path, '{"edits": [{"op": "frobnicate", "measure": 1}]}', "unknown.json")
    assert omr_fix.main([str(piece), str(unknown)]) != 0
    assert piece.read_bytes() == original


def test_set_key_writes_fifths_in_measure():
    out = omr_fix.apply_edits(_root(_score(BASE)), [{"op": "set_key", "measure": 2, "fifths": 3}])
    assert _measures(out)[1].find("attributes/key/fifths").text == "3"
    with pytest.raises(ValueError):
        omr_fix.apply_edits(_root(_score(BASE)), [{"op": "set_key", "measure": 2, "fifths": 9}])


def test_set_time_updates_every_time_element_in_measure():
    text = _score(BASE).replace("</attributes>",
        "</attributes><attributes><time><beats>5</beats><beat-type>8</beat-type></time></attributes>", 1)
    out = omr_fix.apply_edits(_root(text), [{"op": "set_time", "measure": 1, "beats": 6, "beat_type": 8}])
    times = _measures(out)[0].findall("attributes/time")
    assert len(times) == 2
    assert all(t.findtext("beats") == "6" and t.findtext("beat-type") == "8" for t in times)
