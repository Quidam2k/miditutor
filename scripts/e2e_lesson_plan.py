"""#6530 F end-to-end: the guided lesson plan, against a RUNNING hidden muted app (see memory
hidden-test-copy-must-be-muted; env MIDITUTOR_URL / MIDITUTOR_TOKEN_FILE / MIDITUTOR_CDP).

1. A 10-bar loop: the button is off until 5 laps. 5 laps with a wrong note in bars 4 and 9 ->
   plan 3-5 (3 clean), 8-10 (3 clean), whole loop 1-10 (1 clean). A wrong lap doesn't count; 3 clean
   laps move it to 8-10; Skip step -> the whole loop; a clean lap -> "Lesson plan complete.", loop 1-10.
2. A 4-bar loop, 5 laps missing bar 2 -> plan; a clean and a wrong lap of the sub-loop; Stop ->
   his loop 1-4 again and his trouble-spot list exactly as before the plan.
3. During a plan, Build backwards ends it and builds on his own loop 1-4, not the sub-loop.
"""

import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from miditutor_mcp import tutor_client as tc
from scripts.e2e_advice_rules import lap, load, screen, set_loop
from scripts.e2e_overrun import FAILS, check, events_since, wait_for


def loop_now():
    lp = screen().get("loop") or {}
    return lp.get("firstBar"), lp.get("lastBar")


def spans(lesson):
    return [(s["first"], s["last"], s["need"]) for s in (lesson or {}).get("steps") or []]


def lesson_btn(page):
    """#6655: the toolbar Lesson plan button is gone; the Loops menu row is the one way in."""
    if not page.get_by_test_id("loops-panel").is_visible():
        page.get_by_test_id("loops").click()
        time.sleep(0.3)
    return page.get_by_test_id("lesson-plan-menu")


def full_run(page):
    load("Lesson plan (e2e)", 10)
    set_loop(1, 10)
    check("button off before 5 laps", lesson_btn(page).is_disabled() and not screen().get("lessonReady"))
    for _ in range(5):
        lap(range(1, 11), wrong_in=(4, 9))
    time.sleep(0.5)
    check("button on after 5 laps", bool(screen().get("lessonReady")) and lesson_btn(page).is_enabled())
    seq = tc.state()["eventSeq"]
    lesson_btn(page).click()
    time.sleep(1)
    lesson = screen().get("lesson")
    print("plan:", spans(lesson))
    check("plan = 3-5 x3, 8-10 x3, whole 1-10 x1", spans(lesson) == [(3, 5, 3), (8, 10, 3), (1, 10, 1)])
    check("looping 3-5", loop_now() == (3, 5))
    check("status line", "step 1 of 3" in page.get_by_test_id("lesson-status").inner_text())
    check("lesson on event", any(e.get("on") is True for e in events_since(seq, "lesson")))

    lap(range(3, 6))
    lap(range(3, 6), wrong_in=(4,))
    time.sleep(0.5)
    check("a wrong lap doesn't count (1 clean)", (screen().get("lesson") or {}).get("clean") == 1)
    lap(range(3, 6))
    lap(range(3, 6))
    time.sleep(0.8)
    check("3 clean laps -> step 2, looping 8-10", (screen().get("lesson") or {}).get("at") == 1 and loop_now() == (8, 10))

    page.get_by_test_id("lesson-skip").click()
    time.sleep(0.8)
    check("Skip step -> whole loop", (screen().get("lesson") or {}).get("at") == 2 and loop_now() == (1, 10))
    seq = tc.state()["eventSeq"]
    lap(range(1, 11))
    done = wait_for(lambda: [e for e in events_since(seq, "lesson") if e.get("done")], 5)
    time.sleep(0.5)
    check("clean whole loop -> complete", bool(done) and screen().get("lesson") is None)
    check("complete banner", "Lesson plan complete" in page.get_by_test_id("target-reached").inner_text())
    check("back on his loop 1-10", loop_now() == (1, 10))
    check("celebrated", any(e.get("what") == "lesson" for e in events_since(seq, "celebrate")))


