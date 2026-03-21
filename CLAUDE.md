# MidiTutor

Desktop app that connects to a MIDI keyboard and teaches music — starting with note identification and intervals.

## Tech Stack

- **Shell**: Electron Forge + Vite
- **UI**: React 19 + TypeScript
- **Notation**: VexFlow 5 (SVG rendering)
- **MIDI**: WebMidi.js 3.x
- **Audio**: Tone.js
- **State**: Zustand (with `persist` middleware for settings)
- **Styling**: Tailwind CSS v4 (via `@tailwindcss/postcss`)

## Commands

- `npm start` — Launch in dev mode (Electron Forge + Vite HMR)
- `npx tsc --noEmit` — Type check
- `npx electron-forge package` — Production build
- `npx electron-forge make` — Create distributable

## Architecture

### Data Flow (real-time loop)
```
MIDI Keyboard → WebMidi.js noteon → useMidi hook → Zustand store
  → ExerciseView reads store → ExerciseEngine.evaluate() → result
  → StaffDisplay highlights green/red, FeedbackOverlay animates
  → SessionStats updates → after delay → ExerciseEngine.next()
  → DifficultyManager adjusts → StaffDisplay renders new note
```

### Key Directories
- `src/main/` — Electron main process (main.ts, preload.ts)
- `src/renderer/engine/` — Exercise logic, music theory, difficulty system
- `src/renderer/store/` — Zustand stores (midi, exercise, session, settings)
- `src/renderer/components/` — React UI (staff, midi, exercise, feedback)
- `src/renderer/audio/` — Tone.js audio engine
- `src/renderer/types/` — TypeScript types (music, exercise, midi)

### Zustand Stores
- `useMidiStore` — MIDI device state, last note events
- `useExerciseStore` — Current exercise, phase, results
- `useSessionStore` — Running stats (attempts, accuracy, streak)
- `useSettingsStore` — Persisted user preferences (clef, audio, etc.)

## Conventions

- Middle C = C4 = MIDI number 60
- VexFlow keys use format `"c/4"`, `"c#/4"`, `"bb/5"`
- Accidentals: sharps by default for black keys; `midiNumberToPitch(n, true)` for flats
- Tailwind v4 uses `@import "tailwindcss"` in CSS, processed via PostCSS (not Vite plugin — ESM incompatibility with Electron Forge)

## Known Constraints

- Tailwind's Vite plugin (`@tailwindcss/vite`) is ESM-only and incompatible with Electron Forge's CJS config loading. Use `@tailwindcss/postcss` via `postcss.config.js` instead.
- Audio must be initialized from a user gesture (browser autoplay policy). The "Start Practice" button triggers `initAudio()`.
- WebMidi runs in the renderer process — no IPC hop needed for low-latency MIDI input.
