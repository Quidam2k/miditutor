"""#6062 adaptive corral (and the #6054 menu), against the RUNNING hidden muted app.

1. Seed a FRESH user-data dir:  python scripts/e2e_menus.py --seed <scratch>/ud
   (control-usage.json: 8 sessions; Hand/Follow/Keyboard used in session 8/8/7, Play for me in session 1, Hand zones in 6.)
2. Start the packaged app hidden and muted on it with MIDITUTOR_TEST_SESSION=1 (launch line: memory
   hidden-test-copy-must-be-muted; also --user-data-dir=<scratch>/ud).
3. MIDITUTOR_UD=<scratch>/ud MIDITUTOR_URL=... MIDITUTOR_CDP=... python scripts/e2e_menus.py

Checks: unused controls are in More, used ones stay (a corral control used lately is on the main row); miss sound,
its Test and Pause never hide; More shows "N on" for hidden controls that are ON (floating badge, button size
unchanged); the panel fits at 1920x1080 and 1186x609; a plain click opens/closes it, outside click, Escape and
Enter close it; using a control from More brings it forward at once and is written to control-usage.json;
Show everything brings all forward; opening More changes no neighbour's position.
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

SEED = {
    "sessions": 8,
    "controls": {
        "hand": {"uses": 9, "lastUsedAt": 0, "lastSession": 8, "perDay": {}},
        "follow": {"uses": 3, "lastUsedAt": 0, "lastSession": 8, "perDay": {}},
        "keyboard": {"uses": 3, "lastUsedAt": 0, "lastSession": 7, "perDay": {}},
        "watch": {"uses": 1, "lastUsedAt": 0, "lastSession": 1, "perDay": {}},
        "handZones": {"uses": 2, "lastUsedAt": 0, "lastSession": 6, "perDay": {}},
    },
}

if len(sys.argv) == 3 and sys.argv[1] == "--seed":
    ud = Path(sys.argv[2])
    ud.mkdir(parents=True, exist_ok=True)
    (ud / "control-usage.json").write_text(json.dumps(SEED), encoding="utf-8")
    print("seeded", ud / "control-usage.json")
    sys.exit(0)

from playwright.sync_api import sync_playwright  # noqa: E402

from e2e_backwards import FAILS, SCORE, check, tc  # noqa: E402

OUT = Path("screengrab")


def main() -> int:
    seq = tc.state()["eventSeq"]
    tc.load_piece("Menus (e2e)", SCORE.read_text(encoding="utf-8"))
    for _ in range(40):
        if any(e.get("kind") == "piece" for e in tc.request("GET", f"/events?since={seq}&limit=2000")["events"]):
            break
        time.sleep(0.5)
    OUT.mkdir(exist_ok=True)
    usage_file = Path(os.environ["MIDITUTOR_UD"]) / "control-usage.json"
    with sync_playwright() as p:
        page = p.chromium.connect_over_cdp(os.environ["MIDITUTOR_CDP"]).contexts[0].pages[0]
        page.get_by_role("button", name="Score", exact=True).click()
        page.wait_for_selector("[data-testid=bar-now]", timeout=30000)
        page.wait_for_timeout(500)
        vis = lambda loc: loc.count() > 0 and loc.first.is_visible()  # noqa: E731
        more = page.get_by_test_id("menu-more")
        panel = page.get_by_test_id("menu-more-panel")

        # Who is on the main row (usage seeded: 8 sessions).
        check(vis(page.get_by_test_id("hand-both")), "used Hand stays on the main row")
        check(vis(page.get_by_label("Follow my playing")), "used Follow stays")
        check(vis(page.get_by_label("Keyboard", exact=True)), "Keyboard (used in session 7) stays")
        check(vis(page.get_by_test_id("hand-zones")), "a corral control used lately (Hand zones) is on the main row")
        for test_id, what in (("layout-strip", "Layout"), ("loop-bars", "Loop bars"), ("watch", "Play it for me (last used 7 sessions ago)"),
                              ("keep-going", "Keep going"), ("simple-mark", "Simple"), ("read-ahead", "Read ahead")):
            check(not vis(page.get_by_test_id(test_id)), f"unused {what} is not on the main row")
        check(not vis(page.get_by_role("button", name="◀ Prev")), "unused Prev is not on the main row")
        check(vis(page.get_by_test_id("miss-sound")) and vis(page.get_by_test_id("miss-sound-test")), "miss sound + Test never hide")
        check(vis(page.get_by_test_id("pause-button")), "Pause never hides")

        # More: the floating "N on" badge (Big notes is ON by default and hidden).
        badge = page.get_by_test_id("menu-more-badge")
        check(badge.count() == 1 and badge.inner_text().endswith(" on"), "More shows an N on count", badge.inner_text() if badge.count() else None)
        check(page.evaluate("() => getComputedStyle(document.querySelector('[data-testid=menu-more-badge]')).position") == "absolute",
              "the count floats: it cannot resize or move a neighbour")

        # Panel behaviour at both sizes; opening it moves nobody.
        for w, h in ((1920, 1080), (1186, 609)):
            page.set_viewport_size({"width": w, "height": h})
            page.wait_for_timeout(800)
            tag = f"{w}x{h}"
            names = ["hand-both", "hand-zones", "miss-sound", "pause-button"]
            before = {n: page.get_by_test_id(n).first.bounding_box() for n in names}
            check(more.is_visible() and not panel.count(), f"{tag}: More there, panel closed")
            more.click()
            check(panel.count() == 1, f"{tag}: one click opens", panel.count())
            after = {n: page.get_by_test_id(n).first.bounding_box() for n in names}
            check(before == after, f"{tag}: opening More moves nothing", (before, after))
            box = panel.bounding_box() or {}
            inside = box and box["x"] >= 0 and box["y"] >= 0 and box["x"] + box["width"] <= w and box["y"] + box["height"] <= h
            check(bool(inside), f"{tag}: panel inside the window without scrolling", box)
            pb = page.get_by_test_id("pause-button").bounding_box()
            top = page.evaluate("([x, y]) => document.elementFromPoint(x, y)?.closest('[data-testid=pause-button]') !== null",
                                [pb["x"] + pb["width"] / 2, pb["y"] + pb["height"] / 2])
            check(top, f"{tag}: Pause is not covered")
            page.screenshot(path=str(OUT / f"corral-more-{w}.png"))
            more.click()
            check(panel.count() == 0, f"{tag}: second click closes")
            more.click()
            page.mouse.click(w // 2, h // 2)
            check(panel.count() == 0, f"{tag}: click outside closes")
            more.click()
            page.keyboard.press("Escape")
            check(panel.count() == 0, f"{tag}: Escape closes")
            more.click()
            panel.locator("select, input").first.focus()
            page.keyboard.press("Enter")
            check(panel.count() == 0, f"{tag}: Enter closes")
        page.set_viewport_size({"width": 1920, "height": 1080})
        page.wait_for_timeout(500)

        # Using a hidden control from More brings it forward at once, and is recorded.
        more.click()
        page.get_by_test_id("read-ahead").check()
        page.wait_for_timeout(300)
        check(panel.locator("[data-testid=read-ahead]").count() == 1, "a box ticked in More stays under the pointer while the menu is open")
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)
        check(vis(page.get_by_test_id("read-ahead")) and panel.count() == 0, "Read ahead, used from More, is on the main row once More closes")
        page.wait_for_timeout(800)
        saved = json.loads(usage_file.read_text(encoding="utf-8")) if usage_file.exists() else {}
        check(saved.get("controls", {}).get("readAhead", {}).get("uses") == 1, "the use is in control-usage.json", saved.get("controls", {}).get("readAhead"))
        check(saved.get("sessions", 0) >= 8, "sessions count kept", saved.get("sessions"))
        page.get_by_test_id("read-ahead").uncheck()  # leave it off
        more.click()
        # Show everything.
        page.get_by_test_id("show-everything").click()
        page.wait_for_timeout(500)
        check(vis(page.get_by_test_id("layout-strip")) and vis(page.get_by_test_id("simple-mark")), "Show everything: hidden controls are on the main row")
        check(page.get_by_test_id("menu-more-badge").count() == 0, "no count when nothing is hidden")
        if not panel.count():
            more.click()
        check("Everything is on the main row" in panel.inner_text(), "More says everything is out")
        page.keyboard.press("Escape")
        page.wait_for_timeout(800)
        saved = json.loads(usage_file.read_text(encoding="utf-8"))
        check(saved["controls"].get("layout", {}).get("uses") == 1, "Show everything is recorded as a use", saved["controls"].get("layout"))
        page.screenshot(path=str(OUT / "corral-everything-1920.png"))
    print("FAILS:", FAILS)
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
