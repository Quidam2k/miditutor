"""#6425 end-to-end check: "Play it for me" holds tied chords their full tied length.

Launch a packaged, muted, hidden copy (memory hidden-test-copy-must-be-muted), then run with
MIDITUTOR_URL / MIDITUTOR_TOKEN_FILE / MIDITUTOR_CDP set. Loads his Sorcerer's Apprentice
(read only), loops bars 21-41, plays one lap and reads window.__playLog.

Bars 31-32: G3 Eb3 B2 tied, 1.5 + 0.5 = 2 beats. Bars 33-35: F3 Ab3 B3 tied over three bars,
3 x 1.5 = 4.5 beats. Before the fix each sounded only until the next step.
"""

import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from miditutor_mcp import tutor_client as tc

FAILS = []
SCORE = Path.home() / "MidiTutor Pieces" / "sorcerers-apprentice.musicxml"


def check(label, condition, detail=""):
    print(f"{'PASS' if condition else 'FAIL'}: {label}" + ("" if condition else f"  {detail}"))
    if not condition:
        FAILS.append(label)


def screen():
    return tc.state().get("screen") or {}


def events_since(seq, kind):
    return [e for e in tc.request("GET", f"/events?since={seq}&limit=5000")["events"] if e.get("kind") == kind]


def wait_for(fn, timeout=15):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        got = fn()
        if got:
            return got
        time.sleep(0.1)
    return None


def main():
    from playwright.sync_api import sync_playwright

    wait_for(lambda: tc.state().get("rendererConnected"), 30)
    seq = tc.state()["eventSeq"]
    tc.load_piece("Sorcerer tied (e2e)", SCORE.read_text(encoding="utf-8"))
    if not wait_for(lambda: events_since(seq, "piece"), 30):
        raise RuntimeError("piece never loaded")
    time.sleep(2)
    tc.request("POST", "/loop", {"firstBar": 21, "lastBar": 41})
    time.sleep(1)

    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp(os.environ["MIDITUTOR_CDP"])
        page = next(pg for ctx in browser.contexts for pg in ctx.pages if "devtools" not in pg.url)
        page.evaluate("window.__playLog = []")
        seq = tc.state()["eventSeq"]
        page.get_by_test_id("watch").click()
        on = wait_for(lambda: [e.get("data", e) for e in events_since(seq, "watch") if e.get("data", e).get("on")])
        bpm = on[0]["bpm"] if on else 80
        print("bpm", bpm)
        # One lap: the cursor reaches bar 41, then wraps back to 21.
        check("reached bar 41", wait_for(lambda: screen().get("measure", 0) >= 41, 120))
        check("wrapped to bar 21", wait_for(lambda: screen().get("measure") == 21, 30))
        log = page.evaluate("window.__playLog")
        page.get_by_test_id("watch").click()
        browser.close()

    beats = lambda e: round(e["duration"] * bpm / 60, 3)
    print("entries", len(log))

    def find(chord):
        return [beats(e) for e in log if set(chord) <= set(e["notes"])]

    a = find([55, 51, 47])
    b = find([53, 56, 59])
    print("bars 31-32 chord:", a, "bars 33-35 chord:", b)
    check("bars 31-32 tied chord struck once, 2 beats", a == [2.0], a)
    check("bars 33-35 tied chord struck once, 4.5 beats", b == [4.5], b)
    check("no note has zero or negative length", all(beats(e) > 0 for e in log))


if __name__ == "__main__":
    main()
    print("FAILED: " + ", ".join(FAILS) if FAILS else "ALL PASS")
    sys.exit(1 if FAILS else 0)
