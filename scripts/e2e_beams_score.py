"""#6612 end-to-end: beamed eighths on the Score view still play, judge and move the cursor right.

Against a RUNNING hidden, muted packaged app (memory hidden-test-copy-must-be-muted), with
MIDITUTOR_URL / MIDITUTOR_TOKEN_FILE / MIDITUTOR_CDP set. The fixture has no <beam>s (like his
OMR'd scores): bar 1 is eight eighths in 4/4 (two beams of four), bar 2 a 3/8 bar of three eighths
(one beam). Every note is played in order; none may be judged wrong, the cursor must reach bar 2,
and the drawn score must show beams (vf-beam groups), not flags.
"""

import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from miditutor_mcp import tutor_client as tc
from scripts.e2e_keep_going import FAILS, check, screen, wait_for

BAR1 = [("C", 4, 60), ("D", 4, 62), ("E", 4, 64), ("F", 4, 65), ("G", 4, 67), ("A", 4, 69), ("B", 4, 71), ("C", 5, 72)]
BAR2 = [("B", 4, 71), ("A", 4, 69), ("G", 4, 67)]


def fixture():
    def notes(items):
        return "".join(f"<note><pitch><step>{s}</step><octave>{o}</octave></pitch><duration>1</duration>"
                       f"<voice>1</voice><type>eighth</type></note>" for s, o, _ in items)
    attrs = ("<attributes><divisions>2</divisions><key><fifths>0</fifths></key>"
             "<time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>")
    return ('<?xml version="1.0" encoding="UTF-8"?><score-partwise version="3.1">'
            '<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">'
            f'<measure number="1">{attrs}{notes(BAR1)}</measure>'
            '<measure number="2"><attributes><time><beats>3</beats><beat-type>8</beat-type></time></attributes>'
            f'{notes(BAR2)}</measure></part></score-partwise>')


def main():
    from playwright.sync_api import sync_playwright

    wait_for(lambda: tc.state().get("rendererConnected"), 30)
    tc.load_piece("Beams (e2e)", fixture())
    wait_for(lambda: screen().get("status") == "ready" and screen().get("piece") == "Beams (e2e)", 30)
    with sync_playwright() as p:
        page = p.chromium.connect_over_cdp(os.environ["MIDITUTOR_CDP"]).contexts[0].pages[0]
        beams = page.locator("svg g.vf-beam").count()
        check(f"the score draws beams, not flags (vf-beam groups={beams}, want 3)", beams == 3)
    for i, (_, _, midi) in enumerate(BAR1 + BAR2):
        tc.inject([midi], kind="chord", hold_ms=120)
        time.sleep(0.35)
        fb = screen().get("feedback") or {}
        if fb.get("kind") == "wrong":
            check(f"note {i + 1} ({midi}) judged right", False)
            break
        if i == len(BAR1) - 1:
            check("after bar 1 the cursor is in bar 2", wait_for(lambda: screen().get("measure") == 2, 5))
    check("no wrong notes across the beamed bars", (screen().get("wrongCount") or 0) == 0)
    print("ALL PASS" if not FAILS else f"{len(FAILS)} FAIL: {FAILS}")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
