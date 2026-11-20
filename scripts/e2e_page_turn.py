"""E2E check of the Pages layout (page-turn) behaviour in the MidiTutor Electron app (#6373).

Drives the RUNNING hidden, muted test copy of the app. It loads a generated 160-bar
piece and checks:
  * the "p" key toggles Pages and back to the remembered layout (strip / scroll)
  * two-page spread start, PageDown/PageUp, wheel notches (normal or reversed), edge
    click zones, the page-next / page-prev buttons, mouse back/forward buttons
  * auto-turn when the cursor leaves the spread, the typing guard in the bar box
  * clamping at the last page
Finally it saves a screenshot and restores the Strip layout.

Usage: python scripts/e2e_page_turn.py [outdir]    (default outdir: screengrab)
Env vars:
  MIDITUTOR_URL         base URL of the running test copy's control server
  MIDITUTOR_CDP         Chromium DevTools endpoint of that copy (required)
  MIDITUTOR_TOKEN_FILE  file holding the control-server auth token
"""
import os
import re
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright
from e2e_backwards import check, tc, tid, FAILS


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


VISIBLE_JS = """() => Array.from(document.querySelectorAll('[data-testid=score-panel] *'))
  .filter(e => /^osmdCanvasPage\\d+$/.test(e.id) && getComputedStyle(e).visibility !== 'hidden')
  .map(e => parseInt(e.id.replace('osmdCanvasPage', ''), 10)).sort((a, b) => a - b)"""
WHEEL_JS = """(dy) => { const el = document.querySelector('[data-testid=score-panel]'); const r = el.getBoundingClientRect();
  el.dispatchEvent(new WheelEvent('wheel', {deltaY: dy, deltaMode: 0, bubbles: true, cancelable: true, clientX: r.left + 5, clientY: r.top + 5})); }"""
CURSOR_JS = """() => { const c = document.querySelector('img[id^=cursorImg]');
  const m = c && c.parentElement && c.parentElement.id.match(/^osmdCanvasPage(\\d+)$/); return m ? parseInt(m[1], 10) : null; }"""
MOUSE_JS = "(b) => window.dispatchEvent(new MouseEvent('mouseup', {button: b, bubbles: true}))"


def visible_pages(page) -> list[int]:
    return page.evaluate(VISIBLE_JS)


def label(page) -> str:
    return page.get_by_test_id("page-spread").locator("span").inner_text().strip()


def last_page(text: str) -> int | None:
    m = re.search(r"Pages? (\d+)(?:-(\d+))? of (\d+)", text)
    return int(m.group(2) or m.group(1)) if m else None


def pressed(page, name: str) -> bool:
    return tid(page, name).get_attribute("aria-pressed") == "true"


def blur(page) -> None:
    page.evaluate("document.activeElement && document.activeElement.blur()")


def press_p(page) -> None:
    blur(page)
    page.keyboard.press("p")
    page.wait_for_timeout(2500)


def key(page, name: str) -> None:
    blur(page)
    page.keyboard.press(name)
    page.wait_for_timeout(700)


def expect(page, what: str, pages: list[int]) -> None:
    got = visible_pages(page)
    check(got == pages, what, f"expected {pages}, got {got}")


