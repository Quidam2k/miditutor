"""#11354 item 6 end-to-end check of Score > "Chord moves" against a RUNNING hidden app.

Launch the packaged app hidden and muted (see e2e_bare.py) with MIDITUTOR_PIECES_DIR=<scratch folder holding
a COPY of a chordal score>, then:
    MIDITUTOR_URL=http://127.0.0.1:47811 MIDITUTOR_TOKEN_FILE=<ud>/api-token MIDITUTOR_CDP=http://127.0.0.1:9347 \
      python scripts/e2e_chord_moves.py <title regex, e.g. sorcerer>
Turns chord moves on, checks the rings and tags match the screen report, saves screengrab/e2e-chord-moves.png,
and turns it off.
"""

import os
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from miditutor_mcp import tutor_client as tc  # noqa: E402

FAILS = []


def check(label, ok, detail=""):
    print(f"{'PASS' if ok else 'FAIL'}: {label}" + ("" if ok else f"  {detail}"))
    if not ok:
        FAILS.append(label)


def moves():
    return (tc.state().get("screen") or {}).get("chordMoves")


def main():
    title = sys.argv[1] if len(sys.argv) > 1 else "sorcerer"
    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp(os.environ["MIDITUTOR_CDP"])
        page = next(pg for c in browser.contexts for pg in c.pages if "devtools" not in pg.url)
        page.get_by_role("button", name="Score", exact=True).first.click()
        sel = page.locator("select").first
        sel.wait_for(timeout=15000)
        page.wait_for_function(
            "(t) => [...document.querySelector('select').options].some((o) => new RegExp(t, 'i').test(o.text))", arg=title, timeout=15000
        )
        value = sel.evaluate("(s, t) => [...s.options].find((o) => new RegExp(t, 'i').test(o.text)).value", title)
        sel.select_option(value)
        page.wait_for_function("() => document.querySelectorAll('.vf-notehead').length > 50", timeout=60000)
        page.wait_for_function("() => !!document.querySelector('[data-testid=chord-moves]:not([disabled])')", timeout=15000)
        time.sleep(1.5)
        if page.get_by_test_id("chord-moves").get_attribute("aria-pressed") == "true":  # left on by an earlier run
            page.get_by_test_id("chord-moves").click()
            time.sleep(0.3)
        page.get_by_test_id("chord-moves").click()
        page.get_by_test_id("chords-msg").wait_for(timeout=5000)
        time.sleep(0.5)
        m = moves() or {}
        check("screen reports chord moves", bool(m), m)
        check("the piece has chord changes", m.get("changes", 0) > 0, m)
        rings = page.get_by_test_id("chord-ring")
        check("a ring per reported note", rings.count() > 0 and rings.count() == m.get("rings"), (rings.count(), m))
        stay = page.locator("[data-testid=chord-ring][data-kind=stay]").count()
        move = page.locator("[data-testid=chord-ring][data-kind=move]").count()
        check("rings for notes that stay and notes that move", stay > 0 and move > 0, (stay, move))
        labels = page.locator("[data-testid=chord-ring][data-kind=move] text").evaluate_all("els => els.map((e) => e.textContent)")
        check("every moving note says how far", len(labels) == move and all(l[0] in "+-" for l in labels), labels[:10])
        tags = page.get_by_test_id("chord-tag").count()
        check("a tag per repeat or whole-hand shift (at most)", tags <= m.get("same", 0) + m.get("shifts", 0), (tags, m))
        msg = page.get_by_test_id("chords-msg").inner_text()
        check("message counts the changes", msg.startswith(f"{m.get('changes')} chord change"), msg)
        print("chord moves:", m, "| tags drawn:", tags, "| msg:", msg)
        (ROOT / "screengrab").mkdir(exist_ok=True)
        page.screenshot(path=str(ROOT / "screengrab" / "e2e-chord-moves.png"))
        page.get_by_test_id("chord-moves").click()
        time.sleep(0.3)
        check("off again: no rings, no report", page.get_by_test_id("chord-ring").count() == 0 and not moves())


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        FAILS.append(f"{type(exc).__name__}: {exc}")
    print("FAILED: " + "; ".join(FAILS) if FAILS else "ALL PASS")
    sys.exit(1 if FAILS else 0)
