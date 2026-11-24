"""#6851/#6852 e2e: Two pages shows every system it holds, and Scroll's toolbar spans the window.

Drives the RUNNING hidden, muted test copy (recipe: memory hidden-test-copy-must-be-muted).
Pages (#6851): at his real window size (1200x772 inner, Pinocchio's saved 1200x800), after each spread turn
  * the spread sits at the top of the scroll area, so the whole page is above the keyboard strip
  * no ink (staff lines, text, fingering digits) hangs below its page or under the keyboard strip
  * every full page holds >= 3 systems (the old 320 px guess hid the third under the keyboard)
Scroll (#6852): the sticky toolbar is as wide as the main column, not a 768 px strip, in a 1920 px window.

Usage: python scripts/e2e_pages_fit.py [outdir]   (env: MIDITUTOR_URL, MIDITUTOR_CDP, MIDITUTOR_TOKEN_FILE)
"""
import os
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright
from e2e_backwards import FAILS, check, tc, tid
from e2e_page_turn import piece

MEASURE_JS = """() => {
  const panel = document.querySelector('[data-testid=score-panel]');
  const ks = document.querySelector('[data-testid=keyboard-strip]');
  const kbTop = ks ? ks.getBoundingClientRect().top : innerHeight;
  const main = document.querySelector('main');
  const pages = [];
  for (const d of panel.querySelectorAll('[id^=osmdCanvasPage]')) {
    if (!/^osmdCanvasPage\\d+$/.test(d.id) || getComputedStyle(d).visibility === 'hidden') continue;
    const r = d.getBoundingClientRect();
    const ink = Array.from(d.querySelectorAll('g.staffline, text')).map(g => g.getBoundingClientRect().bottom);
    pages.push({id: d.id, top: r.top, bottom: r.bottom, systems: d.querySelectorAll('g.vf-brace').length,
      inkBottom: ink.length ? Math.max(...ink) : 0});
  }
  const total = Array.from(panel.querySelectorAll('[id^=osmdCanvasPage]')).filter(d => /^osmdCanvasPage\d+$/.test(d.id)).length;
  return {kbTop, mainTop: main.getBoundingClientRect().top, pages, total};
}"""


def main() -> int:
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "screengrab")
    out.mkdir(parents=True, exist_ok=True)
    for _ in range(60):
        try:
            if tc.state()["rendererConnected"]:
                break
        except tc.TutorUnavailable:
            pass
        time.sleep(1)
    else:
        print("renderer never connected")
        return 1
    with sync_playwright() as p:
        page = p.chromium.connect_over_cdp(os.environ["MIDITUTOR_CDP"]).contexts[0].pages[0]
        page.set_viewport_size({"width": 1200, "height": 772})
        title = "Pages fit (e2e)"
        tc.load_piece(title, piece(title, [("C", 5), ("E", 5), ("G", 5), ("B", 4)],
                                   [("C", 3), ("G", 2), ("E", 3), ("C", 3)], bars=160))
        if not page.locator("[data-testid=bar-now]").count():
            page.get_by_role("button", name="Score", exact=True).click()
        page.wait_for_selector("[data-testid=bar-now]")
        # Scroll first, then Pages: opening Two pages is what must bring the spread to the top.
        # (Playwright scrolls a button into view before clicking it, so never click Pages while already in it.)
        tid(page, "layout-scroll").click()
        page.wait_for_timeout(2500)
        tid(page, "layout-pages").click()
        page.wait_for_timeout(4000)

        spreads = 0
        for i in range(4):
            m = page.evaluate(MEASURE_JS)
            check(len(m["pages"]) == 2, f"spread {i + 1}: two pages shown", f"got {len(m['pages'])}")
            for pg in m["pages"]:
                check(pg["bottom"] <= m["kbTop"] + 1, f"spread {i + 1} {pg['id']}: whole page above the keyboard",
                      f"page bottom {pg['bottom']:.0f} > keyboard top {m['kbTop']:.0f}")
                check(pg["inkBottom"] <= pg["bottom"] + 1, f"spread {i + 1} {pg['id']}: no ink below its page",
                      f"ink bottom {pg['inkBottom']:.0f} > page bottom {pg['bottom']:.0f}")
                last = pg["id"] == f"osmdCanvasPage{m['total']}"  # the last page holds whatever is left
                check(last or pg["systems"] >= 3, f"spread {i + 1} {pg['id']}: at least 3 systems", f"got {pg['systems']}")
                check(pg["top"] >= m["mainTop"], f"spread {i + 1} {pg['id']}: page top in view",
                      f"top {pg['top']:.0f} < scroll area top {m['mainTop']:.0f}")
            page.screenshot(path=str(out / f"pages-fit-spread{i + 1}.png"))
            spreads += 1
            page.keyboard.press("PageDown")
            page.wait_for_timeout(800)

        # The strip comes and goes: the pages are laid out again for the room that is left.
        box = page.get_by_label("Keyboard", exact=True)
        box.uncheck()
        page.wait_for_timeout(1500)
        box.check()
        page.wait_for_timeout(2500)
        page.keyboard.press("PageUp")  # (Playwright scrolled to the checkbox) bring the spread back to the top
        page.wait_for_timeout(800)
        m = page.evaluate(MEASURE_JS)
        check(m["kbTop"] < 700 and all(pg["bottom"] <= m["kbTop"] + 1 for pg in m["pages"]),
              "keyboard toggled off and on: pages still end above the strip", f"kbTop {m['kbTop']:.0f}, pages {[round(pg['bottom']) for pg in m['pages']]}")

        # #6852: Scroll at 1920 wide: the toolbar is not a half-width strip.
        page.set_viewport_size({"width": 1920, "height": 1080})
        tid(page, "layout-scroll").click()
        page.wait_for_timeout(3000)
        tb = page.evaluate("() => { const t = document.querySelector('[data-score-toolbar]').getBoundingClientRect(); "
                           "const m = document.querySelector('main').getBoundingClientRect(); return [t.width, m.width]; }")
        check(tb[0] > 1200, "scroll: toolbar spans the window", f"toolbar {tb[0]:.0f}px of main {tb[1]:.0f}px")
        page.screenshot(path=str(out / "pages-fit-scroll-1920.png"))
        tid(page, "layout-pages").click()
        page.wait_for_timeout(1500)
        page.set_viewport_size({"width": 1200, "height": 772})
    print(f"checked {spreads} spreads; {len(FAILS)} failure(s)")
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
