"""Snap played MIDI timing to a grid that reads like printed music (#6309).

music21's own quantizePost snaps every note on its own, to the nearest point of a 16th grid
or an eighth-triplet grid. A loosely played take then mixes the two inside one beat and the
notation fills with 12-tuplets, nested triplets and stray 32nd rests. Here each beat picks ONE
grid (straight 16ths unless the notes in it clearly sit on triplet points), notes snap on it,
and the small gaps a player leaves between notes are closed.

A file whose notes already sit on the grids (a cleanly sequenced score) comes back untouched.
Pure Python (no music21); events are (offset, duration, pitches) in quarter lengths for ONE
hand or staff, since gap closing looks only at the notes of that list.
"""

from __future__ import annotations

import math
from fractions import Fraction

STRAIGHT = Fraction(1, 4)
TRIPLET = Fraction(1, 3)
LEAD = 0.125          # a note this far before a beat still belongs to that beat's window
CLEAN = 0.004         # within this of a grid point counts as already on the grid
TRIPLET_WINS = 0.6    # triplet grid must beat the straight one by this error ratio
MAX_GAP = Fraction(1, 2)  # a gap shorter than an eighth after a note is closed (played legato)

Event = tuple[float, float, list[int]]


def _snap(value: float, step: Fraction) -> Fraction:
    return Fraction(math.floor(value / float(step) + 0.5)) * step


def _on_grid(value: float) -> bool:
    return any(abs(value - float(_snap(value, step))) <= CLEAN for step in (STRAIGHT, TRIPLET))


def _writable(length: Fraction) -> bool:
    """A length that is a whole number of 16ths or of eighth-triplets is one printed note."""
    return length > 0 and (length % STRAIGHT == 0 or length % TRIPLET == 0)


def _window(value: float) -> int:
    return math.floor(value + LEAD)


def choose_grids(onsets: list[float]) -> dict[int, Fraction]:
    """One grid step per beat window: TRIPLET only where the notes clearly sit on triplet points."""
    windows: dict[int, list[float]] = {}
    for onset in onsets:
        windows.setdefault(_window(onset), []).append(onset)
    grids: dict[int, Fraction] = {}
    for window, notes in windows.items():
        straight_error = sum(abs(o - float(_snap(o, STRAIGHT))) for o in notes)
        triplet_error = sum(abs(o - float(_snap(o, TRIPLET))) for o in notes)
        off_beat = sum(1 for o in notes if _snap(o, TRIPLET).denominator == 3)
        grids[window] = TRIPLET if off_beat and triplet_error < TRIPLET_WINS * straight_error else STRAIGHT
    return grids


def fit_gap(duration: float, room: float) -> float:
    """Trim a note so it and the rest after it (up to the next onset, `room` away) each print as one value.

    A 16th note held across a triplet beat would read 7/12; a triplet-eighth and a 16th rest read cleanly.
    Lengths that already print fine come back as they are.
    """
    length, room_f = _fraction(duration), _fraction(room)
    if _writable(length) and (room_f == length or _writable(room_f - length) or room_f < length):
        return duration
    for twelfths in range(int(min(length, room_f) * 12), 0, -1):
        candidate = Fraction(twelfths, 12)
        if _writable(candidate) and (room_f == candidate or _writable(room_f - candidate)):
            return float(candidate)
    return duration


def _fraction(value: float) -> Fraction:
    return Fraction(value).limit_denominator(24)


def close_gaps(events: list[Event]) -> list[Event]:
    """Extend each note to the next onset when a gap under an eighth follows it (played legato)."""
    starts = sorted({_fraction(o) for o, _, _ in events})
    result: list[Event] = []
    for onset, duration, pitches in events:
        start = _fraction(onset)
        end = start + _fraction(duration)
        later = next((s for s in starts if s > start), None)
        if later is not None and 0 < later - end < MAX_GAP and _writable(later - start):
            duration = float(later - start)
        result.append((onset, duration, pitches))
    return result


def snap_events(events: list[Event], close: bool = True) -> list[Event]:
    """Snap onsets and lengths to the beat; input already on the grid is returned as it came.

    close=False leaves the gaps for a later close_gaps() call (when the events still hold both
    hands and are about to be split).
    """
    if not events or all(_on_grid(o) and _on_grid(o + d) for o, d, _ in events):
        return list(events)
    grids = choose_grids([o for o, _, _ in events])
    snapped: list[Event] = []
    for onset, duration, pitches in events:
        step = grids.get(_window(onset), STRAIGHT)
        start = max(Fraction(0), _snap(onset, step))
        # The length is a whole number of the START's steps, so it can be written as one note.
        snapped.append((float(start), float(max(step, _snap(duration, step))), pitches))
    return close_gaps(snapped) if close else snapped
