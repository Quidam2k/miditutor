"""MidiTutor score importer (#4045 slice D).

Turns whatever the musician has (a MIDI file, a MusicXML file, a photo of a
score) into MusicXML text that the Score tab can render.

Python interface:
    importer.midi.midi_to_musicxml(path, title=None) -> str
    importer.musicxml.read_musicxml(path) -> str        (.musicxml/.xml/.mxl)
    importer.omr.photo_to_musicxml(path) -> str         (slice E plugs in here)

CLI: python -m importer midi|musicxml|photo <file> [-o out.musicxml] [--json]
"""
