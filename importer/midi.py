"""Convert MIDI files to MusicXML for the MidiTutor MusicXML pipeline.

midi_to_musicxml(path, title=None) returns a complete score-partwise document
containing one piano grand staff. Conversion uses music21 without external
programs. Percussion is discarded, timing is quantized, and overlapping notes
are preserved through separate voices.
"""

from __future__ import annotations

import math
import os
from copy import deepcopy
from fractions import Fraction
from pathlib import Path
from tempfile import TemporaryDirectory

from .quantize import snap_events

from music21 import (
    chord,
    clef,
    converter,
    instrument,
    key,
    layout,
    metadata,
    meter,
    note,
    stream,
    tempo,
)


def _discard_percussion(source: stream.Stream) -> None:
    """Remove unpitched events and events on zero-based MIDI channel nine."""
    discarded = []
    for event in source.recurse().notes:
        if not isinstance(event, (note.Note, chord.Chord)):
            discarded.append(event)
            continue
        event_instrument = event.getContextByClass(instrument.Instrument)
        if event_instrument is not None and (
            event_instrument.midiChannel == 9
            or isinstance(event_instrument, instrument.UnpitchedPercussion)
        ):
            discarded.append(event)

    for event in discarded:
        source.remove(event, recurse=True)

    for part in tuple(source.getElementsByClass(stream.Part)):
        if not part.recurse().notes:
            source.remove(part)


def midi_to_musicxml(
    path: str | os.PathLike[str], title: str | None = None
) -> str:
    """Import MIDI as piano MusicXML, raising ValueError if no pitched notes remain.

    Pitches at each quantized onset merge within their staff. The resulting
    chord uses the longest contributing duration on that staff, preserving
    every pitch when simultaneously starting notes have different lengths.
    """
    try:
        source = converter.parse(os.fspath(path), quantizePost=False)
    except Exception as exc:  # music21 raises its own exception types for bad MIDI
        raise ValueError(f"not a readable MIDI file: {exc}") from exc
    if not source.flatten().notes:
        raise ValueError("MIDI file has no notes")

    first_key = source.recurse().getElementsByClass(key.KeySignature).first()
    first_time = source.recurse().getElementsByClass(meter.TimeSignature).first()
    first_tempo = source.recurse().getElementsByClass(tempo.MetronomeMark).first()

    _discard_percussion(source)
    if not source.flatten().notes:
        raise ValueError("MIDI file has no notes")

    if first_key is not None:
        key_signature = deepcopy(first_key)
    else:
        try:
            key_signature = key.KeySignature(source.analyze("key").sharps)
        except Exception:
            key_signature = key.KeySignature(0)
    time_signature = (
        deepcopy(first_time) if first_time is not None else meter.TimeSignature("4/4")
    )

    # Snap each staff on its own (one grid per beat, small gaps closed); see quantize.py.
    staff_events: list[list[tuple[float, float, list[int]]]] = [[], []]
    for event in source.flatten().notes:
        if isinstance(event, note.Note):
            pitches = [int(event.pitch.midi)]
        elif isinstance(event, chord.Chord):
            pitches = [int(pitch.midi) for pitch in event.pitches]
        else:
            continue
        offset, length = float(event.offset), float(event.duration.quarterLength)
        for staff_index in (0, 1):
            staff_pitches = [p for p in pitches if (p >= 60) == (staff_index == 0)]
            if staff_pitches:
                staff_events[staff_index].append((offset, length, staff_pitches))

    if not any(staff_events):
        raise ValueError("MIDI file has no notes")
    snapped = [snap_events(events) for events in staff_events]

    treble = stream.Part(id="treble")
    bass = stream.Part(id="bass")
    treble.partName = "Piano"
    treble.partAbbreviation = "Pno."
    bass.partName = "Piano"
    bass.partAbbreviation = "Pno."
    parts = (treble, bass)

    for part, staff_clef in zip(parts, (clef.TrebleClef(), clef.BassClef())):
        part.insert(0, instrument.Piano())
        part.insert(0, staff_clef)
        part.insert(0, deepcopy(key_signature))
        part.insert(0, deepcopy(time_signature))
    if first_tempo is not None:
        treble.insert(0, deepcopy(first_tempo))

    groups: dict[tuple[Fraction, int], tuple[set[int], Fraction]] = {}
    end = Fraction(0)
    for staff_index, events in enumerate(snapped):
        for offset, length, pitches in events:
            start = Fraction(offset).limit_denominator(24)
            duration = max(Fraction(1, 4), Fraction(length).limit_denominator(24))
            end = max(end, start + duration)
            previous_pitches, previous_duration = groups.get(
                (start, staff_index), (set(), Fraction(0))
            )
            groups[(start, staff_index)] = (
                previous_pitches | set(pitches),
                max(previous_duration, duration),
            )

    for (offset, staff_index), (pitches, duration) in sorted(groups.items()):
        staff_chord = chord.Chord(sorted(pitches))
        staff_chord.duration.quarterLength = duration
        parts[staff_index].insert(offset, staff_chord)

    bar_length = Fraction(time_signature.barDuration.quarterLength)
    notation_end = math.ceil(end / bar_length) * bar_length

    result = stream.Score()
    result.metadata = metadata.Metadata()
    result.metadata.title = title if title is not None else Path(path).stem
    # Blank, not music21's default "Music21" composer and a repeated subtitle.
    result.metadata.composer = ""
    result.metadata.movementName = ""
    for part in parts:
        part.makeVoices(inPlace=True, fillGaps=False)
        part.makeRests(
            refStreamOrTimeRange=(0, notation_end), fillGaps=True, inPlace=True
        )
        result.insert(0, part)
    result.insert(
        0, layout.StaffGroup([treble, bass], name="Piano", symbol="brace", barTogether=True)
    )
    result.makeNotation(
        refStreamOrTimeRange=(0, notation_end), bestClef=False, inPlace=True
    )

    with TemporaryDirectory(prefix="miditutor-") as temporary_directory:
        destination = Path(temporary_directory) / "score.musicxml"
        written_path = result.write("musicxml", fp=destination)
        return Path(written_path).read_text(encoding="utf-8")
