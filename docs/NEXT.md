# MidiTutor — pickup note

Last updated: 2026-09-28. **Milestone 2 (score following) is built and tested
with the virtual keyboard. Next step: Todd tests it at the FP-30X.**

## What M2 does

On the **Score** tab the score now follows your playing from live MIDI:

- The cursor waits on the next note (or chord). Play it and it moves on. Notes
  you have played correctly turn **green**.
- A wrong key flashes the panel with a **red ring**, turns the expected notes red
  for a moment, and shows `✗ F#4 — expected D5 + G3`. The cursor does **not**
  move, so fix the note and carry on. A wrong-note counter keeps score.
- Chords and two-hand notes: all notes at that spot are needed, in any order.
  The **Play:** readout shows what is still missing.
- Held (tied) notes and rests are skipped automatically.
- **Pace** shows about how fast you are playing (quarter notes per minute, over
  the last 8 steps), next to the piece's target tempo.
- **Follow my playing** toggle; **Prev / Next** still move the cursor by hand (the
  follower picks up from wherever you land); **Restart** clears and goes to bar 1.
- Piece picker: **Minuet in G (simplified)** (default) or the old sample
  (C scale + Ode to Joy).

**New piece:** *Minuet in G major, BWV Anh. 114* (Christian Petzold, c.1725,
long credited to Bach), public domain. It covers bars 1–16 (the A section). The
right hand is as written. The **left hand is simplified** to one held bass note
per bar. That puts it near the level of "The Stormy Sea" (the original left
hand is a little harder). Target 100 bpm. File: `src/renderer/assets/minuet-in-g.musicxml`.

## Test this at the FP-30X (in order)

Setup: follow `docs/roland-plug-in-checklist.md` (USB-B into the port marked
**"Computer"**). **Leave Local Control ON.** The app never plays your keys
back, so turning it OFF would make the piano silent. (The old checklist said
OFF, which was wrong, and it is now fixed.)

Launch: `out\MidiTutor-win32-x64\MidiTutor.exe` (or `npm start`, which also
shows the dev keyboard).

1. **Connection.** The top-right badge shows the piano, not an error. On the
   **MIDI Monitor** tab, every key you press adds a note-on and a note-off line.
   *If not: stop here and tell me what the badge says.*
2. **Score tab → Minuet.** Bar 1 should read `Play: D5 + G3`. Play both
   together: both turn green and the cursor moves to the G4 eighth note.
3. **Chord, one hand at a time.** Press Restart, play only the right-hand D5, and
   check the readout changes to `Play: G3`. Then play G3 and check it moves on.
4. **Wrong note.** Hit any wrong key. You should see a red ring and a red `✗`
   message, and the cursor stays put. Play the right note and it carries on.
5. **Repeated notes** (bar 2: D5, G4, G4). You must strike G4 twice, and each
   strike should move the cursor once. *Watch for: one strike counting as two,
   or a second strike being ignored.*
6. **Play the whole 16 bars slowly, hands together.** At the end you should see
   `✓ Piece complete`. *Tell me:* does the cursor ever lag your hand, get stuck,
   or count a key you didn't press?
7. **Sustain pedal.** Play a few bars with the pedal down. It should change
   nothing, since pedal messages are ignored.
8. **Legato overlap.** Press the next key before you let go of the last one. It
   should still follow.
9. **Pace.** Play bars 1–4 steadily at roughly metronome 100 (the FP-30X has a
   built-in metronome). The Pace readout should show about 100.
10. **Optional: Bluetooth.** Unplug USB, pair "FP-30X MIDI", and repeat step 1.
    That checks whether Bluetooth works as the input.

Report back: which steps failed, and how it *felt*, meaning lag, being too strict,
or brushed keys counted as wrong.

## Known limits (on purpose for M2, candidates for M2.1)

- No skip-ahead: if you skip a note, it waits for you. Use **Next ▶** to get past it.
- Strict: a brushed neighbouring key counts as wrong (no timing/velocity filter yet).
- Pace is shown but not judged. There is no "too slow/fast" colouring yet.
- If the window is resized, the score redraws and the green marks clear. Following still works.
- Only the two built-in pieces are available. Loading your own MusicXML file (and M3 scanning) comes later.

## How to run / verify (dev)

```
npm start                    # dev; virtual keyboard at bottom: Z…M lower octave, Q…P upper, -/= octave
npx tsc --noEmit             # clean
npm run lint                 # 0 errors (6 old warnings)
npx electron-forge package   # → out/MidiTutor-win32-x64/MidiTutor.exe
```

Dev test hook (dev builds only): `window.__miditutorDev.play([74, 55])` plays a
chord through the real MIDI path. The M2 end-to-end check drove the Vite renderer
(`npx vite --config vite.renderer.config.ts --port 5199`) with headless Playwright.
It played both pieces through, including wrong notes, a split chord, keyboard
input, pace ≈ 100 bpm and Restart, and all 12 checks passed.

## Code map (M2)

- `src/renderer/engine/ScoreFollower.ts` — the matching logic on its own (steps → advance/wrong/partial/complete, pace).
- `src/renderer/components/score/ScoreView.tsx` — works through the OSMD cursor to build the steps, feeds live MIDI in, colours the notes.
- `src/renderer/components/midi/VirtualKeyboardDev.tsx` — two-octave dev keyboard with octave shift and the test hook.

## Gotchas

- OSMD `note.halfTone + 12` = MIDI note number (C4 = 60).
- Tailwind's preflight rule `img { height: auto }` flattens OSMD's cursor `<img>`
  to 1px. `keepCursorHeight()` in ScoreView copies the height attribute into an
  inline style. (M1's cursor had this bug too.)
- vexflow@5 types vs OSMD: `useVexFlow.ts` imports vexflow's default export and
  casts the statics (unchanged from M1).

## Still open from the M2 options card

USB vs Bluetooth as the main input (step 10 above answers it). Which tower
sits at the piano. AGPL batch tools (Audiveris) for M3 scanning.
