"""#5729 Review: lines are presumed right, a click flags a bar, Submit review verifies.

Run against a hidden, muted packaged copy pointed at a scratch COPY of a library holding
Sorcerer's Apprentice and Die Gedanken with review layouts (it appends to their logs), and
at a scripts dir whose review_queue.py is a stub (so a flag never calls the vision model):
    MIDITUTOR_HIDDEN=1 MIDITUTOR_TEST_SESSION=1 ./out/MidiTutor-win32-x64/MidiTutor.exe --mute-audio
        --user-data-dir=<s>/ud --remote-debugging-port=9357 --review-library=<s>/lib
        --review-python=<venv python> --review-scripts=<s>/scripts --review-pinocchio=
    MIDITUTOR_CDP=http://localhost:9357 python scripts/e2e_review_flags.py
"""
import os
import sys
from playwright.sync_api import sync_playwright

CDP = os.environ.get("MIDITUTOR_CDP", "http://localhost:9357")
FAILS = []


def check(cond, label, detail=""):
    print(("PASS " if cond else "FAIL ") + label + (f"  {detail}" if not cond else ""))
    if not cond:
        FAILS.append(label)


def open_piece(page, name):
    page.get_by_role("button", name="Review", exact=True).click()
    back = page.get_by_text("← All pieces")
    if back.count():
        back.first.click()
    page.get_by_text(name, exact=False).first.click()
    page.wait_for_selector("[data-testid=review-scan-overlay]", timeout=30000)
    page.wait_for_timeout(800)


def status(page):
    return page.locator("[data-testid=review-status]").inner_text()


def open_marks(page):
    return page.locator("[data-testid^=review-mark-]").filter(has=page.get_by_role("button", name="Withdraw", exact=True)).count()


def click_scan(page, share):
    box = page.locator("[data-testid=review-scan-overlay]").bounding_box()
    page.mouse.click(box["x"] + box["width"] * share, box["y"] + box["height"] * 0.5)
    page.wait_for_timeout(700)


with sync_playwright() as p:
    browser = p.chromium.connect_over_cdp(CDP)
    page = browser.contexts[0].pages[0]
    page.set_viewport_size({"width": 1500, "height": 1000})

    # Clean submit -> Verified by you.
    open_piece(page, "Die Gedanken")
    check(page.locator("[data-testid=review-confirm]").count() == 0, "no per-line confirm button")
    check(page.locator("[data-testid=review-submit-top]").is_visible(), "Submit review on the header")
    check(page.locator("[data-testid=review-submit]").count() == 1, "Submit review under the line")
    check(status(page).startswith("Not submitted yet"), "starts not submitted", status(page))
    page.locator("[data-testid=review-submit]").click()
    page.wait_for_timeout(800)
    check(status(page) == "Verified by you", "submit with nothing flagged -> Verified by you", status(page))
    check("Verified by you" in page.locator("[data-testid=review-notice]").inner_text(), "notice says verified")

    # Flags: a click flags a bar, a second click takes it back.
    open_piece(page, "Sorcerer")
    check(open_marks(page) == 0, "Sorcerer starts with no flags", open_marks(page))
    click_scan(page, 0.45)
    check(open_marks(page) == 1, "a click on a bar flags it", open_marks(page))
    check("1 flagged bar" in status(page), "header counts the flag", status(page))
    tint = page.locator("[data-testid=review-scan-overlay] rect[fill='rgba(239, 68, 68, 0.28)']").count()
    check(tint == 1, "the flagged bar is red on the scan", tint)
    click_scan(page, 0.45)
    check(open_marks(page) == 0, "a second click takes it back", open_marks(page))

    # Stepping past the last line lands on Submit and does not submit.
    for _ in range(40):
        page.keyboard.press("PageDown")
    page.wait_for_timeout(600)
    focused = page.evaluate("() => document.activeElement?.dataset?.testid ?? null")
    check(focused == "review-submit", "past the last line focuses Submit review", focused)
    check(status(page).startswith("Not submitted yet"), "stepping past the end does not submit", status(page))
    check("Submit review" in page.locator("[data-testid=review-notice]").inner_text(), "and says to press Submit")

    # Submit with a flag -> second look, not verified; resolved -> verified with no second submit.
    click_scan(page, 0.45)
    check(open_marks(page) == 1, "flag a bar on the last line", open_marks(page))
    page.locator("[data-testid=review-submit-top]").click()
    page.wait_for_timeout(800)
    check(status(page).startswith("Submitted") and "1 flagged bar" in status(page),
          "submit with a flag -> Submitted, not verified", status(page))
    notice = page.locator("[data-testid=review-notice]").inner_text()
    check("second look at 1 flagged bar" in notice, "says we're taking a second look", notice)
    page.get_by_role("button", name="Withdraw", exact=True).first.click()
    page.wait_for_timeout(800)
    check(status(page) == "Verified by you", "flag resolved -> Verified by you, no second submit", status(page))

    # A flag after submitting voids it.
    click_scan(page, 0.3)
    check(status(page).startswith("Not submitted yet"), "a new flag after submitting voids it", status(page))

    page.get_by_text("← All pieces").first.click()
    page.wait_for_timeout(600)
    row = page.locator("button", has_text="Die Gedanken").first.inner_text()
    check("Verified by you" in row, "list shows Die Gedanken verified", row)

print("ALL PASS" if not FAILS else f"{len(FAILS)} FAIL: {FAILS}")
sys.exit(1 if FAILS else 0)
