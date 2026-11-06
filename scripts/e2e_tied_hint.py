"""#5514 end-to-end check: a loop that opens on the tail of a held chord shows that chord
on the keyboard (as "hold these"), without asking him to strike it.

Start a local app with no window, a spare port and a debug port (see e2e_backwards.py):
    MIDITUTOR_ALLOW_INJECT=1 MIDITUTOR_HIDDEN=1 MIDITUTOR_PORT=47811 <app> --remote-debugging-port=9347
then:
    MIDITUTOR_URL=http://127.0.0.1:47811 MIDITUTOR_CDP=http://127.0.0.1:9347 python scripts/e2e_tied_hint.py

The score is built here: bar 1 a C-E-G whole-note chord tied into bar 2 (a half), then
A4 B4; bar 3 four C5s. Loop bar 2: the keyboard outlines C4 E4 G4 while the cursor waits on
A4, clears once he plays on, and shows again when the lap wraps. Loop bar 3: nothing.
"""
from __future__ import annotations

import os
import sys
import time

from playwright.sync_api import sync_playwright

from e2e_backwards import FAILS, check, midi_of, screen, strike, tc


def note(step: str, octave: int, kind: str, tie: str | None = None, chord: bool = False) -> str:
    dur = {"whole": 16, "half": 8, "quarter": 4}[kind]
    ties = f'<tie type="{tie}"/>' if tie else ""
    notations = f'<notations><tied type="{tie}"/></notations>' if tie else ""
    return (f"<note>{'<chord/>' if chord else ''}<pitch><step>{step}</step><octave>{octave}</octave></pitch>"
            f"<duration>{dur}</duration>{ties}<voice>1</voice><type>{kind}</type>{notations}</note>")


def chord(kind: str, tie: str) -> str:
    return "".join(note(s, 4, kind, tie, chord=i > 0) for i, s in enumerate("CEG"))


SCORE = f"""<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
<part id="P1">
<measure number="1"><attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time>
<clef><sign>G</sign><line>2</line></clef></attributes>{chord("whole", "start")}</measure>
<measure number="2">{chord("half", "stop")}{note("A", 4, "quarter")}{note("B", 4, "quarter")}</measure>
<measure number="3">{note("C", 5, "quarter") * 4}</measure>
</part></score-partwise>"""


# #5568, Sorcerer's Apprentice bar 32: a left-hand B2-Eb3-G3 tied in from bar 1 under a
# right-hand G4 F4 Eb4 D4. He strikes the chord just after the G4 (strike() spaces keys 20 ms).
def lh(step: str, octave: int, kind: str, tie: str | None = None, chord: bool = False, alter: int = 0) -> str:
    alt = f"<alter>{alter}</alter>" if alter else ""
    return note(step, octave, kind, tie, chord).replace("<voice>1</voice>", "<voice>5</voice><staff>2</staff>").replace(
        f"<step>{step}</step>", f"<step>{step}</step>{alt}")


LH_CHORD = lambda kind, tie: lh("B", 2, kind, tie) + lh("E", 3, kind, tie, True, -1) + lh("G", 3, kind, tie, True)
REST = '<note><rest/><duration>{d}</duration><voice>{v}</voice><type>{t}</type>{s}</note>'
SCORE2 = f"""<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
<part id="P1">
<measure number="1"><attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves>
<clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>
{REST.format(d=16, v=1, t="whole", s="")}<backup><duration>16</duration></backup>{LH_CHORD("whole", "start")}</measure>
<measure number="2">{"".join(note(s_, 4, "quarter") for s_ in "GFED")}<backup><duration>16</duration></backup>
{LH_CHORD("quarter", "stop")}{REST.format(d=8, v=5, t="half", s="<staff>2</staff>")}{lh("G", 2, "quarter")}</measure>
</part></score-partwise>"""


def mini(page):
    """(clefs right hand first, every key low to high), or None. One staff per hand (#11091)."""
    els = page.query_selector_all("[data-testid=mini-staff]")
    if not els:
        return None
    keys = sorted((k for el in els for k in el.get_attribute("data-keys").split()), key=lambda k: (k[-1], k))
    return "+".join(el.get_attribute("data-clefs") for el in els), " ".join(keys)


def durations(page) -> list[str]:
    return [el.get_attribute("data-durations") for el in page.query_selector_all("[data-testid=mini-staff]")]


def blue_marks(page) -> int:
    return page.eval_on_selector_all("[data-testid=played-overlay] ellipse", "els => els.filter(e => e.getAttribute('fill') === '#2563eb').length")


