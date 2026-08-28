# Roland FP-30X — Plug-In & First-Test Checklist

A one-page walkthrough for the first time you connect the piano to the computer
and check that MidiTutor can "hear" it. Do these in order. If any step fails,
stop there and note what happened — that tells us exactly where the problem is.

## Before you start
- [ ] The computer is turned on and connected to the internet (the piano's
      driver installs itself automatically the first time it's plugged in, but
      only if the computer is online).
- [ ] Windows is up to date.
- [ ] The piano's software (firmware) is version 1.03 or newer.
- [ ] You have the right cable: a **USB-B** cable (the squarish end goes to the
      piano). Roland doesn't include one, so you may need to buy it.

## Plug it in
- [ ] Plug the cable into the port on the piano labeled **"Computer"** — NOT the
      port for a USB memory stick. They look similar; using the wrong one is the
      most common mistake.
- [ ] Plug the other end into the computer. Wait about 20–30 seconds the first
      time so Windows can set up the piano.
- [ ] Turn the piano on.

## Tell the piano to send its notes to the computer
- [ ] Turn **Local Control OFF** on the piano. (This stops each key from playing
      twice — once from the piano and once echoed back by the app. The piano's
      manual covers how, around page 12.)

## Confirm Windows sees the piano
- [ ] Open Windows **Device Manager** and look for the piano listed as a sound
      or MIDI device. If it's there, Windows found it. If it's not, unplug and
      replug, and double-check you used the "Computer" port.

## Confirm MidiTutor hears it
- [ ] Start MidiTutor and open the **MIDI Monitor** screen (top of the window).
- [ ] The piano should appear in the "Inputs" list with a green dot next to it.
- [ ] If the app asks for permission to use MIDI, allow it.
- [ ] Press a few keys. Each press should show up **instantly** in the note log,
      with the note name (like "C4"), and a **velocity** number that changes
      depending on how hard you press. Seeing velocity change is the real proof
      the connection is working.

## If you'd rather go wireless (optional)
- [ ] The FP-30X can also connect over **Bluetooth** — it shows up as
      "FP-30X MIDI". This is a second way in if the cable ever gives trouble.

## Good to know
- The piano's built-in demo songs are **not** sent to the computer — only the
  notes you actually play.
- The included pedal is a simple on/off pedal. Half-pedal (gradual) only works
  with an optional Roland damper pedal, so don't worry if the pedal reads as
  just "down" or "up" for now.

---
When every box above is checked, the hardware side is proven and we can move on
to following along with real sheet music.
