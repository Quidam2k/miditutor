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

## Pinocchio (Mac mini, remote music box)

Pinocchio is a Mac mini (Apple Silicon) in the music room, driven by Orolo
over SSH from Solace (`ssh toddwalker@todds-mac-mini`). Three docs, in order:

- `docs/pinocchio-todd-steps.md`: Todd's one-time physical checklist (power,
  hub, Wi-Fi, account, Remote Login, keep-awake, FP-30X).
- `docs/pinocchio-walkthrough.md`: the same steps as a script Orolo reads aloud.
- `docs/pinocchio-orolo-runbook.md`: Orolo's SSH steps (toolchain, build,
  LaunchAgent, tunnel `ssh -L 47800:127.0.0.1:47800 pinocchio`, token, checks).

Build workflow: `.github/workflows/macos.yml` runs on `workflow_dispatch` and
`v*` tags only (no push trigger, to save private minutes). It runs tsc, vitest,
`electron-forge make --platform=darwin --arch=arm64`, then a hidden launch smoke
(`.github/scripts/macos-smoke.sh`: /state 200 with token, 401 without), and
uploads the zip. Not yet run on a macOS runner.

Status (2026-10-25, #9437): **installed and verified on Pinocchio.** Built on CI
(run 40234143238), installed to `~/Applications/MidiTutor.app` by
`scripts/deploy_pinocchio.sh`, hidden /state check passed (200 with token, 401
without, renderer connected, Web MIDI enabled). MidiTutor icon is in the Dock and
on the Desktop. The Mac has no Xcode tools, so never run git/python3 there (it
pops an install dialog on the TV). Not yet verified: the FP-30X plugged into
Pinocchio, launch at login.

2026-10-25 (#9443): tunnel + token (runbook 5-7) verified from Solace; POST /piece
loaded The Sorcerer's Apprentice (69 bars, homr on Todd's photos + hand fixes; kept
OUT of this public repo at `Q:/Personal/piano/sorcerers-apprentice/`, with its
`build.py`). Also never use `osascript ... System Events` over SSH: it hangs on an
Automation permission prompt on the TV. Open app bugs found:
- The view opens scrolled to the END: `extractSteps` walks the cursor with
  `followCursor: true` and `cursor.reset()` does not scroll back. Fix: scroll the
  container to top after the walk.
- Note names are always sharps (`expected C#5` for D-flat in a 4-flat piece);
  name by the score's key/spelling instead.

## Music-API handoff (2026-10-08, #7365/#7367)
Shipped + pushed (master cd35233): tutor API + tutor_* MCP tools, blue/red play-along overlay, importer (MIDI/MusicXML/photo) + Open piece + Photo/Score toggle, OMR = homr 0.7.0 (.venv-omr-homr; bench/omr), macOS CI green (run 37842684233), Pinocchio docs.
Verified only via /inject — NOT a real or loopback MIDI port.

Next worker, once Todd has installed loopMIDI and sent photos:
1. Create a loopMIDI port; run the app (hidden; see scripts/e2e_tutor.py header) and select that port as input.
2. Write/run a mido script (.venv) that plays chords + Minuet bars into the port; verify with tutor_wait_for_play / tutor_check / piano_next_chord(show=True) and a /screenshot. Pass -> claim (1), close #3566/#3567.
3. Run bench/omr on Todd's real photos (keep them OUT of git — repo is public); report pitch / pitch+duration % per engine. If homr fails, try Audiveris (needs Docker running or an approved msiexec extract).
4. Still open: tutor_list_pieces (needs piece persistence), Open piece dialog click-test, tests_py/test_piano_drill.py breaks pytest collection, FP-30X + on-box Mac test (#4046 remainder), tempo overlay (#1181 remainder).

## Walking Todd through homework (#4098)
Say what each item is *asking him to do*, not just its name. One plain sentence each:
- **Scale / arpeggio (e.g. E minor):** play the scale up and down with a steady fingering, then the same notes as a broken chord (1-3-5, up and back), hands as JP specified. Goal: even and in the right key (E minor = one sharp, F#).
- **Triads by colour:** memorize chords by their colour, i.e. by the sound and shape of major, minor, diminished and augmented, so you can name or play one on hearing or seeing it, not by spelling it out. The Practice voice drill covers this.
- **A piece's chord patterns (e.g. Sorcerer's):** learn the chord shapes the left hand repeats, so a bar reads as "this chord again" and not as separate notes.
Which drill in Practice covers an item: Homework mode lists JP's newest entry as drills.
Loose ends 2026-10-27 (#9747, #5015): pytest collection fixed (script-style tests exit via `__main__` guard now). Open-piece dialog is a native file dialog, so no headless click-test; exercised by use.
