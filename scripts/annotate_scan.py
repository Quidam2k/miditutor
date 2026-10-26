"""Add fingering and chord symbols, read from page images, to an OMR MusicXML score (#9506).

Usage: annotate_scan.py SCORE READS.json [...] --out OUT [--report R.json]
       annotate_scan.py --listing SCORE [--first M] [--last N]
"""
import argparse
import copy
import json
import re
import xml.etree.ElementTree as ET
from fractions import Fraction
from pathlib import Path


CHORD_KINDS = {
    "": "major",
    "maj": "major",
    "m": "minor",
    "min": "minor",
    "-": "minor",
    "7": "dominant",
    "maj7": "major-seventh",
    "M7": "major-seventh",
    "Δ7": "major-seventh",
    "m7": "minor-seventh",
    "min7": "minor-seventh",
    "-7": "minor-seventh",
    "dim": "diminished",
    "°": "diminished",
    "dim7": "diminished-seventh",
    "°7": "diminished-seventh",
    "m7b5": "half-diminished",
    "ø": "half-diminished",
    "ø7": "half-diminished",
    "aug": "augmented",
    "+": "augmented",
    "sus4": "suspended-fourth",
    "sus": "suspended-fourth",
    "sus2": "suspended-second",
    "6": "major-sixth",
    "m6": "minor-sixth",
    "9": "dominant-ninth",
    "add9": "major",
    "5": "power",
}

PITCH_RE = re.compile(r"([A-G])(##|bb|#|b)?(-?\d+)")
CHORD_RE = re.compile(r"([A-G])([#b]?)([^/]*)(?:/([A-G])([#b]?))?")
ALTERS = {"": 0, "#": 1, "##": 2, "b": -1, "bb": -2}
DOCTYPE_RE = re.compile(
    r"""<!DOCTYPE\b(?:[^\[>"']|"[^"]*"|'[^']*'|\[[\s\S]*?\])*>"""
)


def _name(element):
    if not isinstance(element.tag, str):
        return ""
    return element.tag.rsplit("}", 1)[-1]


def _children(element, name):
    return [child for child in element if _name(child) == name]


def _child(element, name):
    return next((child for child in element if _name(child) == name), None)


def _text(element, name, default=None):
    child = _child(element, name)
    return default if child is None or child.text is None else child.text.strip()


def _tag(element, name):
    if isinstance(element.tag, str) and element.tag.startswith("{"):
        return element.tag.split("}", 1)[0] + "}" + name
    return name


def _subelement(parent, name, text=None, **attributes):
    element = ET.SubElement(parent, _tag(parent, name), attributes)
    if text is not None:
        element.text = str(text)
    return element


def _fraction(value):
    if isinstance(value, bool) or value is None:
        raise ValueError("Expected a finite number")
    return Fraction(str(value))


def _beat(value):
    # A reader copies 8/3 as 2.66667: take the fraction it spells, but only
    # when it is that close. This is not rounding to a nearby note.
    beat = _fraction(value)
    snapped = beat.limit_denominator(48)
    return snapped if abs(snapped - beat) < Fraction(1, 10000) else beat


def _threshold(value):
    try:
        value = _fraction(value)
        if not 0 <= value <= 1:
            raise ValueError
    except (ValueError, TypeError, ZeroDivisionError):
        raise argparse.ArgumentTypeError("confidence must be between 0 and 1")
    return value


def _confident(item, minimum):
    try:
        confidence = _fraction(item.get("confidence"))
        return 0 <= confidence <= 1 and confidence >= minimum
    except (ValueError, TypeError, ZeroDivisionError):
        return False


def _read_pitch(value):
    if not isinstance(value, str):
        return None
    match = PITCH_RE.fullmatch(value)
    if match is None:
        return None
    step, accidental, octave = match.groups()
    return step, Fraction(ALTERS[accidental or ""]), int(octave)


def _note_pitch(note):
    pitch = _child(note, "pitch")
    if pitch is None:
        return None
    try:
        step = _text(pitch, "step")
        if step not in tuple("ABCDEFG"):
            return None
        return (
            step,
            _fraction(_text(pitch, "alter", "0")),
            int(_text(pitch, "octave")),
        )
    except (ValueError, TypeError, ZeroDivisionError):
        return None


def _pitch_label(note):
    if _child(note, "rest") is not None:
        return "r"
    pitch = _note_pitch(note)
    if pitch is None:
        return "?"
    step, alter, octave = pitch
    accidentals = {0: "", 1: "#", 2: "##", -1: "b", -2: "bb"}
    accidental = accidentals.get(alter, "[alter=" + str(alter) + "]")
    return step + accidental + str(octave)


