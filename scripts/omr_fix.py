"""Apply reviewed repairs to one MusicXML score.

Ops: set_time, set_key, delete_measure, replace_measure, split_measure, transpose_note,
delete_note, move_staff. Measure references are original, one-based positions.
apply_edits returns a repaired copy; its input tree is never modified.
"""
import argparse
from copy import deepcopy
from fractions import Fraction
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import xml.etree.ElementTree as ET

sys.dontwritebytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from annotate_scan import (
    Score, DOCTYPE_RE, _child, _children, _document_text, _name,
    _note_pitch, _pitch_label, _read_pitch, _subelement, _tag, _text,
)

ATTRIBUTE_ORDER = "footnote level divisions key time staves part-symbol instruments clef staff-details transpose directive measure-style"
NOTE_ORDER = "grace cue chord pitch rest unpitched duration tie instrument footnote level voice type dot accidental time-modification stem notehead notehead-text staff beam notations lyric play listen"
ACCIDENTALS = {1: "sharp", -1: "flat", 2: "double-sharp", -2: "flat-flat"}
VALUES = [("whole", Fraction(4)), ("half", Fraction(2)), ("quarter", Fraction(1)),
          ("eighth", Fraction(1, 2)), ("16th", Fraction(1, 4)),
          ("32nd", Fraction(1, 8)), ("64th", Fraction(1, 16))]
OPS = {"set_time", "set_key", "delete_measure", "replace_measure", "split_measure",
       "transpose_note", "delete_note", "move_staff"}


def _positive(value, label):
    if not (type(value) is int or isinstance(value, str) and re.fullmatch(r"\d+", value)):
        raise ValueError(f"{label} must be a positive integer")
    number = int(value)
    if number < 1:
        raise ValueError(f"{label} must be a positive integer")
    return number


def _put(parent, name, text=None, order=NOTE_ORDER):
    element = _child(parent, name)
    if element is None:
        element = ET.Element(_tag(parent, name))
        ranks = {tag: index for index, tag in enumerate(order.split())}
        index = next((i for i, child in enumerate(parent)
                      if ranks.get(_name(child), len(ranks)) > ranks[name]), len(parent))
        parent.insert(index, element)
    if text is not None:
        element.text = str(text)
    return element


def _attributes(measure):
    attributes = _child(measure, "attributes")
    if attributes is None:
        attributes = ET.Element(_tag(measure, "attributes"))
        measure.insert(0, attributes)
    return attributes


def _inherited(root, target, name, include=True):
    """Read current attributes in the target's part, respecting earlier edits."""
    value = None
    for part in _children(root, "part"):
        measures = _children(part, "measure")
        if target not in measures:
            continue
        for measure in measures:
            if measure is target and not include:
                return value
            for attributes in _children(measure, "attributes"):
                found = _child(attributes, name)
                if found is not None:
                    value = found
            if measure is target:
                return value
    return value


def _divisions(element):
    if element is None or element.text is None:
        raise ValueError("missing divisions declaration")
    value = Fraction(element.text.strip())
    if value <= 0:
        raise ValueError("divisions must be positive")
    return value


def _pitch(value):
    result = _read_pitch(value)
    if result is None:
        raise ValueError(f"invalid pitch: {value!r}")
    return result


def _set_pitch(note, value):
    step, alter, octave = value
    pitch = _child(note, "pitch")
    if pitch is None:
        pitch = _subelement(note, "pitch")
    pitch[:] = []
    _subelement(pitch, "step", step)
    if alter:
        _subelement(pitch, "alter", int(alter))
    _subelement(pitch, "octave", octave)
    for accidental in _children(note, "accidental"):
        note.remove(accidental)
    if alter:
        _put(note, "accidental", ACCIDENTALS[alter])


