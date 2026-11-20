"""#6530 phase B end-to-end: lap and whole-pass events carry tempo and misses, and the score's
marked tempo reaches the screen, against a RUNNING hidden muted app (see memory
hidden-test-copy-must-be-muted; env MIDITUTOR_URL / MIDITUTOR_TOKEN_FILE as in e2e_overrun.py).

Three bars of quarters marked <sound tempo="96"/>, loop = bar 1.
Lap 1: C D E F, 0.5 s apart -> bpm ~120, wrong 0. Lap 2 with a C# in it -> wrong 1, wrongBars [1].
Then the same score as a new piece, played straight through -> one 'pass' event, bars 1-3.
"""

import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from miditutor_mcp import tutor_client as tc
from scripts.e2e_overrun import check, events_since, tap, wait_for, FAILS

NOTES = (60, 62, 64, 65, 67, 69, 71, 72, 62, 64, 65, 67)


def fixture():
    steps = [("C", 4), ("D", 4), ("E", 4), ("F", 4), ("G", 4), ("A", 4), ("B", 4), ("C", 5),
             ("D", 4), ("E", 4), ("F", 4), ("G", 4)]

    def bar(number, notes, head=""):
        body = "".join(
            f"<note><pitch><step>{s}</step><octave>{o}</octave></pitch><duration>1</duration><type>quarter</type></note>"
            for s, o in notes)
        return f'<measure number="{number}">{head}{body}</measure>'

    head = ("<attributes><divisions>1</divisions><key><fifths>0</fifths></key>"
            "<time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>"
            '<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit>'
            '<per-minute>96</per-minute></metronome></direction-type><sound tempo="96"/></direction>')
    return ('<?xml version="1.0" encoding="UTF-8"?><score-partwise version="3.1">'
            '<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">'
            + bar(1, steps[0:4], head) + bar(2, steps[4:8]) + bar(3, steps[8:12])
            + "</part></score-partwise>")


def play(notes, gap):
    for n in notes:
        tap(n)
        time.sleep(gap - 0.06)


def load(name):
    seq = tc.state()["eventSeq"]
    tc.load_piece(name, fixture())
    piece = wait_for(lambda: events_since(seq, "piece"), 30)
    if not piece:
        raise RuntimeError("piece never loaded")
    time.sleep(1.5)
    return piece[-1]


def main():
    wait_for(lambda: tc.state().get("rendererConnected"), 30)
    piece = load("Lap tempo (e2e)")
    check("piece event carries the marked tempo", piece.get("marked") == 96)
    check("screen shows markedBpm 96", (tc.state().get("screen") or {}).get("markedBpm") == 96)

    tc.request("POST", "/loop", {"firstBar": 1, "lastBar": 1})
    time.sleep(1)
    seq = tc.state()["eventSeq"]
    play(NOTES[:4], 0.5)
    laps = wait_for(lambda: events_since(seq, "lap"), 5) or [{}]
    lap = laps[-1]
    print("lap 1:", lap)
    check("lap 1 bpm about 120", isinstance(lap.get("bpm"), int) and 100 <= lap["bpm"] <= 135)
    check("lap 1 clean", lap.get("wrong") == 0 and lap.get("wrongBars") == [])
    check("lap 1 marked 96, not skipped", lap.get("marked") == 96 and lap.get("skipped") is False)
    check("lap 1 ms about 1500", isinstance(lap.get("ms"), (int, float)) and 1200 <= lap["ms"] <= 1900)

    seq = tc.state()["eventSeq"]
    play((60, 62), 0.5)
    tap(61)  # C#: wrong
    time.sleep(0.3)
    play((64, 65), 0.5)
    laps = wait_for(lambda: events_since(seq, "lap"), 5) or [{}]
    lap = laps[-1]
    print("lap 2:", lap)
    check("lap 2 counts the wrong note in bar 1", lap.get("wrong") == 1 and lap.get("wrongBars") == [1])

    load("Pass tempo (e2e)")
    seq = tc.state()["eventSeq"]
    play(NOTES, 0.4)
    passes = wait_for(lambda: events_since(seq, "pass"), 5) or [{}]
    p = passes[-1]
    print("pass:", p)
    check("one whole pass event", len(passes) == 1 and p.get("firstBar") == 1 and p.get("lastBar") == 3)
    check("pass bpm about 150", isinstance(p.get("bpm"), int) and 125 <= p["bpm"] <= 170)
    check("pass clean, marked 96", p.get("wrong") == 0 and p.get("wrongBars") == [] and p.get("marked") == 96)

    print("passed" if not FAILS else f"failed: {FAILS}")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
