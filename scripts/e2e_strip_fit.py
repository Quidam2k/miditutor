"""#6055 Strip fits the music's ink, not the SVG box. Against the RUNNING hidden muted app
(see e2e_celebrate.py for the launch line), then:
    MIDITUTOR_URL=... MIDITUTOR_CDP=... MIDITUTOR_TOKEN_FILE=... python scripts/e2e_strip_fit.py [outdir]
For Minuet in G, a high-ledger piece and a wide-range piece, at 1920x1080 and 1186x609, keyboard on
and off: ink height / panel height, whether the ink sits inside the panel, and full bars visible.
Saves a screenshot of each case into outdir (default screengrab/).
"""
from __future__ import annotations

import os
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

from e2e_backwards import SCORE, check, tc

OUT = Path(sys.argv[1] if len(sys.argv) > 1 else "screengrab")

STEP = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def note(step: str, octave: int, finger: str = "") -> str:
    tech = f"<notations><technical><fingering>{finger}</fingering></technical></notations>" if finger else ""
    return f"<note><pitch><step>{step}</step><octave>{octave}</octave></pitch><duration>1</duration><type>quarter</type><staff>{{s}}</staff>{tech}</note>"


def piece(title: str, rh: list[tuple[str, int]], lh: list[tuple[str, int]], bars: int = 8) -> str:
    def part(notes, staff):
        out = []
        for m in range(bars):
            body = "".join(note(*notes[(m * 4 + i) % len(notes)], str(1 + i % 5)).replace("{s}", str(staff)) for i in range(4))
            attrs = ""
            if m == 0:
                attrs = ("<attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time>"
                         "<staves>2</staves><clef number=\"1\"><sign>G</sign><line>2</line></clef><clef number=\"2\"><sign>F</sign><line>4</line></clef></attributes>"
                         "<direction placement=\"above\"><direction-type><words>Allegro</words></direction-type><sound tempo=\"100\"/></direction>")
            out.append((attrs, body))
        return out
    r, l = part(rh, 1), part(lh, 2)
    measures = ""
    for m in range(bars):
        measures += f"<measure number=\"{m + 1}\">{r[m][0]}{r[m][1]}<backup><duration>4</duration></backup>{l[m][1]}</measure>"
    return (f'<?xml version="1.0" encoding="UTF-8"?><score-partwise version="3.1"><work><work-title>{title}</work-title></work>'
            f'<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">{measures}</part></score-partwise>')


HIGH = piece("High ledger (e2e)", [("C", 7), ("A", 6), ("E", 7), ("B", 6)], [("C", 2), ("E", 2), ("G", 2), ("C", 3)])
WIDE = piece("Wide range (e2e)", [("C", 7), ("C", 4), ("A", 6), ("E", 4)], [("A", 1), ("C", 4), ("C", 2), ("B", 3)])
PIECES = [("minuet", "Minuet (e2e)", SCORE.read_text(encoding="utf-8")), ("high", "High ledger (e2e)", HIGH), ("wide", "Wide range (e2e)", WIDE)]

MEASURE_JS = """() => {
  const panel = document.querySelector('[data-testid=score-panel]');
  const svg = panel && panel.querySelector('svg');
  if (!panel || !svg) return null;
  const pr = panel.getBoundingClientRect();
  const sr = svg.getBoundingClientRect();
  const vb = svg.viewBox.baseVal;
  const vbH = (vb && vb.height) || svg.height.baseVal.value;
  const bb = svg.getBBox();
  const k = sr.height / vbH;
  const top = sr.top + (bb.y - (vb ? vb.y : 0)) * k;
  const bottom = top + bb.height * k;
  const xs = [...svg.querySelectorAll('.measure-number')].map(e => e.getBoundingClientRect().left).sort((a, b) => a - b);
  let full = 0;
  for (let i = 0; i + 1 < xs.length; i++) if (xs[i] >= pr.left && xs[i + 1] <= pr.right) full++;
  const tf = svg.parentElement && svg.parentElement.parentElement && getComputedStyle(svg.closest('div.relative') || svg).transform;
  const gaps = xs.slice(1).map((x, i) => x - xs[i]);
  const barW = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0;
  const cur = document.querySelector('[id^=cursorImg]');
  const cx = cur ? cur.getBoundingClientRect().left + cur.getBoundingClientRect().width / 2 : pr.left;
  return {barW: Math.round(barW), span: barW ? +(pr.width / barW).toFixed(2) : null, ahead: barW ? +((pr.right - cx) / barW).toFixed(2) : null, panelH: Math.round(pr.height), panelW: Math.round(pr.width), inkH: Math.round(bottom - top),
          ratio: +((bottom - top) / (pr.height - 32)).toFixed(2),
          insideTop: Math.round(top - (pr.top + 16)), insideBottom: Math.round((pr.bottom - 16) - bottom),
          fullBars: full, vBar: panel.offsetWidth - panel.clientWidth, cursorFrac: (() => { const c = document.querySelector('[id^=cursorImg]'); return c ? +(((c.getBoundingClientRect().left + c.getBoundingClientRect().width / 2) - pr.left) / pr.width).toFixed(2) : null; })(), inkLeftBlank: Math.round(sr.left + (bb.x - (vb ? vb.x : 0)) * k - pr.left), scrollLeft: Math.round(panel.scrollLeft), kbTop: (document.querySelector('[data-testid=keyboard-88]') || {getBoundingClientRect: () => ({top: null})}).getBoundingClientRect().top};
}"""


