"""#10262 end-to-end check on a hidden Electron app: Sight-read picks, parks his drill, and writes no score.

Start the app on scratch dirs:
    python scripts/e2e_sight_read.py seed <pieces-dir>
    MIDITUTOR_HIDDEN=1 MIDITUTOR_TEST_SESSION=1 MIDITUTOR_WINDOW_SIZE=1400x900 MIDITUTOR_PORT=47812 \
      MIDITUTOR_VITE_PORT=5183 MIDITUTOR_PIECES_DIR=<pieces-dir> \
      npx electron-forge start -- --remote-debugging-port=9346 --user-data-dir=<scratch>
then, with MIDITUTOR_URL=http://127.0.0.1:47812, MIDITUTOR_TOKEN_FILE=<scratch>/api-token and
MIDITUTOR_CDP=http://127.0.0.1:9346:
    python scripts/e2e_sight_read.py run <pieces-dir>
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from miditutor_mcp import tutor_client as tc  # noqa: E402

CDP = os.environ.get("MIDITUTOR_CDP", "http://127.0.0.1:9346")
SHOTS = ROOT / "screengrab"
FAILS: list[str] = []
DRILL = "Drill Piece"


def check(cond, label, detail="") -> None:
    print(("PASS " if cond else "FAIL ") + label + ("" if cond else f"  {detail}"))
    if not cond:
        FAILS.append(label)


def piece_xml(title: str, notes_per_bar: int, bars: int = 16) -> str:
    """Two staves, a note in each hand on every beat used, so either hand has steps in every bar."""
    dur = 4 // notes_per_bar
    def staff(pitch: str, octave: int, staff_no: int) -> str:
        return (f"<note><pitch><step>{pitch}</step><octave>{octave}</octave></pitch><duration>{dur}</duration>"
                f"<voice>{staff_no}</voice><type>{ {1: 'quarter', 2: 'half', 4: 'whole'}[dur] }</type><staff>{staff_no}</staff></note>")
    measures = []
    for m in range(1, bars + 1):
        attrs = ("<attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time>"
                 "<staves>2</staves><clef number=\"1\"><sign>G</sign><line>2</line></clef><clef number=\"2\"><sign>F</sign><line>4</line></clef></attributes>") if m == 1 else ""
        right = "".join(staff("CDEG"[i % 4], 5, 1) for i in range(notes_per_bar))
        left = "".join(staff("CGEG"[i % 4], 3, 2) for i in range(notes_per_bar))
        measures.append(f'<measure number="{m}">{attrs}{right}<backup><duration>4</duration></backup>{left}</measure>')
    return ('<?xml version="1.0" encoding="UTF-8"?><score-partwise version="3.1">'
            f"<work><work-title>{title}</work-title></work>"
            '<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>'
            f'<part id="P1">{"".join(measures)}</part></score-partwise>')


def seed(pieces: Path) -> None:
    pieces.mkdir(parents=True, exist_ok=True)
    for title, density in [(DRILL, 4), ("Sparse One", 1), ("Sparse Two", 1), ("Middle", 2), ("Busy A", 4), ("Busy B", 4)]:
        (pieces / f"{title.lower().replace(' ', '-')}.musicxml").write_text(piece_xml(title, density), encoding="utf-8")


def files_hash(pieces: Path) -> dict[str, str]:
    return {f.name: hashlib.sha256(f.read_bytes()).hexdigest() for f in sorted(pieces.rglob("*")) if f.is_file()}


def screen() -> dict:
    return tc.request("GET", "/state")["screen"]


def settings(page) -> dict:
    return json.loads(page.evaluate("() => localStorage.getItem('miditutor-settings')"))["state"]


def strike(note: int) -> None:
    for kind in ("noteon", "noteoff"):
        tc.request("POST", "/inject", {"notes": [note], "kind": kind, "velocity": 64})


def sight_read(page) -> dict:
    page.get_by_test_id("sight-read").click()
    page.wait_for_function(
        "() => /bars \\d+-\\d+/.test(document.querySelector('[data-testid=sight-msg]')?.innerText ?? '')", timeout=20000
    )
    page.wait_for_timeout(800)
    return screen()


def run(pieces: Path) -> None:
    before = files_hash(pieces)
    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp(CDP)
        page = browser.contexts[0].pages[0]
        page.on("pageerror", lambda e: print("pageerror:", e))
        page.wait_for_timeout(1500)
        page.get_by_role("button", name="Score", exact=True).click()
        page.wait_for_selector("[data-testid=sight-read]", timeout=30000)
        select = page.locator("select").first
        page.wait_for_function(f"() => [...document.querySelector('select').options].some((o) => o.text.includes('{DRILL}'))", timeout=15000)
        select.select_option(label=next(o for o in select.locator("option").all_inner_texts() if DRILL in o))
        page.wait_for_timeout(1500)

        # His drill: right hand, Build backwards on bars 5-12, a few notes along it.
        page.get_by_test_id("hand-right").click()
        page.wait_for_timeout(500)
        res = tc.request("POST", "/loop", {"firstBar": 5, "lastBar": 12, "backwards": True})
        check("error" not in res, "drill loop set", res)
        page.wait_for_timeout(800)
        # The right hand's C5 D5 E5 G5, repeating; Build backwards starts on bar 12. And one wrong key.
        for note in (72, 74, 76, 30):
            strike(note)
            page.wait_for_timeout(150)
        page.wait_for_timeout(900)
        drill = screen()
        print("drill:", {k: drill.get(k) for k in ("piece", "hand", "loop", "backwards", "measure", "remaining", "wrongCount")})
        check(drill.get("backwards"), "Build backwards is on", drill)
        check(drill.get("measure") == 12 and drill.get("wrongCount") == 1, "the drill is under way", drill)
        loops_before = dict(settings(page).get("pieceLoops", {}))

        # Sight-read: another piece, one hand, 5-8 bars, the sparse third first.
        picked = sight_read(page)
        print("picked:", picked.get("piece"), picked.get("hand"), picked.get("loop"))
        check(DRILL not in str(picked.get("piece")), "a different piece", picked)
        check("Sparse" in str(picked.get("piece")), "with none marked, a sparse piece", picked)
        check(picked.get("hand") in ("right", "left"), "one hand", picked)
        loop = picked.get("loop") or {}
        span = loop.get("lastBar", 0) - loop.get("firstBar", 0) + 1
        check(5 <= span <= 8, "5-8 bars", loop)
        check(not picked.get("backwards"), "no Build backwards on the new piece", picked)
        check(settings(page).get("pieceLoops", {}) == loops_before, "his saved per-piece loops are untouched")
        check(page.get_by_test_id("sight-back").inner_text() == f"Back to {DRILL}", "offers the way back")
        page.screenshot(path=str(SHOTS / "sight_read.png"))

        # Again: never the one on screen, and the parked drill is still his, not this one.
        again = sight_read(page)
        print("again:", again.get("piece"), again.get("hand"), again.get("loop"))
        check(again.get("piece") != picked.get("piece"), "pressing again gives another piece", again)
        parked = settings(page).get("parkedDrills", {})
        check(len(parked) == 1 and DRILL in next(iter(parked.values()))["pieceLabel"], "only his drill is parked", parked)

        # Back: everything returns.
        page.get_by_test_id("sight-back").click()
        page.wait_for_function(f"() => document.querySelector('[data-testid=sight-back]') === null", timeout=20000)
        page.wait_for_timeout(1500)
        back = screen()
        print("back:", {k: back.get(k) for k in ("piece", "hand", "loop", "backwards", "measure", "remaining", "wrongCount")})
        for field in ("piece", "hand", "loop", "backwards", "measure", "remaining", "wrongCount"):
            check(back.get(field) == drill.get(field), f"return restores {field}", (back.get(field), drill.get(field)))
        check(not settings(page).get("parkedDrills"), "nothing left parked")

        # His mark wins over the fallback, and a favorite is skipped.
        select.select_option(label=next(o for o in select.locator("option").all_inner_texts() if "Busy A" in o))
        page.wait_for_timeout(1500)
        check(screen().get("hand") == "right", "an ordinary piece switch keeps the hand as before", screen().get("hand"))
        page.get_by_test_id("simple-mark").click()
        select.select_option(label=next(o for o in select.locator("option").all_inner_texts() if DRILL in o))
        page.wait_for_timeout(1500)
        marked = sight_read(page)
        check("Busy A" in str(marked.get("piece")), "a piece he marked simple comes first", marked)

        # A relaunch in the middle: the drill is still parked, and still comes back.
        page.get_by_test_id("hand-both").wait_for(timeout=5000)
        parked_before = settings(page).get("parkedDrills")
        page.reload()
        page.wait_for_selector("[data-testid=sight-back]", timeout=30000)
        check(settings(page).get("parkedDrills") == parked_before, "a reload keeps what's parked")
        page.get_by_test_id("sight-back").click()
        page.wait_for_function("() => document.querySelector('[data-testid=sight-back]') === null", timeout=20000)
        page.wait_for_timeout(1500)
        check(DRILL in str(screen().get("piece")), "back after a reload", screen().get("piece"))

    after = files_hash(pieces)
    check(before == after, "no score file was written", {k: (before.get(k), after.get(k)) for k in set(before) | set(after) if before.get(k) != after.get(k)})


def main() -> int:
    if len(sys.argv) != 3 or sys.argv[1] not in ("seed", "run"):
        sys.exit(__doc__)
    pieces = Path(sys.argv[2]).resolve()
    {"seed": seed, "run": run}[sys.argv[1]](pieces)
    if sys.argv[1] == "run":
        print(f"\n{len(FAILS)} failed" if FAILS else "\nall passed")
    return 1 if FAILS else 0


if __name__ == "__main__":
    raise SystemExit(main())
