"""#10134 headless check: loop bars, add a fingering (re-renders), Restart -> loop's first bar.

Needs the renderer's Vite server, e.g. from a hidden test app:
    MIDITUTOR_HIDDEN=1 MIDITUTOR_PORT=47811 MIDITUTOR_VITE_PORT=5182 npm start
then, with a Python that has Playwright (headless Chromium, no window):
    python scripts/e2e_loop_restart.py
"""
import re
import sys
from playwright.sync_api import sync_playwright

URL = "http://localhost:5182/"
FAILS = []


def check(cond, label, detail=""):
    print(("PASS " if cond else "FAIL ") + label + ("" if cond else f"  {detail}"))
    if not cond:
        FAILS.append(label)


def bar(page):
    return int(page.get_by_test_id("bar-now").input_value())


def measure_centers(page):
    # One box per bar on the top staff, left to right, from OSMD's VexFlow groups.
    return page.evaluate("""() => {
      const out = [];
      for (const g of document.querySelectorAll('g.vf-measure')) {
        const r = g.getBoundingClientRect();
        if (r.width > 0) out.push({id: g.id, x: r.left + r.width / 2, y: r.top + r.height / 2, top: r.top, left: r.left});
      }
      return out;
    }""")


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1600, "height": 1000})
    page.on("console", lambda m: m.type == "error" and print("console:", m.text))
    page.add_init_script("localStorage.setItem('miditutor-settings', JSON.stringify({state: {scoreLayout: 'pages'}, version: 2}))")
    page.goto(URL)
    page.get_by_role("button", name="Score", exact=True).click()
    page.wait_for_selector("[data-testid=loop-bars]", timeout=30000)
    page.wait_for_timeout(2500)
    # Before measuring: its range fields can push the score down a row.
    page.click("[data-testid=loop-bars]")
    page.wait_for_timeout(1000)
    # Pages layout, so bars are laid out on pages and clickable.
    boxes = measure_centers(page)
    print("measure groups:", len(boxes))
    # Groups come bar by bar, top staff first: every other one is the top staff.
    seen = {}
    for b in boxes:
        seen.setdefault(b["id"], b)
    top_row = list(seen.values())
    page.mouse.click(top_row[2]["x"], top_row[2]["y"])
    page.mouse.click(top_row[3]["x"], top_row[3]["y"])
    page.wait_for_timeout(500)
    status = page.locator("[data-testid=loop-status]")
    check(status.count() == 1, "loop set", page.locator("body").inner_text()[:400])
    loop_text = status.inner_text() if status.count() else ""
    print("loop:", loop_text)
    first = int(page.get_by_test_id("loop-first").input_value()) if loop_text else 3
    check(bar(page) == first, f"cursor at loop start bar {first}", bar(page))

    # Tap a notehead inside the loop, give it finger 2: the score re-renders.
    heads = page.evaluate("""(x0) => [...document.querySelectorAll('.vf-notehead')].map(e => e.getBoundingClientRect())
        .filter(r => r.width > 0).map(r => ({x: r.left + r.width/2, y: r.top + r.height/2}))""", None)
    target = min(heads, key=lambda h: abs(h["x"] - top_row[2]["x"]) + abs(h["y"] - top_row[2]["y"]))
    page.mouse.click(target["x"], target["y"])
    page.wait_for_selector("[data-testid=finger-picker]", timeout=5000)
    page.locator("[data-testid=finger-picker] button", has_text="2").first.click()
    page.wait_for_timeout(2500)
    check(page.locator("[data-testid=loop-status]").count() == 1, "loop kept after fingering edit")

    # #10146: the same note gets "Hold"; tapped again it offers "Re-strike".
    def tap():
        page.mouse.click(target["x"], target["y"])
        page.wait_for_selector("[data-testid=finger-picker]", timeout=5000)
    tap()
    toggle = page.locator("[data-testid=hold-toggle]")
    check(toggle.inner_text() == "Hold (don't re-strike)", "picker offers Hold", toggle.inner_text())
    toggle.click()
    page.wait_for_timeout(2500)
    tap()
    check(toggle.inner_text() == "Re-strike", "held note offers Re-strike", toggle.inner_text())
    toggle.click()
    page.wait_for_timeout(2500)
    tap()
    check(toggle.inner_text() == "Hold (don't re-strike)", "hold removed", toggle.inner_text())
    page.get_by_role("button", name="Cancel", exact=True).click()

    page.get_by_role("button", name="Restart", exact=True).click()
    page.wait_for_timeout(800)
    check(page.locator("[data-testid=loop-status]").count() == 1, "loop kept after Restart")
    check(bar(page) == first, f"Restart -> bar {first}", bar(page))

    page.click("[data-testid=clear-loop]")
    page.get_by_role("button", name="Restart", exact=True).click()
    page.wait_for_timeout(800)
    check(bar(page) == 1, "Clear loop + Restart -> bar 1", bar(page))
    browser.close()

print("FAILED: " + ", ".join(FAILS) if FAILS else "ALL PASS")
sys.exit(1 if FAILS else 0)
