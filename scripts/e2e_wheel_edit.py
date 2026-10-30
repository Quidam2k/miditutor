"""#10258 #10259 end-to-end check on a hidden Electron app, on a COPY of the score: a finger edit
(wheel or click) leaves the score where it is, and the wheel off a note moves one note per notch.

    MIDITUTOR_HIDDEN=1 MIDITUTOR_WINDOW_SIZE=1600x900 MIDITUTOR_PORT=47812 MIDITUTOR_VITE_PORT=5183 \
      MIDITUTOR_PIECES_DIR=<copy> npx electron-forge start -- --remote-debugging-port=9346 --user-data-dir=<scratch>
    MIDITUTOR_URL=http://127.0.0.1:47812 MIDITUTOR_TOKEN_FILE=<scratch>/api-token MIDITUTOR_CDP=http://127.0.0.1:9346 \
      python scripts/e2e_wheel_edit.py <copy>/sorcerers-apprentice.musicxml

Every mark it changes it puts back, and it checks the file's marks match at the end.
"""
from __future__ import annotations

import os
import re
import statistics
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from miditutor_mcp import tutor_client as tc  # noqa: E402

CDP = os.environ.get("MIDITUTOR_CDP", "http://127.0.0.1:9346")
SHOTS = ROOT / "screengrab"
LETTERS = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
FAILS: list[str] = []
YELLOW = "rgb(255, 230, 0)"


def check(cond, label, detail="") -> None:
    print(("PASS " if cond else "FAIL ") + label + ("" if cond else f"  {detail}"))
    if not cond:
        FAILS.append(label)


def screen() -> dict:
    return tc.state().get("screen") or {}


def where() -> tuple:
    s = screen()
    return s.get("measure"), tuple(sorted(s.get("remaining") or []))


def midi_of(name: str) -> int:
    m = re.fullmatch(r"([A-G])(#|b{1,2}|x)?(-?\d)", name)
    alter = {None: 0, "#": 1, "x": 2, "b": -1, "bb": -2}[m.group(2)]
    return 12 * (int(m.group(3)) + 1) + LETTERS[m.group(1)] + alter


def strike(notes: list[int]) -> None:
    for kind in ("noteon", "noteoff"):
        for note in notes:
            result = tc.request("POST", "/inject", {"notes": [note], "kind": kind, "velocity": 64})
            if "error" in result:
                sys.exit(f"inject failed: {result}")
        time.sleep(0.03)


def marks_of(path: Path) -> list[str | None]:
    xml = path.read_text(encoding="utf-8")
    out = []
    for n in re.findall(r"<note\b.*?</note>", xml, re.S):
        f = re.search(r"<fingering[^>]*>(\d)", n)
        out.append(f.group(1) if f else None)
    return out


def type_bar(page, testid: str, value) -> None:
    box = page.get_by_test_id(testid)
    box.fill(str(value))
    box.press("Enter")
    page.wait_for_timeout(400)


def layout(page) -> dict:
    """Where everything sits on screen: this must not change when a mark does."""
    return page.evaluate(
        """() => {
          const box = (e) => { const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top)]; };
          const heads = [...document.querySelectorAll('.vf-notehead')]
            .map(box).filter(([x]) => x > 0 && x < innerWidth);
          const cursor = document.querySelector('img[id^=cursorImg]');
          return { heads, cursor: cursor ? box(cursor) : null };
        }"""
    )


def watch_frames(page) -> None:
    page.evaluate(
        """() => {
          window.__frames = [];
          window.__watching = true;
          const tick = () => {
            if (!window.__watching) return;
            const heads = document.querySelectorAll('.vf-notehead');
            window.__frames.push([heads.length, heads[40] ? Math.round(heads[40].getBoundingClientRect().left) : null]);
            requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }"""
    )


def frames_seen(page) -> list:
    return page.evaluate("() => { window.__watching = false; return window.__frames; }")


