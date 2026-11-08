"""#5657 (f) end-to-end: wrong keys land in the practice roll-up, by bar and by finger.

Start a hidden, muted app with inject allowed (see e2e_tied_hint.py), then:
    MIDITUTOR_URL=http://127.0.0.1:47821 MIDITUTOR_TOKEN_FILE=<ud>/api-token MIDITUTOR_CDP=http://127.0.0.1:9357 \
        python scripts/e2e_rollup.py
The score: bar 1 C D E F fingered 1 2 3 4, bar 2 four G4s fingered 5. Loop bar 2 and hit A4
instead of G4 twice: the roll-up names bar 2 and right-hand 5, on GET /rollup and in "Where I miss".
"""
from __future__ import annotations

import os
import sys
import time

from playwright.sync_api import sync_playwright

from e2e_backwards import FAILS, check, strike, tc

TITLE = "Rollup (e2e)"


def note(step: str, finger: str) -> str:
    return (f"<note><pitch><step>{step}</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice>"
            f"<type>quarter</type><notations><technical><fingering>{finger}</fingering></technical></notations></note>")


SCORE = f"""<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
<part id="P1">
<measure number="1"><attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time>
<clef><sign>G</sign><line>2</line></clef></attributes>{"".join(note(s, f) for s, f in zip("CDEF", "1234"))}</measure>
<measure number="2">{note("G", "5") * 4}</measure>
</part></score-partwise>"""


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
    cdp = os.environ.get("MIDITUTOR_CDP") or sys.exit("set MIDITUTOR_CDP")

    tc.load_piece(TITLE, SCORE)
    time.sleep(3)
    tc.request("POST", "/loop", {"firstBar": 2, "lastBar": 2})
    time.sleep(1)
    for keys in ([69], [67], [69], [67], [67], [67]):  # A4 wrong, G4 right, A4 wrong, then the rest of the lap
        strike(keys)
        time.sleep(0.25)

    roll = tc.request("GET", "/rollup?days=1")
    mine = next((p for p in roll.get("pieces", []) if p.get("piece") == TITLE), None)
    check(mine is not None, "GET /rollup lists the piece", roll)
    if mine:
        check(mine["misses"] >= 2, "both wrong keys counted", mine)
        check(bool(mine["worstBars"]) and mine["worstBars"][0]["bar"] == 2, "bar 2 is the worst bar", mine["worstBars"])
        f0 = (mine["fingers"] or [{}])[0]
        check(f0.get("hand") == "R" and f0.get("finger") == "5", "the missed key was right-hand 5", mine["fingers"])
        check(mine["fingerData"] is True, "finger data logged", mine)

    with sync_playwright() as p:
        page = p.chromium.connect_over_cdp(cdp).contexts[0].pages[0]
        page.locator("[data-testid=practice-report]").click()
        page.wait_for_selector("[data-testid=report-bar]", timeout=10000)
        text = page.locator("[data-testid=practice-report-panel]").inner_text()
        check("Bar 2" in text, '"Where I miss" lists bar 2', text)
        check("Right 5" in text, '"Where I miss" names right-hand 5', text)
        tc.request("DELETE", "/loop")
        time.sleep(0.5)
        page.locator("[data-testid=report-bar]").first.click()
        time.sleep(0.8)
        check(page.locator("[data-testid=clear-loop]").count() == 1, "clicking the bar loops it")
        page.locator("[data-testid=practice-report]").click()
        tc.request("DELETE", "/loop")

    print("ALL PASS" if not FAILS else f"{len(FAILS)} FAIL: {FAILS}")
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