def _document_text(data):
    if data.startswith((b"\xff\xfe\x00\x00", b"\x00\x00\xfe\xff")):
        return data.decode("utf-32")
    if data.startswith((b"\xff\xfe", b"\xfe\xff")):
        return data.decode("utf-16")
    match = re.match(
        rb"""\s*<\?xml\b[^>]*\bencoding\s*=\s*["']([^"']+)["']""",
        data,
    )
    encoding = match.group(1).decode("ascii") if match else "utf-8-sig"
    return data.decode(encoding)


def _duration(element, divisions):
    try:
        duration = _fraction(_text(element, "duration"))
        if divisions is None or divisions <= 0 or duration < 0:
            return None
        return duration / divisions
    except (ValueError, TypeError, ZeroDivisionError):
        return None


class Score:
    def __init__(self, path):
        self.path = Path(path)
        self.original = self.path.read_bytes()
        source = _document_text(self.original)
        match = DOCTYPE_RE.search(source)
        self.doctype = match.group(0) if match else None

        parser = ET.XMLParser(
            target=ET.TreeBuilder(insert_comments=True, insert_pis=True)
        )
        self.root = ET.fromstring(self.original, parser=parser)
        if self.root.tag.startswith("{"):
            namespace = self.root.tag[1:].split("}", 1)[0]
            ET.register_namespace("", namespace)

        if _name(self.root) != "score-partwise":
            raise ValueError("Expected a score-partwise MusicXML document")
        part = _child(self.root, "part")
        if part is None:
            raise ValueError("The score has no part")

        self.measures = []
        self.by_number = {}
        divisions = None
        beats = None
        beat_type = None

        for measure in _children(part, "measure"):
            cursor = Fraction(0)
            previous_onsets = {}
            heads = {}
            notes = []

            for element in measure:
                name = _name(element)
                if name == "attributes":
                    value = _text(element, "divisions")
                    if value is not None:
                        divisions = _fraction(value)
                        if divisions <= 0:
                            raise ValueError("divisions must be positive")
                    time = _child(element, "time")
                    if time is not None:
                        # Compound time declarations cannot be interpreted
                        # using one beat-type without an additional policy.
                        types = _children(time, "beat-type")
                        beat_counts = _children(time, "beats")
                        if len(types) == 1 and len(beat_counts) == 1:
                            beats = (beat_counts[0].text or "").strip()
                            beat_type = _fraction(types[0].text)
                            if beat_type <= 0:
                                raise ValueError("beat-type must be positive")
                        else:
                            beats = None
                            beat_type = None
                elif name in ("backup", "forward"):
                    duration = _duration(element, divisions)
                    if cursor is None or duration is None:
                        cursor = None
                    elif name == "backup":
                        cursor -= duration
                    else:
                        cursor += duration
                elif name == "note":
                    if _child(element, "grace") is not None:
                        continue

                    voice = _text(element, "voice", "1")
                    is_chord = _child(element, "chord") is not None
                    if is_chord:
                        onset = previous_onsets.get(voice)
                    else:
                        onset = cursor
                        previous_onsets[voice] = onset
                        heads[voice] = element
                        duration = _duration(element, divisions)
                        cursor = (
                            cursor + duration
                            if cursor is not None and duration is not None
                            else None
                        )

                    try:
                        staff = int(_text(element, "staff", "1"))
                    except ValueError:
                        staff = None

                    notes.append(
                        {
                            "element": element,
                            "staff": staff,
                            "pitch": _note_pitch(element),
                            "onset": onset,
                            "chord": is_chord,
                            # A harmony must go before the chord's first
                            # note, never between it and a <chord/> mate.
                            "head": heads.get(voice, element),
                            "tied_into": any(
                                tie.get("type") == "stop"
                                for tie in _children(element, "tie")
                            ),
                        }
                    )

            entry = {
                "element": measure,
                "number": measure.get("number", ""),
                "notes": notes,
                "beats": beats,
                "beat_type": beat_type,
            }
            self.measures.append(entry)
            self.by_number.setdefault(entry["number"], []).append(entry)

    def listing(self, first=None, last=None):
        lines = []
        for measure in self.measures:
            if first is not None or last is not None:
                try:
                    number = int(measure["number"])
                except ValueError:
                    continue
                if first is not None and number < first:
                    continue
                if last is not None and number > last:
                    continue

            staffs = {}
            for record in measure["notes"]:
                if record["staff"] is None:
                    continue
                tokens = staffs.setdefault(record["staff"], [])
                label = _pitch_label(record["element"])
                onset = record["onset"]
                if (
                    record["chord"]
                    and tokens
                    and onset is not None
                    and tokens[-1][1] == onset
                ):
                    tokens[-1][0].append(label)
                else:
                    tokens.append([[label], onset])

            for staff in sorted(staffs):
                tokens = []
                for labels, onset in staffs[staff]:
                    beat_type = measure["beat_type"]
                    beat = (
                        str(1 + onset * beat_type / 4)
                        if onset is not None and beat_type is not None
                        else "?"
                    )
                    tokens.append("+".join(labels) + "(" + beat + ")")
                meter = (
                    str(measure["beats"]) + "/" + str(measure["beat_type"])
                    if measure["beats"] is not None
                    and measure["beat_type"] is not None
                    else "?/?"
                )
                lines.append(
                    "m{} s{}: {} | beats {}".format(
                        measure["number"], staff, " ".join(tokens), meter
                    )
                )
        return "\n".join(lines)

    def write(self, output):
        output = Path(output)
        if output.resolve() == self.path.resolve():
            backup = self.path.with_suffix(".pre-annotate.musicxml")
            if not backup.exists():
                backup.write_bytes(self.original)

        data = ET.tostring(
            self.root, encoding="utf-8", xml_declaration=True
        )
        if self.doctype:
            declaration, newline, body = data.partition(b"\n")
            data = (
                declaration
                + b"\n"
                + self.doctype.encode("utf-8")
                + b"\n"
                + body
            )
        output.write_bytes(data)


