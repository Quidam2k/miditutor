"""#6661: set_fingering.py writes and removes his tie-to-previous ("hold") mark like fingering.ts."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import set_fingering  # noqa: E402

SCORE = """<?xml version="1.0"?><score-partwise><part-list><score-part id="P1"/></part-list><part id="P1">
<measure number="1"><attributes><divisions>1</divisions></attributes>
<note><pitch><step>A</step><alter>-1</alter><octave>5</octave></pitch><duration>1</duration><notations><technical><fingering>3</fingering></technical></notations><listen/></note>
</measure></part></score-partwise>"""

AB5 = 80


def test_hold_then_unhold(tmp_path):
    path = tmp_path / "s.musicxml"
    path.write_text(SCORE, encoding="utf-8")
    set_fingering.set_fingering(str(path), 1, 1, 0, AB5, "hold")
    text = path.read_text(encoding="utf-8")
    assert '<play><other-play type="miditutor">hold</other-play></play><listen' in text
    assert "<fingering>3</fingering>" in text
    set_fingering.set_fingering(str(path), 1, 1, 0, AB5, "hold")  # idempotent
    assert path.read_text(encoding="utf-8").count("other-play type") == 1
    set_fingering.set_fingering(str(path), 1, 1, 0, AB5, "unhold")
    text = path.read_text(encoding="utf-8")
    assert "other-play" not in text and "<play" not in text
    assert "<fingering>3</fingering>" in text


def test_cli_accepts_hold_and_refuses_junk(tmp_path):
    path = tmp_path / "s.musicxml"
    path.write_text(SCORE, encoding="utf-8")
    assert set_fingering.main([str(path), "1", "1", "0", str(AB5), "hold"]) == 0
    assert set_fingering.main([str(path), "1", "1", "0", str(AB5), "Hold"]) == 2
