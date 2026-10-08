"""The score importer: MIDI -> MusicXML grand staff, MusicXML pass-through, photo stub."""
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import mido
import music21
import pytest

from importer.__main__ import main
from importer.midi import midi_to_musicxml
from importer.musicxml import MusicXMLError, read_musicxml

MINUET = ROOT / "src" / "renderer" / "assets" / "minuet-in-g.musicxml"


def write_midi(path, notes_with_gaps):
    """Write a single-track MIDI file; each item is (note, ticks_before_on, ticks_held)."""
    midi = mido.MidiFile(ticks_per_beat=480)
    track = mido.MidiTrack()
    midi.tracks.append(track)
    track.append(mido.MetaMessage("time_signature", numerator=3, denominator=4, time=0))
    track.append(mido.MetaMessage("key_signature", key="G", time=0))
    events = []
    for note, start, length in notes_with_gaps:
        events.append((start, "note_on", note))
        events.append((start + length, "note_off", note))
    events.sort(key=lambda e: (e[0], e[1] == "note_on"))
    last = 0
    for tick, kind, note in events:
        track.append(mido.Message(kind, note=note, velocity=80 if kind == "note_on" else 0,
                                  time=tick - last))
        last = tick
    midi.save(path)


@pytest.fixture
def two_hand_midi(tmp_path):
    path = tmp_path / "two-hands.mid"
    # Bass C3-E3-G3 struck together for one beat, then the melody E5 D5 C5 on quarters.
    write_midi(path, [
        (48, 0, 480), (52, 0, 480), (55, 0, 480),
        (76, 480, 480), (74, 960, 480), (72, 1440, 480),
    ])
    return path


def test_midi_becomes_grand_staff_split_at_c4(two_hand_midi):
    xml = midi_to_musicxml(two_hand_midi, title="Two hands")
    score = music21.converter.parseData(xml)

    assert len(score.parts) == 2
    treble, bass = score.parts
    treble_notes = treble.flatten().notes
    bass_notes = bass.flatten().notes
    assert [(float(n.offset), n.nameWithOctave) for n in treble_notes] == [
        (1.0, "E5"), (2.0, "D5"), (3.0, "C5"),
    ]
    assert [(float(n.offset), [p.nameWithOctave for p in n.pitches]) for n in bass_notes] == [
        (0.0, ["C3", "E3", "G3"]),
    ]
    assert treble.recurse().getElementsByClass(music21.clef.TrebleClef)
    assert bass.recurse().getElementsByClass(music21.clef.BassClef)
    assert treble.recurse().getElementsByClass(music21.meter.TimeSignature).first().ratioString == "3/4"
    assert treble.recurse().getElementsByClass(music21.key.KeySignature).first().sharps == 1


def test_midi_without_notes_is_an_error(tmp_path):
    path = tmp_path / "empty.mid"
    midi = mido.MidiFile(ticks_per_beat=480)
    track = mido.MidiTrack()
    midi.tracks.append(track)
    track.append(mido.MetaMessage("set_tempo", tempo=500000, time=0))
    midi.save(path)
    with pytest.raises(ValueError, match="no notes"):
        midi_to_musicxml(path)


def test_garbage_file_is_a_value_error(tmp_path):
    path = tmp_path / "junk.mid"
    path.write_bytes(b"this is not a midi file")
    with pytest.raises(ValueError, match="not a readable MIDI file"):
        midi_to_musicxml(path)


def test_cli_midi_writes_file_and_prints_path(two_hand_midi, tmp_path, capsys):
    out = tmp_path / "out.musicxml"
    assert main(["midi", str(two_hand_midi), "-o", str(out)]) == 0
    printed = capsys.readouterr().out.strip()
    assert printed == str(out.resolve())
    assert len(music21.converter.parse(out).parts) == 2


def test_musicxml_passthrough_validates_and_reads_mxl(tmp_path):
    assert "<score-partwise" in read_musicxml(MINUET)

    mxl = tmp_path / "score.mxl"
    with zipfile.ZipFile(mxl, "w") as archive:
        archive.writestr("META-INF/container.xml",
                         '<container><rootfiles><rootfile full-path="music/score.xml"/></rootfiles></container>')
        archive.writestr("music/score.xml", MINUET.read_text(encoding="utf-8"))
    assert "<score-partwise" in read_musicxml(mxl)


def test_musicxml_rejects_non_scores(tmp_path):
    bad = tmp_path / "bad.musicxml"
    bad.write_text("<invalid />", encoding="utf-8")
    with pytest.raises(MusicXMLError, match="not a MusicXML score"):
        read_musicxml(bad)


def test_photo_is_a_stub_until_slice_e(tmp_path, capsys):
    photo = tmp_path / "page.jpg"
    photo.write_bytes(b"not really a jpeg")
    assert main(["photo", str(photo)]) == 1
    assert "OMR not wired yet (slice E)" in capsys.readouterr().err