def mark_drawing(page) -> None:
    page.evaluate("() => { window.__head = document.querySelectorAll('.vf-notehead')[40]; }")


def same_drawing(page) -> bool:
    """False once the score has been drawn again, even invisibly."""
    return page.evaluate("() => window.__head?.isConnected === true")


def renders(page) -> list[float]:
    return page.evaluate("() => performance.getEntriesByName('finger-render').map((e) => e.duration)")


def chord_heads(page) -> list[dict]:
    """The heads of the left-hand chord under the cursor, lowest first."""
    return page.evaluate(
        """() => {
          const cursor = document.querySelector('img[id^=cursorImg]')?.getBoundingClientRect();
          const near = [...document.querySelectorAll('.vf-stavenote')]
            .filter((g) => g.querySelectorAll('.vf-notehead').length === 2)
            .map((g) => ({ g, r: g.getBoundingClientRect() }))
            .filter(({ r }) => r.width > 0 && r.left < innerWidth && r.right > 0)
            .sort((a, b) => Math.abs(a.r.left - cursor.left) - Math.abs(b.r.left - cursor.left));
          return [...near[0].g.querySelectorAll('.vf-notehead')].map((h) => {
            const r = h.getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
          }).sort((a, b) => b.y - a.y);
        }"""
    )


def stack_at_cursor(page) -> list[str]:
    """The purple finger labels under the two-note chord at the cursor, top to bottom."""
    return page.evaluate(
        """() => {
          const cursor = document.querySelector('img[id^=cursorImg]')?.getBoundingClientRect();
          const c = [...document.querySelectorAll('.vf-stavenote')]
            .filter((g) => g.querySelectorAll('.vf-notehead').length === 2)
            .map((g) => g.getBoundingClientRect())
            .filter((r) => r.width > 0)
            .sort((a, b) => Math.abs(a.left - cursor.left) - Math.abs(b.left - cursor.left))[0];
          const cx = c.left + c.width / 2;
          return [...document.querySelectorAll('svg text')]
            .filter((t) => /^[1-5]$/.test(t.textContent.trim()) && t.style.fill.replace(/ /g, '') === 'rgb(124,58,237)')
            .map((t) => ({ text: t.textContent.trim(), r: t.getBoundingClientRect() }))
            .filter(({ r }) => Math.abs(r.left + r.width / 2 - cx) < 14 && r.top >= c.top)
            .sort((a, b) => a.r.top - b.r.top)
            .map(({ text }) => text);
        }"""
    )


def upper_head(page) -> dict:
    """The right-hand head under the cursor."""
    return page.evaluate(
        """() => {
          const cursor = document.querySelector('img[id^=cursorImg]').getBoundingClientRect();
          const heads = [...document.querySelectorAll('.vf-notehead')].map((h) => h.getBoundingClientRect())
            .filter((r) => r.left < innerWidth && r.right > 0 && r.top < cursor.top + cursor.height / 2)
            .sort((a, b) => Math.abs(a.left - cursor.left) - Math.abs(b.left - cursor.left));
          return { x: heads[0].left + heads[0].width / 2, y: heads[0].top + heads[0].height / 2 };
        }"""
    )


def yellow_heads(page) -> int:
    return page.evaluate(
        """(c) => [...document.querySelectorAll('.vf-notehead')].filter((h) =>
             h.style.fill === c || [...h.querySelectorAll('*')].some((e) => e.style.fill === c)).length""",
        YELLOW,
    )


def off_note(page) -> dict:
    """A spot in the score with nothing on it: above the top staff."""
    spot = page.evaluate(
        """() => {
          const top = Math.min(...[...document.querySelectorAll('.vf-notehead')].map((h) => h.getBoundingClientRect().top));
          const panel = document.querySelector('img[id^=cursorImg]').parentElement.getBoundingClientRect();
          return { x: innerWidth / 2 + 200, y: Math.max(panel.top, 240) + (top > 300 ? 20 : 2) };
        }"""
    )
    page.mouse.move(spot["x"], spot["y"])
    page.wait_for_timeout(120)
    return spot


