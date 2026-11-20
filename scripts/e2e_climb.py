"""#6530 C end-to-end: the tempo climb riding on Keep going, against a RUNNING hidden muted app
(see memory hidden-test-copy-must-be-muted; env MIDITUTOR_URL / MIDITUTOR_TOKEN_FILE / MIDITUTOR_CDP).

Two bars of quarters looped. Keep going at 100 (saved, so the climb starts there), Climb on,
target 100, reaction Quick. Lap 1 all right -> 'reached' (celebrate, thermometer full, green).
Lap 2 no notes -> 'down' one Quick step to 94, and lap 3 runs at 94. Stop -> climb gone.
The 'up' path needs 30+ s at a tempo; tests/tempoClimb.test.ts covers it.
"""

import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from miditutor_mcp import tutor_client as tc
from scripts.e2e_keep_going import FAILS, NOTES, check, events_since, fixture, play_at, screen, wait_for

BPM = 100


def main():
    cdp = os.environ["MIDITUTOR_CDP"]
    from playwright.sync_api import sync_playwright

    wait_for(lambda: tc.state().get("rendererConnected"), 30)
    seq = tc.state()["eventSeq"]
    tc.load_piece("Climb (e2e)", fixture())
    if not wait_for(lambda: events_since(seq, "piece"), 30):
        raise RuntimeError("piece never loaded")
    time.sleep(1.5)
    tc.request("POST", "/loop", {"firstBar": 1, "lastBar": 2})
    time.sleep(1)

    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp(cdp)
        page = next(pg for ctx in browser.contexts for pg in ctx.pages if "devtools" not in pg.url)
        page.get_by_test_id("practice-settings").click()
        page.get_by_test_id("climbReaction").select_option("quick")
        check("Roland click off by default", not page.get_by_test_id("rolandClick").is_checked())
        page.get_by_test_id("practice-settings").click()
        page.get_by_test_id("keep-bpm").fill(str(BPM))
        page.get_by_test_id("keep-bpm").blur()
        if not page.get_by_test_id("climb-on").is_checked():
            page.get_by_test_id("climb-on").check()
        page.get_by_test_id("climb-target").fill(str(BPM))
        page.get_by_test_id("climb-target").blur()
        time.sleep(0.3)
        check("screen climbTarget 100", screen().get("climbTarget") == BPM)

        seq = tc.state()["eventSeq"]
        page.get_by_test_id("keep-going").click()
        on = wait_for(lambda: [e for e in events_since(seq, "keep") if e.get("on") is True]) or [{}]
        start = on[0].get("startMs", time.time() * 1000 + 2000)
        climb_on = [e for e in events_since(seq, "climb") if e.get("on")]
        print("climb on:", climb_on)
        check("climb starts at 100 aiming for 100, quick, no Roland",
              bool(climb_on) and (climb_on[0].get("start"), climb_on[0].get("target"), climb_on[0].get("reaction"), climb_on[0].get("roland")) == (BPM, BPM, "quick", False))
        check("thermometer shown", page.get_by_test_id("climb-thermo").count() == 1)
        ro = page.get_by_test_id("click-readout").text_content() or ""
        check("readout shows tempo and the app click", ro == f"♩ {BPM} · click: app")

        beat_ms = 60000 / BPM
        for i, n in enumerate(NOTES):
            play_at(start + i * beat_ms + 60, n)
        reached = wait_for(lambda: [e for e in events_since(seq, "climb") if e.get("change")], 8) or [{}]
        print("lap 1 climb:", reached[0])
        check("clean lap at target -> reached", reached[0].get("change") == "reached")
        check("celebrate climb event", bool([e for e in events_since(seq, "celebrate") if e.get("what") == "climb"]))
        c = screen().get("climb") or {}
        check("screen climb reached, 100%", c.get("reached") is True and c.get("percent") == 100)
        check("summary says reached", "reached" in (page.get_by_test_id("keep-last").text_content() or ""))

        # Lap 2: nothing played -> a rough lap, down 6 (Quick).
        downs = wait_for(lambda: [e for e in events_since(seq, "climb") if e.get("change") == "down"], 10) or [{}]
        print("lap 2 climb:", downs[0])
        check("empty lap -> down to 94", downs[0].get("bpm") == BPM - 6)
        time.sleep(0.5)
        check("lap 3 runs at 94", "94" in (page.get_by_test_id("keep-status").text_content() or ""))
        check("screen climb bpm 94, still reached", (screen().get("climb") or {}).get("bpm") == 94 and (screen().get("climb") or {}).get("reached") is True)

        page.get_by_test_id("keep-going").click()
        time.sleep(0.5)
        check("stop clears the climb", screen().get("climb") is None and page.get_by_test_id("climb-thermo").count() == 0)
        check("readout stays after stop", (page.get_by_test_id("click-readout").text_content() or "").endswith("click: app"))

        # A new target below which it climbs: starts at his saved 94; a clean 5 s lap holds
        # (Quick needs 30 s at a tempo), and the old +4 rule must NOT fire while climbing.
        page.get_by_test_id("climb-target").fill("110")
        page.get_by_test_id("climb-target").blur()
        seq = tc.state()["eventSeq"]
        page.get_by_test_id("keep-going").click()
        on = wait_for(lambda: [e for e in events_since(seq, "keep") if e.get("on") is True]) or [{}]
        start, bpm2 = on[0].get("startMs", time.time() * 1000 + 2000), on[0].get("bpm")
        climb_on = [e for e in events_since(seq, "climb") if e.get("on")] or [{}]
        check("second climb starts at saved 94 aiming for 110", (bpm2, climb_on[0].get("start"), climb_on[0].get("target")) == (94, 94, 110))
        beat_ms = 60000 / 94
        for i, n in enumerate(NOTES):
            play_at(start + i * beat_ms + 60, n)
        laps = wait_for(lambda: [e for e in events_since(seq, "keep") if "lap" in e], 8) or [{}]
        changes = [e for e in events_since(seq, "climb") if e.get("change")] or [{}]
        print("clean lap below target:", laps[0], changes[0])
        check("clean lap counted", laps[0].get("hit") == 8)
        check("climb holds (needs 30 s), no +4 step", changes[0].get("change") == "hold" and laps[0].get("nextBpm") == 94)
        page.get_by_test_id("keep-going").click()
        # #6587: Roland click on with no piano here: it says so, the app clicks, and the failed write is logged.
        page.get_by_test_id("practice-settings").click()
        page.get_by_test_id("rolandClick").check()
        page.get_by_test_id("practice-settings").click()
        check("readout names Roland when chosen", (page.get_by_test_id("click-readout").text_content() or "").endswith("click: Roland"))
        seq = tc.state()["eventSeq"]
        page.get_by_test_id("keep-going").click()
        wait_for(lambda: [e for e in events_since(seq, "keep") if e.get("on") is True])
        rl = wait_for(lambda: [e for e in events_since(seq, "roland")]) or [{}]
        print("roland event:", rl[0])
        check("roland event logged, failed, with port info", rl[0].get("param") == "tempo" and rl[0].get("ok") is False and bool(rl[0].get("error")))
        check("readout says Roland not found, app clicking", (page.get_by_test_id("click-readout").text_content() or "").endswith("Roland not found (app clicking)"))
        check("screen carries the readout", "Roland not found" in (screen().get("clickReadout") or ""))
        page.get_by_test_id("keep-going").click()
        page.get_by_test_id("practice-settings").click()
        page.get_by_test_id("rolandClick").uncheck()
        page.get_by_test_id("practice-settings").click()
        page.get_by_test_id("climb-on").uncheck()
        browser.close()

    print("passed" if not FAILS else f"failed: {FAILS}")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
