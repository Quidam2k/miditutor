# Beaming eighth notes: the rules (#6612)

Beams join a run of eighths (or shorter notes) so the eye sees the beat. Separate flags on every eighth are
old vocal-music style, one per syllable; piano music doesn't do that.

**JP's rule (lesson 11/20, and it wins over the books):** group everything under one beat together.
"It's an art, not a science." It depends on the meter:

| Meter | Beam groups | Example |
|---|---|---|
| 3/8 | the whole bar | ♪♪♪ as one beam |
| 6/8, 9/8, 12/8 | three eighths (one dotted-quarter beat) | 9/8 = 3 + 3 + 3 |
| 4/4 | beats 1+2 and 3+4 (half bars), never across the middle | ♪♪♪♪ ♪♪♪♪ |
| 2/4 | the whole bar | ♪♪♪♪ |
| 3/4 | one beat each | ♪♪ ♪♪ ♪♪ |
| 2/2 (cut time) | one half note each | ♪♪♪♪ ♪♪♪♪ |
| 5/8 | 2 + 3 (JP's example). A piece written 3 + 2 says so on the page | ♪♪ ♪♪♪ |
| 7/8 | 2 + 2 + 3 | ♪♪ ♪♪ ♪♪♪ |

**The book adds (Elaine Gould, *Behind Bars*):**
- **16ths beam by the beat,** even in 4/4. A half bar holding 16ths splits back into single beats.
- **A rest breaks the beam.** Eighth, rest, eighth in 3/8 shows two flags (see Sorcerer's Apprentice, Giocoso, page 1).
  Some modern editions beam over a rest; we don't.
- **A lone eighth keeps its flag.** A beam needs two or more notes.
- **A beam never crosses a barline,** and never joins two voices or the two hands.
- **Triplets** beam as their own group of three, with the 3 on the beam.
- **A pickup bar** is the end of a full bar, so it's grouped counting back from the barline.
- **Chords** share one beam. The beam slants with the melody, and the stems go the way most notes need.

**In MidiTutor:** `src/renderer/engine/autoBeam.ts` applies these rules to every score the app draws: the Score
view, Review, the mix builder, and Print for binder / Save as PDF (one entry point, `forOsmd` in `engine/osmdXml.ts`).
Scanned scores carry no beams of their own, so every beam you see comes from this table. The file on disk is never
changed.
