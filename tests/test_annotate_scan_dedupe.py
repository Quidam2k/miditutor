"""annotate_scan._add_direction must not add a words/dynamics direction that already sits in the bar (#6117)."""
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import annotate_scan as an  # noqa: E402

NOTE = "<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><staff>1</staff></note>"


def _direction(text, ident=None):
    attr = f' id="{ident}"' if ident else ""
    return ET.fromstring(
        f'<direction placement="above"{attr}><direction-type><words>{text}</words></direction-type>'
        "<staff>1</staff></direction>"
    )


def _measure(*parts):
    return ET.fromstring("<measure number=\"5\">" + "".join(parts) + "</measure>")


def _words(measure):
    return [d.find("direction-type/words").text for d in measure if an._name(d) == "direction"]


def test_twin_after_print_is_skipped():
    # Original Giocoso, then <print new-system>, then the first note: the page-read twin is a duplicate.
    measure = _measure(
        '<direction placement="above"><direction-type><words>Giocoso</words></direction-type><staff>1</staff></direction>',
        '<print new-system="yes"/>',
        NOTE,
    )
    note = measure.find("note")
    assert an._add_direction(measure, note, _direction("Giocoso", "pageread-92-2")) is False
    assert _words(measure) == ["Giocoso"]


def test_different_text_is_inserted():
    measure = _measure(
        '<direction placement="above"><direction-type><words>Giocoso</words></direction-type><staff>1</staff></direction>',
        '<print new-system="yes"/>',
        NOTE,
    )
    note = measure.find("note")
    assert an._add_direction(measure, note, _direction("Vivace", "pageread-92-3")) is True
    assert _words(measure) == ["Giocoso", "Vivace"]


def test_same_text_before_an_earlier_note_is_not_a_twin():
    # A direction before a previous note is a different onset; the walk stops at the note.
    measure = _measure(
        '<direction placement="above"><direction-type><words>Giocoso</words></direction-type><staff>1</staff></direction>',
        NOTE,
        NOTE,
    )
    second = list(measure.iter("note"))[1]
    assert an._add_direction(measure, second, _direction("Giocoso", "pageread-92-4")) is True
    assert _words(measure) == ["Giocoso", "Giocoso"]
