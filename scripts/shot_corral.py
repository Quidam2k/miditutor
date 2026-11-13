"""#6062 before/after pictures of the Score toolbar, against the RUNNING hidden muted app (see e2e_menus.py for the
launch line). Minuet in G at 1920x1080 and 1186x609, keyboard on/off, layouts Strip/Pages/Scroll, plus the More menu open.
    MIDITUTOR_URL=... MIDITUTOR_CDP=... MIDITUTOR_TOKEN_FILE=... python scripts/shot_corral.py <outdir> <tag>
(Bars visible in the Strip: scripts/e2e_strip_fit.py.)
"""
from __future__ import annotations

import os
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

from e2e_backwards import SCORE, tc, tid

OUT = Path(sys.argv[1])
TAG = sys.argv[2]


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    seq = tc.state()["eventSeq"]
    tc.load_piece("Minuet (shots)", SCORE.read_text(encoding="utf-8"))
    for _ in range(40):
        if any(e.get("kind") == "piece" for e in tc.request("GET", f"/events?since={seq}&limit=2000")["events"]):
            break
        time.sleep(0.5)
    with sync_playwright() as p:
        page = p.chromium.connect_over_cdp(os.environ["MIDITUTOR_CDP"]).contexts[0].pages[0]
        page.get_by_role("button", name="Score", exact=True).click()
        page.wait_for_selector("[data-testid=bar-now]", timeout=30000)
        for w, h in ((1920, 1080), (1186, 609)):
            page.set_viewport_size({"width": w, "height": h})
            for kb in (True, False):
                box = page.get_by_label("Keyboard", exact=True)
                if box.count() and box.is_checked() != kb:
                    box.click()
                tid(page, "layout-strip").click()
                page.wait_for_timeout(900)
                page.screenshot(path=str(OUT / f"{TAG}-strip-{w}-kb{'on' if kb else 'off'}.png"))
            for lay in ("pages", "scroll"):
                tid(page, f"layout-{lay}").click()
                page.wait_for_timeout(1500)
                page.screenshot(path=str(OUT / f"{TAG}-{lay}-{w}.png"))
            tid(page, "layout-strip").click()
            page.wait_for_timeout(500)
            more = page.get_by_test_id("menu-more")
            if more.count() and not page.get_by_test_id("menu-more-panel").count():
                more.click()
                page.wait_for_timeout(300)
                page.screenshot(path=str(OUT / f"{TAG}-more-open-{w}.png"))
                page.keyboard.press("Escape")
    print("shots in", OUT)


main()
