"""Audit OMR-scanned piano MusicXML for likely misreads (#9625).

Usage: omr_audit.py lint LIBRARY_DIR --out OUT.json [--annotate DIR] [--only slug,slug]
       omr_audit.py compare LIBRARY_DIR HOMR_DIR OEMER_DIR --out OUT.json [--only slug,slug]
       omr_audit.py report LINT.json [COMPARE.json] --out REPORT.md

Library content stays under Q:/Personal, never the repo.
"""
import argparse
from collections import Counter, defaultdict
from difflib import SequenceMatcher
from fractions import Fraction
import json
from pathlib import Path
import re
import sys

sys.path.insert(0, str(Path(__file__).parent))
from annotate_scan import (
    Score, _children, _child, _text, _name, _note_pitch, _duration, _fraction,
)

# Pitch and rhythm are judged apart: a wrong note teaches him wrong; a timing fault misplaces right notes. #9625
VERDICT_RULE = {
    "minimum_agreement": 0.70,
    "pitch_checks": frozenset({
        "octave_repeat", "leap", "range", "tie_unclosed", "tie_orphan", "numeric_words",
        "homr_unstable", "engine_octave", "engine_low", "bar_number_drift",
    }),
    "rhythm_checks": frozenset({"time_signature", "bar_length overfull"}),
}
SEMITONES = dict(zip("CDEFGAB", (0, 2, 4, 5, 7, 9, 11)))


def ascii_text(value):
    return str(value).encode("ascii", "backslashreplace").decode("ascii")


def midi(step, alter, octave):
    return 12 * (octave + 1) + SEMITONES[step] + int(alter)


def note_name(value):
    octave, pitch = divmod(value, 12)
    return ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")[pitch] + str(octave - 1)


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def _durations(score, include_rests=False):
    result, divisions = [], None
    for measure in score.measures:
        staffs, previous, cursor = {1: [], 2: []}, {}, Fraction(0)
        for element in measure["element"]:
            name = _name(element)
            if name == "attributes":
                value = _text(element, "divisions")
                if value is not None:
                    divisions = _fraction(value)
                    if divisions <= 0:
                        raise ValueError("divisions must be positive")
            elif name in ("backup", "forward"):
                duration = _duration(element, divisions)
                cursor = (None if cursor is None or duration is None else
                          cursor + (-duration if name == "backup" else duration))
            elif name == "note" and _child(element, "grace") is None:
                voice = _text(element, "voice", "1")
                duration = _duration(element, divisions)
                if _child(element, "chord") is not None:
                    onset = previous.get(voice)
                else:
                    onset = previous[voice] = cursor
                    cursor = (cursor + duration if cursor is not None
                              and duration is not None else None)
                try:
                    staff = int(_text(element, "staff", "1"))
                except ValueError:
                    continue
                pitch = _note_pitch(element)
                rest = _child(element, "rest") is not None
                if staff in staffs and ((pitch is not None and not rest)
                                        or (include_rests and rest)):
                    staffs[staff].append(
                        (onset, duration, None if rest else midi(*pitch), element))
        result.append(staffs)
    return result


def note_durations(path):
    """Return measure-indexed staff lists of (onset, quarters, midi, element)."""
    return _durations(Score(path))


def pitch_records(measure, staff, document=False):
    records = [n for n in measure["notes"] if n["staff"] == staff
               and n["pitch"] is not None and _child(n["element"], "rest") is None]
    if not document:
        return sorted(records, key=lambda n: (
            n["onset"] is None, n["onset"] or Fraction(0), midi(*n["pitch"])))
    groups = []
    for record in records:
        if record["chord"] and groups:
            groups[-1].append(record)
        else:
            groups.append([record])
    return [n for group in groups for n in sorted(group, key=lambda n: midi(*n["pitch"]))]


def tie_types(element):
    return {e.get("type") for e in element.iter() if _name(e) in ("tie", "tied")}


def voice_fills(score):
    """Per measure, {(staff, voice): summed duration of its non-chord notes and rests}."""
    result, divisions = [], None
    for measure in score.measures:
        fills = Counter()
        for element in measure["element"]:
            name = _name(element)
            if name == "attributes" and _text(element, "divisions") is not None:
                divisions = _fraction(_text(element, "divisions"))
            elif (name == "note" and _child(element, "grace") is None
                  and _child(element, "chord") is None):
                key = (_text(element, "staff", "1"), _text(element, "voice", "1"))
                fills[key] += _duration(element, divisions) or 0
        result.append(fills)
    return result


