"""#6371 end-to-end check of starred ranges and Build outward against a RUNNING test copy.

Needs MIDITUTOR_URL (+ MIDITUTOR_TOKEN_FILE) and MIDITUTOR_CDP (a hidden, muted copy started with
--remote-debugging-port on a spare port, never 9333). See scripts/e2e_backwards.py for the recipe.

Loads the Minuet in G, stars bars 2-6 and 3-4 with the star button, picks 2-6 from the Starred
dropdown, then starts Build outward on 3-4 (POST /loop outward=true). The outer span must be 2-6
(the smallest starred range strictly around 3-4). Default clean-lap targets "3,5": 3 clean laps
grow 3-4 to 2-5; a wrong lap doesn't count or shrink it; 5 clean laps grow it one-sided to 2-6
(bar 2 is already the edge); 5 more finish it. The Outward button then turns it off.
"""
from __future__ import annotations

import sys
import time

from e2e_backwards import FAILS, SCORE, check, midi_of, play_lap, screen, strike, tc, tid  # noqa: F401


def wait_piece(seq: int) -> None:
    for _ in range(40):
        events = tc.request("GET", f"/events?since={seq}&limit=2000")["events"]
        if any(e.get("kind") == "piece" for e in events):
            break
        time.sleep(0.5)
    time.sleep(1.5)


def main() -> int:
    import os
    from playwright.sync_api import sync_playwright

    state = tc.state()
    check(state.get("injectEnabled") is True, "inject enabled")
    seq = state["eventSeq"]
    tc.load_piece("Outward (e2e)", SCORE.read_text(encoding="utf-8"))
    wait_piece(seq)

    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp(os.environ["MIDITUTOR_CDP"])
        page = next(pg for ctx in browser.contexts for pg in ctx.pages if "devtools" not in pg.url)

        def loop(first: int, last: int, **kw) -> None:
            tc.request("POST", "/loop", {"firstBar": first, "lastBar": last, **kw})
            time.sleep(0.8)

        for first, last in ((2, 6), (3, 4)):
            loop(first, last)
            star = page.get_by_test_id("star-range")
            check(star.get_attribute("aria-pressed") == "false", f"{first}-{last} starts unstarred")
            star.click()
            time.sleep(0.2)
            check(star.get_attribute("aria-pressed") == "true", f"star button stars {first}-{last}")

        page.get_by_test_id("loops").click()
        time.sleep(0.2)
        rows = page.get_by_test_id("loops-panel").locator("[data-testid^='starred-']").all_inner_texts()
        check(rows == ["Bars 2–6", "Bars 3–4"], "Loops list goes by bar (#6513)", rows)
        page.get_by_test_id("starred-2-6").click()
        time.sleep(0.8)
        s = screen()
        check(s["loop"]["firstBar"] == 2 and s["loop"]["lastBar"] == 6, "picking a star loops it", s.get("loop"))
        check(page.get_by_test_id("loops-panel").count() == 0, "picking closes the dropdown")

        # #6513: one list. 2-6 as a spot too shows once, with its star and its counts; x takes only the spot off.
        page.get_by_test_id("loops").click()
        page.get_by_test_id("spot-add").click()
        time.sleep(0.5)
        if page.get_by_test_id("loops-panel").count() == 0:
            page.get_by_test_id("loops").click()
        row = page.get_by_test_id("loops-panel").get_by_test_id("spot-2-6")
        text = row.inner_text() if row.count() else ""
        check(row.count() == 1 and "★" in text and "alone 0/5" in text and row.get_by_test_id("starred-2-6").count() == 1,
              "a starred range that is also a spot is one row with both", text)
        check(page.get_by_test_id("loops").inner_text().startswith("Loops 2"), "Loops N counts the star 3-4 and the 2-6 row",
              page.get_by_test_id("loops").inner_text())
        page.get_by_test_id("spot-x-2-6").click()
        time.sleep(0.3)
        check(page.get_by_test_id("loops-panel").get_by_test_id("starred-2-6").count() == 1, "x on the spot keeps the star")
        page.keyboard.press("Escape")

        loop(3, 4, outward=True)
        s = screen()
        b = s.get("backwards") or {}
        check(b.get("outward") is True and b.get("firstBar") == 2 and b.get("lastBar") == 6, "outer span is the 2-6 star", b)
        check(b.get("startBar") == 3 and b.get("endBar") == 4 and b.get("need") == 3, "loops the 3-4 core, needs 3", b)
        check(page.get_by_test_id("build-outward").inner_text() == "Outward: on", "Outward button shows on")
        check(page.get_by_test_id("build-backwards").is_disabled(), "Build backwards is off-limits meanwhile")

        for _ in range(2):
            play_lap()
        play_lap(wrong=True)
        b = screen()["backwards"]
        check(b["clean"] == 2 and b["startBar"] == 3, "a wrong lap doesn't count or shrink it", b)
        play_lap()
        time.sleep(0.8)
        s = screen()
        b = s["backwards"]
        check(b["startBar"] == 2 and b["endBar"] == 5 and b["need"] == 5, "3 clean laps grow it a bar each side", b)
        check(s["loop"]["firstBar"] == 2 and s["loop"]["lastBar"] == 5, "loop now bars 2-5", s.get("loop"))

        for _ in range(5):
            play_lap()
        time.sleep(0.8)
        b = screen()["backwards"]
        check(b["startBar"] == 2 and b["endBar"] == 6 and not b["done"], "grows one way at the edge: 2-6", b)
        for _ in range(5):
            play_lap()
        s = screen()
        b = s["backwards"]
        check(b["done"] is True and b.get("reached") is True, "5 clean laps on the outer span finish it", b)
        check("Outward: whole range 2–6" in page.get_by_test_id("backwards-status").inner_text(), "status says whole range")

        page.get_by_test_id("target-reached-restart").click()
        time.sleep(0.5)
        page.get_by_test_id("build-outward").click()
        time.sleep(0.8)
        s = screen()
        check(s.get("backwards") is None and s["loop"]["firstBar"] == 2 and s["loop"]["lastBar"] == 6,
              "Outward off goes back to the whole 2-6 loop", s.get("loop"))

        page.get_by_test_id("loops").click()
        time.sleep(0.2)
        page.get_by_test_id("unstar-3-4").click()
        time.sleep(0.2)
        rows = page.get_by_test_id("loops-panel").locator("[data-testid^='starred-']").all_inner_texts()
        check(rows == ["Bars 2–6"], "x removes a star, dropdown stays open", rows)
        page.keyboard.press("Escape")

    tc.request("DELETE", "/loop")
    events = tc.request("GET", f"/events?since={seq}&limit=5000")["events"]
    chunks = [e for e in events if e.get("kind") == "chunk" and e.get("outward")]
    check(sum(1 for e in chunks if e.get("grew")) == 2, "two growth events", len(chunks))
    check(sum(1 for e in chunks if e.get("reached")) == 1, "exactly one reached event", len(chunks))
    print("FAILED: " + ", ".join(FAILS) if FAILS else "ALL PASS")
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
