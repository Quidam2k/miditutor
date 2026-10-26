import json
import xml.etree.ElementTree as ET
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))


import pytest

from annotate_scan import annotate, main


SCORE = """<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">
  <part-list>
    <score-part id="P1"><part-name>Piano</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="12">
      <attributes>
        <divisions>2</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <staves>2</staves>
      </attributes>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>2</duration><voice>1</voice><type>quarter</type>
      </note>
      <note>
        <chord/><pitch><step>E</step><octave>4</octave></pitch>
        <duration>2</duration><voice>1</voice><type>quarter</type>
        <staff>1</staff><beam number="1">end</beam>
        <lyric><text>la</text></lyric>
      </note>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>2</duration><tie type="stop"/><voice>1</voice>
        <type>quarter</type><staff>1</staff>
      </note>
      <note>
        <grace/><pitch><step>C</step><octave>4</octave></pitch>
        <voice>1</voice><type>eighth</type><staff>1</staff>
      </note>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>2</duration><voice>1</voice><type>quarter</type>
        <staff>1</staff>
        <notations><technical><up-bow/></technical></notations>
      </note>
      <note>
        <pitch><step>D</step><octave>4</octave></pitch>
        <duration>2</duration><voice>1</voice><type>quarter</type>
        <staff>1</staff>
      </note>
      <backup><duration>8</duration></backup>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration><voice>2</voice><type>half</type>
        <staff>2</staff>
      </note>
      <note>
        <pitch><step>E</step><octave>3</octave></pitch>
        <duration>4</duration><voice>2</voice><type>half</type>
        <staff>2</staff>
      </note>
    </measure>
  </part>
</score-partwise>
"""


def write_inputs(tmp_path, reads, xml=SCORE):
    score = tmp_path / "score.musicxml"
    reads_path = tmp_path / "reads.json"
    score.write_text(xml, encoding="utf-8")
    reads_path.write_text(json.dumps(reads), encoding="utf-8")
    return score, reads_path, tmp_path / "out.musicxml"


def fingering(**changes):
    item = {
        "measure": 12,
        "staff": 1,
        "pitch": "C4",
        "digit": 2,
        "confidence": 0.9,
    }
    item.update(changes)
    return item


def chord(symbol="G/B", **changes):
    item = {
        "measure": 12,
        "beat": 3,
        "symbol": symbol,
        "confidence": 0.95,
    }
    item.update(changes)
    return item


def finger_text(note):
    return note.findtext("notations/technical/fingering")


def test_fingerings_select_staff_chord_nth_and_skip_ties_and_grace(tmp_path):
    score, reads, out = write_inputs(
        tmp_path,
        {
            "page": "page012.png",
            "fingerings": [
                fingering(pitch="E4", digit=5),
                fingering(nth=2, digit="3-2"),
                fingering(staff=2, digit="1,3"),
            ],
        },
    )
    report = annotate(score, [reads], out)
    notes = ET.parse(out).findall("./part/measure/note")

    assert report["placed"] == {"fingerings": 3, "chords": 0}
    assert report["unmatched"] == []
    assert finger_text(notes[0]) is None
    assert finger_text(notes[1]) == "5"
    assert finger_text(notes[2]) is None
    assert finger_text(notes[3]) is None
    assert finger_text(notes[4]) == "3-2"
    assert finger_text(notes[6]) == "1,3"
    assert len(notes[4].findall("notations")) == 1
    assert len(notes[4].findall("notations/technical")) == 1
    assert notes[4].find("notations/technical/up-bow") is not None
    tags = [child.tag for child in notes[1]]
    assert tags.index("beam") < tags.index("notations") < tags.index("lyric")