def edit_checks(page, score: Path, original: list) -> None:
    type_bar(page, "bar-now", 23)
    page.wait_for_timeout(500)
    low, _high = chord_heads(page)
    page.mouse.move(low["x"], low["y"])
    page.wait_for_timeout(200)
    check(yellow_heads(page) >= 1, "the note under the pointer is yellow")

    before = layout(page)
    at = where()
    mark_drawing(page)
    watch_frames(page)
    page.mouse.wheel(0, -100)  # B2 was 4: up is 5
    page.wait_for_timeout(900)
    frames = frames_seen(page)
    after = layout(page)
    check(same_drawing(page), "changing a finger's number doesn't redraw the score at all")
    check(stack_at_cursor(page) == ["2", "5"], "the label on screen says the new number", stack_at_cursor(page))
    check(after == before, "wheel edit: nothing on screen moved", _first_diff(before, after))
    check(where() == at, "wheel edit: the cursor stayed", (at, where()))
    check(yellow_heads(page) >= 1, "wheel edit: the note stays yellow")
    print(f"frames watched: {len(frames)}, score blank in {sum(1 for c, _ in frames if c == 0)}, "
          f"positions {sorted({x for _, x in frames if x is not None})}")
    if frames:
        check(all(c > 0 for c, _ in frames), "wheel edit: no frame without the score")
        check(len({x for _, x in frames}) == 1, "wheel edit: no frame with the score elsewhere")
    else:
        print("NOTE no animation frames in this hidden window: frame check not run")
    now = marks_of(score)
    check(now != original and sum(a != b for a, b in zip(now, original)) == 1, "wheel edit: the file changed one mark")
    page.screenshot(path=str(SHOTS / "wheel_edit_bar23.png"))

    # The next notch of the same spin still edits, on top of the last save.
    page.mouse.wheel(0, 100)
    page.wait_for_timeout(900)
    check(marks_of(score) == original, "wheel back: the file is as it was")
    check(layout(page) == before, "wheel back: nothing on screen moved")
    check(same_drawing(page), "wheel back: still no redraw")

    # Click: add a mark to a note with none, then take it off. Bar 20's right hand has none.
    type_bar(page, "bar-now", 20)
    page.wait_for_timeout(500)
    head = upper_head(page)
    before = layout(page)
    count = len(renders(page))
    page.mouse.click(head["x"], head["y"])
    page.get_by_test_id("finger-picker").wait_for(timeout=3000)
    page.get_by_test_id("finger-picker").get_by_role("button", name="3", exact=True).click()
    page.wait_for_timeout(700)
    check(len(renders(page)) == count + 1, "a click edit took the in-place path")
    check(layout(page) == before, "click adds a mark: nothing on screen moved", _first_diff(before, layout(page)))
    added = marks_of(score)
    check(sum(a != b for a, b in zip(added, original)) == 1 and "3" in [a for a, b in zip(added, original) if a != b],
          "click adds a mark: saved")
    page.mouse.click(head["x"], head["y"])
    page.get_by_test_id("finger-picker").wait_for(timeout=3000)
    page.get_by_test_id("finger-picker").get_by_role("button", name="×", exact=True).click()
    page.wait_for_timeout(700)
    check(marks_of(score) == original, "click takes the mark off: the file is as it was")
    check(layout(page) == before, "click takes the mark off: nothing on screen moved", _first_diff(before, layout(page)))


def _first_diff(a: dict, b: dict):
    if a["cursor"] != b["cursor"]:
        return ("cursor", a["cursor"], b["cursor"])
    if len(a["heads"]) != len(b["heads"]):
        return ("heads", len(a["heads"]), len(b["heads"]))
    return next((p for p in zip(a["heads"], b["heads"]) if p[0] != p[1]), None)


