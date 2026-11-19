"""#6513 end-to-end check: trouble spots auto-add from playing ANYWHERE in the piece, not only in a loop.

Same running test copy as e2e_spots.py (MIDITUTOR_URL, MIDITUTOR_TOKEN_FILE, MIDITUTOR_CDP; hidden, muted,
own empty user data). With no loop set, one whole pass of the Minuet with three wrong notes in bar 9 must
add bars 8-10 when the pass ends. Then three wrong notes in bar 13 and reopening the piece must add
bars 12-14 as it opens. Hesitation-only spots are pinned in tests/troubleSpots.test.ts.
"""
from __future__ import annotations

import sys
import time

from e2e_backwards import FAILS, SCORE, check, midi_of, screen, strike, tc
from e2e_spots import spot, wait_piece

TITLE = "Spots anywhere (e2e)"


def miss_three(remaining: list[int]) -> None:
    bad = max(remaining) + 1
    for _ in range(3):
        strike([bad])
        time.sleep(0.3)


def open_piece() -> None:
    seq = tc.state()["eventSeq"]
    tc.load_piece(TITLE, SCORE.read_text(encoding="utf-8"))
    wait_piece(seq)


def play_to(bar: int | None) -> None:
    """Play forward; at `bar`, miss three times first. bar=None plays to the end of the piece."""
    for _ in range(300):
        s = screen()
        remaining = [midi_of(n) for n in s.get("remaining", [])]
        if not remaining:
            return
        if bar is not None and s.get("measure") == bar:
            miss_three(remaining)
            return
        strike(remaining)
        time.sleep(0.25)
    sys.exit(f"never reached bar {bar}: {screen()}")


def main() -> int:
    check(tc.state().get("injectEnabled") is True, "inject enabled")
    open_piece()
    tc.request("DELETE", "/loop")
    time.sleep(1.0)
    check(screen().get("spots") == [], "no spots to begin with", screen().get("spots"))

    play_to(9)
    check(spot(8, 10) is None, "nothing added mid-pass", screen().get("spots"))
    play_to(None)
    time.sleep(1.5)
    sp = spot(8, 10)
    check(sp is not None and sp["auto"] is True, "whole pass, no loop: bars 8-10 auto-added", screen().get("spots"))

    tc.request("DELETE", "/loop")  # no loop to clear; it restarts from the top
    time.sleep(1.0)
    play_to(13)
    open_piece()
    time.sleep(1.5)
    sp = spot(12, 14)
    check(sp is not None and sp["auto"] is True, "reopening the piece: bars 12-14 auto-added", screen().get("spots"))
    check(len(screen().get("spots") or []) == 2, "only the two spots, nothing extra", screen().get("spots"))

    print("FAILED: " + ", ".join(FAILS) if FAILS else "ALL PASS")
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