def test_low_confidence_reports_and_preserves_score_tree(tmp_path, capsys):
    item = fingering(confidence=0.79)
    score, reads, out = write_inputs(
        tmp_path, {"page": "page012.png", "fingerings": [item]}
    )
    report_path = tmp_path / "report.json"
    main([
        str(score), str(reads), "--out", str(out),
        "--report", str(report_path),
    ])

    report = json.loads(report_path.read_text(encoding="utf-8"))
    assert ET.tostring(ET.parse(score).getroot()) == ET.tostring(
        ET.parse(out).getroot()
    )
    assert report == {
        "score": str(score),
        "placed": {"fingerings": 0, "chords": 0},
        "unmatched": [{
            "page": "page012.png",
            "measure": 12,
            "kind": "fingering",
            "item": item,
            "reason": "low-confidence",
        }],
    }
    assert capsys.readouterr().out == (
        f"{out}: fingerings placed 0/1, chords placed 0/0, unmatched 1\n"
    )


def test_chords_exact_onset_slash_bass_and_unknown_suffix(tmp_path):
    score, reads, out = write_inputs(
        tmp_path,
        {
            "page": "page012.png",
            "chords": [
                chord(),
                chord("Em/G"),
                chord("Bb7"),
                chord("Cxyz"),
                chord("C", beat=2.5),
            ],
        },
    )
    report = annotate(score, [reads], out)
    measure = ET.parse(out).find("./part/measure")
    harmonies = measure.findall("harmony")

    assert report["placed"]["chords"] == 3
    assert [item["reason"] for item in report["unmatched"]] == [
        "unknown-chord", "no-onset"
    ]
    assert harmonies[0].attrib == {"print-frame": "no"}
    assert harmonies[0].findtext("root/root-step") == "G"
    assert harmonies[0].findtext("kind") == "major"
    assert harmonies[0].find("kind").get("text") == ""
    assert harmonies[0].findtext("bass/bass-step") == "B"
    assert harmonies[0].findtext("staff") == "1"
    assert harmonies[1].findtext("root/root-step") == "E"
    assert harmonies[1].findtext("kind") == "minor"
    assert harmonies[1].find("kind").get("text") == "m"
    assert harmonies[1].findtext("bass/bass-step") == "G"
    assert harmonies[2].findtext("root/root-step") == "B"
    assert harmonies[2].findtext("root/root-alter") == "-1"
    assert harmonies[2].findtext("kind") == "dominant"
    assert harmonies[2].find("kind").get("text") == "7"

    children = list(measure)
    anchor = measure.findall("note")[4]
    anchor_index = children.index(anchor)
    assert children[anchor_index - 3:anchor_index] == harmonies


def test_listing_two_staff_chord_backup_and_grace(tmp_path, capsys):
    score, _, _ = write_inputs(tmp_path, {})
    main(["--listing", str(score), "--first", "12", "--last", "12"])
    assert capsys.readouterr().out == (
        "m12 s1: C4+E4(1) C4(2) C4(3) D4(4) | beats 4/4\n"
        "m12 s2: C4(1) E3(3) | beats 4/4\n"
    )
    main(["--listing", str(score), "--first", "13"])
    assert capsys.readouterr().out == ""


def test_unknown_measure_and_string_measure_matching(tmp_path):
    score, reads, out = write_inputs(
        tmp_path,
        {
            "fingerings": [
                fingering(measure="12"),
                fingering(measure="missing"),
            ],
            "chords": [chord(measure=99)],
        },
    )
    report = annotate(score, [reads], out)
    assert report["placed"]["fingerings"] == 1
    assert [item["reason"] for item in report["unmatched"]] == [
        "no-measure", "no-measure"
    ]
    assert [item["measure"] for item in report["unmatched"]] == ["missing", 99]


def test_no_note_for_wrong_pitch_occurrence_or_invalid_digit(tmp_path):
    score, reads, out = write_inputs(
        tmp_path,
        {
            "fingerings": [
                fingering(pitch="B#3"),
                fingering(nth=3),
                fingering(staff=3),
                fingering(digit=6),
            ],
        },
    )
    report = annotate(score, [reads], out)
    assert report["placed"]["fingerings"] == 0
    assert [item["reason"] for item in report["unmatched"]] == ["no-note"] * 4


