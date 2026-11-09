"""#5731 Review: the score panel draws exactly the bars of the scan line, on every line.

OSMD read drawFromMeasureNumber as an index when it took bar 1 for a pickup, so pieces that
start with one (Love Dance, Fur Elise, Die Gedanken) drew every line a bar late. The score
panel's data-bars lists the bars it drew; data-range is the line's bars from the scan layout.

Run against a hidden, muted packaged copy pointed at a scratch COPY of the library (needs the
pieces' .musicxml, review/, review-pages/ and a pages/<slug>/ folder each):
    MIDITUTOR_HIDDEN=1 MIDITUTOR_TEST_SESSION=1 ./out/MidiTutor-win32-x64/MidiTutor.exe --mute-audio
        --user-data-dir=<s>/ud --remote-debugging-port=9357 --review-library=<s>/lib
        --review-python=<venv python> --review-scripts=<s>/scripts --review-pinocchio=
    MIDITUTOR_CDP=http://localhost:9357 python scripts/e2e_review_bars.py [slug ...]
"""
import os
import sys
from playwright.sync_api import sync_playwright

CDP = os.environ.get("MIDITUTOR_CDP", "http://localhost:9357")
SLUGS = sys.argv[1:] or ["love-dance-from-ka", "fur-elise", "die-gedanken-sind-frei", "sorcerers-apprentice"]
FAILS = []


def check(cond, label, detail=""):
    print(("PASS " if cond else "FAIL ") + label + (f"  {detail}" if not cond else ""))
    if not cond:
        FAILS.append(label)


def lines_of(page):
    """[(line label, range, drawn bars)] for every line of the open piece."""
    out, seen = [], set()
    while True:
        page.wait_for_function(
            "() => { const e = document.querySelector('[data-testid=review-score]');"
            " return e && (!e.dataset.range || e.dataset.bars); }", timeout=10000)
        score = page.locator("[data-testid=review-score]")
        label = page.locator("[data-testid=review-line-label]").inner_text()
        if label in seen:
            return out
        seen.add(label)
        out.append((label, score.get_attribute("data-range"), score.get_attribute("data-bars")))
        nxt = page.locator("[data-testid=review-next]")
        if not nxt.is_enabled():
            return out
        nxt.click()
        page.wait_for_timeout(250)


with sync_playwright() as p:
    page = p.chromium.connect_over_cdp(CDP).contexts[0].pages[0]
    page.set_viewport_size({"width": 1500, "height": 1000})
    page.get_by_role("button", name="Review", exact=True).click()
    for slug in SLUGS:
        back = page.get_by_text("← All pieces")
        if back.count():
            back.first.click()
        page.locator(f"[data-testid=review-row-{slug}]").click()
        page.wait_for_selector("[data-testid=review-score]", timeout=30000)
        lines = [ln for ln in lines_of(page) if ln[1]]
        check(len(lines) > 0, f"{slug}: has lines")
        for label, rng, bars in lines:
            a, b = map(int, rng.split("-"))
            want = ",".join(str(m) for m in range(a, b + 1))
            check(bars == want, f"{slug} {label}: score draws bars {rng}", f"drew {bars or 'nothing'}")

print(f"\n{len(FAILS)} failure(s)" if FAILS else "\nALL PASS")
sys.exit(1 if FAILS else 0)