def bar_quarters(measure):
    try:
        return int(measure["beats"]) * 4 / measure["beat_type"]
    except (TypeError, ValueError, ZeroDivisionError):
        return None


def lint_score(score):
    flags, fills = [], voice_fills(score)

    def flag(index, staff, check, detail):
        flags.append(dict(measure=index, number=score.measures[index - 1]["number"],
                          staff=staff, check=check, detail=ascii_text(detail)))

    for staff in (1, 2):
        history, melody, ordered = [], [], []
        for index, measure in enumerate(score.measures, 1):
            records = pitch_records(measure, staff)
            pitches = [midi(*n["pitch"]) for n in records]
            ordered.extend((index, n) for n in records)
            for earlier, other in reversed(history):
                if len(pitches) < 3 or len(pitches) != len(other):
                    continue
                diffs = [a - b for a, b in zip(pitches, other)]
                if (all(d in (0, 12, -12) for d in diffs) and any(diffs)
                        and diffs.count(0) * 2 >= len(diffs)):
                    detail = ", ".join(f"{note_name(a)} vs {note_name(b)}"
                                       for a, b in zip(pitches, other) if a != b)
                    flag(index, staff, "octave_repeat", f"{detail} in m{earlier}")
                    break
            history.append((index, pitches))
            onsets = defaultdict(list)
            for record in records:
                value = midi(*record["pitch"])
                if (staff == 1 and (value > 93 or value < 43)
                        or staff == 2 and (value < 28 or value > 76)):
                    flag(index, staff, "range", f"{note_name(value)} (midi {value})")
                if record["onset"] is not None:
                    onsets[record["onset"]].append(value)
            melody.extend((index, (max if staff == 1 else min)(values))
                          for _, values in sorted(onsets.items()))
            try:
                expected = int(measure["beats"]) * 4 / measure["beat_type"]
            except (TypeError, ValueError, ZeroDivisionError):
                continue
            if expected <= 0 or not records:
                continue
            # OSMD times each voice on its own, so homr's missing <backup> between voices
            # is harmless; a bar is wrong only when a voice itself over- or under-fills it. #9644
            voices = [v for (st, _), v in fills[index - 1].items() if st == str(staff)]
            if any(v > expected + Fraction(1, 64) for v in voices):
                flag(index, staff, "bar_length", f"overfull: voices hold {sorted(set(voices))}, expected {expected}")
            elif (voices and all(v < expected - Fraction(1, 64) for v in voices)
                  and index not in (1, len(score.measures))):
                flag(index, staff, "bar_length", f"underfull: voices hold {sorted(set(voices))}, expected {expected}")
        for before, current, after in zip(melody, melody[1:], melody[2:]):
            a, b, c = before[1], current[1], after[1]
            # An exact octave from a neighbour is an ordinary octave figure, not a spike.
            if (abs(b - a) >= 12 and abs(b - c) >= 12 and abs(a - c) <= 7
                    and 12 not in (abs(b - a), abs(b - c))):
                flag(current[0], staff, "leap",
                     f"{note_name(b)} between {note_name(a)} and {note_name(c)}")
        pending = Counter()
        for position, (index, record) in enumerate(ordered):
            value, types = midi(*record["pitch"]), tie_types(record["element"])
            if "stop" in types:
                if pending[value]:
                    pending[value] -= 1
                else:
                    flag(index, staff, "tie_orphan", note_name(value) + " stop without start")
            if "start" in types:
                following = next((n for _, n in ordered[position + 1:position + 9]
                                  if midi(*n["pitch"]) == value), None)
                if following is None or "stop" not in tie_types(following["element"]):
                    flag(index, staff, "tie_unclosed",
                         note_name(value) + " start without matching stop in next 8 notes")
                pending[value] += 1
    # The bar content the piece usually has vs its declared meter: a misread time signature. #9625
    declared = Counter(bar_quarters(m) for m in score.measures)
    usual = Counter(v for f in fills for v in f.values())
    if usual and declared:
        meter, (content, count) = declared.most_common(1)[0][0], usual.most_common(1)[0]
        if meter != content:
            first = score.measures[0]
            flag(1, None, "time_signature",
                 f"declared {first['beats']}/{first['beat_type']} ({meter} quarters) but bars usually hold "
                 f"{content} quarters ({count}/{sum(usual.values())} voice-bars)")
    for index, measure in enumerate(score.measures, 1):
        for direction in _children(measure["element"], "direction"):
            try:
                staff = int(_text(direction, "staff", "1"))
            except ValueError:
                staff = None
            for element in direction.iter():
                if _name(element) == "octave-shift":
                    flag(index, staff, "octave_shift",
                         f"type={element.get('type', '?')} size={element.get('size', '8')}")
                elif _name(element) == "words":
                    text = "".join(element.itertext()).strip()
                    if re.fullmatch(r"[1-5]+", text):
                        flag(index, staff, "numeric_words", text)
    return flags


