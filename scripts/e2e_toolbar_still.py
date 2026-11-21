"""#6655 end-to-end: the Score toolbar's button row holds still. Switching the loop, Climb or Miss sound must
not move any button in [data-testid=toolbar-row]; loop-only tools exist only while a loop is on.

Run against a RUNNING hidden muted test copy (see memory hidden-test-copy-must-be-muted). Never the owner's
piano (ports 47810 / 47800):
    MIDITUTOR_URL=http://127.0.0.1:47811 MIDITUTOR_TOKEN_FILE=<ud>/api-token MIDITUTOR_CDP=http://127.0.0.1:9347 python scripts/e2e_toolbar_still.py
"""

import os
import sys
import time
from pathlib import Path
from urllib.parse import urlparse

URL = os.environ.get("MIDITUTOR_URL", "")
if not URL or not os.environ.get("MIDITUTOR_TOKEN_FILE") or urlparse(URL).port in (47810, 47800):
    print("Set MIDITUTOR_URL and MIDITUTOR_TOKEN_FILE to a hidden test copy (never port 47810 or 47800).")
    sys.exit(2)

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from playwright.sync_api import sync_playwright  # noqa: E402

from miditutor_mcp import tutor_client as tc  # noqa: E402
from scripts.e2e_advice_rules import load, screen  # noqa: E402
from scripts.e2e_overrun import FAILS, check  # noqa: E402

CDP = os.environ.get("MIDITUTOR_CDP", "http://127.0.0.1:9347")
VIEWPORTS = [(1920, 1080), (1440, 900), (1186, 609)]
ROW = "[data-testid=toolbar-row]"
LOOP = "[data-testid=loop-bars]"

RAW_JS = """() => {
  const row = document.querySelector('[data-testid=toolbar-row]');
  if (!row) return [];
  return [...row.querySelectorAll('button, select, input, label')].filter(el => {
    if (el.closest('[data-testid=menu-more-panel]')) return false;
    return el.offsetParent !== null && getComputedStyle(el).visibility !== 'hidden';
  }).map(el => {
    const r = el.getBoundingClientRect();
    const key = el.getAttribute('data-testid') || el.getAttribute('aria-label')
      || (el.innerText || '').trim().slice(0, 30);
    const t = el.closest('[title]');
    return {key, left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width),
            tip: !!(el.title || (t && t.title))};
  });
}"""


def raw(page):
    return page.evaluate(RAW_JS)


def measure(page):
    """key -> (left, top, width) of every visible toolbar-row control."""
    out = {}
    for item in raw(page):
        key, n = item["key"], 1
        while key in out:
            n += 1
            key = f"{item['key']}#{n}"
        out[key] = (item["left"], item["top"], item["width"])
    return out


def same(a, b, keys=None, tol=1):
    bad = []
    for k in (keys if keys is not None else list(a)):
        if k not in b:
            bad.append((k, a.get(k), None))
        elif k in a and any(abs(x - y) > tol for x, y in zip(a[k], b[k])):
            bad.append((k, a[k], b[k]))
    for k, x, y in bad[:5]:
        print(f"    differs: {k}: {x} -> {y}")
    return not bad


def box(page, selector):
    return page.evaluate(
        "(s) => { const e = document.querySelector(s); if (!e) return null;"
        " const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top)]; }", selector)


def set_viewport(page, w, h):
    page.set_viewport_size({"width": w, "height": h})
    time.sleep(0.8)


def loop_text(page):
    return page.locator(LOOP).inner_text().strip()


def open_more(page):
    page.locator("[data-testid=menu-more]").click()
    page.wait_for_selector("[data-testid=menu-more-panel]", timeout=5000)


def close_more(page):
    page.keyboard.press("Escape")
    time.sleep(0.3)


def check_loop(page, base):
    tc.request("POST", "/loop", {"firstBar": 2, "lastBar": 5})
    time.sleep(1)
    check("loop on: button row did not move", same(base, measure(page)))
    tools = page.locator("[data-testid=loop-tools]")
    check("loop on: loop-tools visible with build-backwards",
          tools.count() == 1 and tools.is_visible() and tools.locator("[data-testid=build-backwards]").count() == 1)
    check("loop tools are not in the button row",
          page.locator(f"{ROW} [data-testid=build-backwards]").count() == 0
          and page.locator(f"{ROW} [data-testid=block]").count() == 0)
    page.locator(LOOP).click()
    time.sleep(0.5)
    check("loop off by clicking Loop: on", not screen().get("loop"))
    check("loop off: loop-tools gone", page.locator("[data-testid=loop-tools]").count() == 0)
    check("loop off: button row did not move", same(base, measure(page)))
    page.locator(LOOP).click()
    time.sleep(0.3)
    check("picking: text starts with 'Click first bar'", loop_text(page).startswith("Click first bar"))
    check("picking: button row did not move", same(base, measure(page)))
    page.locator(LOOP).click()
    time.sleep(0.3)
    check("picking stopped: text is 'Loop bars'", loop_text(page) == "Loop bars")
    check("picking stopped: button row did not move", same(base, measure(page)))


