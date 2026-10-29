"""#10160/#10162 headless check: a reload reopens the tab and piece he left.

Needs the renderer's Vite server, e.g. from a hidden test app:
    MIDITUTOR_HIDDEN=1 MIDITUTOR_PORT=47811 MIDITUTOR_VITE_PORT=5182 npm start
then, with a Python that has Playwright (headless Chromium, no window):
    python scripts/e2e_last_piece.py
(The plain page has no Pieces folder, so this covers built-in pieces and the
missing-file fallback; the library case is checked on the real app.)
"""
import json
import sys
from playwright.sync_api import sync_playwright

URL = "http://localhost:5182/"
FAILS = []


def check(cond, label, detail=""):
    print(("PASS " if cond else "FAIL ") + label + (f"  {detail}" if not cond else ""))
    if not cond:
        FAILS.append(label)


def seed(page, state):
    page.evaluate(
        "s => localStorage.setItem('miditutor-settings', JSON.stringify({state: s, version: 2}))", state
    )


def settings(page):
    return json.loads(page.evaluate("() => localStorage.getItem('miditutor-settings')"))["state"]


def picked(page):
    page.wait_for_selector("[data-testid=loop-bars]", timeout=30000)
    page.wait_for_timeout(1500)
    return page.locator("select").first.input_value()


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1600, "height": 1000})
    page.on("console", lambda m: m.type == "error" and print("console:", m.text))
    page.goto(URL)

    # Fresh: Practice tab, then he opens Score and picks the A minor scale.
    seed(page, {})
    page.reload()
    page.wait_for_timeout(1000)
    check(page.locator("[data-testid=loop-bars]").count() == 0, "fresh start opens on Practice")
    page.get_by_role("button", name="Score", exact=True).click()
    check(picked(page) == "minuet", "fresh Score shows the default piece")
    page.locator("select").first.select_option("a-minor")
    page.wait_for_timeout(1500)
    s = settings(page)
    check(s.get("lastPiece", {}).get("id") == "a-minor" and s.get("lastView") == "score", "saved piece + tab", s)

    # Restart (reload): straight onto Score with the A minor scale.
    page.reload()
    check(picked(page) == "a-minor", "reload reopens Score on the A minor scale")
    check(page.get_by_text("Couldn't").count() == 0, "no error shown")

    # His file is gone: the default piece, quietly, and the saved piece moves on.
    seed(page, {"lastPiece": {"id": "file:gone.musicxml", "label": "Gone"}, "lastView": "score"})
    page.reload()
    check(picked(page) == "minuet", "missing file -> default piece")
    check(settings(page).get("lastPiece", {}).get("id") == "minuet", "saved piece reset to the default")

    # A desk-only tab he can't have here falls back to Practice.
    seed(page, {"lastView": "review"})
    page.reload()
    page.wait_for_timeout(1000)
    check(page.locator("[data-testid=loop-bars]").count() == 0, "lastView=review -> Practice")
    browser.close()

print("FAILED: " + ", ".join(FAILS) if FAILS else "ALL PASS")
sys.exit(1 if FAILS else 0)