def vision_flags(score, directory, slug):
    flags, by_number, drift = [], defaultdict(list), set()
    for index, measure in enumerate(score.measures, 1):
        by_number[measure["number"]].append(index)

    def add(number, staff, check, detail):
        indexes = by_number.get(str(number), [])
        if len(indexes) == 1:
            flags.append(dict(measure=indexes[0], number=str(number), staff=staff,
                              check=check, detail=ascii_text(detail)))

    report = directory / "reports" / f"{slug}.unmatched.json"
    grouped = defaultdict(list)
    if report.exists():
        for item in read_json(report).get("unmatched", []):
            grouped[item.get("measure")].append(str(item.get("reason", "unknown")))
    for number, reasons in grouped.items():
        counts = ", ".join(f"{r}:{n}" for r, n in sorted(Counter(reasons).items()))
        add(number, None, "vision_unmatched", f"{len(reasons)} items ({counts})")
    items = [(kind, item) for path in sorted((directory / "reads").glob(f"{slug}.*.json"))
             for kind, entries in read_json(path).items() if kind in ("fingerings", "chords", "expressions")
             for item in entries]
    # A pickup bar or printed numbering shifts every bar alike; only a change in that shift is drift.
    offsets = Counter(item["printed_bar"] - item["measure"] for _, item in items
                      if type(item.get("measure")) is int and type(item.get("printed_bar")) is int)
    usual = offsets.most_common(1)[0][0] if offsets else 0
    for kind, item in items:
        number, printed = item.get("measure"), item.get("printed_bar")
        staff = item.get("staff")
        if (type(number) is int and type(printed) is int
                and printed - number != usual and number not in drift):
            add(number, staff, "bar_number_drift",
                f"printed {printed} vs listing {number} (usual shift {usual:+d})")
            drift.add(number)
        try:
            if _fraction(item.get("confidence")) <= Fraction(3, 10):
                add(number, staff, "vision_lowconf",
                    f"{kind} confidence={item['confidence']}")
        except (ValueError, TypeError, ZeroDivisionError):
            pass
    return flags


def lint_piece(path, annotate_dir=None):
    path = Path(path)
    score, raw_path = Score(path), path.with_suffix(".pre-annotate.musicxml")
    flags, raw = lint_score(score), None
    if raw_path.exists():
        raw = Score(raw_path)
        identities = {(f["measure"], f["staff"], f["check"], f["detail"]) for f in flags}
        for flag in lint_score(raw):
            if (flag["measure"], flag["staff"], flag["check"], flag["detail"]) not in identities:
                flags.append(dict(flag, raw_only=True))
    if annotate_dir is not None:
        flags.extend(vision_flags(score, Path(annotate_dir), path.stem))
    flags.sort(key=lambda f: (f["measure"], f["staff"] or 0, f["check"], f["detail"]))
    return dict(measures=len(score.measures), raw_measures=len(raw.measures) if raw else None,
                flags=flags, counts=dict(sorted(Counter(f["check"] for f in flags).items())))


