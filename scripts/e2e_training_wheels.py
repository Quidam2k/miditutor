"""#5519 end-to-end check of keyboard training wheels against the RUNNING app.

Start a hidden app with inject and a debug port (see e2e_tied_hint.py), then:
    MIDITUTOR_URL=http://127.0.0.1:47811 MIDITUTOR_CDP=http://127.0.0.1:9347 python scripts/e2e_training_wheels.py

Minuet in G, loop bars 2-3, Training wheels on. The green keys show through bar 2 (the
lap's first bar), are gone in bar 3 while he plays steadily, come back when he pauses
past the hesitation time, and come back after a wrong note. Off again: always shown.
"""
from __future__ import annotations

import os
import sys
import time

from playwright.sync_api import sync_playwright

from e2e_backwards import FAILS, SCORE, check, midi_of, screen, strike, tc


def greens(page) -> int:
    return page.eval_on_selector_all("[data-testid=keyboard-strip] [data-green]", "els => els.length")


def remaining() -> list[int]:
    return [midi_of(n) for n in screen().get("remaining", [])]


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

    tc.load_piece("Training wheels (e2e)", SCORE.read_text(encoding="utf-8"))
    time.sleep(3)
    with sync_playwright() as p:
        page = p.chromium.connect_over_cdp(cdp).contexts[0].pages[0]
        page.check("[data-testid=training-wheels]")
        tc.request("POST", "/loop", {"firstBar": 2, "lastBar": 3})
        time.sleep(1)
        check(greens(page) > 0, "lap start: keys shown", greens(page))
        while screen().get("measure") == 2:
            check(greens(page) > 0, "still shown in bar 2", (screen().get("measure"), greens(page)))
            strike(remaining())
            time.sleep(0.3)
        check(greens(page) == 0, "bar 3, playing steadily: keys hidden", greens(page))
        time.sleep(2.0)
        check(greens(page) > 0, "a pause past the hesitation time brings them back", greens(page))
        strike(remaining())
        time.sleep(0.3)
        check(screen().get("measure") == 3, "still in bar 3", screen().get("measure"))
        check(greens(page) == 0, "played on: hidden again", greens(page))
        strike([max(remaining()) + 1])
        time.sleep(0.3)
        check(greens(page) > 0, "a wrong note brings them back", greens(page))
        page.uncheck("[data-testid=training-wheels]")
        time.sleep(0.3)
        check(greens(page) > 0, "off: keys shown", greens(page))
        tc.request("DELETE", "/loop")

    print("ALL PASS" if not FAILS else f"{len(FAILS)} FAILED: {FAILS}")
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
