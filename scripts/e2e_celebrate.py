"""#5521 end-to-end check of the clean-run celebrations against the RUNNING app.

Start a hidden, MUTED app with inject and a debug port (memory: hidden-test-copy-must-be-
muted; never without --mute-audio on Solace), then:
    MIDITUTOR_URL=http://127.0.0.1:47811 MIDITUTOR_CDP=http://127.0.0.1:9347 python scripts/e2e_celebrate.py

Minuet in G with the Glow wave turned on. A clean lap of bars 2-3 reports a 'celebrate'
event (chime + wave) and draws the wave; a lap with a wrong note gets nothing. Build
backwards on bars 2-3 reaches its target with a 'small' finale (2 bars) and a wave.
"""
from __future__ import annotations

import os
import sys
import time

from playwright.sync_api import sync_playwright

from e2e_backwards import FAILS, SCORE, check, play_lap, screen, strike, tc


def celebrations(seq: int) -> list[dict]:
    events = tc.request("GET", f"/events?since={seq}&limit=2000")["events"]
    return [e for e in events if e.get("kind") == "celebrate"]


def spoiled(seq: int) -> list[dict]:
    events = tc.request("GET", f"/events?since={seq}&limit=2000")["events"]
    return [e for e in events if e.get("kind") == "lap-spoiled"]


def dots(page) -> int:
    return page.eval_on_selector_all("[data-wave-dot]", "els => els.length")


def main() -> int:
    for _ in range(60):
        try:
            if tc.state().get("rendererConnected"):
                break
        except tc.TutorUnavailable:
            pass
        time.sleep(1)
    else:
        sys.exit("app not reachable / renderer not connected")
    cdp = os.environ.get("MIDITUTOR_CDP") or sys.exit("set MIDITUTOR_CDP")

    tc.load_piece("Celebrate (e2e)", SCORE.read_text(encoding="utf-8"))
    time.sleep(3)
    with sync_playwright() as p:
        page = p.chromium.connect_over_cdp(cdp).contexts[0].pages[0]
        page.click("[data-testid=practice-settings]")
        page.check("[data-testid=celebrateWave]")
        page.check("[data-testid=celebrateChime]")
        page.check("[data-testid=celebrateFinale]")
        page.click("[data-testid=practice-settings]")

        tc.request("POST", "/loop", {"firstBar": 2, "lastBar": 3})
        time.sleep(1)
        seq = tc.state()["eventSeq"]
        play_lap()
        time.sleep(0.25)
        n = dots(page)
        got = celebrations(seq)
        check(len(got) == 1 and got[0].get("chime") and got[0].get("wave"), "clean lap: chime + wave reported", got)
        check(n > 0, "clean lap: the wave is drawn", n)
        check(spoiled(seq) == [], "clean lap: no miss tick", spoiled(seq))

        time.sleep(2.5)
        check(dots(page) == 0, "the wave clears itself", dots(page))
        seq = tc.state()["eventSeq"]
        strike([30])  # #5566: two wrong notes in one lap (this, and play_lap's own)
        time.sleep(0.3)
        play_lap(wrong=True)
        time.sleep(0.3)
        check(celebrations(seq) == [], "a lap with a wrong note: no celebration", celebrations(seq))
        got = spoiled(seq)
        # #5799: every wrong note thuds, not just the first of the lap (two wrongs 300 ms apart here).
        check(len(got) == 2 and all(e.get("sound") is True for e in got), "#5799: a miss sound for each wrong note", got)
        check(sum(1 for e in got if e.get("first")) == 1, "#5799: only the first is flagged first", got)
        # #11561: reached the speakers, not just asked for: the audio context was running with no click first.
        check(got and all(e.get("audio") == "running" for e in got), "#11561: the miss sounds played with the audio context running", got)

        tc.request("POST", "/loop", {"firstBar": 2, "lastBar": 3, "backwards": True})
        time.sleep(1)
        seq = tc.state()["eventSeq"]
        for _ in range(12):
            s = screen()
            if (s.get("backwards") or {}).get("done"):
                break
            play_lap()
        time.sleep(0.25)
        finale = [e for e in celebrations(seq) if e.get("what") == "finale"]
        check(len(finale) == 1 and finale[0].get("size") == "small" and finale[0].get("bars") == 2, "target reached: a small finale", finale)
        check(dots(page) > 0, "the finale's wave is drawn", dots(page))
        tc.request("DELETE", "/loop")

    print("ALL PASS" if not FAILS else f"{len(FAILS)} FAILED: {FAILS}")
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