def restrike_check(page) -> None:
    tc.load_piece("Tied restrike (e2e)", SCORE2)
    time.sleep(3)
    tc.request("POST", "/loop", {"firstBar": 2, "lastBar": 2})
    time.sleep(1)
    check(mini(page) == ("treble", "g/4"), "#5624 mini staff: just the G4, treble", mini(page))
    clear_of_score(page, "treble")
    page.uncheck("[data-testid=mini-staff-toggle]")
    time.sleep(0.3)
    check(mini(page) is None, "#5624 mini staff switches off", mini(page))
    page.check("[data-testid=mini-staff-toggle]")
    time.sleep(0.3)
    since = tc.state().get("eventSeq", 0)
    strike([67, 47, 51, 55])  # G4, then the tied chord 20-60 ms later
    for _ in range(20):  # a hidden window paints lazily
        if blue_marks(page) >= 4:
            break
        time.sleep(0.1)
    check(blue_marks(page) == 4, "G4 plus the struck tied chord are blue", blue_marks(page))
    events = tc.request("GET", f"/events?since={since}")["events"]
    results = [e.get("result") for e in events if e.get("kind") == "follow"]
    check("stray" not in results and "wrong" not in results, "the chord is no graze", results)
    check(durations(page) == ["q", "hr"], "#11092 the F4 is a quarter; the left hand shows its half rest", durations(page))
    strike([65])
    time.sleep(0.15)
    strike([64])
    time.sleep(0.15)
    check(mini(page) == ("treble+bass", "g/2 d/4"), "#11091 both hands: a treble over the right, a bass over the left", mini(page))
    clear_of_score(page, "two-hand")
    boxes = [el.bounding_box() for el in page.query_selector_all("[data-testid=mini-staff]")]
    check(len(boxes) == 2 and boxes[1]["x"] + boxes[1]["width"] <= boxes[0]["x"] + 1,
          "#11091 two staves: the left hand's sits left of the right hand's, apart", boxes)
    check(durations(page) == ["q", "q"], "#11092 quarters drawn as quarters", durations(page))
    page.screenshot(path="screengrab/e2e-mini-staff-band.png")
    strike([62, 43])
    time.sleep(0.15)
    page.click('button:text-is("Left")')
    time.sleep(0.8)
    check(mini(page) == ("bass", "g/2"), "#5624 left hand only: the staff follows the hand switch", mini(page))
    page.click('button:text-is("Both")')
    time.sleep(0.8)
    time.sleep(0.4)
    chunk = [e for e in tc.request("GET", f"/events?since={since}")["events"] if e.get("kind") == "lap"]
    check(len(chunk) == 1, "lap wrapped", chunk)
    tc.request("DELETE", "/loop")


def clear_of_score(page, what: str) -> None:
    """#11089: the card sits in its own band above the keyboard, never over the music."""
    band = page.query_selector("[data-testid=mini-staff-band]").bounding_box()
    for el in page.query_selector_all("[data-testid=mini-staff]"):
        card = el.bounding_box()
        inside = card["y"] >= band["y"] - 0.5 and card["y"] + card["height"] <= band["y"] + band["height"] + 0.5
        check(inside and card["height"] > 20, f"#11089 {what} staff fits its band, clear of the score",
              (card, band))


def score_wheel_check(page) -> None:
    """#5630: with the switch off the wheel over a score note edits no finger; over a key it does."""
    tc.load_piece("Tied hint (e2e)", SCORE)
    time.sleep(2)
    def wheel_on_note() -> bool:
        width = page.viewport_size["width"] if page.viewport_size else page.evaluate("innerWidth")
        heads = [b for b in (h.bounding_box() for h in page.query_selector_all(".vf-notehead"))
                 if b and 40 < b["x"] < width - 60]
        head = heads[0]
        page.mouse.move(head["x"] + head["width"] / 2, head["y"] + head["height"] / 2)
        time.sleep(0.3)
        page.mouse.wheel(0, 120)
        time.sleep(0.15)
        return page.query_selector("[data-testid=finger-live]") is not None

    page.check("[data-testid=score-wheel-fingers]")
    check(wheel_on_note(), "#5630 switch on: the wheel over a score note edits its finger")
    page.mouse.move(5, 5)
    time.sleep(0.8)  # the edit commits; this is the test's own piece
    page.uncheck("[data-testid=score-wheel-fingers]")
    check(not wheel_on_note(), "#5630 switch off: the wheel over a score note edits no finger")
    page.mouse.move(5, 5)
    tc.request("POST", "/loop", {"firstBar": 1, "lastBar": 1})  # the cursor on the C-E-G chord
    time.sleep(0.8)
    box = page.query_selector("[data-midi='60']").bounding_box()
    page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] - 6)
    time.sleep(0.3)
    page.mouse.wheel(0, 120)
    time.sleep(0.1)
    check(page.query_selector("[data-testid=finger-live]") is not None, "#5630 switch off: the wheel over the key still edits the finger")
    page.mouse.move(5, 5)
    time.sleep(0.8)
    tc.request("DELETE", "/loop")


def tied(page) -> list[int]:
    return sorted(int(v) for v in page.eval_on_selector_all("[data-tied]", "els => els.map(e => e.dataset.tied)"))


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

    tc.load_piece("Tied hint (e2e)", SCORE)
    time.sleep(3)
    with sync_playwright() as p:
        page = p.chromium.connect_over_cdp(cdp).contexts[0].pages[0]
        tc.request("POST", "/loop", {"firstBar": 2, "lastBar": 2})
        time.sleep(1)
        s = screen()
        check([midi_of(n) for n in s.get("remaining", [])] == [69], "loop bar 2 waits on A4, not the tied chord", s.get("remaining"))
        check(tied(page) == [60, 64, 67], "keyboard shows the held-over C E G", tied(page))
        strike([69])
        time.sleep(0.4)
        check(tied(page) == [], "played on: the hint clears", tied(page))
        strike([71])
        time.sleep(0.6)
        check(screen()["loop"]["lap"] == 2, "lap wrapped", screen()["loop"])
        check(tied(page) == [60, 64, 67], "next lap shows it again", tied(page))
        tc.request("POST", "/loop", {"firstBar": 3, "lastBar": 3})
        time.sleep(1)
        check(tied(page) == [], "a bar with no tie shows nothing", tied(page))
        tc.request("DELETE", "/loop")
        restrike_check(page)
        score_wheel_check(page)

    print("ALL PASS" if not FAILS else f"{len(FAILS)} FAILED: {FAILS}")
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
