"""Tests for scripts/piece_versions.py (piano-only copies of vocal arrangements, spurious bars dropped)."""
import importlib.util
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent.parent / "scripts"
_spec = importlib.util.spec_from_file_location("piece_versions", SCRIPTS / "piece_versions.py")
piece_versions = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(piece_versions)

DOCTYPE = '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">'
NOTE = "<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note>"
SCORE = f"""<?xml version="1.0" encoding="UTF-8"?>
{DOCTYPE}
<score-partwise version="4.0">
  <part-list>
    <score-part id="P1"><part-name>Piano</part-name></score-part>
    <score-part id="P2"><part-name>Voice</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1"><attributes><divisions>1</divisions><staves>2</staves></attributes>{NOTE}</measure>
    <measure number="2"><print new-system="yes"/><attributes><divisions>4</divisions><key><fifths>-5</fifths></key></attributes>{NOTE}</measure>
    <measure number="3"><attributes><clef number="1"><sign>F</sign><line>4</line></clef></attributes>{NOTE}</measure>
    <measure number="4">{NOTE}</measure>
  </part>
  <part id="P2"><measure number="1">{NOTE}</measure></part>
</score-partwise>
"""


def run(tmp_path, *args):
    src = tmp_path / "in.musicxml"
    src.write_text(SCORE, encoding="utf-8")
    dest = tmp_path / "out.musicxml"
    code = piece_versions.main(["piano-only", str(src), str(dest), *args])
    return code, dest


def test_drops_voice_and_carries_attributes(tmp_path):
    code, dest = run(tmp_path, "--drop-bar", "2")
    assert code == 0
    text = dest.read_text(encoding="utf-8")
    assert DOCTYPE in text
    root = ET.fromstring(text)
    assert [s.get("id") for s in root.iter("score-part")] == ["P1"]
    assert [p.get("id") for p in root.findall("part")] == ["P1"]
    measures = root.find("part").findall("measure")
    assert [m.get("number") for m in measures] == ["1", "2", "3"]
    second = measures[1]
    assert second[0].tag == "print"
    assert [c.tag for c in second.find("attributes")] == ["divisions", "key", "clef"]
    assert second.findtext("attributes/key/fifths") == "-5"


def test_refuses_src_and_existing_dest(tmp_path):
    code, dest = run(tmp_path)
    assert code == 0
    assert run(tmp_path)[0] == 2
    src = tmp_path / "in.musicxml"
    assert piece_versions.main(["piano-only", str(src), str(src)]) == 2


def test_no_piano_part_is_an_error(tmp_path):
    assert run(tmp_path, "--keep-part", "P9")[0] == 2
