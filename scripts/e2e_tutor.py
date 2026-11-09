"""End-to-end check of the tutor API against the RUNNING app.

Start the app first (npm start, or MIDITUTOR_HIDDEN=1 npm start), then:
    python scripts/e2e_tutor.py            # notes via /inject (NOT a real MIDI device)
    python scripts/e2e_tutor.py --port "loopMIDI Port"   # notes via a virtual MIDI port (mido)

The inject path goes renderer ingest -> bridge -> main, the same path the
keyboard uses after WebMidi; only a MIDI port run proves the WebMidi leg.
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from miditutor_mcp import tutor_client as tc  # noqa: E402

FAILS: list[str] = []


def check(cond: bool, label: str, detail: object = "") -> None:
    print(("PASS " if cond else "FAIL ") + label + (f"  {detail}" if not cond else ""))
    if not cond:
        FAILS.append(label)


def held(during) -> None:
    """Keys stay down 0.25 s; with `during`, it runs while they are still down (a wrong note
    shows red only while its key is held, #9630)."""
    if during is None:
        time.sleep(0.25)
        return
    time.sleep(0.5)
    during()


def make_cdp_player(port_name: str):
    """#5077 on the Mac (no python there): the app's own renderer sends through WebMIDI to a
    CoreMIDI loopback port (IAC Driver Bus 1), and its WebMidi input hears it come back."""
    import os

    from playwright.sync_api import sync_playwright

    pw = sync_playwright().start()
    page = pw.chromium.connect_over_cdp(os.environ.get("MIDITUTOR_CDP", "http://127.0.0.1:9345")).contexts[0].pages[0]
    js = """async ([name, notes, on]) => {
      const a = await navigator.requestMIDIAccess();
      const out = [...a.outputs.values()].find((o) => o.name && (o.name.includes(name) || name.includes(o.name)));
      if (!out) throw new Error('no MIDI output named ' + name);
      for (const n of notes) out.send(on ? [0x90, n, 80] : [0x80, n, 0]);
    }"""

    def play(notes, during=None):
        page.evaluate(js, [port_name, notes, True])
        held(during)
        page.evaluate(js, [port_name, notes, False])

    return play


def make_player(port_name: str | None, cdp_out: str | None = None):
    if cdp_out:
        return make_cdp_player(cdp_out)
    if not port_name:
        def inject(notes, during=None):
            tc.inject(notes, hold_ms=1500 if during else 250)
            held(during)
            if during:
                time.sleep(1.1)  # the app releases the keys itself, at 1.5 s

        return inject
    import mido  # only needed for the real-port path

    out = mido.open_output(port_name)

    def play(notes, during=None):
        for n in notes:
            out.send(mido.Message("note_on", note=n, velocity=80))
        held(during)
        for n in notes:
            out.send(mido.Message("note_off", note=n, velocity=0))

    return play


def wait_task(pred, timeout=3.0):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        task = tc.get_task().get("task")
        if task and pred(task):
            return task
        time.sleep(0.05)
    return tc.get_task().get("task")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", help="virtual MIDI output port name (default: use /inject)")
    ap.add_argument("--cdp-out", help="send from the app's renderer (WebMIDI, via MIDITUTOR_CDP) to this "
                    "loopback output, e.g. 'IAC Driver Bus 1' on the Mac; the app must be listening on it")
    args = ap.parse_args()
    play = make_player(args.port, args.cdp_out)
    real = args.cdp_out or args.port
    print("mode:", f"MIDI port {real!r}" if real else "INJECT (not a real MIDI device)")

    st = tc.state()
    check(st.get("ok") is True, "app answers /state", st)
    end = time.monotonic() + 30
    while not st.get("rendererConnected") and time.monotonic() < end:
        time.sleep(0.5)
        st = tc.state()
    check(st.get("rendererConnected") is True, "window is connected to the API", st)
    if args.cdp_out:
        name = (st.get("device") or {}).get("name") or ""
        check(name and (name in args.cdp_out or args.cdp_out in name), "app listens on the loopback port", st.get("device"))

    # Chord task: right on the second try -> two attempts, latest correct.
    shown = tc.show_chord("E minor", ["E", "G", "B"])
    check("task" in shown, "show_chord arms a task", shown)
    play([60, 64, 67])  # C major: wrong
    t = wait_task(lambda t: len(t["attempts"]) >= 1)
    check(t and t["result"]["verdict"] == "wrong", "wrong chord graded wrong", t)
    play([52, 59, 67])  # E3 B3 G4: E minor, open voicing
    t = wait_task(lambda t: len(t["attempts"]) >= 2)
    check(t and t["result"]["verdict"] == "correct", "E minor (any octave) graded correct", t)

    # Live listening: wait_for_play sees the next gesture and names it.
    after = tc.state()["lastGestureId"]
    play([62, 66, 69])
    got = tc.wait_for_play(timeout_s=5, after=after)
    chord = (got.get("gesture") or {}).get("chord") or {}
    check(chord.get("name") == "D major", "wait_for_play names D major", got)

    rec = tc.recent(seconds=10)
    check(any(g["chord"] == "D major" for g in rec["gestures"]), "recent() lists the D major gesture", rec)
    tc.clear_task()

    # Push a piece and follow it: the Minuet opens with D5 + G3.
    xml = (Path(__file__).resolve().parent.parent / "src/renderer/assets/minuet-in-g.musicxml").read_text(encoding="utf-8")
    check(tc.load_piece("E2E Minuet", xml).get("ok") is True, "load_piece accepted")
    time.sleep(2.0)  # OSMD render
    scr = tc.state()["screen"]
    check(scr.get("piece") == "E2E Minuet" and scr.get("status") == "ready", "pushed piece is on screen", scr)
    check(sorted(scr.get("remaining", [])) == ["D5", "G3"], "screen expects D5 + G3", scr)
    play([74, 55])
    time.sleep(0.5)
    scr = tc.state()["screen"]
    check(scr.get("remaining") == ["G4"], "follower advanced to G4", scr)
    held_scr: dict = {}
    play([68], during=lambda: held_scr.update(tc.state()["screen"]))  # G#4 where G4 is written
    check(held_scr.get("redAccidentals") == ["sharp"], "red sharp drawn for G#4 vs written G4 (key down)", held_scr)
    check(held_scr.get("playedMarks") == 3, "two blue heads + the red one while the key is down", held_scr)
    time.sleep(0.5)
    scr = tc.state()["screen"]
    check(scr.get("playedMarks") == 2 and not scr.get("redAccidentals"), "red note gone once the key is up (#9630)", scr)
    play([61])  # wrong key
    time.sleep(0.5)
    scr = tc.state()["screen"]
    check(scr.get("wrongCount", 0) >= 1, "wrong key counted", scr)

    print("ALL PASS" if not FAILS else f"{len(FAILS)} FAILED: {FAILS}")
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
