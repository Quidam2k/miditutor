"""#5652 K end-to-end check of Keep going against a RUNNING hidden app.

Launch a packaged, muted, hidden copy (see memory hidden-test-copy-must-be-muted), then run
with MIDITUTOR_URL / MIDITUTOR_TOKEN_FILE / MIDITUTOR_CDP set (see e2e_blocking.py).

Two bars of quarters (C D E F | G A B C) looped at 120: a bar of count-in, then lap 1 with one
note left out and one wrong note (not clean, tempo stays), lap 2 all right (tempo +4), then a lap
with no notes at all, and the cursor must still cross into bar 2 on its own.
"""

import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from miditutor_mcp import tutor_client as tc

FAILS = []
NOTES = [60, 62, 64, 65, 67, 69, 71, 72]
BPM = 120
BEAT_S = 60 / BPM


def check(label, condition):
    print(f"{'PASS' if condition else 'FAIL'}: {label}")
    if not condition:
        FAILS.append(label)


def send(kind, note):
    tc.request("POST", "/inject", {"notes": [note], "kind": kind, "velocity": 64})


def screen():
    return tc.state().get("screen") or {}


def fixture():
    def bar(number, notes, attrs=""):
        body = "".join(
            f"<note><pitch><step>{s}</step><octave>{o}</octave></pitch><duration>1</duration><type>quarter</type></note>"
            for s, o in notes
        )
        return f'<measure number="{number}">{attrs}{body}</measure>'

    attrs = ("<attributes><divisions>1</divisions><key><fifths>0</fifths></key>"
             "<time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>")
    return ('<?xml version="1.0" encoding="UTF-8"?><score-partwise version="3.1">'
            '<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">'
            + bar(1, [("C", 4), ("D", 4), ("E", 4), ("F", 4)], attrs)
            + bar(2, [("G", 4), ("A", 4), ("B", 4), ("C", 5)])
            + "</part></score-partwise>")


def events_since(seq, kind):
    return [e for e in tc.request("GET", f"/events?since={seq}&limit=5000")["events"] if e.get("kind") == kind]


def wait_for(fn, timeout=15):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        got = fn()
        if got:
            return got
        time.sleep(0.05)
    return None


def play_at(when_ms, note):
    delay = when_ms / 1000 - time.time()
    if delay > 0:
        time.sleep(delay)
    send("noteon", note)
    time.sleep(0.05)
    send("noteoff", note)


def main():
    cdp = os.environ["MIDITUTOR_CDP"]
    from playwright.sync_api import sync_playwright

    wait_for(lambda: tc.state().get("rendererConnected"), 30)
    seq = tc.state()["eventSeq"]
    tc.load_piece("Keep going (e2e)", fixture())
    if not wait_for(lambda: events_since(seq, "piece"), 30):
        raise RuntimeError("piece never loaded")
    time.sleep(1.5)
    tc.request("POST", "/loop", {"firstBar": 1, "lastBar": 2})
    time.sleep(1)

    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp(cdp)
        page = next(pg for ctx in browser.contexts for pg in ctx.pages if "devtools" not in pg.url)
        page.get_by_test_id("keep-bpm").fill(str(BPM))
        page.get_by_test_id("keep-bpm").blur()
        seq = tc.state()["eventSeq"]
        page.get_by_test_id("keep-going").click()

        on = wait_for(lambda: [e for e in events_since(seq, "keep") if e.get("data", e).get("on") is True])
        check("keep on event", bool(on))
        data = on[0].get("data", on[0]) if on else {}
        start = data.get("startMs", time.time() * 1000 + 2000)
        check("keep at 120", data.get("bpm") == BPM)
        check("count-in shown", "Count-in" in (page.get_by_test_id("keep-status").text_content() or ""))
        check("follower hints off", screen().get("keep") is not None)

        beat_ms = BEAT_S * 1000
        # Lap 1: leave out B4 (step 6), add a wrong C#4 in bar 1.
        for i, n in enumerate(NOTES):
            if i == 6:
                continue
            play_at(start + i * beat_ms + 60, n)
            if i == 1:
                play_at(start + i * beat_ms + 250, 61)
        lap2 = start + 8 * beat_ms
        for i, n in enumerate(NOTES):
            play_at(lap2 + i * beat_ms + 60, n)

        laps = wait_for(lambda: (lambda ls: ls if len(ls) >= 2 else None)(
            [e.get("data", e) for e in events_since(seq, "keep") if "lap" in e.get("data", e)]), 10) or []
        l1 = laps[0] if laps else {}
        l2 = laps[1] if len(laps) > 1 else {}
        if len(laps) < 2 or laps[0].get("hit") != 7 or laps[1].get("hit") != 8:
            print("FAIL-INFO lap events:", laps, "status:", page.get_by_test_id("keep-status").text_content() if page.get_by_test_id("keep-status").count() else None)
        check("lap 1 tally", (l1.get("notes"), l1.get("hit"), l1.get("missed"), l1.get("wrong")) == (8, 7, 1, 1))
        check("lap 1 worst bar is 2 or 1 (one each)", {b["bar"] for b in l1.get("worstBars", [])} == {1, 2})
        check("lap 1 not clean: same tempo", l1.get("nextBpm") == BPM)
        check("lap 2 clean", (l2.get("hit"), l2.get("wrong")) == (8, 0))
        check("lap 2 steps up to 124", l2.get("nextBpm") == BPM + 4)
        check("summary line shown", "Lap 2 at" in (page.get_by_test_id("keep-last").text_content() or ""))

        # Lap 3 at 124: no notes, the cursor still reaches bar 2.
        lap3 = lap2 + 8 * beat_ms
        bar2 = lap3 + 4 * (60000 / (BPM + 4)) + 300
        time.sleep(max(0, bar2 / 1000 - time.time()))
        check("cursor moves without him", screen().get("measure") == 2)
        check("lap 3 runs at 124", "124" in (page.get_by_test_id("keep-status").text_content() or ""))

        page.get_by_test_id("keep-going").click()
        time.sleep(0.5)
        check("stop event", any(e.get("data", e).get("on") is False for e in events_since(seq, "keep")))
        check("stopped", page.get_by_test_id("keep-status").count() == 0)
        check("tempo kept at 124", page.get_by_test_id("keep-bpm").input_value() == str(BPM + 4))
        browser.close()

    print("passed" if not FAILS else f"failed: {FAILS}")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
