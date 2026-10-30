"""#10236 #10240 #10245 #5259 end-to-end check on a hidden Electron app: typed bars, the clock,
favorites, a homework line, and a seamless relaunch across a real kill.

Start the app on a scratch user-data dir and a scratch Pieces folder, with MIDITUTOR_TEST_SESSION=1
(a hidden copy otherwise neither reads nor writes the snapshot):
    MIDITUTOR_HIDDEN=1 MIDITUTOR_TEST_SESSION=1 MIDITUTOR_WINDOW_SIZE=900x600 MIDITUTOR_PORT=47811 \
      MIDITUTOR_VITE_PORT=5182 MIDITUTOR_PIECES_DIR=<copy> \
      npx electron-forge start -- --remote-debugging-port=9333 --user-data-dir=<scratch>
then run these phases in order, killing and restarting the app where it says so:
    python scripts/e2e_relaunch.py set <scratch>       # builds a drill, saves what it should come back to
    (hard-kill the app, start it again)
    python scripts/e2e_relaunch.py check <scratch>     # recent snapshot: all of it comes back
    python scripts/e2e_relaunch.py age <scratch>       # makes the snapshot old, leaves the marker off
    (kill, start)
    python scripts/e2e_relaunch.py old <scratch>       # old, no marker: piece yes, drill no
    python scripts/e2e_relaunch.py marker <scratch>    # old again, marker on
    (kill, start)
    python scripts/e2e_relaunch.py forced <scratch>    # old, marker: all of it comes back; marker used up
    python scripts/e2e_relaunch.py count <scratch>     # the practice count, beside the clock
    python scripts/e2e_relaunch.py homework <scratch>  # needs a homework.json with a Sorcerer's piece line
Each phase needs MIDITUTOR_URL=http://127.0.0.1:47811 and MIDITUTOR_TOKEN_FILE=<scratch>/api-token.
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from miditutor_mcp import tutor_client as tc  # noqa: E402

CDP = os.environ.get("MIDITUTOR_CDP", "http://127.0.0.1:9333")
LETTERS = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
FAILS: list[str] = []


def check(cond, label, detail="") -> None:
    print(("PASS " if cond else "FAIL ") + label + ("" if cond else f"  {detail}"))
    if not cond:
        FAILS.append(label)


def midi_of(name: str) -> int:
    m = re.fullmatch(r"([A-G])(#|b{1,2}|x)?(-?\d)", name)
    alter = {None: 0, "#": 1, "x": 2, "b": -1, "bb": -2}[m.group(2)]
    return 12 * (int(m.group(3)) + 1) + LETTERS[m.group(1)] + alter


def screen() -> dict:
    return tc.state().get("screen") or {}


def strike(notes: list[int]) -> None:
    for kind in ("noteon", "noteoff"):
        for note in notes:
            result = tc.request("POST", "/inject", {"notes": [note], "kind": kind, "velocity": 64})
            if "error" in result:
                sys.exit(f"inject failed: {result}")
        time.sleep(0.03)


def play_lap() -> None:
    lap = screen()["loop"]["lap"]
    for _ in range(120):
        s = screen()
        if s["loop"]["lap"] != lap:
            return
        strike([midi_of(n) for n in s.get("remaining", [])])
        time.sleep(0.2)
    sys.exit(f"lap never wrapped: {screen()}")


def wait_ready(page) -> None:
    page.wait_for_selector("[data-testid=bar-now]", timeout=60000)
    page.wait_for_function("() => document.querySelectorAll('.vf-notehead').length > 50", timeout=60000)
    page.wait_for_timeout(1500)


def type_bar(page, testid: str, value) -> None:
    box = page.get_by_test_id(testid)
    box.fill(str(value))
    box.press("Enter")
    page.wait_for_timeout(400)


def opened(p):
    browser = p.chromium.connect_over_cdp(CDP)
    page = browser.contexts[0].pages[0]
    page.on("console", lambda m: m.type == "error" and print("console:", m.text))
    return page


def clock_checks(page) -> None:
    box = lambda sel: page.locator(sel).first.bounding_box()
    clock, nav, tutor = box("[data-testid=top-clock]"), box("header nav"), box("header > div:last-child")
    check(page.get_by_test_id("clock-now").is_visible(), "#10240 clock visible", page.locator("header").inner_text())
    check(re.search(r"\d{1,2}:\d{2}", page.get_by_test_id("clock-now").inner_text()) is not None, "clock shows a time")
    width = page.evaluate("innerWidth")
    check(nav["x"] + nav["width"] <= clock["x"] and clock["x"] + clock["width"] <= tutor["x"],
          f"clock fits between tabs and Tutor at width {width}", (nav, clock, tutor))
    check(page.evaluate("document.title").startswith("MidiTutor 0.1.0 ("), "version in the title", page.evaluate("document.title"))
    check("MidiTutor 0.1.0 (" in page.get_by_test_id("app-version").inner_text(), "version in the footer")


def snapshot(page) -> dict:
    s = screen()
    return {
        # Last lap's tempo isn't part of the snapshot: he hasn't played a lap yet since the relaunch.
        "piece": s.get("piece"), "bar": s.get("measure"), "backwards": s.get("backwards"),
        "loop": {k: v for k, v in (s.get("loop") or {}).items() if k != "lastLapBpm"},
        "wrong": s.get("wrongCount"), "tab_score": page.get_by_test_id("bar-now").count() == 1,
        "hand_left": page.get_by_test_id("hand-left").get_attribute("aria-pressed") == "true",
    }


def phase_set(scratch: Path) -> None:
    with sync_playwright() as p:
        page = opened(p)
        page.reload()
        page.wait_for_timeout(1500)
        page.get_by_role("button", name="Score", exact=True).click()
        page.wait_for_selector("[data-testid=loop-bars]", timeout=30000)
        page.wait_for_function("() => [...document.querySelector('select').options].some((o) => o.value.includes('sorcerers'))", timeout=30000)
        page.locator("select").first.select_option("file:sorcerers-apprentice.musicxml")
        page.wait_for_function("() => document.querySelectorAll('.vf-notehead').length > 50", timeout=60000)
        page.wait_for_timeout(2500)
        clock_checks(page)

        # Bar field.
        type_bar(page, "bar-now", 25)
        check(screen()["measure"] == 25, "typed bar 25 goes there", screen()["measure"])
        type_bar(page, "bar-now", 9999)
        check(page.get_by_test_id("bar-now").input_value() == "25", "no such bar: the field goes back")
        type_bar(page, "bar-now", "x")
        check(page.get_by_test_id("bar-now").input_value() == "25", "not a number: the field goes back")

        # #10245: Prev walks out of bar 25, a step at a time, never sticking.
        seen = []
        for _ in range(12):
            page.get_by_role("button", name="◀ Prev").click()
            page.wait_for_timeout(120)
            seen.append(screen()["measure"])
        check(min(seen) < 25, "Prev walks back out of bar 25 (#10245)", seen)
        check(seen == sorted(seen, reverse=True), "Prev never goes forward", seen)
        for _ in range(12):
            page.get_by_role("button", name="Next ▶").click()
            page.wait_for_timeout(60)
        check(screen()["measure"] >= 25, "Next comes back", screen()["measure"])

        # Typed range.
        page.get_by_test_id("loop-bars").click()
        page.wait_for_timeout(200)
        focused = page.evaluate("document.activeElement?.getAttribute('data-testid')")
        check(focused == "loop-first", "Loop bars focuses the first bar", focused)
        type_bar(page, "loop-first", 22)
        focused = page.evaluate("document.activeElement?.getAttribute('data-testid')")
        check(focused == "loop-last", "then the last bar", focused)
        type_bar(page, "loop-last", 30)
        s = screen()
        check(s["loop"]["firstBar"] == 22 and s["loop"]["lastBar"] == 30 and s["measure"] == 22, "typed 22-30 loops there", s["loop"])

        page.get_by_test_id("build-backwards").click()
        page.wait_for_timeout(500)
        check("now looping 30–30" in page.get_by_test_id("loop-status").inner_text(), "shows the range beside the sub-loop",
              page.get_by_test_id("loop-status").inner_text())
        check(page.get_by_test_id("loop-first").input_value() == "22", "the range stays 22")

        # Two clean laps on the left hand, then edit the range around them.
        page.get_by_test_id("hand-left").click()
        page.wait_for_timeout(800)
        play_lap()
        play_lap()
        b = screen()["backwards"]
        check(b["clean"] == 2 and b["startBar"] == 30, "two clean laps counted", b)
        type_bar(page, "loop-first", 24)
        b = screen()["backwards"]
        check(b["clean"] == 2 and b["firstBar"] == 24 and b["startBar"] == 30, "a new first bar keeps progress", b)
        type_bar(page, "loop-first", 22)
        type_bar(page, "loop-last", 29)
        b = screen()["backwards"]
        check(b["clean"] == 0 and b["startBar"] == 29, "a new last bar starts over", b)
        type_bar(page, "loop-last", 30)
        play_lap()
        play_lap()
        # Move on inside the bar, so the cursor isn't simply the loop's start.
        strike([midi_of(n) for n in screen()["remaining"]])
        page.wait_for_timeout(1200)

        # Favorites-only keeps the piece on screen.
        page.locator("button[aria-pressed]", has_text="☆").first.click()
        page.wait_for_timeout(100)
        page.get_by_test_id("favorites-only").click()
        page.wait_for_timeout(200)
        count = page.locator("select").first.evaluate("s => s.options.length")
        check(count == 1, "★ only: just the favorite on screen", count)
        page.get_by_test_id("favorites-only").click()
        page.locator("button[aria-pressed]", has_text="★").first.click()

        page.wait_for_timeout(1500)
        want = snapshot(page)
        print("drill:", want)
        check(want["backwards"]["clean"] == 2 and want["loop"]["lap"] == 3, "drill has laps to restore", want)
        (scratch / "want.json").write_text(json.dumps(want))
        saved = json.loads((scratch / "ud" / "session.json").read_text())
        check(saved["chunk"]["clean"] == 2, "session.json holds the chunk", saved)
        page.wait_for_timeout(35000)  # his tab is in localStorage, which Chromium writes lazily


def same_drill(page, want: dict, label: str) -> None:
    got = snapshot(page)
    check(got == want, label, f"\n  got  {got}\n  want {want}")
    check(page.get_by_test_id("loop-first").input_value() == "22", f"{label}: range field 22")
    check("now looping" in page.get_by_test_id("loop-status").inner_text(), f"{label}: sub-loop shown")


def phase_check(scratch: Path, label="recent snapshot") -> None:
    want = json.loads((scratch / "want.json").read_text())
    with sync_playwright() as p:
        page = opened(p)
        wait_ready(page)
        same_drill(page, want, label)
        # The follower knows the lap too, not only the label.
        b0, lap0 = screen()["backwards"]["clean"], screen()["loop"]["lap"]
        play_lap()
        s = screen()
        check(s["loop"]["lap"] == lap0 + 1 and s["backwards"]["clean"] == b0 + 1 or s["backwards"]["startBar"] == 29,
              f"{label}: the next lap carries on from there", s)
        page.wait_for_timeout(1200)
        (scratch / "want.json").write_text(json.dumps(snapshot(page)))


def make_old(scratch: Path) -> None:
    f = scratch / "ud" / "session.json"
    s = json.loads(f.read_text())
    s["at"] -= 2 * 60 * 60 * 1000
    f.write_text(json.dumps(s))


def phase_old(scratch: Path) -> None:
    with sync_playwright() as p:
        page = opened(p)
        wait_ready(page)
        s = screen()
        check("Sorcerer" in s.get("piece", ""), "old snapshot: the piece still opens", s.get("piece"))
        check(s.get("loop") is None and s.get("backwards") is None, "old snapshot: no drill", s)
        check(page.get_by_test_id("hand-both").get_attribute("aria-pressed") == "true", "old snapshot: hand as today")


def phase_marker(scratch: Path) -> None:
    # The old launch wrote a new snapshot without the drill; put back the saved drill, old.
    f = scratch / "ud" / "session.json"
    f.write_text((scratch / "drill-session.json").read_text())
    make_old(scratch)
    (scratch / "ud" / "restore-next").write_text("")


def phase_forced(scratch: Path) -> None:
    check(not (scratch / "ud" / "restore-next").exists(), "the marker is used up")
    phase_check(scratch, "old snapshot, patch relaunch")


def phase_count(scratch: Path) -> None:
    # The dev keyboard: /inject notes don't count, they aren't him playing.
    with sync_playwright() as p:
        page = opened(p)
        page.get_by_role("button", name="Practice", exact=True).click()
        page.wait_for_timeout(300)
        count = page.get_by_test_id("practice-count")
        for note in (60, 62, 64):
            page.evaluate("(n) => window.__miditutorDev.play(n)", note)
            page.wait_for_timeout(400)
        check(count.is_visible(), "#10240 practice count after he plays", page.locator("header").inner_text())
        check(re.fullmatch(r"Practiced \d+:\d\d", count.inner_text()) is not None, "reads hours:minutes", count.inner_text())
        clock_checks(page)  # with the count beside the time
        page.screenshot(path=str(scratch / "top_bar_900.png"))
        page.reload()
        page.wait_for_timeout(2500)
        check(page.get_by_test_id("practice-count").is_visible(), "the count survives a reload")


def phase_homework(scratch: Path) -> None:
    with sync_playwright() as p:
        page = opened(p)
        page.get_by_role("button", name="Practice", exact=True).click()
        page.wait_for_timeout(300)
        page.get_by_role("button", name="Homework", exact=True).click()
        page.get_by_test_id("homework-piece").click()
        wait_ready(page)
        s = screen()
        check("Sorcerer" in s.get("piece", ""), "homework line opens the piece", s.get("piece"))
        b = s.get("backwards") or {}
        check(b.get("firstBar") == 22 and b.get("lastBar") == 30, "on the range he last set, building backwards", s)
        # No range yet: the first field waits for him.
        page.evaluate("""() => { const k = 'miditutor-settings'; const v = JSON.parse(localStorage.getItem(k));
                          v.state.pieceLoops = {}; localStorage.setItem(k, JSON.stringify(v)); }""")
        page.reload()
        page.wait_for_timeout(2500)
        page.get_by_role("button", name="Practice", exact=True).click()
        page.wait_for_timeout(300)
        page.get_by_role("button", name="Homework", exact=True).click()
        page.get_by_test_id("homework-piece").click()
        wait_ready(page)
        focused = page.evaluate("document.activeElement?.getAttribute('data-testid')")
        check(focused == "loop-first", "no range yet: the first bar field is focused", focused)


def main() -> int:
    phase, scratch = sys.argv[1], Path(sys.argv[2])
    if phase == "set":
        phase_set(scratch)
    elif phase == "check":
        phase_check(scratch)
        (scratch / "drill-session.json").write_text((scratch / "ud" / "session.json").read_text())
    elif phase == "age":
        make_old(scratch)
    elif phase == "old":
        phase_old(scratch)
    elif phase == "marker":
        phase_marker(scratch)
    elif phase == "forced":
        phase_forced(scratch)
    elif phase == "count":
        phase_count(scratch)
    elif phase == "homework":
        phase_homework(scratch)
    else:
        sys.exit(f"unknown phase {phase}")
    print("FAILED: " + ", ".join(FAILS) if FAILS else "ALL PASS")
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
