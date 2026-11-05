"""#5516 end-to-end check of the graze rule against the RUNNING app.

Start a local app with no window on a spare port first (see e2e_backwards.py), then:
    MIDITUTOR_URL=http://127.0.0.1:47811 python scripts/e2e_graze.py

Loads the Minuet in G, Build backwards on bar 3 (3 clean laps to grow). Lap 1 is clean and
records the notes of each step. Lap 2 strikes a step, then grazes the NEXT step's note
straight after it, the way he grazed C while playing D (11/4, bar 33): that note must not
count (the cursor still waits for it), the follow event says 'stray', the lap isn't clean,
and the wrong-note count doesn't move.
"""
from __future__ import annotations

import sys
import time

from e2e_backwards import FAILS, SCORE, check, midi_of, screen, send, strike, tc


def events_since(seq: int) -> list[dict]:
    return tc.request("GET", f"/events?since={seq}&limit=2000")["events"]


def main() -> int:
    for _ in range(60):
        try:
            if tc.state().get("rendererConnected"):
                break
        except tc.TutorUnavailable:
            pass
        time.sleep(1)
    else:
        sys.exit("app not reachable / renderer not connected")

    seq = tc.state()["eventSeq"]
    tc.load_piece("Graze (e2e)", SCORE.read_text(encoding="utf-8"))
    for _ in range(40):
        if any(e.get("kind") == "piece" for e in events_since(seq)):
            break
        time.sleep(0.5)
    time.sleep(1.5)
    tc.request("POST", "/loop", {"firstBar": 3, "lastBar": 3, "backwards": True})
    time.sleep(1.0)

    # Lap 1, clean: the notes of each step, in order.
    s = screen()
    lap = s["loop"]["lap"]
    seqs: list[list[int]] = []
    while s["loop"]["lap"] == lap and len(seqs) < 40:
        remaining = [midi_of(n) for n in s.get("remaining", [])]
        seqs.append(remaining)
        strike(remaining)
        time.sleep(0.3)
        s = screen()
    check(s["backwards"]["clean"] == 1, "lap 1 clean", s["backwards"])
    check(len(seqs) >= 2, "bar 3 has at least two steps", seqs)

    # Lap 2: strike step 0, then graze step 1's first note at once.
    wrong_before = s.get("wrongCount", 0)
    seq = tc.state()["eventSeq"]
    for note in seqs[0]:
        send("noteon", note)
    graze = seqs[1][0]
    send("noteon", graze)
    time.sleep(0.05)
    for note in [*seqs[0], graze]:
        send("noteoff", note)
    time.sleep(0.4)
    s = screen()
    check(graze in [midi_of(n) for n in s.get("remaining", [])], "the grazed note still waits to be played", s.get("remaining"))
    follows = [e for e in events_since(seq) if e.get("kind") == "follow"]
    stray = [e for e in follows if e.get("result") == "stray"]
    check(len(stray) == 1 and stray[0]["note"] == graze, "follow event says stray", [(e["note"], e["result"], e.get("why")) for e in follows])
    check(s.get("wrongCount", 0) == wrong_before, "a graze is not a wrong note", s.get("wrongCount"))

    # Finish lap 2 properly: it still doesn't count.
    for remaining in seqs[1:]:
        strike(remaining)
        time.sleep(0.3)
    time.sleep(0.5)
    b = screen()["backwards"]
    check(b["clean"] == 1 and b["startBar"] == 3, "the grazed lap isn't clean", b)

    print("ALL PASS" if not FAILS else f"{len(FAILS)} FAILED: {FAILS}")
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