def test_idempotent_and_multiple_reads_files(tmp_path):
    score, reads, out = write_inputs(
        tmp_path,
        {
            "fingerings": [fingering(nth=2)],
            "chords": [chord(), chord("Em/G")],
        },
    )
    extra = tmp_path / "reads2.json"
    extra.write_text(
        json.dumps({
            "page": "second.png",
            "fingerings": [fingering(pitch="E4", digit=5)],
            "chords": [chord("Bb7")],
        }),
        encoding="utf-8",
    )
    first = annotate(score, [reads, extra], out)
    second_out = tmp_path / "second.musicxml"
    second = annotate(out, [reads, extra], second_out)

    assert first["placed"] == {"fingerings": 2, "chords": 3}
    assert second["placed"] == {"fingerings": 0, "chords": 0}
    assert second["unmatched"] == []
    assert second_out.read_bytes() == out.read_bytes()
    root = ET.parse(second_out).getroot()
    assert len(root.findall(".//fingering")) == 2
    assert len(root.findall(".//harmony")) == 3


def test_in_place_backup_created_once_and_doctype_preserved(tmp_path):
    score, reads, _ = write_inputs(
        tmp_path, {"fingerings": [fingering()]}
    )
    original = score.read_bytes()
    annotate(score, [reads], score)
    backup = score.with_suffix(".pre-annotate.musicxml")
    assert backup.read_bytes() == original
    assert ET.parse(score).find(".//fingering").text == "2"

    annotate(score, [reads], score)
    assert backup.read_bytes() == original
    lines = score.read_text(encoding="utf-8").splitlines()
    assert lines[0].startswith("<?xml ")
    assert lines[1] == SCORE.splitlines()[1]
    assert score.read_text(encoding="utf-8").count("<!DOCTYPE") == 1


def test_inherited_meter_divisions_forward_and_fractional_beat(tmp_path):
    xml = """<score-partwise><part id="P1">
      <measure number="1">
        <attributes><divisions>4</divisions>
          <time><beats>6</beats><beat-type>8</beat-type></time>
        </attributes>
        <note><rest/><duration>12</duration></note>
      </measure>
      <measure number="2">
        <note><pitch><step>F</step><alter>1</alter><octave>4</octave></pitch>
          <duration>1</duration><voice>1</voice></note>
        <note><pitch><step>B</step><alter>-1</alter><octave>3</octave></pitch>
          <duration>1</duration><voice>1</voice></note>
        <forward><duration>2</duration><voice>1</voice></forward>
        <note><pitch><step>C</step><octave>5</octave></pitch>
          <duration>4</duration><voice>1</voice></note>
      </measure>
    </part></score-partwise>"""
    score, reads, out = write_inputs(
        tmp_path,
        {
            "fingerings": [
                fingering(measure=2, pitch="F#4"),
                fingering(measure=2, pitch="Bb3"),
            ],
            "chords": [
                chord("C", measure=2, beat=1.5),
                chord("D", measure=2, beat=3),
                chord("E", measure=2, beat=1.52),
            ],
        },
        xml,
    )
    report = annotate(score, [reads], out)
    measure = ET.parse(out).findall("./part/measure")[1]
    children = list(measure)
    notes = measure.findall("note")
    harmonies = measure.findall("harmony")

    assert report["placed"] == {"fingerings": 2, "chords": 2}
    assert report["unmatched"][0]["reason"] == "no-onset"
    assert children[children.index(notes[1]) - 1] is harmonies[0]
    assert children[children.index(notes[2]) - 1] is harmonies[1]


def test_namespace_and_only_first_part_are_annotated(tmp_path):
    xml = """<score-partwise xmlns="http://www.musicxml.org/ns/musicxml">
      <part id="P1"><measure number="12">
        <attributes><divisions>1</divisions>
          <time><beats>4</beats><beat-type>4</beat-type></time>
        </attributes>
        <note><pitch><step>C</step><octave>4</octave></pitch>
          <duration>4</duration></note>
      </measure></part>
      <part id="P2"><measure number="12">
        <note><pitch><step>C</step><octave>4</octave></pitch>
          <duration>4</duration></note>
      </measure></part>
    </score-partwise>"""
    score, reads, out = write_inputs(
        tmp_path,
        {"fingerings": [fingering()], "chords": [chord(beat=1)]},
        xml,
    )
    annotate(score, [reads], out)
    root = ET.parse(out).getroot()
    ns = {"m": "http://www.musicxml.org/ns/musicxml"}
    parts = root.findall("m:part", ns)
    assert len(parts[0].findall(".//m:fingering", ns)) == 1
    assert len(parts[0].findall(".//m:harmony", ns)) == 1
    assert parts[1].findall(".//m:fingering", ns) == []
    assert parts[1].findall(".//m:harmony", ns) == []


