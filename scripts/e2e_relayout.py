"""#6531 e2e: flipping the layout (P, Strip/Pages/Scroll) keeps his loop, place, lap and drill.

Before the fix, any layout change re-ran the score load, which cleared his selected loop bars.
Drives the RUNNING hidden, muted test copy (recipe: memory hidden-test-copy-must-be-muted):
loads a 160-bar piece, starts Build backwards on bars 10-12, plays one lap, then checks the loop
survives Strip -> Pages (P) -> Strip (P) -> Scroll, that Pages shades the loop on the visible
spread and shows the cursor there, and that each flip logs a 'relayout' event, not a new piece.

Usage: python scripts/e2e_relayout.py [outdir]   (env: MIDITUTOR_URL, MIDITUTOR_CDP, MIDITUTOR_TOKEN_FILE)
"""
import os
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright
from e2e_backwards import FAILS, check, play_lap, screen, tc, tid
from e2e_page_turn import CURSOR_JS, VISIBLE_JS, blur, piece

# Loop bands that overlap a visible page div (Pages hides the other spreads).
BANDS_ON_SPREAD_JS = """() => {
  const pages = Array.from(document.querySelectorAll('[data-testid=score-panel] *'))
    .filter(e => /^osmdCanvasPage\\d+$/.test(e.id) && getComputedStyle(e).visibility !== 'hidden')
    .map(e => e.getBoundingClientRect());
  const bands = Array.from(document.querySelectorAll('[data-testid=loop-band]')).map(b => b.getBoundingClientRect());
  const on = bands.filter(b => pages.some(p => b.left < p.right && b.right > p.left && b.top < p.bottom && b.bottom > p.top));
  return { bands: bands.length, onSpread: on.length };
}"""


def kept(page, what: str, want: dict) -> None:
    s = screen()
    loop = s.get("loop") or {}
    got = {"first": loop.get("firstBar"), "last": loop.get("lastBar"), "lap": loop.get("lap"),
           "backwards": bool(s.get("backwards")), "measure": s.get("measure")}
    check(got == want, f"{what}: loop/lap/drill/place kept", f"want {want}, got {got}")
    check(page.locator("[data-testid=loop-band]").count() > 0, f"{what}: loop shaded", "no loop-band")


def flip(page, how: str) -> None:
    if how == "p":
        blur(page)
        page.keyboard.press("p")
    else:
        tid(page, f"layout-{how}").click()
    page.wait_for_timeout(3000)


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
        page.set_viewport_size({"width": 1920, "height": 1080})
        title = "Relayout (e2e)"
        seq = tc.state()["eventSeq"]
        tc.load_piece(title, piece(title, [("C", 5), ("E", 5), ("G", 5), ("B", 4)],
                                   [("C", 3), ("G", 2), ("E", 3), ("C", 3)], bars=160))
        for _ in range(40):
            if any(e.get("kind") == "piece" for e in tc.request("GET", f"/events?since={seq}&limit=2000")["events"]):
                break
            time.sleep(0.5)
        page.get_by_role("button", name="Score", exact=True).click()
        page.wait_for_selector("[data-testid=bar-now]")
        flip(page, "strip")

        tc.request("POST", "/loop", {"firstBar": 10, "lastBar": 12, "backwards": True})
        page.wait_for_timeout(1500)
        s = play_lap()
        loop = s.get("loop") or {}
        want = {"first": loop.get("firstBar"), "last": loop.get("lastBar"), "lap": loop.get("lap"),
                "backwards": bool(s.get("backwards")), "measure": s.get("measure")}
        check(want["first"] is not None and want["backwards"], "drill running before the flip", s)
        seq = tc.state()["eventSeq"]

        flip(page, "p")
        check(screen().get("scoreLayout") == "pages", "P -> Pages", screen().get("scoreLayout"))
        kept(page, "Pages", want)
        spread = page.evaluate(BANDS_ON_SPREAD_JS)
        check(spread["onSpread"] > 0, "Pages: loop shaded on the visible spread", spread)
        cp, vp = page.evaluate(CURSOR_JS), page.evaluate(VISIBLE_JS)
        check(cp in vp, "Pages: green cursor on the visible spread", f"cursor page={cp} visible={vp}")
        page.screenshot(path=str(out / "relayout-pages.png"))

        flip(page, "p")
        check(screen().get("scoreLayout") == "strip", "P -> back to Strip", screen().get("scoreLayout"))
        kept(page, "Strip", want)
        flip(page, "scroll")
        kept(page, "Scroll", want)

        kinds = [e.get("kind") for e in tc.request("GET", f"/events?since={seq}&limit=2000")["events"]]
        check(kinds.count("relayout") >= 3, "each flip logs 'relayout'", kinds)
        check("spot" not in kinds, "a flip is not a new open (no spot check)", kinds)
        s = play_lap()
        check((s.get("loop") or {}).get("lap") == want["lap"] + 1, "laps keep counting after the flips", s.get("loop"))
        flip(page, "strip")
    print("FAILS:", FAILS)
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
