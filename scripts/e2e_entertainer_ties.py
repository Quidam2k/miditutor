"""#5085 stopgap: The Entertainer's ties take ONE press, checked against the RUNNING app.

Start a hidden muted copy first (memory hidden-test-copy-must-be-muted), then:
    MIDITUTOR_URL=... MIDITUTOR_TOKEN_FILE=... python scripts/e2e_entertainer_ties.py <score.musicxml>
It plays bars 1-8 holding every key (the way his pedal does), and counts how many times the tutor ASKS for each
pitch of each tied pair. With the ties in the file each pair is asked once; without them, twice. Run it on the
library file (no ties) and on the repaired copy (omr_fix.py tests_py/fixtures/the-entertainer-ties.json) to compare.
"""
from __future__ import annotations

import re
import sys
import time
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from miditutor_mcp import tutor_client as tc  # noqa: E402

LETTERS = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
# (bar, note name, presses a tied pair should take): bar 1's A5 pair, bar 2's A4, bar 3's A3 (A3 B3 A3 after it:
# 3 A3s on the page, one is the tied pair's second note), bar 7's E5 pair (3 E5s on the page).
EXPECT = {(1, "A5"): 1, (2, "A4"): 1, (3, "A3"): 2, (7, "E5"): 2}


def midi_of(name: str) -> int:
    m = re.fullmatch(r"([A-G])(#|b{1,2}|x)?(-?\d)", name)
    alter = {None: 0, "#": 1, "x": 2, "b": -1, "bb": -2}[m.group(2)]
    return 12 * (int(m.group(3)) + 1) + LETTERS[m.group(1)] + alter


def send(kind: str, note: int) -> None:
    result = tc.request("POST", "/inject", {"notes": [note], "kind": kind, "velocity": 64})
    if "error" in result:
        sys.exit(f"inject failed: {result}")


def main() -> int:
    xml = Path(sys.argv[1]).read_text(encoding="utf-8")
    for _ in range(60):
        try:
            if tc.state().get("rendererConnected"):
                break
        except tc.TutorUnavailable:
            pass
        time.sleep(1)
    seq = tc.state()["eventSeq"]
    tc.load_piece("Entertainer ties (e2e)", xml)
    for _ in range(40):
        if any(e.get("kind") == "piece" for e in tc.request("GET", f"/events?since={seq}&limit=2000")["events"]):
            break
        time.sleep(0.5)
    time.sleep(1.5)
    asked: Counter = Counter()
    down: set[int] = set()
    for _ in range(160):
        s = tc.state().get("screen") or {}
        bar = s.get("measure", 0)
        if bar >= 9:
            break
        remaining = list(s.get("remaining", []))
        for name in remaining:  # each pass strikes everything asked, so a pass is one step
            asked[(bar, name)] += 1
        for name in remaining:
            note = midi_of(name)
            if note in down:
                send("noteoff", note)
                down.discard(note)
                time.sleep(0.05)
        for name in remaining:
            send("noteon", midi_of(name))
            down.add(midi_of(name))
            time.sleep(0.03)
        time.sleep(0.4)
    for note in down:
        send("noteoff", note)
    print("asked per bar/pitch:", {f"{b}:{n}": c for (b, n), c in sorted(asked.items()) if (b, n) in EXPECT})
    print("bars 5-6 C5 (eighth over the bar line, half, next eighth):", {b: asked[(b, "C5")] for b in (5, 6)})
    fails = [f"bar {b} {n}: asked {asked[(b, n)]}x, want {c}" for (b, n), c in EXPECT.items() if asked[(b, n)] != c]
    print("FAILED: " + "; ".join(fails) if fails else "ALL PASS")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
