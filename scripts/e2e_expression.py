"""End-to-end check of expression telemetry (#9569) against the RUNNING app.

Start a local app with no window on a spare port first, e.g.
    MIDITUTOR_HIDDEN=1 MIDITUTOR_PORT=47811 npm start
then:
    MIDITUTOR_URL=http://127.0.0.1:47811 python scripts/e2e_expression.py

It loads the expression test piece, loops bars 1-8 and plays three laps through
/inject (NOT a real MIDI device): two as marked (p, cresc., f, rit., a held
fermata), one flat. It then reads tutor_recent's `expression` lines and the raw
expression events, and checks each mark's verdict.
"""
from __future__ import annotations

import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from miditutor_mcp import tutor_client as tc  # noqa: E402

PIECE = ROOT / "src" / "renderer" / "assets" / "expression-test.musicxml"
# One note per step: bars 1-7 quarters, bar 8 two halves (beats).
NOTES = [60, 62, 64, 65, 67, 65, 64, 62, 60, 62, 64, 65, 67, 69, 71, 72,
         72, 71, 69, 67, 65, 67, 69, 71, 72, 71, 69, 67, 64, 60]
BEATS = [1] * 28 + [2, 2]
FAILS: list[str] = []


def check(cond: bool, label: str, detail: object = "") -> None:
    print(("PASS " if cond else "FAIL ") + label + (f"  {detail}" if not cond else ""))
    if not cond:
        FAILS.append(label)


def send(kind: str, note: int, velocity: int = 80) -> None:
    result = tc.request("POST", "/inject", {"notes": [note], "kind": kind, "velocity": velocity})
    if "error" in result:
        sys.exit(f"inject failed: {result}")


def lap(as_marked: bool) -> None:
    for i, (note, beats) in enumerate(zip(NOTES, BEATS)):
        if as_marked:
            velocity = 45 if i < 8 else 48 + round((i - 8) * 3.5) if i < 16 else 80
            beat_ms = 667 if i < 24 else 667 + (i - 23) * 120
            hold = 3.5 if i == len(NOTES) - 1 else beats * beat_ms / 1000
        else:
            velocity, beat_ms = 64, 667
            hold = beats * beat_ms / 1000
        send("noteon", note, velocity)
        time.sleep(max(0.0, hold - 0.02))
        send("noteoff", note)
        time.sleep(0.02)


def verdicts(since: int) -> dict[str, object]:
    events = tc.request("GET", f"/events?since={since}&limit=2000")["events"]
    return {f"{e['type']}:{e['expected']}": e["ok"] for e in events if e.get("kind") == "expression"}


def main() -> int:
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

    # Wait for THIS load's piece event: the screen may still show an earlier run's copy.
    seq = tc.state()["eventSeq"]
    tc.load_piece("Expression test (e2e)", PIECE.read_text(encoding="utf-8"))
    for _ in range(40):
        events = tc.request("GET", f"/events?since={seq}&limit=2000")["events"]
        if any(e.get("kind") == "piece" and e.get("piece") == "Expression test (e2e)" for e in events):
            break
        time.sleep(0.25)
    time.sleep(0.5)
    marks = tc.state()["screen"].get("expressionMarks", [])
    check(marks == ["p @ bar 1", "cresc. bars 3-4", "f @ bar 5", "rit. bars 7-8", "fermata @ bar 8"],
          "screen lists the marks", marks)
    check("error" not in tc.request("POST", "/loop", {"firstBar": 1, "lastBar": 8}), "loop bars 1-8")

    passes = []
    for as_marked in (True, True, False):
        start = tc.state()["eventSeq"]
        lap(as_marked)
        time.sleep(0.5)
        passes.append(verdicts(start))
    first, second, flat = passes
    print("lap verdicts:", passes)
    check(first.get("dynamic:p") is None, "lap 1: no baseline yet for the opening p")
    for key in ("dynamic:p", "dynamic:f", "wedge:cresc", "tempo:rit", "fermata:fermata"):
        check(second.get(key) is True, f"lap 2 as marked: {key} ok")
    for key in ("dynamic:f", "wedge:cresc", "tempo:rit", "fermata:fermata"):
        check(flat.get(key) is False, f"lap 3 flat: {key} flagged")

    lines = tc.recent(seconds=120, limit=2000)["expression"]
    print("\n".join(lines))
    check(any("marked rit." in line and "no real slowing" in line for line in lines),
          "tutor_recent carries the flat lap's rit. line")
    check(any(line.startswith("bars 5-8: marked f") for line in lines), "a dynamic names the bars it covers")
    check(tc.state()["screen"].get("wrongCount") == 0, "nothing played counted wrong")
    print(f"\n{len(FAILS)} failure(s)" if FAILS else "\nALL PASS")
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
