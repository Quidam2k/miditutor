"""#5948/#6053 Pause and #5947 "same fingering on the matching ones", against the RUNNING app.

Hidden MUTED app with inject + debug port (see e2e_celebrate.py), then:
    MIDITUTOR_URL=... MIDITUTOR_CDP=... MIDITUTOR_TOKEN_FILE=... python scripts/e2e_pause_spread.py
Pause: the header button and banner exist on every tab; while paused wrong notes do not count, make
no lap-spoiled event and do not move the cursor; Resume judges again; Restart, a tab change and a
piece change each end it. Spread: fingering a G4 offers the button, pressing it fingers the others.
"""
from __future__ import annotations

import os
import sys
import time

from playwright.sync_api import sync_playwright

from e2e_backwards import FAILS, SCORE, check, screen, strike, tc

WRONG = [30]  # far below anything in the piece


def events_since(seq: int, kind: str) -> list[dict]:
    return [e for e in tc.request("GET", f"/events?since={seq}&limit=2000")["events"] if e.get("kind") == kind]


def main() -> int:
    seq = tc.state()["eventSeq"]
    tc.load_piece("Pause (e2e)", SCORE.read_text(encoding="utf-8"))
    for _ in range(40):
        if events_since(seq, "piece"):
            break
        time.sleep(0.5)
    time.sleep(1.5)
    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp(os.environ["MIDITUTOR_CDP"])
        page = browser.contexts[0].pages[0]
        btn = page.get_by_test_id("pause-button")
        banner = page.get_by_test_id("pause-banner")

        # On every tab.
        for tab in ("Practice", "MIDI Monitor", "Score"):
            page.get_by_role("button", name=tab, exact=True).click()
            page.wait_for_timeout(400)
            check(btn.count() == 1 and btn.is_visible(), f"#6053: Pause button on {tab}")
        page.wait_for_selector("[data-testid=bar-now]", timeout=30000)
        page.wait_for_timeout(1500)

        check(not banner.count(), "no banner before pausing")
        base = screen().get("wrongCount", 0)
        strike(WRONG)
        time.sleep(0.4)
        check(screen().get("wrongCount", 0) == base + 1, "baseline: a wrong note counts", screen().get("wrongCount"))

        seq = tc.state()["eventSeq"]
        measure0 = screen().get("measure")
        btn.click()
        check(banner.count() == 1 and banner.is_visible(), "banner visible while paused")
        check("Paused" in banner.inner_text() and "10 minutes" in banner.inner_text(), "banner says what it does and the time limit", banner.inner_text())
        count = screen().get("wrongCount", 0)
        for _ in range(3):
            strike(WRONG)
            time.sleep(0.15)
        time.sleep(0.4)
        s = screen()
        check(s.get("wrongCount", 0) == count, "paused: 3 wrong notes do not count", s.get("wrongCount"))
        check(not events_since(seq, "lap-spoiled"), "paused: no lap-spoiled / miss sound", events_since(seq, "lap-spoiled"))
        check(s.get("measure") == measure0, "paused: the cursor stays", s.get("measure"))

        btn.click()
        check(banner.count() == 0, "Resume hides the banner")
        strike(WRONG)
        time.sleep(0.4)
        check(screen().get("wrongCount", 0) == count + 1, "resumed: judged again", screen().get("wrongCount"))

        btn.click()
        page.get_by_role("button", name="Restart", exact=True).click()
        page.wait_for_timeout(500)
        check(banner.count() == 0, "Restart ends the pause")

        # Keep going's clock does not wait, so pausing ends that run (and the pause stays).
        page.get_by_test_id("keep-going").click()
        page.wait_for_timeout(800)
        check("Stop" in page.get_by_test_id("keep-going").inner_text(), "Keep going is running")
        btn.click()
        page.wait_for_timeout(800)
        check("Keep going" in page.get_by_test_id("keep-going").inner_text() and banner.count() == 1,
              "pausing ends Keep going and stays paused", page.get_by_test_id("keep-going").inner_text())
        btn.click()

        btn.click()
        page.get_by_role("button", name="Practice", exact=True).click()
        page.wait_for_timeout(500)
        check(banner.count() == 0, "changing tab ends the pause")
        page.get_by_role("button", name="Score", exact=True).click()
        page.wait_for_selector("[data-testid=bar-now]", timeout=30000)
        page.wait_for_timeout(1500)

        # #6053: the Notes trainer is judged by the same gate.
        page.get_by_role("button", name="Practice", exact=True).click()
        page.wait_for_timeout(800)
        btn.click()
        check(banner.count() == 1, "pause on the Practice screen")
        btn.click()

        # Spread: finger a G4 on the Score screen.
        page.get_by_role("button", name="Score", exact=True).click()
        page.wait_for_selector("[data-testid=bar-now]", timeout=30000)
        page.wait_for_timeout(2000)
        page.get_by_role("button", name="Restart", exact=True).click()
        page.wait_for_timeout(1500)
        found = False
        for k in range(12):
            page.evaluate("""(k) => { const hs = [...document.querySelectorAll('.vf-notehead')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.left > 0 && r.right < innerWidth; });
                const e = hs[k]; const r = e.getBoundingClientRect();
                e.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 })); }""", k)
            try:
                page.wait_for_selector("[data-testid=finger-picker]", timeout=1500)
            except Exception:
                continue
            if "G4" in page.get_by_test_id("finger-pick-name").inner_text():
                found = True
                break
            page.get_by_role("button", name="Cancel", exact=True).click()
        check(found, "found a G4 to finger")
        if found:
            page.locator("[data-testid=finger-picker] button", has_text="3").first.click()
            page.wait_for_timeout(3000)
            spread = page.get_by_test_id("spread-fingering")
            check(spread.count() == 1, "the 'same fingering on N more' button appears", page.get_by_test_id("finger-msg").inner_text() if page.get_by_test_id("finger-msg").count() else "")
            if spread.count():
                label = spread.inner_text()
                print("button:", label)
                spread.click()
                page.wait_for_timeout(3500)
                msg = page.get_by_test_id("finger-msg").inner_text() if page.get_by_test_id("finger-msg").count() else ""
                check(msg.startswith("Fingered"), "bulk apply reports what it did", msg)
                check(page.get_by_test_id("spread-fingering").count() == 0, "the button is gone after use")
    print("ALL PASS" if not FAILS else f"{len(FAILS)} FAILED: {FAILS}")
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
