"""#6530 E end-to-end: three of the tutor's advice rules, against a RUNNING hidden muted app (see memory
hidden-test-copy-must-be-muted; env MIDITUTOR_URL / MIDITUTOR_TOKEN_FILE / MIDITUTOR_CDP).

Each scenario loads its own fixture piece (its own advice data) and sets window.__adviceNoGap so the
5-minute gap between banners doesn't hide the later ones.
1. Loop reshape: a 10-bar loop, a wrong note in bars 4 and 9 on each of 3 laps -> "... are clean:
   try ... loops at ..." [Use these] -> the windows join his trouble spots, the loop is the first one.
2. Pause before a bar: a 4-bar loop played evenly except a 2 s wait before bar 3, 3 laps ->
   "You pause before bar 3 every time. Loop bars 2-3?" [Loop bars 2-3] -> loop 2-3.
3. Quiet note: a 2-bar loop, bar 2's 2nd note at velocity 40 among 100s, 3 laps -> "The F4 in bar 2
   ... quieter ..." (no button); Not today logs the rule.
"""

import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from miditutor_mcp import tutor_client as tc
from scripts.e2e_overrun import FAILS, check, events_since, wait_for

BAR = [60, 62, 64, 65]  # C D E F in every bar
NAMES = {60: ("C", 4), 62: ("D", 4), 64: ("E", 4), 65: ("F", 4)}


def fixture(bars):
    def bar(number, head=""):
        body = "".join(
            f"<note><pitch><step>{NAMES[n][0]}</step><octave>{NAMES[n][1]}</octave></pitch>"
            "<duration>1</duration><type>quarter</type></note>" for n in BAR)
        return f'<measure number="{number}">{head}{body}</measure>'

    head = ("<attributes><divisions>1</divisions><key><fifths>0</fifths></key>"
            "<time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>")
    return ('<?xml version="1.0" encoding="UTF-8"?><score-partwise version="3.1">'
            '<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">'
            + bar(1, head) + "".join(bar(i) for i in range(2, bars + 1)) + "</part></score-partwise>")


def tap(note, velocity=100, hold=0.05):
    tc.request("POST", "/inject", {"notes": [note], "kind": "noteon", "velocity": velocity})
    time.sleep(hold)
    tc.request("POST", "/inject", {"notes": [note], "kind": "noteoff", "velocity": 64})


def screen():
    return tc.state().get("screen") or {}


def load(name, bars):
    seq = tc.state()["eventSeq"]
    tc.load_piece(name, fixture(bars))
    if not wait_for(lambda: events_since(seq, "piece"), 30):
        raise RuntimeError("piece never loaded")
    time.sleep(1.5)


def set_loop(first, last):
    tc.request("POST", "/loop", {"firstBar": first, "lastBar": last})
    time.sleep(1)


def lap(bars, gap=0.3, wrong_in=(), pause_before=None, quiet_at=None):
    """One lap of the loop's bars. wrong_in: bars that get a C# before their first note."""
    for b in bars:
        if b == pause_before:
            time.sleep(2.0)
        for i, n in enumerate(BAR):
            if i == 0 and b in wrong_in:
                tap(61)
                time.sleep(0.1)
            tap(n, 40 if quiet_at == (b, i) else 100)
            time.sleep(gap - 0.05)


def shown_advice(seq, timeout=10):
    """Wait out the 4 s pause; the banner that shows."""
    ev = wait_for(lambda: [e for e in events_since(seq, "advice") if e.get("shown")], timeout) or [{}]
    return ev[0], screen().get("advice") or {}


def reshape(page):
    load("Advice reshape (e2e)", 10)
    set_loop(1, 10)
    seq = tc.state()["eventSeq"]
    for _ in range(3):
        lap(range(1, 11), wrong_in=(4, 9))
    ev, adv = shown_advice(seq)
    print("reshape:", adv)
    wins = (adv.get("action") or {}).get("windows") or []
    check("reshape banner", adv.get("rule") == "reshape" and "are clean: try" in (adv.get("text") or ""))
    check("windows cover bars 4 and 9",
          any(w["first"] <= 4 <= w["last"] for w in wins) and any(w["first"] <= 9 <= w["last"] for w in wins))
    check("banner text on screen", "are clean: try" in page.get_by_test_id("advice").inner_text())
    seq = tc.state()["eventSeq"]
    page.get_by_test_id("advice-reshape").click()
    time.sleep(1)
    spots = [(s.get("first"), s.get("last")) for s in screen().get("spots") or []]
    loop = screen().get("loop") or {}
    print("spots:", spots, "loop:", loop)
    check("[Use these] adds the windows as spots", all((w["first"], w["last"]) in spots for w in wins))
    check("[Use these] loops the first window",
          bool(wins) and (loop.get("firstBar"), loop.get("lastBar")) == (wins[0]["first"], wins[0]["last"]))
    check("action logged", any(e.get("action") == "reshape" for e in events_since(seq, "advice")))


def pause(page):
    load("Advice pause (e2e)", 4)
    set_loop(1, 4)
    seq = tc.state()["eventSeq"]
    for _ in range(3):
        lap(range(1, 5), pause_before=3)
    ev, adv = shown_advice(seq)
    print("pause:", adv)
    check("pause banner names bar 3", adv.get("rule") == "pause" and adv.get("bar") == 3
          and "You pause before bar 3 every time" in (adv.get("text") or ""))
    page.get_by_test_id("advice-loop").click()
    time.sleep(1)
    loop = screen().get("loop") or {}
    check("[Loop bars 2-3] loops 2-3", (loop.get("firstBar"), loop.get("lastBar")) == (2, 3))


def quiet(page):
    load("Advice quiet note (e2e)", 2)
    set_loop(1, 2)
    seq = tc.state()["eventSeq"]
    for _ in range(3):
        lap(range(1, 3), quiet_at=(2, 1))
    ev, adv = shown_advice(seq)
    print("velocity:", adv)
    check("quiet-note banner: bar 2, about 40%",
          adv.get("rule") == "velocity" and adv.get("bar") == 2 and 0.3 <= (adv.get("ratio") or 0) <= 0.5
          and "quieter than the notes around it" in (adv.get("text") or ""))
    check("no action button", page.get_by_test_id("advice-loop").count() == 0)
    seq = tc.state()["eventSeq"]
    page.get_by_test_id("advice-not-today").click()
    time.sleep(0.5)
    check("Not today logged for velocity",
          any(e.get("rule") == "velocity" and e.get("action") == "not-today" for e in events_since(seq, "advice")))


def main():
    from playwright.sync_api import sync_playwright

    wait_for(lambda: tc.state().get("rendererConnected"), 30)
    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp(os.environ["MIDITUTOR_CDP"])
        page = next(pg for ctx in browser.contexts for pg in ctx.pages if "devtools" not in pg.url)
        page.evaluate("window.__adviceNoGap = true")
        for scenario in (reshape, pause, quiet):
            try:
                scenario(page)
            except Exception as err:  # keep going: one scenario's failure shouldn't hide the others
                check(f"{scenario.__name__} ran", False)
                print(scenario.__name__, "error:", err)
        page.evaluate("window.__adviceNoGap = false")

    print("passed" if not FAILS else f"failed: {FAILS}")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
