import sys
import xml.etree.ElementTree as ET
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import set_fingering


def note(step="C", octave=4, extra="", prefix="", alter=""):
    return (
        f"<note>{prefix}<pitch><step>{step}</step>{alter}"
        f"<octave>{octave}</octave></pitch><duration>4</duration>{extra}</note>"
    )


def score(body):
    return (
        '<score-partwise><part id="P1"><measure number="99">'
        "<attributes><divisions>4</divisions></attributes>"
        f"{body}</measure></part></score-partwise>"
    )


def write_score(tmp_path, xml):
    path = tmp_path / "score.musicxml"
    path.write_text(xml, encoding="utf-8")
    return path


def edited(tmp_path, xml, measure=1, staff=1, onset="0", midi=60, digit="3"):
    path = write_score(tmp_path, xml)
    set_fingering.set_fingering(path, measure, staff, onset, midi, digit)
    return ET.parse(path).getroot()


def elements(root, name):
    return [
        element
        for element in root.iter()
        if isinstance(element.tag, str)
        and element.tag.rsplit("}", 1)[-1] == name
    ]


def fingerings(root):
    return [element.text for element in elements(root, "fingering")]


def test_add(tmp_path):
    root = edited(tmp_path, score(note()))
    assert fingerings(root) == ["3"]


def test_replace_all_and_keep_other_marks(tmp_path):
    marks = (
        "<notations><technical><fingering>1</fingering><up-bow/></technical>"
        "<technical><fingering>2</fingering></technical></notations>"
    )
    root = edited(tmp_path, score(note(extra=marks)))
    assert fingerings(root) == ["3"]
    assert len(elements(root, "up-bow")) == 1
    assert len(elements(root, "notations")) == 1


def test_remove_empty_containers(tmp_path):
    marks = (
        "<notations>\n<technical>\n<fingering>1</fingering>\n"
        "</technical>\n</notations>"
    )
    root = edited(tmp_path, score(note(extra=marks)), digit=None)
    assert fingerings(root) == []
    assert elements(root, "technical") == []
    assert elements(root, "notations") == []


def test_remove_keeps_other_notation_content(tmp_path):
    marks = (
        "<notations><technical><fingering>1</fingering><up-bow/></technical>"
        '<slur type="start"/></notations>'
    )
    root = edited(tmp_path, score(note(extra=marks)), digit=None)
    assert fingerings(root) == []
    assert len(elements(root, "technical")) == 1
    assert len(elements(root, "slur")) == 1


def test_chord_by_midi(tmp_path):
    root = edited(
        tmp_path,
        score(note() + note("E", prefix="<chord/>")),
        midi=64,
    )
    notes = elements(root, "note")
    assert fingerings(notes[0]) == []
    assert fingerings(notes[1]) == ["3"]


def test_staff_two_after_backup(tmp_path):
    body = (
        note(extra="<staff>1</staff>")
        + "<backup><duration>4</duration></backup>"
        + note(extra="<staff>2</staff>")
    )
    root = edited(tmp_path, score(body), staff=2)
    notes = elements(root, "note")
    assert fingerings(notes[0]) == []
    assert fingerings(notes[1]) == ["3"]


def test_forward(tmp_path):
    body = "<forward><duration>6</duration></forward>" + note()
    root = edited(tmp_path, score(body), onset="1.5")
    assert fingerings(root) == ["3"]


def test_ambiguous(tmp_path):
    body = (
        note(extra="<voice>1</voice>")
        + "<backup><duration>4</duration></backup>"
        + note(extra="<voice>2</voice>")
    )
    path = write_score(tmp_path, score(body))
    before = path.read_bytes()
    with pytest.raises(ValueError, match=r"^ambiguous: 2 notes$"):
        set_fingering.set_fingering(path, 1, 1, "0", 60, "3")
    assert path.read_bytes() == before


def test_no_match(tmp_path):
    path = write_score(tmp_path, score(note()))
    with pytest.raises(ValueError, match=r"^no such note$"):
        set_fingering.set_fingering(path, 1, 1, "0", 61, "3")


def test_measure_out_of_range(tmp_path):
    path = write_score(tmp_path, score(note()))
    with pytest.raises(ValueError, match=r"^measure out of range$"):
        set_fingering.set_fingering(path, 2, 1, "0", 60, "3")


def test_b_flat(tmp_path):
    root = edited(
        tmp_path,
        score(note("B", alter="<alter>-1</alter>")),
        midi=70,
    )
    assert fingerings(root) == ["3"]


def test_notations_before_lyric(tmp_path):
    root = edited(
        tmp_path,
        score(note(extra="<lyric><text>la</text></lyric>")),
    )
    selected = elements(root, "note")[0]
    assert [element.tag for element in selected] == [
        "pitch",
        "duration",
        "notations",
        "lyric",
    ]


def test_carried_divisions_first_part_and_measure_position(tmp_path):
    xml = (
        '<score-partwise><part id="P1"><measure number="12">'
        "<attributes><divisions>4</divisions></attributes></measure>"
        '<measure number="42"><forward><duration>6</duration></forward>'
        f'{note()}</measure></part><part id="P2"><measure>'
        f"{note()}</measure></part></score-partwise>"
    )
    root = edited(tmp_path, xml, measure=2, onset="1.5")
    parts = elements(root, "part")
    assert fingerings(parts[0]) == ["3"]
    assert fingerings(parts[1]) == []


def test_grace_does_not_advance_and_nonpitched_notes_do_not_match(tmp_path):
    body = (
        "<note><grace/><pitch><step>D</step><octave>4</octave></pitch></note>"
        + note()
        + "<note><rest/><duration>0</duration></note>"
        + "<note><unpitched/><duration>0</duration></note>"
    )
    root = edited(tmp_path, score(body))
    assert fingerings(elements(root, "note")[1]) == ["3"]


def test_namespace(tmp_path):
    xml = score(note()).replace(
        "<score-partwise>",
        '<score-partwise xmlns="urn:test:musicxml">',
    )
    root = edited(tmp_path, xml)
    assert elements(root, "fingering")[0].tag == "{urn:test:musicxml}fingering"


def test_no_part(tmp_path):
    path = write_score(tmp_path, "<score-partwise/>")
    with pytest.raises(ValueError, match=r"^no <part>$"):
        set_fingering.set_fingering(path, 1, 1, "0", 60, "3")


def test_parse_error(tmp_path):
    path = write_score(tmp_path, "<score-partwise>")
    with pytest.raises(ValueError, match=r"^parse error$"):
        set_fingering.set_fingering(path, 1, 1, "0", 60, "3")


def test_main_success_and_none(tmp_path, capsys):
    path = write_score(tmp_path, score(note()))
    args = [str(path), "1", "1", "0", "60", "5"]
    assert set_fingering.main(args) == 0
    captured = capsys.readouterr()
    assert captured.out == "ok\n"
    assert captured.err == ""
    assert fingerings(ET.parse(path).getroot()) == ["5"]

    assert set_fingering.main(args[:-1] + ["none"]) == 0
    assert capsys.readouterr().out == "ok\n"
    assert fingerings(ET.parse(path).getroot()) == []


def test_main_failure(tmp_path, capsys):
    path = write_score(tmp_path, score(note()))
    assert set_fingering.main([str(path), "1", "1", "0", "61", "3"]) == 2
    captured = capsys.readouterr()
    assert captured.out == ""
    assert captured.err == "no such note\n"