def _transposed(value, semitones):
    step, alter, octave = value
    if semitones % 12 == 0:
        return step, alter, octave + semitones // 12
    midi = 12 * (octave + 1) + dict(C=0, D=2, E=4, F=5, G=7, A=9, B=11)[step]
    midi += int(alter) + semitones
    names = ("C Db D Eb E F Gb G Ab A Bb B" if alter < 0 else
             "C C# D D# E F F# G G# A A# B").split()
    return _pitch(names[midi % 12] + str(midi // 12 - 1))


def _fill(measure, staves, divisions):
    if not isinstance(staves, dict) or not staves:
        raise ValueError("staves must be a nonempty staff/voice mapping")
    lanes = {}
    for staff, voices in staves.items():
        staff = _positive(staff, "staff")
        if not isinstance(voices, dict) or not voices:
            raise ValueError("each staff needs a nonempty voice mapping")
        for voice, events in voices.items():
            key = (staff, _positive(voice, "voice"))
            if key in lanes or not isinstance(events, list):
                raise ValueError("duplicate lane or invalid event list")
            lanes[key] = events
    stream, previous_length = [], None
    for (staff, voice), events in sorted(lanes.items()):
        if previous_length is not None:
            backup = ET.Element(_tag(measure, "backup"))
            _subelement(backup, "duration", previous_length)
            stream.append(backup)
        length = 0
        for event in events:
            if not isinstance(event, dict) or not isinstance(event.get("dur"), str):
                raise ValueError("each event needs a string dur")
            duration = Fraction(event["dur"])
            ticks = duration * divisions
            if duration <= 0 or ticks.denominator != 1:
                raise ValueError(f"duration {duration} is not positive integer divisions ({divisions})")
            notation = next(((kind, dotted, triplet)
                             for kind, base in VALUES
                             for factor, dotted, triplet in
                             [(Fraction(1), False, False), (Fraction(3, 2), True, False),
                              (Fraction(2, 3), False, True)]
                             if duration == base * factor), None)
            if notation is None:
                raise ValueError(f"unsupported note value: {duration} quarters")
            kind, dotted, triplet = notation
            rest = event.get("rest") is True
            pitches = event.get("notes")
            if (rest and "notes" in event) or (not rest and (
                    not isinstance(pitches, list) or not pitches)):
                raise ValueError("event must contain either rest:true or a nonempty notes list")
            for index, pitch in enumerate([None] if rest else pitches):
                note = ET.Element(_tag(measure, "note"))
                if index:
                    _subelement(note, "chord")
                if rest:
                    _subelement(note, "rest")
                else:
                    value = _pitch(pitch)
                    pitch_el = _subelement(note, "pitch")
                    _subelement(pitch_el, "step", value[0])
                    if value[1]:
                        _subelement(pitch_el, "alter", int(value[1]))
                    _subelement(pitch_el, "octave", value[2])
                _subelement(note, "duration", int(ticks))
                _subelement(note, "voice", voice)
                _subelement(note, "type", kind)
                if dotted:
                    _subelement(note, "dot")
                if not rest and value[1]:
                    _subelement(note, "accidental", ACCIDENTALS[value[1]])
                if triplet:
                    modification = _subelement(note, "time-modification")
                    _subelement(modification, "actual-notes", 3)
                    _subelement(modification, "normal-notes", 2)
                _subelement(note, "staff", staff)
                stream.append(note)
            length += int(ticks)
        previous_length = length
    for child in list(measure):
        if _name(child) in {"note", "backup", "forward"}:
            measure.remove(child)
    index = next((i for i, child in enumerate(measure)
                  if _name(child) == "barline"), len(measure))
    measure[index:index] = stream


def _rows(root, measure):
    """Recompute onsets from the edited stream, including backup and forward."""
    divisions_el = _inherited(root, measure, "divisions", include=False)
    divisions = _divisions(divisions_el) if divisions_el is not None else None
    cursor, previous = Fraction(0), {}
    rows = []
    for child in measure:
        name = _name(child)
        if name == "attributes":
            element = _child(child, "divisions")
            if element is not None:
                divisions = _divisions(element)
        elif name in {"note", "backup", "forward"}:
            grace = name == "note" and _child(child, "grace") is not None
            chord = name == "note" and _child(child, "chord") is not None
            if name == "note":
                voice = _positive(_text(child, "voice", "1"), "voice")
                onset = previous.get(voice, cursor) if chord else cursor
                rows.append((child, _positive(_text(child, "staff", "1"), "staff"),
                             voice, onset))
                if not chord:
                    previous[voice] = onset
            if grace or chord:
                continue
            if divisions is None:
                raise ValueError("cannot determine onset: missing divisions")
            duration = Fraction(_text(child, "duration")) / divisions
            if duration < 0:
                raise ValueError("negative duration in note stream")
            cursor += -duration if name == "backup" else duration
    return rows


def _edit_notes(measure, edit):
    staff = _positive(edit["staff"], "staff")
    voice = _positive(edit["voice"], "voice") if "voice" in edit else None
    names = edit["pitch"] if isinstance(edit["pitch"], list) else [edit["pitch"]]
    pitches = {_pitch(name) for name in names}
    matches = [note for note in _children(measure, "note")
               if _child(note, "grace") is None and _note_pitch(note) in pitches
               and _positive(_text(note, "staff", "1"), "staff") == staff
               and (voice is None or _positive(_text(note, "voice", "1"), "voice") == voice)]
    if not matches:
        raise ValueError(f"no matching note on staff {staff}: {names}")
    details = []
    if edit["op"] == "transpose_note":
        semitones = edit["semitones"]
        if type(semitones) is not int:
            raise ValueError("semitones must be an integer")
        for note in matches:
            old = _pitch_label(note)
            _set_pitch(note, _transposed(_note_pitch(note), semitones))
            details.append(f"{old} -> {_pitch_label(note)}")
    else:
        # Delete members first; if an entire chord disappears, its head becomes
        # a rest and retains the chord's rhythmic slot.
        for note in reversed(matches):
            label = _pitch_label(note)
            index = list(measure).index(note)
            member = _child(note, "chord") is not None
            following = measure[index + 1] if index + 1 < len(measure) else None
            has_members = (following is not None and _name(following) == "note"
                           and _child(following, "chord") is not None)
            if member or has_members:
                measure.remove(note)
                if not member:
                    following.remove(_child(following, "chord"))
                action = "removed (chord member)" if member else "removed (head promoted)"
            else:
                rest = ET.Element(_tag(note, "note"), dict(note.attrib))
                rest.tail = note.tail
                _subelement(rest, "rest")
                for child in note:
                    if _name(child) in {"duration", "type", "dot", "time-modification",
                                        "voice", "staff"}:
                        rest.append(deepcopy(child))
                measure[index] = rest
                action = "replaced with rest"
            details.append(f"{label}: {action}")
        details.reverse()
    return f"s{staff}: " + "; ".join(details)


def _move(root, measures, edit, log):
    source = _positive(edit["from_staff"], "from_staff")
    target = _positive(edit["to_staff"], "to_staff")
    voice = _positive(edit["voice"], "voice") if "voice" in edit else None
    for position, measure in measures:
        rows = _rows(root, measure)
        moving = [row for row in rows if row[1] == source
                  and (voice is None or row[2] == voice)]
        occupied = {(v, onset) for _, staff, v, onset in rows if staff == target}
        if source != target and any((v, onset) in occupied for _, _, v, onset in moving):
            raise ValueError(f"m{position}: destination staff {target} has overlapping voice/onset")
        for note, _, _, _ in moving:
            _put(note, "staff", target)
        declared = _inherited(root, measure, "staves")
        count = _positive(declared.text.strip(), "staves") if declared is not None else 1
        attributes = _attributes(measure)
        _put(attributes, "staves", max(count, target), ATTRIBUTE_ORDER)
        if measure is measures[0][1] and not any(
                clef.get("number", "1") == str(target)
                for clef in _children(attributes, "clef")):
            clef = ET.Element(_tag(attributes, "clef"), number=str(target))
            _subelement(clef, "sign", "F")
            _subelement(clef, "line", 4)
            placeholder = _put(attributes, "clef", order=ATTRIBUTE_ORDER)
            attributes.insert(list(attributes).index(placeholder) + 1, clef)
            if len(placeholder) == 0 and not placeholder.attrib:
                attributes.remove(placeholder)
        log(f"[move_staff] m{position}: s{source} -> s{target} ({len(moving)} notes/rests)")


def apply_edits(root, edits, log=lambda message: None):
    """Return a repaired deep copy, raising ValueError on invalid edits.

    log is a callable accepting one line. References span all parts in document
    order; inherited divisions and time signatures remain local to each part.
    """
    if _name(root) != "score-partwise" or not isinstance(edits, list):
        raise ValueError("expected score-partwise root and an edits list")
    root = deepcopy(root)
    parents = {measure: part for part in _children(root, "part")
               for measure in _children(part, "measure")}
    original = list(parents)
    resolved = []
    for index, edit in enumerate(edits, 1):
        if not isinstance(edit, dict) or edit.get("op") not in OPS:
            raise ValueError(f"edit {index}: missing or unknown op")
        keys = ("measure_from", "measure_to") if edit["op"] == "move_staff" else ("measure",)
        positions = [_positive(edit.get(key), key) for key in keys]
        if any(position > len(original) for position in positions):
            raise ValueError(f"edit {index}: measure position outside 1..{len(original)}")
        first, last = positions[0], positions[-1]
        if first > last:
            raise ValueError(f"edit {index}: measure_from exceeds measure_to")
        resolved.append((edit, [(p, original[p - 1]) for p in range(first, last + 1)]))
    structural = False
    for index, (edit, references) in enumerate(resolved, 1):
        op = edit["op"]
        position, measure = references[0]
        try:
            if any(m not in list(parents[m]) for _, m in references):
                raise ValueError("reference conflicts with a previously deleted measure")
            part = parents[measure]
            if op == "move_staff":
                _move(root, references, edit, log)
                continue
            if op == "set_time":
                beats = _positive(edit["beats"], "beats")
                beat_type = _positive(edit["beat_type"], "beat_type")
                old = _inherited(root, measure, "time")
                old_meter = ("none" if old is None else
                             f"{_text(old, 'beats', '?')}/{_text(old, 'beat-type', '?')}")
                # A measure can carry more than one <attributes> block, each with
                # its own <time>; the last one wins in playback, so set them all.
                blocks = [a for a in _children(measure, "attributes") if _child(a, "time") is not None]
                if not blocks:
                    blocks = [_attributes(measure)]
                for block in blocks:
                    time = _put(block, "time", order=ATTRIBUTE_ORDER)
                    time[:] = []
                    _subelement(time, "beats", beats)
                    _subelement(time, "beat-type", beat_type)
                detail = f"{beats}/{beat_type} (was {old_meter})"
            elif op == "set_key":
                fifths = edit["fifths"]
                if type(fifths) is not int or not -7 <= fifths <= 7:
                    raise ValueError("fifths must be an integer from -7 to 7")
                key = _put(_attributes(measure), "key", order=ATTRIBUTE_ORDER)
                key[:] = []
                _subelement(key, "fifths", fifths)
                detail = f"key fifths {fifths}"
            elif op == "delete_measure":
                part.remove(measure)
                structural = True
                detail = "removed"
            elif op in {"replace_measure", "split_measure"}:
                divisions = _divisions(_inherited(root, measure, "divisions"))
                _fill(measure, edit["staves"] if op == "replace_measure"
                      else edit["first"]["staves"], divisions)
                if op == "split_measure":
                    second = ET.Element(_tag(measure, "measure"))
                    _fill(second, edit["second"]["staves"], divisions)
                    part.insert(list(part).index(measure) + 1, second)
                    structural = True
                detail = "replaced" if op == "replace_measure" else "split into two measures"
            else:
                detail = _edit_notes(measure, edit)
            log(f"[{op}] m{position}: {detail}")
        except (ValueError, TypeError, KeyError, ZeroDivisionError) as error:
            raise ValueError(f"edit {index} [{op}] m{position}: {error}") from error
    if structural:
        measures = [m for part in _children(root, "part") for m in _children(part, "measure")]
        for position, measure in enumerate(measures, 1):
            measure.set("number", str(position))
    return root


def _serialize(score):
    source = _document_text(score.original)
    match = re.match(r"\ufeff?\s*(<\?xml\b[^?]*\?>)", source)
    declaration = match.group(1) if match else ""
    encoding = re.search(r"""encoding\s*=\s*["']([^"']+)["']""", declaration)
    encoding = encoding.group(1) if encoding else "utf-8"
    doctype = DOCTYPE_RE.search(source)
    text = "\n".join(item for item in
                     [declaration, doctype.group(0) if doctype else "",
                      ET.tostring(score.root, encoding="unicode")] if item)
    data = text.encode(encoding, errors="xmlcharrefreplace")
    if score.original.startswith(b"\xef\xbb\xbf") and not data.startswith(b"\xef\xbb\xbf"):
        data = b"\xef\xbb\xbf" + data
    return data


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("piece", type=Path)
    parser.add_argument("edits", type=Path)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    temporary = None
    try:
        payload = json.loads(args.edits.read_text(encoding="utf-8-sig"))
        if not isinstance(payload, dict) or not isinstance(payload.get("edits"), list):
            raise ValueError('edits JSON must contain {"edits": [...]}')
        score = Score(args.piece)
        score.root = apply_edits(score.root, payload["edits"], print)
        data = _serialize(score)
        if not args.dry_run:
            with tempfile.NamedTemporaryFile(dir=score.path.parent, prefix=score.path.name + ".",
                                             suffix=".tmp", delete=False) as output:
                temporary = Path(output.name)
                output.write(data)
            try:
                with Path(str(score.path) + ".orig").open("xb") as backup:
                    backup.write(score.original)
            except FileExistsError:
                pass
            os.replace(temporary, score.path)
        return 0
    except (OSError, ValueError, TypeError, KeyError, ZeroDivisionError,
            LookupError, ET.ParseError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


if __name__ == "__main__":
    sys.exit(main())
