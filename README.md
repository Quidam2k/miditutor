# MidiTutor

Desktop app that connects to a MIDI keyboard and drills music-reading skills.
Electron + React 19 + TypeScript, VexFlow staff, WebMidi.js input, Tone.js
audio, Zustand state. See `CLAUDE.md` for architecture and conventions.

## What it does

- **Note and interval trainer.** Renders a random note (or two-note interval) on a
  treble/bass staff, listens for MIDI `noteon`, highlights green (correct) / red
  (wrong), tracks streak and accuracy, and adjusts difficulty (range and
  accidentals) with a mastery model.
- **Score following.** The Score tab follows your playing from live MIDI: the
  cursor waits on the next note or chord, correct notes turn green, a wrong key
  is flagged without advancing, and the pace you play at is shown next to the
  piece's target tempo. A few public-domain MusicXML pieces are bundled.
- **Importing music.** `importer/` reads MusicXML and MIDI files, and can turn a
  photo of a printed score into MusicXML with an optical music recognition
  engine (homr, installed separately; see `importer/omr.py` and `bench/omr/`).
- **More practice tools.** Scale fingering, pedal coaching, a sight-read drill
  and build-backwards loops.
- Auto-connects to the first MIDI input, with an on-screen MIDI status
  indicator, and plays notes with Tone.js (audio starts after a user gesture).

Electron's Chromium blocks `requestMIDIAccess()` unless the main process grants
the permission, so `src/main.ts` installs a Web MIDI permission handler.

## Run

```
npm install
npm start                    # dev mode (Electron Forge + Vite HMR)
npx tsc --noEmit             # type check
npx electron-forge package   # production build → out/
```

No keyboard? Install **loopMIDI** (or any virtual MIDI port) to test input
without hardware.

## Voice drill + MCP server (companion-app interface)

`drill/` is a stdlib-only practice engine: `catalog.json` (24 major/minor triads, grouped by
white/black key colour) and `piano_drill.py`, which serves chords at random from the ones not yet
covered this cycle. A "missed" chord stays in the pool. History lives in `data/drill.db`
(gitignored).

`miditutor_mcp/server.py` exposes it as MCP tools (`piano_next_chord`, `piano_record`,
`piano_drill_status`) so voice assistants can run a practice session:

    python -m miditutor_mcp.server    # cwd + PYTHONPATH = repo root

The Electron app can read the same catalog and database when the MIDI box comes online.
Tests: `python tests_py/test_piano_drill.py`.

## License

MIT, see [LICENSE](LICENSE).
