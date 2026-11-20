"""#6587 meter end-to-end: Keep going's click follows the score's own time signature, against a
RUNNING hidden muted app (env MIDITUTOR_URL / MIDITUTOR_TOKEN_FILE / MIDITUTOR_CDP).

A 3/4 piece, two bars looped, ♩ = 120, the app's click (window.__clickLog records its pitches:
96 = the bar's accent, 91 = the other beats). The count-in is 3 clicks, then each bar is
accent + 2. A 6/8 piece with the Roland box ticked says "app clicking: 6/8 piece" and clicks
by the app. Climb forces a click on for its run without changing his Click setting.
"""

import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from miditutor_mcp import tutor_client as tc
from scripts.e2e_keep_going import FAILS, check, events_since, screen, wait_for

BPM = 150  # 400 ms a beat


def score(sig_beats, sig_type, bars):
    def bar(n, attrs=""):
        notes = "".join(
            f"<note><pitch><step>{s}</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>"
            for s in "CDEFGAB"[: sig_beats]
        )
        return f'<measure number="{n}">{attrs}{notes}</measure>'

    attrs = ("<attributes><divisions>1</divisions><key><fifths>0</fifths></key>"
             f"<time><beats>{sig_beats}</beats><beat-type>{sig_type}</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>")
    return ('<?xml version="1.0" encoding="UTF-8"?><score-partwise version="3.1">'
            '<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">'
            + "".join(bar(i + 1, attrs if i == 0 else "") for i in range(bars)) + "</part></score-partwise>")


def main():
    cdp = os.environ["MIDITUTOR_CDP"]
    from playwright.sync_api import sync_playwright

    wait_for(lambda: tc.state().get("rendererConnected"), 30)
    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp(cdp)
        page = next(pg for ctx in browser.contexts for pg in ctx.pages if "devtools" not in pg.url)

        def load(label, xml):
            seq = tc.state()["eventSeq"]
            tc.load_piece(label, xml)
            if not wait_for(lambda: events_since(seq, "piece"), 30):
                raise RuntimeError("piece never loaded")
            time.sleep(1.5)
            tc.request("POST", "/loop", {"firstBar": 1, "lastBar": 2})
            time.sleep(1)
            page.get_by_test_id("keep-bpm").fill(str(BPM))
            page.get_by_test_id("keep-bpm").blur()

        def run(seconds):
            page.evaluate("window.__clickLog = []")
            page.get_by_test_id("keep-going").click()
            time.sleep(seconds)
            log = page.evaluate("window.__clickLog")
            page.get_by_test_id("keep-going").click()
            time.sleep(0.5)
            return log

        # 3/4: count-in 3, then accent + 2 per bar (2 bars = 6 beats = 2.4 s).
        load("Meter 3/4 (e2e)", score(3, 4, 2))
        if page.get_by_test_id("climb-on").is_checked():
            page.get_by_test_id("climb-on").uncheck()
        log = run(1.2 + 2.4 + 1.0)  # count-in 1.2 s + a lap + into lap 2
        print("3/4 clicks:", log)
        check("3/4: count-in then accents every third click", log[:9] == [96, 91, 91, 96, 91, 91, 96, 91, 91])

        # 6/8: Roland ticked but no piano, and not 4/4 anyway: says why, the app clicks, no Roland write.
        load("Meter 6/8 (e2e)", score(6, 8, 2))
        page.get_by_test_id("practice-settings").click()
        page.get_by_test_id("rolandClick").check()
        page.get_by_test_id("keepClick").uncheck()  # Roland on + Click off: the app must still click when the Roland can't
        page.get_by_test_id("practice-settings").click()
        seq = tc.state()["eventSeq"]
        log = run(1.2 + 1.5)
        print("6/8 clicks:", log, screen().get("clickReadout"))
        check("6/8: accent every third quarter", log[:6] == [96, 91, 91, 96, 91, 91])
        check("6/8 + Roland box: no Roland write was tried", not events_since(seq, "roland"))
        page.get_by_test_id("keep-going").click()
        time.sleep(0.3)
        text = page.get_by_test_id("click-readout").text_content() or ""
        check("readout says app clicking: 6/8 piece", text.endswith("app clicking: 6/8 piece") or "6/8" in (screen().get("clickReadout") or ""))
        page.get_by_test_id("keep-going").click()
        page.get_by_test_id("practice-settings").click()
        page.get_by_test_id("rolandClick").uncheck()
        page.get_by_test_id("keepClick").check()
        page.get_by_test_id("practice-settings").click()

        # Climb with his Click setting OFF: the run still clicks, and the setting is left off.
        load("Meter 3/4 again (e2e)", score(3, 4, 2))
        page.get_by_test_id("practice-settings").click()
        page.get_by_test_id("keepClick").uncheck()
        page.get_by_test_id("practice-settings").click()
        page.get_by_test_id("climb-on").check()
        log = run(1.5)
        print("climb, click setting off:", log)
        check("climb clicks even with Click off", len(log) >= 3)
        page.get_by_test_id("practice-settings").click()
        check("his Click setting is still off afterwards", not page.get_by_test_id("keepClick").is_checked())
        page.get_by_test_id("keepClick").check()
        page.get_by_test_id("practice-settings").click()
        page.get_by_test_id("climb-on").uncheck()
        browser.close()

    print("passed" if not FAILS else f"failed: {FAILS}")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