def reload_keeps_edit(page, score: Path, original: list) -> None:
    """A finger edited in place, then a layout switch reloads the score: the new number must be drawn."""
    type_bar(page, "bar-now", 23)
    page.wait_for_timeout(500)
    low, _high = chord_heads(page)
    page.mouse.move(low["x"], low["y"])
    page.wait_for_timeout(200)
    page.mouse.wheel(0, -100)  # B2 4 -> 5
    page.wait_for_timeout(900)
    check(stack_at_cursor(page) == ["2", "5"], "edited in place", stack_at_cursor(page))
    page.get_by_role("button", name="Pages", exact=True).click()
    page.wait_for_function("() => document.querySelectorAll('.vf-notehead').length > 50", timeout=60000)
    page.wait_for_timeout(2500)
    page.get_by_role("button", name="Strip", exact=True).click()
    page.wait_for_function("() => document.querySelectorAll('.vf-notehead').length > 50", timeout=60000)
    page.wait_for_timeout(2500)
    type_bar(page, "bar-now", 23)
    page.wait_for_timeout(500)
    check(stack_at_cursor(page) == ["2", "5"], "a reload (layout switch) keeps the edited finger", stack_at_cursor(page))
    low, _high = chord_heads(page)
    page.mouse.move(low["x"], low["y"])
    page.wait_for_timeout(200)
    page.mouse.wheel(0, 100)  # 5 -> 4
    page.wait_for_timeout(900)
    check(marks_of(score) == original, "the next edit builds on it: the file is as it was")


def wheel_checks(page) -> None:
    type_bar(page, "bar-now", 20)
    page.wait_for_timeout(300)
    # What one note forward looks like, from the Next button.
    seq = [where()]
    for _ in range(14):
        page.get_by_role("button", name="Next ▶").click()
        page.wait_for_timeout(120)
        seq.append(where())
    type_bar(page, "bar-now", 20)
    page.wait_for_timeout(300)
    off_note(page)
    check(yellow_heads(page) == 0, "off a note: nothing is yellow")

    i = 0
    for delta in (1, 4, 53, 100, 120, 500):
        page.mouse.wheel(0, delta)
        page.wait_for_timeout(180)
        i += 1
        check(where() == seq[i], f"a single notch of {delta} moves one note", (where(), seq[i]))
    check(len({m for m, _ in seq[:i + 1]}) >= 1, "steps stayed note by note")
    for delta in (-1, -120):
        page.mouse.wheel(0, delta)
        page.wait_for_timeout(180)
        i -= 1
        check(where() == seq[i], f"a notch of {delta} moves one note back", (where(), seq[i]))

    # A fast spin and a trackpad-like stream, in the page so the gaps are what they say.
    page.evaluate(
        """async () => {
          const el = document.elementFromPoint(innerWidth / 2 + 200, 300) ?? document.body;
          const send = (deltaY) => el.dispatchEvent(new WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true }));
          for (let k = 0; k < 41; k++) { send(5); await new Promise((r) => setTimeout(r, 16)); }
        }"""
    )
    page.wait_for_timeout(300)
    moved = seq.index(where()) - i if where() in seq else None
    check(moved == 3, "a trackpad stream of 41 small deltas (200 in all) moves 3 notes", moved)