def exercise(page) -> None:
    tid(page, "layout-strip").click()
    page.wait_for_timeout(1500)
    press_p(page)
    check(pressed(page, "layout-pages"), "p -> Pages", "layout-pages not pressed")
    press_p(page)
    check(pressed(page, "layout-strip"), "p again -> remembered Strip", "layout-strip not pressed")
    tid(page, "layout-scroll").click()
    page.wait_for_timeout(2500)
    press_p(page)
    press_p(page)
    check(pressed(page, "layout-scroll"), "p, p -> remembered Scroll", "layout-scroll not pressed")
    press_p(page)
    check(pressed(page, "layout-pages"), "p -> Pages for the rest", "layout-pages not pressed")

    text = label(page)
    m = re.search(r" of (\d+)$", text)
    n = int(m.group(1)) if m else None
    check(n is not None and n >= 4, "piece spans >= 4 pages", f"label={text!r}")
    if n is None or n < 4:
        return
    check(visible_pages(page) == [1, 2] and text.startswith("Pages 1-2"), "start on Pages 1-2",
          f"pages={visible_pages(page)} label={text!r}")

    key(page, "PageDown")
    expect(page, "PageDown -> [3,4]", [3, 4])
    key(page, "PageUp")
    expect(page, "PageUp -> [1,2]", [1, 2])

    page.evaluate(WHEEL_JS, 120)
    page.wait_for_timeout(700)
    if visible_pages(page) == [3, 4]:
        print("wheel direction: normal")
        check(True, "wheel +120 -> [3,4]", "")
        page.evaluate(WHEEL_JS, -120)
        page.wait_for_timeout(700)
        expect(page, "wheel -120 -> [1,2]", [1, 2])
    else:
        print("wheel direction: reversed (reverse wheel setting on?)")
        expect(page, "reversed: wheel +120 stays [1,2]", [1, 2])
        page.evaluate(WHEEL_JS, -120)
        page.wait_for_timeout(700)
        expect(page, "reversed: wheel -120 -> [3,4]", [3, 4])
        page.evaluate(WHEEL_JS, 120)
        page.wait_for_timeout(700)
        expect(page, "reversed: wheel +120 -> [1,2]", [1, 2])

    page.get_by_test_id("page-edge-forward").click()
    page.wait_for_timeout(700)
    expect(page, "edge forward -> [3,4]", [3, 4])
    page.get_by_test_id("page-edge-back").click()
    page.wait_for_timeout(700)
    expect(page, "edge back -> [1,2]", [1, 2])
    page.get_by_test_id("page-next").click()
    page.wait_for_timeout(700)
    expect(page, "page-next -> [3,4]", [3, 4])
    page.get_by_test_id("page-prev").click()
    page.wait_for_timeout(700)
    expect(page, "page-prev -> [1,2]", [1, 2])

    page.evaluate(MOUSE_JS, 4)
    page.wait_for_timeout(700)
    expect(page, "mouse forward button -> [3,4]", [3, 4])
    page.evaluate(MOUSE_JS, 3)
    page.wait_for_timeout(700)
    expect(page, "mouse back button -> [1,2]", [1, 2])

    loc = page.get_by_test_id("bar-now")
    loc.click()
    loc.fill("150")
    loc.press("Enter")
    page.wait_for_timeout(1500)
    vp, cp = visible_pages(page), page.evaluate(CURSOR_JS)
    check(cp in vp and vp != [1, 2], "auto-turn follows cursor to bar 150", f"cursor page={cp} visible={vp}")
    loc.click()
    loc.fill("1")
    loc.press("Enter")
    page.wait_for_timeout(1500)
    expect(page, "bar 1 -> [1,2]", [1, 2])

    loc.click()
    page.keyboard.press("p")
    page.wait_for_timeout(500)
    check(pressed(page, "layout-pages"), "typing guard: p in bar box keeps Pages", "layout changed")
    page.keyboard.press("Escape")
    blur(page)

    for _ in range(20):
        page.keyboard.press("PageDown")
        page.wait_for_timeout(100)
    page.wait_for_timeout(700)
    check(last_page(label(page)) == n, "PageDown x20 reaches last page", f"label={label(page)!r} N={n}")
    key(page, "PageDown")
    check(last_page(label(page)) == n, "extra PageDown clamps", f"label={label(page)!r} N={n}")
    check(page.get_by_test_id("page-edge-forward").is_disabled(), "edge forward disabled at end", "still enabled")
    print("SKIP finger-wheel over a note (covered by e2e_wheel_edit.py in Strip)")


HAS_BAR_JS = """(n) => [...document.querySelectorAll('[id^=osmdCanvasPage]')]
  .filter((d) => d.style.visibility !== 'hidden')
  .some((d) => [...d.querySelectorAll('svg text')].some((t) => t.textContent.trim() === String(n)))"""


