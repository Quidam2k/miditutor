"""Set or remove one MusicXML fingering (#9988): the desk applies his taps on Pinocchio to the library score.

Same note-matching rule as src/shared/fingering.ts; an ambiguous match is refused.
"""

import sys
import xml.etree.ElementTree as ET
from fractions import Fraction
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from annotate_scan import Score, _children, _child, _name, _tag, _subelement


_OFFSETS = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def _text(parent, name, default=None):
    element = _child(parent, name)
    if element is None:
        return default
    return (element.text or "").strip()


def _number(parent, name, default):
    text = _text(parent, name)
    if text is None:
        return default
    try:
        return Fraction(text)
    except (ValueError, ZeroDivisionError) as exc:
        raise ValueError("parse error") from exc


def _midi(note):
    if _child(note, "rest") is not None or _child(note, "unpitched") is not None:
        return None
    pitch = _child(note, "pitch")
    if pitch is None:
        return None
    offset = _OFFSETS.get(_text(pitch, "step"))
    octave = _number(pitch, "octave", None)
    if offset is None or octave is None or octave.denominator != 1:
        return None
    return (octave + 1) * 12 + offset + _number(pitch, "alter", Fraction(0))


def _empty(element):
    return len(element) == 0 and not (element.text or "").strip()


def _edit(note, digit):
    notations = _children(note, "notations")
    for notation in notations:
        for technical in _children(notation, "technical"):
            for fingering in _children(technical, "fingering"):
                technical.remove(fingering)

    if digit is None:
        for notation in notations:
            for technical in _children(notation, "technical"):
                if _empty(technical):
                    notation.remove(technical)
            if _empty(notation):
                note.remove(notation)
        return

    technical = None
    for notation in notations:
        technical = _child(notation, "technical")
        if technical is not None:
            break

    if technical is None:
        if notations:
            notation = notations[0]
        else:
            notation = ET.Element(_tag(note, "notations"))
            lyric = _child(note, "lyric")
            if lyric is None:
                note.append(notation)
            else:
                note.insert(list(note).index(lyric), notation)
        technical = _subelement(notation, "technical")

    _subelement(technical, "fingering", digit)


def set_fingering(score_path, measure, staff, onset, midi, digit) -> None:
    if digit is not None and digit not in ("1", "2", "3", "4", "5"):
        raise ValueError("digit must be 1-5 or null")

    try:
        score = Score(score_path)
    except ET.ParseError as exc:
        raise ValueError("parse error") from exc
    except ValueError as exc:
        messages = {
            "The score has no part": "no <part>",
            "Expected a score-partwise MusicXML document": "expected score-partwise",
        }
        raise ValueError(messages.get(str(exc), str(exc))) from exc

    part = _child(score.root, "part")
    if part is None:
        raise ValueError("no <part>")
    measures = _children(part, "measure")
    if not isinstance(measure, int) or not 1 <= measure <= len(measures):
        raise ValueError("measure out of range")

    try:
        wanted_onset = Fraction(str(onset)).limit_denominator(10000)
        wanted_midi = Fraction(str(midi))
    except (ValueError, ZeroDivisionError) as exc:
        raise ValueError("no such note") from exc

    divisions = Fraction(1)
    candidates = []
    for index, measure_element in enumerate(measures[:measure], start=1):
        cursor = Fraction(0)
        previous_start = Fraction(0)
        for element in measure_element:
            tag = _name(element)
            if tag == "attributes":
                divisions = _number(element, "divisions", divisions)
                if divisions <= 0:
                    raise ValueError("divisions must be positive")
            elif tag in ("backup", "forward"):
                duration = _number(element, "duration", Fraction(0))
                cursor += -duration if tag == "backup" else duration
            elif tag == "note":
                chord = _child(element, "chord") is not None
                start = previous_start if chord else cursor
                previous_start = start
                if not chord:
                    cursor += _number(element, "duration", Fraction(0))
                note_staff = _number(element, "staff", Fraction(1))
                if (
                    index == measure
                    and note_staff.denominator == 1
                    and note_staff == staff
                    and start / divisions == wanted_onset
                    and _midi(element) == wanted_midi
                ):
                    candidates.append(element)

    if not candidates:
        raise ValueError("no such note")
    if len(candidates) > 1:
        raise ValueError(f"ambiguous: {len(candidates)} notes")

    _edit(candidates[0], digit)
    score.write(score_path)


def main(argv=None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    try:
        if len(args) != 6:
            raise ValueError(
                "usage: set_fingering.py SCORE MEASURE STAFF ONSET MIDI DIGIT"
            )
        path, measure, staff, onset, midi, digit = args
        if digit != "none" and digit not in ("1", "2", "3", "4", "5"):
            raise ValueError("digit must be 1-5 or null")
        set_fingering(
            path,
            int(measure),
            int(staff),
            onset,
            midi,
            None if digit == "none" else digit,
        )
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 2

    print("ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