def stop_run(page):
    load("Lesson plan stop (e2e)", 4)
    set_loop(1, 4)
    for _ in range(5):
        lap(range(1, 5), wrong_in=(2,))
    time.sleep(3)  # let the every-5-laps spot check land before the snapshot
    before = screen().get("spots")
    lesson_btn(page).click()
    time.sleep(1)
    lesson = screen().get("lesson")
    print("plan:", spans(lesson), "spots before:", before)
    check("4-bar plan: 1-3 then whole 1-4", spans(lesson)[:1] == [(1, 3, 3)] and spans(lesson)[-1] == (1, 4, 1))
    lap(range(1, 4))
    lap(range(1, 4), wrong_in=(2,))
    time.sleep(0.5)
    seq = tc.state()["eventSeq"]
    lesson_btn(page).click()  # Stop lesson plan
    time.sleep(1)
    check("Stop -> his loop 1-4", loop_now() == (1, 4) and screen().get("lesson") is None)
    check("Stop logged", any(e.get("on") is False and e.get("why") == "button" for e in events_since(seq, "lesson")))
    check("trouble spots exactly as before", screen().get("spots") == before)


def menu_run(page):
    """#6582: the Lesson plan row in the Loops menu starts and stops the plan without losing his loop."""
    load("Lesson plan menu (e2e)", 4)
    set_loop(1, 4)
    for _ in range(5):
        lap(range(1, 5), wrong_in=(2,))
    time.sleep(3)
    page.get_by_test_id("loops").click()
    time.sleep(0.3)
    row = page.get_by_test_id("lesson-plan-menu")
    check("menu row enabled after 5 laps", row.is_enabled() and "Lesson plan" in row.inner_text())
    check("opening the menu left his loop 1-4", loop_now() == (1, 4))
    row.click()
    time.sleep(1)
    check("menu row starts the plan (looping 1-3)", screen().get("lesson") is not None and loop_now() == (1, 3))
    page.get_by_test_id("loops").click()
    time.sleep(0.3)
    check("row now says Stop", "Stop lesson plan" in page.get_by_test_id("lesson-plan-menu").inner_text())
    page.get_by_test_id("lesson-plan-menu").click()
    time.sleep(1)
    check("menu Stop -> his loop 1-4 again", loop_now() == (1, 4) and screen().get("lesson") is None)


def backwards_run(page):
    load("Lesson plan backwards (e2e)", 4)
    set_loop(1, 4)
    for _ in range(5):
        lap(range(1, 5), wrong_in=(2,))
    time.sleep(0.5)
    lesson_btn(page).click()
    time.sleep(1)
    check("plan on (looping 1-3)", screen().get("lesson") is not None and loop_now() == (1, 3))
    seq = tc.state()["eventSeq"]
    page.get_by_test_id("build-backwards").click()
    time.sleep(1)
    check("Build backwards ends the plan", screen().get("lesson") is None
          and any(e.get("on") is False and e.get("why") == "backwards" for e in events_since(seq, "lesson")))
    check("... and builds backwards on HIS loop 1-4 (starts on bar 4)",
          loop_now() == (4, 4) and "bar 4" in page.get_by_test_id("backwards-status").inner_text())
    page.get_by_test_id("build-backwards").click()
    time.sleep(1)
    check("Backwards off -> his loop 1-4", loop_now() == (1, 4))


def main():
    from playwright.sync_api import sync_playwright

    wait_for(lambda: tc.state().get("rendererConnected"), 30)
    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp(os.environ["MIDITUTOR_CDP"])
        page = next(pg for ctx in browser.contexts for pg in ctx.pages if "devtools" not in pg.url)
        for scenario in (full_run, stop_run, menu_run, backwards_run):
            try:
                scenario(page)
            except Exception as err:
                check(f"{scenario.__name__} ran", False)
                print(scenario.__name__, "error:", err)

    print("passed" if not FAILS else f"failed: {FAILS}")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