def _fingering_text(value):
    if type(value) is int and 1 <= value <= 5:
        return str(value)
    if isinstance(value, str) and re.fullmatch(r"[1-5](?:[-,][1-5])*", value):
        return value
    return None


def _add_fingering(note, text):
    notations_elements = _children(note, "notations")
    for notations in notations_elements:
        for technical in _children(notations, "technical"):
            if any(
                fingering.text == text
                for fingering in _children(technical, "fingering")
            ):
                return False

    if notations_elements:
        notations = notations_elements[0]
    else:
        notations = ET.Element(_tag(note, "notations"))
        lyric = _child(note, "lyric")
        index = list(note).index(lyric) if lyric is not None else len(note)
        note.insert(index, notations)

    technical = _child(notations, "technical")
    if technical is None:
        technical = _subelement(notations, "technical")
    _subelement(technical, "fingering", text)
    return True


def _make_harmony(symbol, context):
    if not isinstance(symbol, str):
        return None
    match = CHORD_RE.fullmatch(symbol)
    if match is None:
        return None
    root_step, root_accidental, suffix, bass_step, bass_accidental = (
        match.groups()
    )
    kind = CHORD_KINDS.get(suffix)
    if kind is None:
        return None

    harmony = ET.Element(_tag(context, "harmony"), {"print-frame": "no"})
    root = _subelement(harmony, "root")
    _subelement(root, "root-step", root_step)
    if root_accidental:
        _subelement(root, "root-alter", ALTERS[root_accidental])
    kind_element = _subelement(harmony, "kind", kind)
    kind_element.set("text", suffix)
    if bass_step:
        bass = _subelement(harmony, "bass")
        _subelement(bass, "bass-step", bass_step)
        if bass_accidental:
            _subelement(bass, "bass-alter", ALTERS[bass_accidental])
    _subelement(harmony, "staff", "1")
    return harmony


def _signature(element):
    return (
        element.tag,
        tuple(sorted(element.attrib.items())),
        (element.text or "").strip(),
        tuple(_signature(child) for child in element),
    )


def _add_harmony(measure, note, harmony):
    children = list(measure)
    index = children.index(note)
    signature = _signature(harmony)
    previous = index - 1
    while previous >= 0 and _name(children[previous]) == "harmony":
        if _signature(children[previous]) == signature:
            return False
        previous -= 1
    measure.insert(index, copy.deepcopy(harmony))
    return True


