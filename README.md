# MidiTutor

Desktop app that connects to a MIDI keyboard and drills music-reading skills.
Electron + React 19 + TypeScript, VexFlow staff, WebMidi.js input, Tone.js
audio, Zustand state. See `CLAUDE.md` for architecture and conventions.

## What actually exists today (2026-08-28)

An early **sight-reading trainer** — it *generates* practice notes and checks
what you play. It is NOT yet a score follower.

- Renders one random note (or a two-note interval) on a treble/bass staff.
- Listens for MIDI `noteon`, evaluates played vs. expected, highlights green
  (correct) / red (wrong), tracks streak/accuracy, and auto-adjusts difficulty
  (range + accidentals) via a mastery model.
- Auto-connects to the first MIDI input; on-screen MIDI status indicator.
- Tone.js note playback (audio init gated behind a user gesture).

**Not built yet:** reading real sheet music, MusicXML import, score-following /
auto-advance, tempo vs. target bpm, OMR of scanned paper, theory drills beyond
note/interval, a settings/exercise-picker UI (`useSettingsStore` is unwired).

## Revive status
- `npx tsc --noEmit` and `npx electron-forge package` — both clean (win x64).
- `npm start` — Electron launches; Vite serves the renderer. Live UI paint +
  MIDI input is **unverified against hardware** — that is the first at-the-piano
  test (see the plug-in kit in the milestone plan).
- Added a Web MIDI permission handler in `src/main.ts`; Chromium blocks
  `requestMIDIAccess()` without it, so MIDI could never have worked before.

## Run

```
npm install
npm start                    # dev mode (Electron Forge + Vite HMR)
npx tsc --noEmit             # type check
npx electron-forge package   # production build → out/
```

No keyboard? Install **loopMIDI** (or any virtual MIDI port) to test input
without hardware.
