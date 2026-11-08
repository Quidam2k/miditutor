#!/usr/bin/env python3
# #11354: build the offline, key-neutral fresh-tune set (src/renderer/assets/fresh-tunes.json).
# Run with the project venv: .venv/Scripts/python.exe scripts/build_fresh_tunes.py
"""Extract short folk melodies from music21's bundled corpus."""

from collections import Counter
from fractions import Fraction
import json
from pathlib import Path

from music21 import chord, corpus, key, meter, note, pitch, stream


METERS = {"2/4", "3/4", "4/4", "6/8"}
LIMITS = {"major": 450, "minor": 150}
OUTPUT = (
    Path(__file__).resolve().parent.parent
    / "src"
    / "renderer"
    / "assets"
    / "fresh-tunes.json"
)


def extract_tune(score, tune_id):
    """Return an encoded tune or its first rejection reason."""
    if len(score.parts) != 1:
        return None, "parts"

    all_events = list(score.recurse().notesAndRests)
    if any(isinstance(event, chord.Chord) for event in all_events):
        return None, "chords"
    if any(event.duration.isGrace for event in all_events):
        return None, "grace-notes"
    if any(event.duration.tuplets for event in all_events):
        return None, "tuplets"
    if any(
        not isinstance(event, (note.Note, note.Rest))
        for event in all_events
    ):
        return None, "unpitched-notes"

    signatures = list(score.recurse().getElementsByClass(meter.TimeSignature))
    if not signatures:
        return None, "missing-meter"
    time_signature = signatures[0]
    if time_signature.ratioString not in METERS:
        return None, "unsupported-meter"
    if any(
        signature.ratioString != time_signature.ratioString
        for signature in signatures
    ):
        return None, "meter-change"

    key_signatures = list(score.recurse().getElementsByClass(key.KeySignature))
    if not key_signatures:
        return None, "missing-key"
    signature = key_signatures[0]
    mode = getattr(signature, "mode", None)
    if mode is None:
        tonal_key = score.analyze("key")
    elif mode in ("major", "minor"):
        tonal_key = (
            signature
            if isinstance(signature, key.Key)
            else signature.asKey(mode=mode)
        )
    else:
        return None, "unsupported-mode"
    if tonal_key.mode not in ("major", "minor"):
        return None, "unsupported-mode"

    measures = list(score.parts[0].getElementsByClass(stream.Measure))

    bar_length = Fraction(
        time_signature.numerator * 4,
        time_signature.denominator,
    )
    first_length = sum(
        event.duration.quarterLength
        for event in measures[0].recurse().notesAndRests
    )
    # A pickup bar is kept as a short first bar, followed by eight full bars.
    if first_length > bar_length or first_length <= 0:
        return None, "bad-first-bar"
    pickup = 0 if first_length == bar_length else first_length * 2
    if pickup and pickup != int(pickup):
        return None, "unsupported-duration"
    pickup = int(pickup)
    take = 9 if pickup else 8
    if len(measures) < take:
        return None, "too-few-measures"
    # Repeat endings in ABC leave short bars mid-tune; every bar after the first must be full.
    if any(
        sum(event.duration.quarterLength for event in measure.recurse().notesAndRests) != bar_length
        for measure in measures[1:take]
    ):
        return None, "short-bar"

    events = [
        event
        for measure in measures[:take]
        for event in measure.recurse().notesAndRests
    ]
    pitched = [event for event in events if isinstance(event, note.Note)]
    if len(pitched) < 16:
        return None, "too-few-notes"
    midi_values = [event.pitch.midi for event in pitched]
    if max(midi_values) - min(midi_values) > 12:
        return None, "pitch-range"

    signature_alters = {}
    for letter in "CDEFGAB":
        accidental = signature.accidentalByStep(letter)
        signature_alters[letter] = accidental.alter if accidental else 0

    reference = pitch.Pitch(f"{tonal_key.tonic.step}4").diatonicNoteNum
    encoded = []
    altered_notes = 0

    for event in events:
        eighths = event.duration.quarterLength * 2
        if eighths < 1 or eighths != int(eighths):
            return None, "unsupported-duration"
        eighths = int(eighths)

        if isinstance(event, note.Rest):
            encoded.append([None, 0, eighths])
            continue

        accidental = event.pitch.accidental
        actual_alter = accidental.alter if accidental else 0
        delta = actual_alter - signature_alters[event.pitch.step]
        if delta not in (-1, 0, 1):
            return None, "unsupported-alteration"
        if delta != 0:
            altered_notes += 1
        if altered_notes > 2:
            return None, "too-many-alterations"

        degree = event.pitch.diatonicNoteNum - reference
        entry = [degree, int(delta), eighths]
        if event.tie is not None and event.tie.type in ("start", "continue"):
            entry.append(1)
        encoded.append(entry)

    lowest_degree = min(entry[0] for entry in encoded if entry[0] is not None)
    shift = -7 * ((lowest_degree + 6) // 7)
    for entry in encoded:
        if entry[0] is not None:
            entry[0] += shift

    # A tie extending past the excerpt has no destination.
    if encoded and len(encoded[-1]) == 4:
        encoded[-1].pop()

    title = score.metadata.title if score.metadata is not None else None
    return {
        "id": tune_id,
        "title": str(title) if title else "",
        "mode": tonal_key.mode,
        "meter": time_signature.ratioString,
        "pickup": pickup,
        "notes": encoded,
    }, None


def main():
    """Write a deterministic sample and report extraction counts."""
    paths = sorted(
        {
            Path(path)
            for collection in ("essenFolksong", "oneills1850")
            for path in corpus.getComposer(collection)
        },
        key=lambda path: path.as_posix(),
    )
    tunes = []
    dropped = Counter()
    scanned = 0
    parse_failures = 0

    for path in paths:
        try:
            opus = corpus.parse(path)
            scores = opus.scores
        except Exception:
            parse_failures += 1
            continue

        for index, score in enumerate(scores):
            scanned += 1
            try:
                tune, reason = extract_tune(score, f"{path.stem}/{index}")
            except Exception:
                dropped["score-error"] += 1
                continue
            if tune is None:
                dropped[reason] += 1
            else:
                tunes.append(tune)

    tunes.sort(key=lambda tune: tune["id"])
    qualified = len(tunes)
    # Even sample per mode, so the few minor tunes are never thinned out by the many major ones.
    kept = []
    for mode, cap in LIMITS.items():
        pool = [tune for tune in tunes if tune["mode"] == mode]
        if len(pool) > cap:
            dropped[f"sample-cap-{mode}"] = len(pool) - cap
            pool = [pool[index * (len(pool) - 1) // (cap - 1)] for index in range(cap)]
        kept.extend(pool)
    tunes = sorted(kept, key=lambda tune: tune["id"])

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(
        "[\n" + ",\n".join(
            json.dumps(tune, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
            for tune in tunes
        ) + "\n]\n",
        encoding="utf-8",
    )

    print(f"scanned: {scanned}")
    print(f"qualified: {qualified}")
    print(f"kept: {len(tunes)}")
    print(f"collection parse failures: {parse_failures}")
    print("why dropped:")
    for reason, count in sorted(dropped.items()):
        print(f"  {reason}: {count}")


if __name__ == "__main__":
    main()

