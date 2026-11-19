"""#6460 end-to-end check of the trouble-spot list against a RUNNING test copy.

Needs MIDITUTOR_URL (+ MIDITUTOR_TOKEN_FILE) and MIDITUTOR_CDP (a hidden, muted copy started with
--remote-debugging-port on a spare port, never 9333, and its own empty user data). Recipe: e2e_backwards.py.

Loads the Minuet in G and loops bars 2-6 with a wrong note in bar 4 on three laps. Setting the loop
again must auto-add bars 3-5 (the day log says he keeps missing bar 4). Then (Todd msg 63713) the spot
stays listed after 5 clean loops of 3-5 alone, and comes off only after 5 passes through 2-6 where
bars 3-5 were clean, even with a miss in bar 6 each time. It must not come straight back. Where I miss
offers "+ List", and the x takes a spot off.
"""
from __future__ import annotations

import os
import sys
import time

from e2e_backwards import FAILS, SCORE, check, midi_of, screen, send, strike, tc  # noqa: F401


def wait_piece(seq: int) -> None:
    for _ in range(40):
        if any(e.get("kind") == "piece" for e in tc.request("GET", f"/events?since={seq}&limit=2000")["events"]):
            break
        time.sleep(0.5)
    time.sleep(1.5)


def loop(first: int, last: int) -> None:
    tc.request("POST", "/loop", {"firstBar": first, "lastBar": last})
    time.sleep(1.0)


def lap(wrong_in: int | None = None) -> dict:
    """One lap of the loop; with wrong_in, one wrong key the first time the cursor is in that bar."""
    s = screen()
    start = s["loop"]["lap"]
    for _ in range(80):
        s = screen()
        if s["loop"]["lap"] != start:
            return s
        remaining = [midi_of(n) for n in s.get("remaining", [])]
        if not remaining:
            sys.exit(f"nothing to play at bar {s.get('measure')}: {s}")
        if wrong_in is not None and s.get("measure") == wrong_in:
            bad = max(remaining) + 1
            while bad in remaining:
                bad += 1
            strike([bad])
            time.sleep(0.3)
            wrong_in = None
        strike(remaining)
        time.sleep(0.25)
    sys.exit(f"lap never wrapped: {s}")


def spot(first: int, last: int) -> dict | None:
    return next((x for x in screen().get("spots") or [] if x["first"] == first and x["last"] == last), None)


def main() -> int:
    from playwright.sync_api import sync_playwright

    state = tc.state()
    check(state.get("injectEnabled") is True, "inject enabled")
    seq = state["eventSeq"]
    tc.load_piece("Spots (e2e)", SCORE.read_text(encoding="utf-8"))
    wait_piece(seq)

    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp(os.environ["MIDITUTOR_CDP"])
        page = next(pg for ctx in browser.contexts for pg in ctx.pages if "devtools" not in pg.url)

        loop(2, 6)
        check(screen().get("spots") == [], "no spots to begin with", screen().get("spots"))
        for _ in range(3):
            lap(wrong_in=4)
        loop(2, 6)
        time.sleep(1.0)
        sp = spot(3, 5)
        check(sp is not None and sp["auto"] is True, "auto-added bars 3-5 from the misses in bar 4", screen().get("spots"))
        tip = page.get_by_test_id("spot-tip")
        check(tip.count() == 1 and "bars 3–5" in tip.inner_text(), "says Added: bars 3-5", tip.all_inner_texts())

        page.get_by_test_id("spots").click()
        time.sleep(0.2)
        check("alone 0/5 · in context 0/5" in page.get_by_test_id("spot-3-5").inner_text(), "Spots list shows its counts")
        page.get_by_test_id("spot-loop-3-5").click()
        time.sleep(1.0)
        s = screen()
        check(s["loop"]["firstBar"] == 3 and s["loop"]["lastBar"] == 5, "Loop on the spot loops 3-5", s.get("loop"))

        for _ in range(6):
            lap()
        sp = spot(3, 5)
        check(sp and sp["alone"] >= 5 and sp["ticked"] is None, "5 clean alone laps: still on the list", sp)

        loop(2, 6)
        for i in range(5):
            lap(wrong_in=6)
            sp = spot(3, 5)
            if i < 4:
                check(sp and sp["inContext"] == i + 1 and sp["ticked"] is None, f"in-context pass {i + 1} counts, miss in bar 6", sp)
        check(sp and sp["ticked"] is not None, "5 in context: ticked off", sp)
        time.sleep(0.3)
        check("off your list" in " ".join(page.get_by_test_id("spot-tip").all_inner_texts()), "says it is off the list")
        loop(2, 6)
        time.sleep(1.0)
        sp = spot(3, 5)
        check(sp and sp["ticked"] is not None, "does not come straight back", screen().get("spots"))

        page.get_by_test_id("practice-report").click()
        time.sleep(1.0)
        adds = page.get_by_test_id("report-add-spot")
        check(adds.count() >= 1, "Where I miss offers + List", adds.count())
        before = len(screen().get("spots") or [])
        if adds.count():
            adds.first.click()
            time.sleep(0.5)
        spots = screen().get("spots") or []
        check(len(spots) == before + 1 or any(not x["ticked"] for x in spots), "+ List adds a spot", spots)
        page.get_by_test_id("practice-report").click()

        open_spot = next((x for x in screen().get("spots") or [] if not x["ticked"]), None)
        if open_spot:
            page.get_by_test_id("spots").click()
            time.sleep(0.2)
            page.get_by_test_id(f"spot-x-{open_spot['first']}-{open_spot['last']}").click()
            time.sleep(0.3)
            check(spot(open_spot["first"], open_spot["last"]) is None, "x takes a spot off", screen().get("spots"))
            page.keyboard.press("Escape")

    tc.request("DELETE", "/loop")
    events = tc.request("GET", f"/events?since={seq}&limit=5000")["events"]
    check(sum(1 for e in events if e.get("kind") == "spot" and e.get("ticked")) == 1, "exactly one ticked event")
    print("FAILED: " + ", ".join(FAILS) if FAILS else "ALL PASS")
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
