"""#10133 end-to-end check of Build backwards against the RUNNING app.

Start a local app with no window on a spare port first, e.g.
    MIDITUTOR_HIDDEN=1 MIDITUTOR_PORT=47811 MIDITUTOR_VITE_PORT=5182 npm start
then:
    MIDITUTOR_URL=http://127.0.0.1:47811 python scripts/e2e_backwards.py

Loads the Minuet in G, asks for bars 2-3 backwards (POST /loop backwards=true) and plays
through /inject with the default clean-lap targets "3,5": bar 3 alone for 3 clean laps,
then bars 2-3. A lap with a wrong note must not count (and must not shrink the chunk);
5 clean laps on bars 2-3 finish it ("whole range").
"""
from __future__ import annotations

import re
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from miditutor_mcp import tutor_client as tc  # noqa: E402

SCORE = ROOT / "src/renderer/assets/minuet-in-g.musicxml"
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


def strike(notes: list[int]) -> None:
    for note in notes:
        send("noteon", note)
        time.sleep(0.02)
    time.sleep(0.03)
    for note in notes:
        send("noteoff", note)


def play_lap(wrong: bool = False) -> dict:
    """Play one lap of the current loop (until the lap counter moves); returns the screen."""
    s = screen()
    lap = s["loop"]["lap"]
    if wrong:
        remaining = [midi_of(n) for n in s.get("remaining", [])]
        bad = max(remaining) + 1
        while bad in remaining:
            bad += 1
        strike([bad])
        time.sleep(0.3)
    for _ in range(60):
        s = screen()
        if s["loop"]["lap"] != lap:
            return s
        remaining = [midi_of(n) for n in s.get("remaining", [])]
        if not remaining:
            sys.exit(f"nothing to play at bar {s.get('measure')}: {s}")
        strike(remaining)
        time.sleep(0.25)
    sys.exit(f"lap never wrapped: {s}")


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

    seq = tc.state()["eventSeq"]
    tc.load_piece("Backwards (e2e)", SCORE.read_text(encoding="utf-8"))
    for _ in range(40):
        events = tc.request("GET", f"/events?since={seq}&limit=2000")["events"]
        if any(e.get("kind") == "piece" for e in events):
            break
        time.sleep(0.5)
    time.sleep(1.5)

    tc.request("POST", "/loop", {"firstBar": 2, "lastBar": 3, "backwards": True})
    time.sleep(1.0)
    s = screen()
    b = s.get("backwards") or {}
    check(b.get("startBar") == 3 and b.get("need") == 3, "starts on bar 3 alone, needs 3", b)
    check(s.get("loop", {}).get("firstBar") == 3 and s.get("measure") == 3, "loop is bar 3, cursor there", s.get("loop"))

    for _ in range(2):
        play_lap()
    b = screen()["backwards"]
    check(b["startBar"] == 3 and b["clean"] == 2, "two clean laps counted", b)

    s = play_lap(wrong=True)
    b = s["backwards"]
    check(s.get("wrongCount", 0) >= 1, "the wrong note registered", s.get("wrongCount"))
    check(b["startBar"] == 3 and b["clean"] == 2, "a lap with a wrong note doesn't count", b)

    s = play_lap()
    time.sleep(0.8)
    s = screen()
    b = s["backwards"]
    check(b["startBar"] == 2 and b["clean"] == 0 and b["need"] == 5, "third clean lap grows to bars 2-3, needs 5", b)
    check(s["loop"]["firstBar"] == 2 and s.get("measure") == 2, "loop now bars 2-3, cursor on bar 2", s.get("loop"))

    for _ in range(2):
        play_lap()
    play_lap(wrong=True)
    b = screen()["backwards"]
    check(b["startBar"] == 2 and b["clean"] == 2, "grown chunk keeps its laps through a wrong lap", b)

    for _ in range(3):
        play_lap()
    b = screen()["backwards"]
    check(b["done"] is True and b["clean"] == 5, "whole range after 5 clean laps", b)
    s = play_lap()
    b = s["backwards"]
    check(b["done"] is True and b["clean"] == 6 and s["loop"]["firstBar"] == 2, "keeps looping the whole range", b)

    tc.request("DELETE", "/loop")
    time.sleep(0.8)
    check(screen().get("backwards") is None, "Clear loop ends it")

    events = tc.request("GET", f"/events?since={seq}&limit=5000")["events"]
    chunks = [e for e in events if e.get("kind") == "chunk"]
    check(any(e.get("grew") for e in chunks), "a chunk event reports the growth", len(chunks))
    print("FAILED: " + ", ".join(FAILS) if FAILS else "ALL PASS")
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