def compare_piece(path, homr_dir, oemer_dir):
    path = Path(path)
    slug = path.stem
    homr = {p.stem: p for p in (Path(homr_dir) / slug).glob("*.musicxml")}
    oemer = {p.stem: p for p in (Path(oemer_dir) / slug).glob("*.musicxml")}
    if not homr and not oemer:
        return {}
    stems = {p.stem for p in (path.parent / "pages" / slug).glob("*.png")} | homr.keys() | oemer.keys()
    raw = path.with_suffix(".pre-annotate.musicxml")
    library = Score(raw if raw.exists() else path)
    pages, flags, missing, offset, matched_total, token_total = {}, [], [], 0, 0, 0
    homr_complete = True  # a bar-count verdict needs every page re-read by homr
    for stem in sorted(stems):
        h = Score(homr[stem]) if stem in homr else None
        homr_complete = homr_complete and h is not None
        base = offset
        offset += len(h.measures) if h else 0
        if h is None or stem not in oemer:
            missing.append(stem)
            continue
        o = Score(oemer[stem])
        page_matched, page_total, per_staff = 0, 0, {}

        def flag(local, staff, check, detail):
            mapped = base + local
            flags.append(dict(measure=mapped if mapped <= len(library.measures) else None,
                              page=stem, page_measure=local, staff=staff,
                              check=check, detail=ascii_text(detail)))

        for staff in (1, 2):
            tokens = [(i, midi(*n["pitch"])) for i, m in enumerate(h.measures, 1)
                      for n in pitch_records(m, staff, document=True)]
            other = [midi(*n["pitch"]) for m in o.measures
                     for n in pitch_records(m, staff, document=True)]
            values = [value for _, value in tokens]
            matches, octaves = Counter(), defaultdict(list)
            for tag, a, b, c, d in SequenceMatcher(None, values, other, autojunk=False).get_opcodes():
                if tag == "equal":
                    matches.update(tokens[j][0] for j in range(a, b))
                elif tag == "replace":
                    for j, k in zip(range(a, b), range(c, d)):
                        if values[j] != other[k] and (values[j] - other[k]) % 12 == 0:
                            octaves[tokens[j][0]].append(
                                f"{note_name(values[j])} vs {note_name(other[k])}")
            totals = Counter(local for local, _ in tokens)
            for local, measure in enumerate(h.measures, 1):
                mapped = base + local
                if mapped <= len(library.measures):
                    lib = sorted(midi(*n["pitch"]) for n in pitch_records(library.measures[mapped - 1], staff))
                    fresh = sorted(midi(*n["pitch"]) for n in pitch_records(measure, staff))
                    if lib != fresh:
                        flag(local, staff, "homr_unstable", f"library {lib} vs homr {fresh}")
                if totals[local] >= 2:
                    if octaves[local]:
                        flag(local, staff, "engine_octave", ", ".join(octaves[local]))
                    agreement = matches[local] / totals[local]
                    if agreement < 0.5:
                        flag(local, staff, "engine_low", f"agreement {agreement:.3f} ({matches[local]}/{totals[local]})")
            matched = sum(matches.values())
            per_staff[staff] = matched / len(tokens) if tokens else 1.0
            page_matched += matched
            page_total += len(tokens)
        pages[stem] = dict(homr_measures=len(h.measures), oemer_measures=len(o.measures),
                           agreement=page_matched / page_total if page_total else 1.0,
                           per_staff=per_staff)
        matched_total += page_matched
        token_total += page_total
    result = dict(pages=pages, piece_agreement=matched_total / token_total if token_total else 1.0,
                  missing_pages=missing, flags=flags)
    if homr_complete and offset != len(library.measures):
        result["bar_count_mismatch"] = dict(library=len(library.measures), homr=offset)
    return result


def flag_reason(flag):
    check = flag["check"]
    if check == "bar_length":
        return check + " " + flag["detail"].split(":", 1)[0]
    return check


def verdict(lint, cmp=None):
    """(pitch verdict, rhythm verdict, reason counts) for one piece."""
    flags = lint.get("flags", []) + (cmp or {}).get("flags", [])
    reasons = Counter(flag_reason(f) for f in flags if not f.get("raw_only"))
    failed = False
    if cmp:
        if cmp.get("bar_count_mismatch") is not None:
            reasons["bar_count_mismatch"] += 1
            failed = True
        if cmp.get("piece_agreement", 1.0) < VERDICT_RULE["minimum_agreement"]:
            reasons["piece_agreement"] += 1
            failed = True
    pitch = ("failed" if failed else "suspect"
             if reasons.keys() & VERDICT_RULE["pitch_checks"] else "verified")
    rhythm = "misread" if reasons.keys() & VERDICT_RULE["rhythm_checks"] else "ok"
    return pitch, rhythm, dict(sorted(reasons.items()))