@pytest.mark.parametrize("value", [-0.1, 1.1, None, "NaN"])
def test_invalid_confidence_is_not_placed(tmp_path, value):
    score, reads, out = write_inputs(
        tmp_path, {"fingerings": [fingering(confidence=value)]}
    )
    report = annotate(score, [reads], out)
    assert report["placed"]["fingerings"] == 0
    assert report["unmatched"][0]["reason"] == "low-confidence"


def test_custom_confidence_threshold_accepts_boundary(tmp_path):
    score, reads, out = write_inputs(
        tmp_path, {"fingerings": [fingering(confidence=0.7)]}
    )
    report = annotate(score, [reads], out, min_confidence="0.7")
    assert report["placed"]["fingerings"] == 1
    assert report["unmatched"] == []


def test_harmony_goes_before_chord_head_not_between_chord_mates(tmp_path):
    # homr often writes one chord across both staves: head on staff 2,
    # <chord/> mate on staff 1. The harmony must not split them.
    xml = """<score-partwise><part id="P1"><measure number="3">
      <attributes><divisions>1</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
      </attributes>
      <note><pitch><step>C</step><octave>3</octave></pitch>
        <duration>4</duration><voice>1</voice><staff>2</staff></note>
      <note><chord/><pitch><step>E</step><octave>5</octave></pitch>
        <duration>4</duration><voice>1</voice><staff>1</staff></note>
    </measure></part></score-partwise>"""
    score, reads, out = write_inputs(
        tmp_path, {"chords": [chord("C", measure=3, beat=1)]}, xml
    )
    report = annotate(score, [reads], out)
    children = list(ET.parse(out).find("./part/measure"))
    assert report["placed"]["chords"] == 1
    assert [child.tag for child in children[1:]] == ["harmony", "note", "note"]


def test_decimal_beat_snaps_to_its_triplet_fraction_only_when_close(tmp_path):
    xml = """<score-partwise><part id="P1"><measure number="2">
      <attributes><divisions>3</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
      </attributes>
      <note><pitch><step>C</step><octave>5</octave></pitch>
        <duration>5</duration><voice>1</voice></note>
      <note><pitch><step>E</step><octave>4</octave></pitch>
        <duration>7</duration><voice>1</voice></note>
    </measure></part></score-partwise>"""
    score, reads, out = write_inputs(
        tmp_path,
        {"chords": [chord("F", measure=2, beat=2.66667),
                    chord("G", measure=2, beat="8/3"),
                    chord("A", measure=2, beat=2.67)]},
        xml,
    )
    report = annotate(score, [reads], out)
    assert report["placed"]["chords"] == 2
    assert [u["item"]["symbol"] for u in report["unmatched"]] == ["A"]


def test_altered_dominant_writes_degree(tmp_path):
    score, reads, out = write_inputs(
        tmp_path, {"chords": [chord("D7b9"), chord("C7#5b9", beat=1)]}
    )
    report = annotate(score, [reads], out)
    assert report["placed"]["chords"] == 2
    d7b9 = [h for h in ET.parse(out).iter("harmony")
            if h.findtext("root/root-step") == "D"][0]
    assert d7b9.findtext("kind") == "dominant"
    assert d7b9.find("kind").get("text") == "7b9"
    assert d7b9.findtext("degree/degree-value") == "9"
    assert d7b9.findtext("degree/degree-alter") == "-1"
    assert d7b9.findtext("degree/degree-type") == "add"
    c = [h for h in ET.parse(out).iter("harmony")
         if h.findtext("root/root-step") == "C"][0]
    assert [(d.findtext("degree-value"), d.findtext("degree-type"))
            for d in c.findall("degree")] == [("5", "alter"), ("9", "add")]
    assert [child.tag for child in d7b9][-2:] == ["degree", "staff"]
