"""#5945 end-to-end check of the loop-end grace against a RUNNING hidden app.

Launch a packaged, muted, hidden copy (see memory hidden-test-copy-must-be-muted), then run
with MIDITUTOR_URL / MIDITUTOR_TOKEN_FILE / MIDITUTOR_CDP set (see e2e_keep_going.py).

Three bars of quarters (C D E F | G A B C | D E F G), loop = bar 1.
Normal loop: C D E F wraps; G (the piece carrying on) is an 'overrun': thud event, no wrong count,
lap stays clean. A wrong note (C#) in the same window is still wrong; so is G after the window.
Keep going at 120: at the lap's end a G is a 'keep-overrun', not a 'keep-miss'.
"""

import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from miditutor_mcp import tutor_client as tc

FAILS = []
BPM = 120
BEAT_S = 60 / BPM


def check(label, condition):
    print(f"{'PASS' if condition else 'FAIL'}: {label}")
    if not condition:
        FAILS.append(label)


def tap(note, hold=0.06):
    tc.request("POST", "/inject", {"notes": [note], "kind": "noteon", "velocity": 64})
    time.sleep(hold)
    tc.request("POST", "/inject", {"notes": [note], "kind": "noteoff", "velocity": 64})


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
            + bar(3, [("D", 4), ("E", 4), ("F", 4), ("G", 4)])
            + "</part></score-partwise>")


def events_since(seq, kind):
    return [e.get("data", e) for e in tc.request("GET", f"/events?since={seq}&limit=5000")["events"] if e.get("kind") == kind]


def wait_for(fn, timeout=15):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        got = fn()
        if got:
            return got
        time.sleep(0.05)
    return None


def main():
    cdp = os.environ["MIDITUTOR_CDP"]
    from playwright.sync_api import sync_playwright

    wait_for(lambda: tc.state().get("rendererConnected"), 30)
    seq = tc.state()["eventSeq"]
    tc.load_piece("Overrun (e2e)", fixture())
    if not wait_for(lambda: events_since(seq, "piece"), 30):
        raise RuntimeError("piece never loaded")
    time.sleep(1.5)
    tc.request("POST", "/loop", {"firstBar": 1, "lastBar": 1})
    time.sleep(1)

    # --- normal loop ---
    seq = tc.state()["eventSeq"]
    for n in (60, 62, 64, 65):
        tap(n)
        time.sleep(0.1)
    laps = wait_for(lambda: events_since(seq, "lap"), 5)
    check("lap 1 wrapped", bool(laps))
    # #5853: each lap names its loop's bars and the help that was on screen.
    lap_ev = laps[-1] if laps else {}
    check("lap event carries the loop's bars", lap_ev.get("firstBar") == 1 and lap_ev.get("lastBar") == 1)
    check("lap event carries the hints state", (lap_ev.get("hints") or {}).get("keys") in ("always", "wheels", "on-pause", "none"))
    tap(67)  # G: the piece carrying on past the loop's end
    over = wait_for(lambda: events_since(seq, "overrun"), 5)
    check("overrun event (thud path ran)", bool(over))
    check("overrun event names the G", bool(over) and over[-1].get("note") == 67)
    check("no wrong 'follow' for the overrun", not [e for e in events_since(seq, "follow") if e.get("note") == 67])
    check("no lap-spoiled for the overrun", not events_since(seq, "lap-spoiled"))
    time.sleep(0.4)
    tap(61)  # C#: not what the piece does next, same window
    check("wrong note in the window still spoils the lap", bool(wait_for(lambda: events_since(seq, "lap-spoiled"), 5)))
    seq2 = tc.state()["eventSeq"]
    for n in (60, 62, 64, 65):
        tap(n)
        time.sleep(0.1)
    wait_for(lambda: events_since(seq2, "lap"), 5)
    time.sleep(1.8)  # past the grace
    tap(67)
    time.sleep(0.3)
    late = [e for e in events_since(seq2, "follow") if e.get("note") == 67]
    check("G after the grace is plain wrong", bool(late) and not late[-1].get("overrun") and late[-1].get("result") == "wrong")

    # --- Keep going ---
    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp(cdp)
        page = next(pg for ctx in browser.contexts for pg in ctx.pages if "devtools" not in pg.url)
        page.get_by_test_id("keep-bpm").fill(str(BPM))
        page.get_by_test_id("keep-bpm").blur()
        seqk = tc.state()["eventSeq"]
        page.get_by_test_id("keep-going").click()
        on = wait_for(lambda: [e for e in events_since(seqk, "keep") if e.get("on") is True])
        check("keep on event", bool(on))
        start = on[0].get("startMs", time.time() * 1000 + 2000) if on else time.time() * 1000
        lap_end = start + 4 * BEAT_S * 1000
        time.sleep(max(0, (lap_end + 300) / 1000 - time.time()))
        tap(67)  # past the loop's end, inside the grace
        over_k = wait_for(lambda: events_since(seqk, "keep-overrun"), 5)
        check("keep-overrun event", bool(over_k))
        check("no keep-miss for it", not events_since(seqk, "keep-miss"))
        time.sleep(2.0)
        tap(61)  # wrong, long after the loop's end
        check("later wrong note is a keep-miss", bool(wait_for(lambda: events_since(seqk, "keep-miss"), 5)))
        page.get_by_test_id("keep-going").click()
        browser.close()

    print("passed" if not FAILS else f"failed: {FAILS}")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