def annotate(score_path, reads_paths, output_path, report_path=None,
             min_confidence=Fraction("0.8")):
    minimum = _threshold(min_confidence)
    score = Score(score_path)
    report = {
        "score": str(score_path),
        "placed": {"fingerings": 0, "chords": 0},
        "unmatched": [],
    }
    totals = {"fingerings": 0, "chords": 0}

    def reject(page, item, kind, reason):
        report["unmatched"].append(
            {
                "page": page,
                "measure": item.get("measure"),
                "kind": kind,
                "item": copy.deepcopy(item),
                "reason": reason,
            }
        )

    for reads_path in reads_paths:
        reads = json.loads(Path(reads_path).read_text(encoding="utf-8-sig"))
        page = reads.get("page")
        for plural, kind in (("fingerings", "fingering"), ("chords", "chord")):
            for item in reads.get(plural, []):
                totals[plural] += 1
                if not _confident(item, minimum):
                    reject(page, item, kind, "low-confidence")
                    continue

                measures = score.by_number.get(str(item.get("measure")), [])
                if not measures:
                    reject(page, item, kind, "no-measure")
                    continue

                if kind == "fingering":
                    pitch = _read_pitch(item.get("pitch"))
                    staff = item.get("staff")
                    nth = item.get("nth", 1)
                    digit = _fingering_text(item.get("digit"))
                    matches = []
                    if (
                        pitch is not None
                        and type(staff) is int
                        and staff >= 1
                        and type(nth) is int
                        and nth >= 1
                        and digit is not None
                    ):
                        for measure in measures:
                            candidates = [
                                record["element"]
                                for record in measure["notes"]
                                if record["staff"] == staff
                                and record["pitch"] == pitch
                                and not record["tied_into"]
                            ]
                            if nth <= len(candidates):
                                matches.append(candidates[nth - 1])
                    if len(matches) != 1:
                        reject(page, item, kind, "no-note")
                    elif _add_fingering(matches[0], digit):
                        report["placed"][plural] += 1
                else:
                    harmony = _make_harmony(
                        item.get("symbol"), measures[0]["element"]
                    )
                    if harmony is None:
                        reject(page, item, kind, "unknown-chord")
                        continue
                    try:
                        beat = _beat(item.get("beat"))
                        if beat < 1:
                            raise ValueError
                    except (ValueError, TypeError, ZeroDivisionError):
                        reject(page, item, kind, "no-onset")
                        continue

                    matches = []
                    for measure in measures:
                        beat_type = measure["beat_type"]
                        if beat_type is None:
                            continue
                        target = (beat - 1) * 4 / beat_type
                        note = next(
                            (
                                record["head"]
                                for record in measure["notes"]
                                if record["staff"] == 1
                                and record["onset"] == target
                            ),
                            None,
                        )
                        if note is not None:
                            matches.append((measure["element"], note))

                    if len(matches) != 1:
                        reject(page, item, kind, "no-onset")
                    elif _add_harmony(*matches[0], harmony):
                        report["placed"][plural] += 1

    score.write(output_path)
    if report_path is not None:
        Path(report_path).write_text(
            json.dumps(report, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    print(
        "{}: fingerings placed {}/{}, chords placed {}/{}, unmatched {}".format(
            output_path,
            report["placed"]["fingerings"],
            totals["fingerings"],
            report["placed"]["chords"],
            totals["chords"],
            len(report["unmatched"]),
        )
    )
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Add exact, confident fingering and chord reads to MusicXML."
    )
    parser.add_argument("score", nargs="?")
    parser.add_argument("reads", nargs="*")
    parser.add_argument("--out")
    parser.add_argument("--report")
    parser.add_argument("--min-confidence", type=_threshold, default=Fraction("0.8"))
    parser.add_argument("--listing", metavar="SCORE.musicxml")
    parser.add_argument("--first", type=int)
    parser.add_argument("--last", type=int)
    args = parser.parse_args(argv)

    if args.listing:
        if args.score or args.reads or args.out or args.report:
            parser.error("--listing cannot be combined with annotation arguments")
        if (
            args.first is not None
            and args.last is not None
            and args.first > args.last
        ):
            parser.error("--first must not exceed --last")
    else:
        if not args.score or not args.reads or not args.out:
            parser.error("annotation requires SCORE, READS, and --out")
        if args.first is not None or args.last is not None:
            parser.error("--first and --last require --listing")

    try:
        if args.listing:
            listing = Score(args.listing).listing(args.first, args.last)
            if listing:
                print(listing)
        else:
            annotate(
                args.score,
                args.reads,
                args.out,
                args.report,
                args.min_confidence,
            )
    except (OSError, ValueError, ET.ParseError) as error:
        parser.error(str(error))


if __name__ == "__main__":
    main()

