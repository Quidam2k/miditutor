"""Score an OMR output MusicXML against a ground-truth MusicXML.

Both files are flattened to a single sequence of notes ordered by onset (parts
merged, chords split into their pitches, rests ignored). Pitches are written
pitches with the key signature applied to un-accidented notes, so a key-signature
miss counts as a wrong pitch. Two sequences are then aligned with difflib:

  pitch_acc       2*M / (|truth| + |pred|) over pitch midi numbers
  pitch_dur_acc   same over (midi, quarterLength) pairs
  (M = total size of matching blocks; 100% = identical sequences)

Usage:  python bench/omr/score.py truth.musicxml pred.musicxml [--json]
Run with the bench venv (music21 is installed there).
"""

from __future__ import annotations

import argparse
import difflib
import json
import sys
from pathlib import Path

from music21 import chord, converter, note, stream

Event = tuple[int, float]


def _key_alter(part_key: object, step: str) -> int:
    if part_key is None:
        return 0
    acc = part_key.accidentalByStep(step)  # type: ignore[attr-defined]
    return int(acc.alter) if acc is not None else 0


def flatten(path: Path) -> list[Event]:
    """Return (midi, quarterLength) per sounding note, ordered by onset."""
    score = converter.parse(str(path))
    events: list[tuple[float, int, float]] = []
    for part in score.parts:
        key = None
        for el in part.recurse():
            if el.__class__.__name__ in ("KeySignature", "Key"):
                key = el
            if isinstance(el, note.Note):
                notes = [el.pitch]
            elif isinstance(el, chord.Chord):
                notes = el.pitches
            else:
                continue
            offset = float(el.getOffsetInHierarchy(score))
            for pitch in notes:
                midi = pitch.midi
                if pitch.accidental is None:
                    midi += _key_alter(key, pitch.step) if key is not None else 0
                events.append((round(offset, 4), int(midi), round(float(el.quarterLength), 3)))
    events.sort(key=lambda e: (e[0], e[1]))
    return [(midi, ql) for _, midi, ql in events]


def _ratio(a: list, b: list) -> float:
    if not a and not b:
        return 1.0
    matcher = difflib.SequenceMatcher(None, a, b, autojunk=False)
    matched = sum(block.size for block in matcher.get_matching_blocks())
    return 2.0 * matched / (len(a) + len(b))


def score_pair(truth_path: Path, pred_path: Path) -> dict:
    truth = flatten(truth_path)
    pred = flatten(pred_path)
    pitch_t = [m for m, _ in truth]
    pitch_p = [m for m, _ in pred]
    return {
        "n_truth": len(truth),
        "n_pred": len(pred),
        "pitch_acc": round(100.0 * _ratio(pitch_t, pitch_p), 1),
        "pitch_dur_acc": round(100.0 * _ratio(truth, pred), 1),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("truth", type=Path)
    parser.add_argument("pred", type=Path)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
    result = score_pair(args.truth, args.pred)
    print(json.dumps(result) if args.json else result)
    return 0


if __name__ == "__main__":
    sys.exit(main())