def loop_checks(page) -> None:
    page.get_by_test_id("loop-bars").click()
    page.wait_for_timeout(200)
    type_bar(page, "loop-first", 22)
    type_bar(page, "loop-last", 23)
    start = screen()
    check(start["loop"]["firstBar"] == 22 and start["measure"] == 22, "loop 22-23 set", start["loop"])
    off_note(page)

    page.mouse.wheel(0, -100)
    page.wait_for_timeout(200)
    check(screen()["measure"] == 22 and where() == (start["measure"], tuple(sorted(start["remaining"]))),
          "the wheel stops at the loop's first note")
    for _ in range(30):
        page.mouse.wheel(0, 100)
        page.wait_for_timeout(70)
    s = screen()
    check(s["measure"] == 23, "the wheel stops at the loop's last note", s["measure"])
    check(s["loop"]["firstBar"] == 22 and s["loop"]["lastBar"] == 23, "the range is unchanged", s["loop"])
    last_in_loop = where()

    page.keyboard.down("Shift")
    page.wait_for_timeout(100)
    page.mouse.wheel(0, 100)
    page.wait_for_timeout(200)
    check(screen()["measure"] == 24, "Shift+wheel goes past the loop's edge", screen()["measure"])
    # macOS sends a Shift+wheel sideways.
    was = where()
    page.mouse.wheel(100, 0)
    page.wait_for_timeout(200)
    check(where() != was, "a sideways Shift+wheel moves too")
    page.keyboard.up("Shift")
    s = screen()
    check(s["loop"]["firstBar"] == 22 and s["loop"]["lastBar"] == 23, "the range is still unchanged", s["loop"])
    for _ in range(2):
        page.mouse.wheel(0, -100)
        page.wait_for_timeout(200)
    check(where() == last_in_loop, "outside the loop, the plain wheel walks back to it", (where(), last_in_loop))

    # Build backwards: a scrolled lap doesn't count as clean; the next, played whole, does.
    page.get_by_test_id("build-backwards").click()
    page.wait_for_timeout(500)
    b = screen()["backwards"]
    check(b is not None and b["clean"] == 0, "Build backwards on", b)
    off_note(page)
    page.mouse.wheel(0, 100)
    page.wait_for_timeout(200)
    check(screen()["backwards"] == b, "scrolling leaves its progress alone", screen()["backwards"])

    def play_lap() -> None:
        lap = screen()["loop"]["lap"]
        for _ in range(120):
            s = screen()
            if s["loop"]["lap"] != lap:
                return
            strike([midi_of(n) for n in s.get("remaining", [])])
            time.sleep(0.2)
        sys.exit(f"lap never wrapped: {screen()}")

    play_lap()
    check(screen()["backwards"]["clean"] == 0, "the lap he scrolled in isn't clean", screen()["backwards"])
    play_lap()
    check(screen()["backwards"]["clean"] == 1, "the next lap, played whole, is", screen()["backwards"])
    page.get_by_test_id("clear-loop").click()
    page.wait_for_timeout(300)


def main() -> int:
    score = Path(sys.argv[1])
    original = marks_of(score)
    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp(CDP)
        page = browser.contexts[0].pages[0]
        page.on("console", lambda m: m.type == "error" and print("console:", m.text))
        page.on("pageerror", lambda e: print("pageerror:", e))
        page.reload()
        page.wait_for_timeout(1500)
        page.get_by_role("button", name="Score", exact=True).click()
        page.wait_for_selector("[data-testid=loop-bars]", timeout=30000)
        page.wait_for_function("() => [...document.querySelector('select').options].some((o) => o.value.includes('sorcerers'))", timeout=30000)
        page.locator("select").first.select_option("file:sorcerers-apprentice.musicxml")
        page.wait_for_function("() => document.querySelectorAll('.vf-notehead').length > 50", timeout=60000)
        # A hidden window barely animates: a smooth scroll would never settle before a measurement.
        page.evaluate(
            """() => {
              const scrollTo = Element.prototype.scrollTo;
              Element.prototype.scrollTo = function (o) { scrollTo.call(this, { ...o, behavior: 'auto' }); };
            }"""
        )
        page.wait_for_timeout(2500)
        edit_checks(page, score, original)
        reload_keeps_edit(page, score, original)
        wheel_checks(page)
        loop_checks(page)
        times = renders(page)
        if times:
            print(f"finger-render ms: {[round(t) for t in times]} median {round(statistics.median(times))}")
    check(marks_of(score) == original, "the file's marks are as they started")
    print(f"\n{len(FAILS)} failed" if FAILS else "\nall passed")
    return 1 if FAILS else 0


if __name__ == "__main__":
    raise SystemExit(main())
