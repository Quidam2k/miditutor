"""#5721 Review overlay: the score laid over the scan, bar by bar.

Run against a hidden, muted packaged copy pointed at a scratch library holding a piece
with a review layout (e.g. Sorcerer's Apprentice):
    MIDITUTOR_HIDDEN=1 ./out/MidiTutor-win32-x64/MidiTutor.exe --mute-audio --user-data-dir=<s>/ud
        --remote-debugging-port=9357 --review-library=<s>/lib --review-pinocchio=
    MIDITUTOR_CDP=http://localhost:9357 python scripts/e2e_review_overlay.py [screenshot.png]
"""
import os
import sys
from playwright.sync_api import sync_playwright

CDP = os.environ.get("MIDITUTOR_CDP", "http://localhost:9357")
SHOT = sys.argv[1] if len(sys.argv) > 1 else ""
FAILS = []


def check(cond, label, detail=""):
    print(("PASS " if cond else "FAIL ") + label + (f"  {detail}" if not cond else ""))
    if not cond:
        FAILS.append(label)


def label(page):
    return page.locator("[data-testid=review-bar-label]").inner_text()


def clip_width(page):
    return page.evaluate(
        "() => +document.querySelector('[data-testid=review-digital-layer] #review-wipe rect')?.getAttribute('width')")


with sync_playwright() as p:
    browser = p.chromium.connect_over_cdp(CDP)
    page = browser.contexts[0].pages[0]
    page.set_viewport_size({"width": 1500, "height": 1000})
    page.get_by_role("button", name="Review", exact=True).click()
    page.get_by_text("Sorcerer", exact=False).first.click()
    page.wait_for_selector("[data-testid=review-digital-layer]", timeout=30000)
    while page.locator("[data-testid=review-prev]").is_enabled():
        page.locator("[data-testid=review-prev]").click()
    page.wait_for_selector("[data-testid=review-digital-layer] image", timeout=15000)
    page.wait_for_timeout(800)

    n = page.locator("[data-testid=review-digital-layer] image").count()
    check(n == 8, "line 1: both staves of all 4 bars laid over the scan", f"images={n}")
    check(label(page) == "Page 1, line 1, 1st bar [bar 1]", "label names page/line/bar", label(page))
    check(page.locator("[data-testid=review-unaligned]").count() == 0, "no bar falls back on line 1")

    # The overlay's top staff line sits on the scan's (layout: 761 page px, y0 677, crop scale 0.5 -> 42).
    ty = page.evaluate("""() => {
      const m = document.querySelector('[data-testid=review-digital-layer] image').transform.baseVal[0].matrix;
      return m.d;
    }""")
    check(0.3 < ty < 3, "vertical scale is sane", ty)

    page.keyboard.press("o")
    check(page.locator("[data-testid=review-digital-layer]").count() == 0, "O hides the score layer")
    page.keyboard.press("o")
    check(page.locator("[data-testid=review-digital-layer]").count() == 1, "O shows it again")
    page.locator("[data-testid=review-overlay-toggle]").click()
    check(page.locator("[data-testid=review-digital-layer]").count() == 0, "Overlay button hides it")
    page.locator("[data-testid=review-overlay-toggle]").click()

    page.locator("[data-testid=review-wipe]").fill("100")
    full = clip_width(page)
    page.locator("[data-testid=review-wipe]").fill("40")
    half = clip_width(page)
    check(full > 0 and abs(half - 0.4 * full) < 1, "slider clips the layer at the handle", f"{full} -> {half}")
    page.evaluate("() => document.activeElement.blur()")
    page.keyboard.press("Shift+ArrowRight")
    check(abs(clip_width(page) - 0.45 * full) < 1, "Shift+Right nudges the handle", clip_width(page))
    page.locator("[data-testid=review-wipe]").fill("100")
    page.evaluate("() => document.activeElement.blur()")

    for _ in range(3):
        page.keyboard.press(".")
    check(label(page) == "Page 1, line 1, 4th bar [bar 4]", ". steps bars", label(page))
    page.keyboard.press(".")
    page.wait_for_timeout(600)
    check(label(page) == "Page 1, line 2, 1st bar [bar 5]", "stepping past the last bar wraps into the next line", label(page))
    check(page.locator("[data-testid=review-line-label]").inner_text().startswith("Line 2"), "the line moved too")
    page.wait_for_selector("[data-testid=review-digital-layer] image", timeout=15000)
    page.wait_for_timeout(800)
    n2 = page.locator("[data-testid=review-digital-layer] image").count()
    check(n2 == 12 and page.locator("[data-testid=review-unaligned]").count() == 0,
          "line 2 (rests, a dynamic): all 6 bars laid over", f"images={n2}")
    page.keyboard.press(",")
    page.wait_for_timeout(600)
    check(label(page) == "Page 1, line 1, 4th bar [bar 4]", ", steps back across the line", label(page))
    for _ in range(4):
        page.locator("[data-testid=review-next]").click()
    page.wait_for_timeout(800)
    check(label(page).startswith("Page 2, line 1, 1st bar [bar 23]"), "page 2 starts at bar 23", label(page))

    # #11353: one-handed on the trackball, real Chromium mouse input through CDP.
    while page.locator("[data-testid=review-prev]").is_enabled():
        page.locator("[data-testid=review-prev]").click()
    page.wait_for_timeout(600)
    cdp = page.context.new_cdp_session(page)

    def click(button, buttons):
        for kind in ("mousePressed", "mouseReleased"):
            cdp.send("Input.dispatchMouseEvent", {"type": kind, "x": 700, "y": 500, "button": button,
                                                  "buttons": buttons if kind == "mousePressed" else 0,
                                                  "clickCount": 1})
        page.wait_for_timeout(300)

    url = page.url
    start = label(page)
    page.keyboard.press(".")
    one_on = label(page)
    page.keyboard.press(",")
    click("forward", 16)
    check(label(page) == one_on != start, "mouse forward steps a bar, like .", f"{start} -> {label(page)}")
    click("back", 8)
    check(label(page) == start, "mouse back steps back, like ,", label(page))
    check(page.url == url, "mouse back does not navigate away", page.url)
    click("middle", 4)
    check(page.locator("[data-testid=review-digital-layer]").count() == 0, "middle button hides the overlay")
    click("middle", 4)
    check(page.locator("[data-testid=review-digital-layer]").count() == 1, "middle button shows it again")
    click("right", 2)
    check(label(page) == start, "right-click changes no bar", label(page))

    # Line 1 for the picture, handle part-way so the bare scan shows on the right.
    while page.locator("[data-testid=review-prev]").is_enabled():
        page.locator("[data-testid=review-prev]").click()
    page.locator("[data-testid=review-wipe]").fill("80")
    page.evaluate("() => document.activeElement.blur()")
    page.keyboard.press(".")
    page.keyboard.press(".")
    page.wait_for_timeout(800)
    if SHOT:
        page.screenshot(path=SHOT, full_page=True)
        print("shot", SHOT)

print("ALL PASS" if not FAILS else f"{len(FAILS)} FAIL: {FAILS}")
sys.exit(1 if FAILS else 0)