def loop_opens(page) -> None:
    """#6585: Two pages opens on the spread holding the loop's first bar; a loop longer than two
    pages opens at its start and says it goes on; no title block; the toggle is called Two pages."""
    from e2e_backwards import screen

    check("Two pages" == tid(page, "layout-pages").inner_text().strip(), "the layout button says Two pages")
    tid(page, "layout-strip").click()
    page.wait_for_timeout(1500)
    tc.request("POST", "/loop", {"firstBar": 81, "lastBar": 84})
    page.wait_for_timeout(1000)
    tid(page, "layout-pages").click()
    page.wait_for_timeout(2500)
    check(page.evaluate(HAS_BAR_JS, 81), "loop 81-84: entering Two pages lands on the spread holding bar 81",
          str(visible_pages(page)))
    check(visible_pages(page)[0] > 1, "... not the first spread", str(visible_pages(page)))
    check(page.get_by_test_id("page-loop-note").count() == 0, "a loop that fits shows no 'goes on' note")
    lp = screen().get("loop") or {}
    check((lp.get("firstBar"), lp.get("lastBar")) == (81, 84), "entering Two pages keeps his loop", str(lp))
    title = page.evaluate("() => [...document.querySelectorAll('[id^=osmdCanvasPage] svg text')].some((t) => t.textContent.includes('Page turn (e2e)'))")
    check(not title, "no title block on the pages")
    tid(page, "layout-strip").click()
    page.wait_for_timeout(1500)
    tc.request("POST", "/loop", {"firstBar": 21, "lastBar": 150})
    page.wait_for_timeout(1000)
    tid(page, "layout-pages").click()
    page.wait_for_timeout(2500)
    check(page.evaluate(HAS_BAR_JS, 21), "loop 21-150 (longer than two pages) opens at its first bar", str(visible_pages(page)))
    note = page.get_by_test_id("page-loop-note")
    check(note.count() == 1 and "goes on to page" in note.inner_text(), "... and says it goes on",
          note.all_inner_texts() if note.count() else "no note")
    page.keyboard.press("p")
    page.wait_for_timeout(1500)
    page.keyboard.press("p")
    page.wait_for_timeout(2500)
    lp = screen().get("loop") or {}
    check((lp.get("firstBar"), lp.get("lastBar")) == (21, 150), "P round trip keeps the loop", str(lp))


def main() -> int:
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "screengrab")
    out.mkdir(parents=True, exist_ok=True)
    deadline = time.time() + 60
    while time.time() < deadline:
        try:
            if tc.state()["rendererConnected"]:
                break
        except tc.TutorUnavailable:
            pass
        time.sleep(1)
    else:
        print("renderer never connected")
        return 1
    with sync_playwright() as p:
        page = p.chromium.connect_over_cdp(os.environ["MIDITUTOR_CDP"]).contexts[0].pages[0]
        page.set_viewport_size({"width": 1920, "height": 1080})
        seq = tc.state()["eventSeq"]
        title = "Page turn (e2e)"
        tc.load_piece(title, piece(title, [("C", 5), ("E", 5), ("G", 5), ("B", 4)],
                                   [("C", 3), ("G", 2), ("E", 3), ("C", 3)], bars=160))
        loaded = False
        for _ in range(40):
            events = tc.request("GET", f"/events?since={seq}&limit=2000")["events"]
            if any(e.get("kind") == "piece" for e in events):
                loaded = True
                break
            time.sleep(0.5)
        check(loaded, "piece loaded", "no piece event within 20 s")
        if loaded:
            page.get_by_role("button", name="Score", exact=True).click()
            page.wait_for_selector("[data-testid=bar-now]")
            exercise(page)
            loop_opens(page)
        page.screenshot(path=str(out / "page-turn.png"))
        tid(page, "layout-strip").click()
        page.wait_for_timeout(1500)
    print("FAILS:", FAILS)
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
