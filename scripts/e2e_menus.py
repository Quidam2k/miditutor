"""#6054 toolbar menus (Practice modes, Options), against the RUNNING hidden muted app
(see e2e_celebrate.py for the launch line). Plain left clicks only (one-handed trackball):
open/close by click, a click outside, Escape or Enter closes; the panel fits the window at
1920x1080 and 1186x609; Pause is never covered; every moved control resolves after one menu
open; the miss-sound Test is one click away; ON options show as a count on Options.
"""
from __future__ import annotations

import os
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

from e2e_backwards import FAILS, MENU_OF, SCORE, check, tc

OUT = Path("screengrab")


def main() -> int:
    seq = tc.state()["eventSeq"]
    tc.load_piece("Menus (e2e)", SCORE.read_text(encoding="utf-8"))
    for _ in range(40):
        if any(e.get("kind") == "piece" for e in tc.request("GET", f"/events?since={seq}&limit=2000")["events"]):
            break
        time.sleep(0.5)
    OUT.mkdir(exist_ok=True)
    with sync_playwright() as p:
        page = p.chromium.connect_over_cdp(os.environ["MIDITUTOR_CDP"]).contexts[0].pages[0]
        page.get_by_role("button", name="Score", exact=True).click()
        page.wait_for_selector("[data-testid=bar-now]", timeout=30000)
        for w, h in ((1920, 1080), (1186, 609)):
            page.set_viewport_size({"width": w, "height": h})
            page.wait_for_timeout(800)
            for menu in ("practice", "options"):
                btn = page.get_by_test_id(f"menu-{menu}")
                panel = page.get_by_test_id(f"menu-{menu}-panel")
                tag = f"{w}x{h} {menu}"
                check(btn.is_visible() and not panel.count(), f"{tag}: button there, panel closed")
                btn.click()
                check(panel.count() == 1, f"{tag}: one click opens", panel.count())
                box = panel.bounding_box() or {}
                inside = box and box["x"] >= 0 and box["y"] >= 0 and box["x"] + box["width"] <= w and box["y"] + box["height"] <= h
                check(bool(inside), f"{tag}: panel inside the window without scrolling", box)
                pause = page.get_by_test_id("pause-button")
                pb = pause.bounding_box()
                top = page.evaluate("([x, y]) => document.elementFromPoint(x, y)?.closest('[data-testid=pause-button]') !== null",
                                    [pb["x"] + pb["width"] / 2, pb["y"] + pb["height"] / 2])
                check(top, f"{tag}: Pause is not covered")
                page.screenshot(path=str(OUT / f"menu-{menu}-{w}.png"))
                btn.click()
                check(panel.count() == 0, f"{tag}: second click closes")
                btn.click()
                page.mouse.click(w // 2, h // 2)
                check(panel.count() == 0, f"{tag}: click outside closes")
                btn.click()
                page.keyboard.press("Escape")
                check(panel.count() == 0, f"{tag}: Escape closes")
                btn.click()
                panel.locator("select, input").first.focus()
                page.keyboard.press("Enter")
                check(panel.count() == 0, f"{tag}: Enter closes")
        # Every moved control resolves after one open of its own menu.
        page.set_viewport_size({"width": 1920, "height": 1080})
        for test_id, menu in MENU_OF.items():
            page.get_by_test_id(f"menu-{menu}").click()
            check(page.get_by_test_id(test_id).count() >= 1 or test_id in ("bare-stop", "every-bar-numbers"), f"{test_id} resolves after opening {menu}")
            page.keyboard.press("Escape")
        # Test is one click from the main row, and stays open for repeat presses.
        page.get_by_test_id("menu-options").click()
        page.get_by_test_id("miss-sound-test").click()
        page.get_by_test_id("miss-sound-test").click()
        check(page.get_by_test_id("menu-options-panel").count() == 1, "Test: panel stays open for a repeat press")
        page.keyboard.press("Escape")
        # ON options count; tucked-away ON modes show on the button.
        badge = page.get_by_test_id("menu-options-badge")
        check(badge.count() == 1 and "on" in badge.inner_text(), "Options shows a count of ON options", badge.inner_text() if badge.count() else None)
        page.get_by_test_id("menu-practice").click()
        page.get_by_test_id("hand-zones").click()
        page.wait_for_timeout(300)
        pb = page.get_by_test_id("menu-practice-badge")
        check(pb.count() == 1 and "Hand zones" in pb.inner_text(), "Practice modes names the active mode", pb.inner_text() if pb.count() else None)
        check(page.get_by_test_id("menu-practice-panel").count() == 0, "an action button closes the menu")
        page.get_by_test_id("menu-practice").click()
        page.get_by_test_id("hand-zones").click()
        page.wait_for_timeout(300)
        check(page.get_by_test_id("menu-practice-badge").count() == 0, "badge clears when the mode is off")
    print("FAILS:", FAILS)
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