def render_report(lint, cmp=None):
    def cell(value):
        return str(value).replace("\\", "\\\\").replace("|", "\\|").replace("\n", " ").replace("\r", " ")
    lp, cp = lint.get("pieces", {}), (cmp or {}).get("pieces", {})
    judged = VERDICT_RULE["pitch_checks"] | VERDICT_RULE["rhythm_checks"]
    lines = ["# OMR audit", "",
             "Pitch: verified (no pitch flag) / suspect / failed. Rhythm: ok / misread.", "",
             "| slug | bars | pitch | rhythm | pitch-flagged bars | reasons |",
             "| --- | ---: | --- | --- | --- | --- |"]
    pitch_counts, rhythm_counts, details = Counter(), Counter(), []
    for slug in sorted(lp.keys() | cp.keys()):
        piece, comparison = lp.get(slug, {}), cp.get(slug)
        pitch, rhythm, reasons = verdict(piece, comparison)
        pitch_counts[pitch] += 1
        rhythm_counts[rhythm] += 1
        flags = [f for f in piece.get("flags", []) + (comparison or {}).get("flags", [])
                 if not f.get("raw_only")]
        pitch_flags = [f for f in flags if f["check"] in VERDICT_RULE["pitch_checks"]]
        bars = sorted({f["measure"] for f in pitch_flags if type(f.get("measure")) is int})
        listing = ", ".join(map(str, bars[:20])) + (f" +{len(bars) - 20} more" if len(bars) > 20 else "")
        primary = [f"{r}:{n}" for r, n in reasons.items()
                   if r in judged or r in ("bar_count_mismatch", "piece_agreement")]
        notes = [f"{r}:{n}" for r, n in reasons.items() if f"{r}:{n}" not in primary]
        reason_text = "; ".join(primary + (["notes: " + ", ".join(notes)] if notes else []))
        lines.append("| " + " | ".join(cell(v) for v in (
            slug, piece.get("measures", "-"), pitch, rhythm, listing or "-", reason_text or "-")) + " |")
        if pitch != "verified":
            details.extend(["", f"## {cell(slug)}", ""])
            if comparison and comparison.get("bar_count_mismatch") is not None:
                details.append(f"Bar count mismatch: {comparison['bar_count_mismatch']}.")
            if comparison and comparison.get("piece_agreement", 1) < VERDICT_RULE["minimum_agreement"]:
                details.append(f"Piece agreement: {comparison['piece_agreement']:.3f}.")
            for flag in pitch_flags:
                location = f"m{flag.get('measure') or '?'} s{flag.get('staff') or '?'}"
                suffix = f" (page {flag['page']} m{flag['page_measure']})" if "page" in flag else ""
                details.append(f"- {location} {flag['check']}: {cell(flag['detail'])}{suffix}")
    total = sum(pitch_counts.values())
    lines.extend(["", f"Pitch: verified {pitch_counts['verified']} / suspect {pitch_counts['suspect']} / "
                  f"failed {pitch_counts['failed']} of {total}. Rhythm: ok {rhythm_counts['ok']} / "
                  f"misread {rhythm_counts['misread']}."])
    return "\n".join(lines + details) + "\n"


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    for command in ("lint", "compare"):
        sub = commands.add_parser(command)
        sub.add_argument("library", type=Path)
        if command == "compare":
            sub.add_argument("homr", type=Path)
            sub.add_argument("oemer", type=Path)
        else:
            sub.add_argument("--annotate", type=Path)
        sub.add_argument("--only")
        sub.add_argument("--out", required=True, type=Path)
    sub = commands.add_parser("report")
    sub.add_argument("lint", type=Path)
    sub.add_argument("compare", nargs="?", type=Path)
    sub.add_argument("--out", required=True, type=Path)
    args = parser.parse_args(argv)
    try:
        if args.command == "report":
            protected = [args.lint] + ([args.compare] if args.compare else [])
            output = render_report(read_json(args.lint), read_json(args.compare) if args.compare else None)
        else:
            selected = set(args.only.split(",")) if args.only else None
            files = sorted(p for p in args.library.glob("*.musicxml")
                           if not p.name.endswith((".pre-annotate.musicxml", ".omr-raw.musicxml"))
                           and (selected is None or p.stem in selected))
            protected = list(args.library.glob("*.musicxml")) + list(args.library.glob("pages/**/*.png"))
            if args.command == "compare":
                protected += list(args.homr.glob("*/*.musicxml")) + list(args.oemer.glob("*/*.musicxml"))
            elif args.annotate:
                protected += list((args.annotate / "reports").glob("*.json")) + list((args.annotate / "reads").glob("*.json"))
            pieces = {}
            for path in files:
                piece = (lint_piece(path, args.annotate) if args.command == "lint"
                         else compare_piece(path, args.homr, args.oemer))
                if not piece:
                    continue
                pieces[path.stem] = piece
                summary = (f"{piece['measures']} bars " + " ".join(f"{k}:{v}" for k, v in piece["counts"].items())
                           if args.command == "lint" else
                           f"{len(piece['pages'])} pages agreement={piece['piece_agreement']:.3f} "
                           f"missing={len(piece['missing_pages'])}" +
                           (" bar_count_mismatch" if "bar_count_mismatch" in piece else ""))
                print(ascii_text(f"{path.stem}: {summary}"))
            output = json.dumps({"pieces": pieces}, ensure_ascii=True, indent=2) + "\n"
        if args.out.resolve() in {p.resolve() for p in protected}:
            raise ValueError("--out must not overwrite an input file")
        args.out.write_text(output, encoding="utf-8")
    except Exception as error:
        parser.error(ascii_text(error))


if __name__ == "__main__":
    main()
