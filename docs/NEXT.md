# MidiTutor — pickup note

Last updated: 2026-08-28. Milestone 1 is shipped and accepted.

## Where things stand

MidiTutor is a **sight-reading trainer** that now also has the first pieces of
the **score-follower** direction (Todd's 2026-08-28 spec). It has NOT been
tested against Todd's Roland FP-30X yet — that is Todd's test at the piano.

**Shipped (commit 205faa7):**
- **MIDI Monitor** tab — device list + live note-on/off log (note, velocity,
  channel, time). The oracle for "did the keyboard connect".
- **Roland plug-in checklist** — `docs/roland-plug-in-checklist.md` (filed to
  Todd's Review tab).
- **Score** tab — renders one MusicXML file with OpenSheetMusicDisplay and a
  manual prev/next/reset cursor. Test piece: `src/renderer/assets/sample-score.musicxml`
  (public-domain C scale + Ode to Joy). No auto-following yet.
- **Dev virtual keyboard** — appears only in `npm start` (dev). Type the
  home-row keys or click to send notes through the real MIDI path, so the app
  is testable without hardware. Absent from packaged builds.

**Earlier (commit 3c2de15):** README + Web MIDI permission handler in
`src/main.ts` (Chromium blocks `requestMIDIAccess()` without it — this was a
latent blocker; MIDI could never have worked before).

## How to run

```
npm install
npm start        # dev mode; the dev virtual keyboard shows at the bottom
npx tsc --noEmit # type check (clean)
npm run lint     # eslint (clean)
npx electron-forge package   # production build → out/
```

No MIDI keyboard? Use the in-app dev virtual keyboard, or install **loopMIDI**
(admin install — Todd's call) for a virtual MIDI port.

## What Milestone 2 needs before it can start

M2 = score following (align live MIDI to the score, auto-advance, wrong-note
highlight) + a tempo indicator vs. target bpm. It is **planned but held** on
Todd's options card:

1. **Which tower/OS** sits at the piano (the older Windows + NVIDIA 30-series box).
2. **USB vs Bluetooth** as the primary MIDI path for the FP-30X.
3. **AGPL batch tools** (Audiveris for M3 OMR) acceptable for offline use?

Also pending: run the Roland plug-in checklist so we have one confirmed
end-to-end hardware test before building following logic on top.

## Gotcha for whoever picks this up

vexflow@5's types re-export via `export *`, which TypeScript's
`moduleResolution: bundler` stops surfacing once OpenSheetMusicDisplay (with its
own nested vexflow) is in the dependency tree. `src/renderer/components/staff/useVexFlow.ts`
therefore imports vexflow's **default** export and casts the statics. Runtime is
unaffected (the default export carries the classes). Revisit if vexflow/TS fixes it.