def main() -> int:
    for _ in range(60):
        try:
            if tc.state().get("rendererConnected"):
                break
        except tc.TutorUnavailable:
            pass
        time.sleep(1)
    OUT.mkdir(exist_ok=True)
    cdp = os.environ.get("MIDITUTOR_CDP") or sys.exit("set MIDITUTOR_CDP")
    with sync_playwright() as p:
        page = p.chromium.connect_over_cdp(cdp).contexts[0].pages[0]
        for key, title, xml in PIECES:
            seq = tc.state()["eventSeq"]
            tc.load_piece(title, xml)
            for _ in range(40):
                if any(e.get("kind") == "piece" for e in tc.request("GET", f"/events?since={seq}&limit=2000")["events"]):
                    break
                time.sleep(0.5)
            page.get_by_role("button", name="Score", exact=True).click()
            page.wait_for_selector("[data-testid=bar-now]", timeout=30000)
            big = page.locator("[data-testid=strip-fit-ink]")
            if big.is_checked() == bool(os.environ.get("FIT_OLD")):
                big.click()
            for w, h in ((1920, 1080), (1186, 609)):
                page.set_viewport_size({"width": w, "height": h})
                for kb in (True, False):
                    box = page.get_by_label("Keyboard", exact=True)
                    if box.is_checked() != kb:
                        box.click()
                    page.wait_for_timeout(1800)
                    m = page.evaluate(MEASURE_JS)
                    name = f"fit-{'old' if os.environ.get('FIT_OLD') else 'new'}-{key}-{w}-kb{'on' if kb else 'off'}"
                    page.screenshot(path=str(OUT / f"{name}.png"))
                    print(name, m)
    return follow_check()


def follow_check() -> int:
    """Cursor stays at the anchor while he plays, and a Keyboard toggle does not move it."""
    with sync_playwright() as p:
        page = p.chromium.connect_over_cdp(os.environ["MIDITUTOR_CDP"]).contexts[0].pages[0]
        page.set_viewport_size({"width": 1920, "height": 1080})
        frac = "() => { const c = document.querySelector('[id^=cursorImg]'); const p = document.querySelector('[data-testid=score-panel]').getBoundingClientRect(); const r = c.getBoundingClientRect(); return (r.left + r.width / 2 - p.left) / p.width; }"
        for _ in range(8):
            page.get_by_role("button", name="Next", exact=False).first.click()
            page.wait_for_timeout(250)
        page.wait_for_timeout(2500)
        a = page.evaluate(frac)
        check(abs(a - 0.25) < 0.02, "follow: the cursor stays at 25% after 8 steps", a)
        kb = page.get_by_label("Keyboard", exact=True)
        kb.click()
        page.wait_for_timeout(1800)
        b = page.evaluate(frac)
        check(abs(b - a) < 0.02, "keyboard off: no jump", (a, b))
        kb.click()
        page.wait_for_timeout(1800)
        c = page.evaluate(frac)
        check(abs(c - a) < 0.02, "keyboard on again: no jump", (a, c))
        page.get_by_role("button", name="Restart", exact=True).click()
        page.wait_for_timeout(900)
        d = page.evaluate("() => { const p = document.querySelector('[data-testid=score-panel]'); const svg = p.querySelector('svg'); const k = svg.getBoundingClientRect().height / ((svg.viewBox.baseVal && svg.viewBox.baseVal.height) || svg.height.baseVal.value); return svg.getBoundingClientRect().left + (svg.getBBox().x - (svg.viewBox.baseVal ? svg.viewBox.baseVal.x : 0)) * k - p.getBoundingClientRect().left; }")
        check(d >= 0, "restart: the first ink (Piano label, clef) is not pushed off the left edge", d)
    from e2e_backwards import FAILS
    print("FAILS:", FAILS)
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