def check_climb(page):
    box_sel = page.locator("[data-testid=climb-on]")
    was = box_sel.is_checked()
    box_sel.set_checked(False)
    time.sleep(0.3)
    c0 = measure(page)
    hidden = box(page, "[data-testid=climb-target]")
    vis = page.evaluate("() => getComputedStyle(document.querySelector('[data-testid=climb-target]')).visibility")
    check("climb off: target input is visibility hidden", vis == "hidden")
    box_sel.check()
    time.sleep(0.3)
    check("climb on: button row did not move", same(c0, measure(page)))
    vis = page.evaluate("() => getComputedStyle(document.querySelector('[data-testid=climb-target]')).visibility")
    check("climb on: target visible in the same place", vis != "hidden" and box(page, "[data-testid=climb-target]") == hidden)
    box_sel.set_checked(was)
    time.sleep(0.3)


def check_miss(page):
    miss = page.locator("[data-testid=miss-sound]")
    was = miss.is_checked()
    miss.set_checked(True)
    time.sleep(0.3)
    m1 = measure(page)
    miss.set_checked(False)
    time.sleep(0.3)
    m2 = measure(page)
    check("miss sound: its own box did not move", same(m1, m2, keys=["miss-sound"]))
    extras = {"miss-sound-test", "miss-kind", "miss-volume"}
    left, top = m1["miss-sound"][0], m1["miss-sound"][1]
    after = [k for k, v in m1.items() if v[0] > left and abs(v[1] - top) <= 4 and k not in extras]
    check("miss sound: everything to its right on the row stayed put", same(m1, m2, keys=after))
    check("miss sound off: Test button hidden (its space kept)", not page.locator("[data-testid=miss-sound-test]").is_visible())
    miss.set_checked(was)
    time.sleep(0.3)


def check_keyboard(page):
    kb = page.get_by_label("Keyboard", exact=True)
    was = kb.is_checked()
    for state in (False, True):
        kb.set_checked(state)
        time.sleep(0.3)
        open_more(page)
        n = page.locator("[data-testid=key-wheel-fingers]").count()
        check(f"keyboard {'on' if state else 'off'}: key-wheel-fingers count is {int(state)}", n == int(state))
        close_more(page)
    kb.set_checked(was)
    time.sleep(0.3)


def per_viewport(page, w, h):
    print(f"-- viewport {w}x{h}")
    set_viewport(page, w, h)
    check_loop_base = measure(page)
    check_loop(page, check_loop_base)
    check_climb(page)
    check_miss(page)
    check_keyboard(page)


def once(page):
    print("-- once")
    check("toolbar Lesson plan button is gone", page.locator("[data-testid=lesson-plan]").count() == 0)
    check("no 'Open piece…' button", page.get_by_role("button", name="Open piece…", exact=True).count() == 0)
    last = page.evaluate("() => { const o = document.querySelector('[data-testid=piece-select]').options;"
                         " return o[o.length - 1].text.trim(); }")
    check("piece list ends with 'Add from file…'", last == "Add from file…")
    chord = page.locator("[data-testid=chord-moves]")
    opened = False
    if chord.count() == 0 or not chord.first.is_visible():
        open_more(page)
        opened = True
    title = page.locator("[data-testid=chord-moves]").first.get_attribute("title") or ""
    check("chord moves tooltip explains the blue ring", "Blue ring = keep that key down." in title)
    if opened:
        close_more(page)
    missing = [i["key"] for i in raw(page) if not i["tip"]]
    if missing:
        print(f"    no tooltip: {missing[:10]}")
    check("every toolbar control has a tooltip", not missing)


def main():
    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp(CDP)
        page = browser.contexts[0].pages[0]
        try:
            page.get_by_role("button", name="Score", exact=True).click()
            page.wait_for_selector(LOOP, timeout=30000)
            tc.request("DELETE", "/loop")
            load("Toolbar still (e2e)", 8)
            time.sleep(1)
            for w, h in VIEWPORTS:
                per_viewport(page, w, h)
            once(page)
        finally:
            tc.request("DELETE", "/loop")
            set_viewport(page, 1920, 1080)
    print("FAILED: " + "; ".join(FAILS) if FAILS else "ALL PASS")
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
