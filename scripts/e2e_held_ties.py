"""End-to-end check of held ties turning blue (#10136) against the RUNNING app.

Start a local app with no window on a spare port first, e.g.
    MIDITUTOR_HIDDEN=1 MIDITUTOR_PORT=47811 MIDITUTOR_VITE_PORT=5182 npm start
then:
    MIDITUTOR_URL=http://127.0.0.1:47811 python scripts/e2e_held_ties.py [score.musicxml]

Default score: his Sorcerer's Apprentice in the library. It plays bars 1-4 through
/inject, keeping every key down the way his pedal keeps it sounding (a key is let go
only to strike it again), and checks that the cursor reaches bar 5 and that each tie
continuation he passed got a blue mark (marks = keys struck + ties held).
Run it with --release to let each key go at once: then no tie may turn blue.
--hold (#10146) marks bar 3's 8va A-flat "hold" in a copy of the score (his file is not
touched), as JP has him play it: the tutor must not ask for it, and it turns blue too.
"""
from __future__ import annotations

import re
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from miditutor_mcp import tutor_client as tc  # noqa: E402

DEFAULT = Path("Q:/Personal/piano/library/sorcerers-apprentice.musicxml")
LETTERS = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
FAILS: list[str] = []


def check(cond: bool, label: str, detail: object = "") -> None:
    print(("PASS " if cond else "FAIL ") + label + (f"  {detail}" if not cond else ""))
    if not cond:
        FAILS.append(label)


def midi_of(name: str) -> int:
    m = re.fullmatch(r"([A-G])(#|b{1,2}|x)?(-?\d)", name)
    if not m:
        sys.exit(f"cannot read note name {name!r}")
    alter = {None: 0, "#": 1, "x": 2, "b": -1, "bb": -2}[m.group(2)]
    return 12 * (int(m.group(3)) + 1) + LETTERS[m.group(1)] + alter


def send(kind: str, note: int) -> None:
    result = tc.request("POST", "/inject", {"notes": [note], "kind": kind, "velocity": 64})
    if "error" in result:
        sys.exit(f"inject failed: {result}")


def screen() -> dict:
    return tc.state().get("screen") or {}


def ties_before_bar(xml: str, bar: int) -> int:
    """Tie continuations (a <tie type="stop">) in bars 1..bar-1, plus at bar's first onset."""
    count = 0
    for m in re.finditer(r'<measure[^>]*number="(\d+)".*?</measure>', xml, re.S):
        n = int(m.group(1))
        if n > bar:
            break
        pos = 0
        last_onset = 0
        for note in re.finditer(r"<note\b.*?</note>|<backup>.*?</backup>|<forward>.*?</forward>", m.group(0), re.S):
            body = note.group(0)
            dur = int(re.search(r"<duration>(\d+)</duration>", body).group(1)) if "<duration>" in body else 0
            if body.startswith("<backup"):
                pos -= dur
                continue
            if body.startswith("<forward"):
                pos += dur
                continue
            if "<chord" in body:
                onset = last_onset
            else:
                onset = pos
                pos += dur
            last_onset = onset
            if '<tie type="stop"' in body and (n < bar or onset == 0):
                count += 1
    return count


HOLD = '<play><other-play type="miditutor">hold</other-play></play>'


def hold_bar3_ab6(xml: str) -> str:
    """Mark bar 3's A-flat 6 (the 8va one) the way setHold does."""
    bar = re.search(r'<measure[^>]*number="3".*?</measure>', xml, re.S)
    notes = [m for m in re.finditer(r"<note\b.*?</note>", bar.group(0), re.S)
             if re.search(r"<step>A</step>\s*<alter>-1</alter>\s*<octave>6</octave>", m.group(0))]
    if len(notes) != 1:
        sys.exit(f"expected one Ab6 in bar 3, found {len(notes)}")
    note = notes[0].group(0)
    marked = note.replace("</note>", HOLD + "</note>")
    start = bar.start() + notes[0].start()
    return xml[:start] + marked + xml[start + len(note):]


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    release = "--release" in sys.argv
    hold = "--hold" in sys.argv
    score = Path(args[0]) if args else DEFAULT
    xml = score.read_text(encoding="utf-8")
    if hold:
        xml = hold_bar3_ab6(xml)
    for _ in range(60):
        try:
            state = tc.state()
            if state.get("rendererConnected"):
                break
        except tc.TutorUnavailable:
            pass
        time.sleep(1)
    else:
        sys.exit("app not reachable / renderer not connected")
    check(state.get("injectEnabled") is True, "inject enabled")

    seq = tc.state()["eventSeq"]
    tc.load_piece("Held ties (e2e)", xml)
    for _ in range(40):
        events = tc.request("GET", f"/events?since={seq}&limit=2000")["events"]
        if any(e.get("kind") == "piece" for e in events):
            break
        time.sleep(0.5)
    time.sleep(1.5)
    check(screen().get("measure") == 1 and screen().get("playedMarks") == 0, "fresh at bar 1", screen())

    down: set[int] = set()
    struck = 0
    asked_ab6_in_bar3 = False
    for _ in range(80):
        s = screen()
        if s.get("measure", 0) >= 5:
            break
        remaining = [midi_of(n) for n in s.get("remaining", [])]
        asked_ab6_in_bar3 |= s.get("measure") == 3 and 92 in remaining
        if not remaining:
            sys.exit(f"nothing to play at bar {s.get('measure')}: {s}")
        for note in remaining:
            if note in down:  # strike it again: let it go first
                send("noteoff", note)
                down.discard(note)
                time.sleep(0.05)
        for note in remaining:
            send("noteon", note)
            struck += 1
            if release:
                time.sleep(0.03)
                send("noteoff", note)
            else:
                down.add(note)
            time.sleep(0.03)
        time.sleep(0.4)
    s = screen()
    for note in down:
        send("noteoff", note)

    check(s.get("measure") == 5, "cursor reached bar 5", s.get("measure"))
    check(s.get("wrongCount") == 0, "no wrong notes", s.get("feedback"))
    painted = s.get("playedMarks", 0) - struck
    # The held Ab6 itself and its tie into bar 4 ring on the Ab5 he holds.
    expected = 0 if release else ties_before_bar(xml, 5) + (1 if hold else 0)
    if hold:
        check(not asked_ab6_in_bar3, "bar 3 never asks for the held Ab6")
    check(painted == expected, f"tie continuations painted blue = {expected}", f"got {painted} (marks {s.get('playedMarks')}, struck {struck})")
    print("FAILED: " + ", ".join(FAILS) if FAILS else "ALL PASS")
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
