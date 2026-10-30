"""#10236 #10237 #10238 end-to-end check on a hidden Electron app (real Pieces folder, real save).

Start a hidden test app with a scratch folder holding a COPY of the score, never his files:
    MIDITUTOR_HIDDEN=1 MIDITUTOR_PORT=47811 MIDITUTOR_VITE_PORT=5182 MIDITUTOR_PIECES_DIR=<copy> \
      npx electron-forge start -- --remote-debugging-port=9333 --user-data-dir=<scratch>
then, with a Python that has Playwright:
    python scripts/e2e_chord_fingering.py <copy>/sorcerers-apprentice.musicxml

Uses bar 25's left-hand chord (D-flat 3 over B 2), which starts with Db3 = 3 and B2 empty.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

CDP = "http://127.0.0.1:9333"
FAILS: list[str] = []
DB3, B2 = 49, 47
YELLOW = "rgb(255, 230, 0)"


def check(cond, label, detail=""):
    print(("PASS " if cond else "FAIL ") + label + ("" if cond else f"  {detail}"))
    if not cond:
        FAILS.append(label)


def bar_notes(path: Path, bar: int) -> dict[tuple[str, str], str | None]:
    xml = path.read_text(encoding="utf-8")
    measure = re.search(rf'<measure[^>]*number="{bar}".*?</measure>', xml, re.S).group(0)
    out = {}
    for note in re.findall(r"<note\b.*?</note>", measure, re.S):
        if "<rest" in note:
            continue
        step = re.search(r"<step>(.)</step>", note).group(1)
        alter = re.search(r"<alter>(-?\d)</alter>", note)
        octave = re.search(r"<octave>(\d)", note).group(1)
        finger = re.search(r"<fingering[^>]*>(\d)", note)
        out[(step + (alter.group(1) if alter else ""), octave)] = finger.group(1) if finger else None
    return out


def wait_saved(page, path: Path, want, label):
    for _ in range(40):
        page.wait_for_timeout(250)
        got = bar_notes(path, 25)
        if got.get(want[0]) == want[1]:
            break
    check(got.get(want[0]) == want[1], label, got)


def yellow_heads(page) -> int:
    return page.evaluate(
        """(c) => [...document.querySelectorAll('.vf-notehead')].filter((h) =>
             h.style.fill === c || [...h.querySelectorAll('*')].some((e) => e.style.fill === c)).length""",
        YELLOW,
    )


def bar(page) -> int:
    return int(re.search(r"\d+", page.locator("text=/^Bar \\d+/").first.inner_text()).group(0))


def go_to_bar(page, wanted: int) -> None:
    for _ in range(400):
        now = bar(page)
        if now == wanted:
            return
        page.get_by_role("button", name="Next ▶" if now < wanted else "◀ Prev").click()
        page.wait_for_timeout(30)
    sys.exit(f"could not reach bar {wanted}")


def chord_at_cursor(page):
    """The two heads of the chord under the cursor's bar 25: find them by key positions."""
    return page.evaluate(
        """() => {
          const pairs = [...document.querySelectorAll('.vf-stavenote')].filter((g) =>
            g.querySelectorAll('.vf-notehead').length === 2);
          const cursor = document.querySelector('img[id^=cursorImg]')?.getBoundingClientRect();
          const near = pairs
            .map((g) => ({ g, r: g.getBoundingClientRect() }))
            .filter(({ r }) => r.width > 0 && r.left < innerWidth && r.right > 0)
            .sort((a, b) => Math.abs(a.r.left - (cursor?.left ?? 0)) - Math.abs(b.r.left - (cursor?.left ?? 0)));
          const heads = [...near[0].g.querySelectorAll('.vf-notehead')].map((h) => {
            const r = h.getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
          });
          return heads.sort((a, b) => b.y - a.y);
        }"""
    )


def main() -> int:
    score = Path(sys.argv[1])
    before = score.read_text(encoding="utf-8").count("<fingering")
    start = bar_notes(score, 25)
    check(start[("D-1", "3")] == "3" and start[("B", "2")] is None, "copy starts Db3 = 3, B2 empty", start)
    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp(CDP)
        page = browser.contexts[0].pages[0]
        page.on("console", lambda m: m.type == "error" and print("console:", m.text))
        page.reload()  # this session's edits live in memory too: read the copy fresh
        page.get_by_role("button", name="Score", exact=True).click()
        page.wait_for_selector("[data-testid=loop-bars]", timeout=30000)
        page.wait_for_timeout(1500)
        sel = page.locator("select").first
        value = sel.evaluate(
            "s => [...s.options].find((o) => /sorcerer/i.test(o.text) || o.value.includes('sorcerers')).value"
        )
        sel.select_option(value)
        page.wait_for_function("() => document.querySelectorAll('.vf-notehead').length > 50", timeout=60000)
        page.wait_for_timeout(2000)
        go_to_bar(page, 25)
        page.wait_for_timeout(500)

        low, high = chord_at_cursor(page)

        # #10237: an empty note counts up from 1, down from 5; past the end it's empty.
        page.mouse.move(low["x"], low["y"])
        page.wait_for_timeout(200)
        # In the page, so the steps land inside the commit delay however slow the hidden window is.
        shown = page.evaluate(
            """async ({ x, y }) => {
              const out = [];
              const on = document.elementFromPoint(x, y);
              for (const deltaY of [-100, 100, 100, -100]) {
                on.dispatchEvent(new WheelEvent('wheel', { deltaY, clientX: x, clientY: y, bubbles: true, cancelable: true }));
                await new Promise((r) => setTimeout(r, 40));
                out.push(document.querySelector('[data-testid=finger-live]')?.textContent);
              }
              return out;
            }""",
            low,
        )
        check(shown == ["1", "–", "5", "–"], "empty B2: up 1, down to empty, down 5, up to empty", shown)
        page.wait_for_timeout(1500)
        check(bar_notes(score, 25)[("B", "2")] is None, "wheel back to empty leaves B2 empty")
        low, high = chord_at_cursor(page)
        page.mouse.move(5, 400)

        # (a) the two heads of a chord are two different notes.
        page.mouse.click(low["x"], low["y"])
        page.wait_for_selector("[data-testid=finger-picker]")
        check("B" in page.get_by_test_id("finger-pick-name").inner_text(), "tap the low head picks B2",
              page.get_by_test_id("finger-pick-name").inner_text())
        check(yellow_heads(page) == 1, "picker: exactly one head yellow", yellow_heads(page))
        page.get_by_test_id("finger-picker").get_by_role("button", name="4", exact=True).click()
        wait_saved(page, score, (("B", "2"), "4"), "B2 = 4 saved")
        page.wait_for_timeout(1500)
        got = bar_notes(score, 25)
        check(got[("D-1", "3")] == "3", "Db3 keeps 3 after setting B2", got)

        low, high = chord_at_cursor(page)
        page.mouse.click(high["x"], high["y"])
        page.wait_for_selector("[data-testid=finger-picker]")
        check("D" in page.get_by_test_id("finger-pick-name").inner_text(), "tap the high head picks Db3",
              page.get_by_test_id("finger-pick-name").inner_text())
        page.get_by_test_id("finger-picker").get_by_role("button", name="Cancel").click()

        # Hold is per note too. The strip re-centres after a save, so read the heads again.
        page.wait_for_timeout(500)
        low, high = chord_at_cursor(page)
        page.mouse.click(low["x"], low["y"])
        page.get_by_test_id("hold-toggle").click()
        page.wait_for_timeout(1500)
        xml = score.read_text(encoding="utf-8")
        measure = re.search(r'<measure[^>]*number="25".*?</measure>', xml, re.S).group(0)
        held = [n for n in re.findall(r"<note\b.*?</note>", measure, re.S) if "other-play" in n]
        check(len(held) == 1 and "<step>B</step>" in held[0], "hold lands on B2 only", held)
        low, high = chord_at_cursor(page)
        page.mouse.click(low["x"], low["y"])
        page.get_by_test_id("hold-toggle").click()
        page.wait_for_timeout(1500)

        # #10237: hover yellow, wheel edits, the score stays put.
        low, high = chord_at_cursor(page)
        page.mouse.move(high["x"], high["y"])
        page.wait_for_timeout(200)
        check(yellow_heads(page) == 1, "hover: one head yellow", yellow_heads(page))
        at = bar(page)
        page.mouse.wheel(0, -100)
        page.wait_for_timeout(100)
        wait_saved(page, score, (("D-1", "3"), "4"), "wheel up saved Db3 = 4")
        check(bar(page) == at, "score did not move under the wheel", bar(page))
        page.wait_for_timeout(1500)
        low, high = chord_at_cursor(page)
        page.mouse.move(high["x"] + 1, high["y"])
        page.wait_for_timeout(200)
        page.mouse.wheel(0, 100)
        wait_saved(page, score, (("D-1", "3"), "3"), "wheel down restores Db3 = 3")
        page.wait_for_timeout(1500)

        # Off a note: the strip moves a bar, nothing turns yellow.
        page.mouse.move(5, 400)
        page.wait_for_timeout(200)
        check(yellow_heads(page) == 0, "off a note: no yellow", yellow_heads(page))
        panel = page.evaluate(
            """() => { const r = document.querySelector('.ring-transparent, .ring-4')?.getBoundingClientRect();
                 return { x: r.left + 4, y: r.top + 4 }; }"""
        )
        page.mouse.move(panel["x"], panel["y"])
        page.wait_for_timeout(200)
        at = bar(page)
        page.mouse.wheel(0, 100)
        page.wait_for_timeout(300)
        check(bar(page) == at + 1, "off a note: wheel down goes one bar on", bar(page))
        page.mouse.wheel(0, -100)
        page.wait_for_timeout(300)
        check(bar(page) == at, "off a note: wheel up comes one bar back", bar(page))

        # #10238: keys. In the step: yellow, and the wheel edits. Not in it: neither.
        check(bar(page) == 25, "back on bar 25", bar(page))
        key = page.locator(f"[data-midi='{B2}']")
        key.hover()
        page.wait_for_timeout(200)
        in_step = key.get_attribute("data-yellow") == "true"
        check(in_step, "hover in-step key B2: key yellow")
        check(yellow_heads(page) == 1, "hover in-step key: its notehead yellow too", yellow_heads(page))
        at = bar(page)
        page.mouse.wheel(0, 100)
        wait_saved(page, score, (("B", "2"), "3"), "wheel on key: B2 4 -> 3")
        check(bar(page) == at, "wheel on in-step key did not move the score", bar(page))
        page.wait_for_timeout(1500)
        page.locator(f"[data-midi='{B2}']").hover()
        page.wait_for_timeout(200)
        page.mouse.wheel(0, -100)
        wait_saved(page, score, (("B", "2"), "4"), "wheel on key: B2 3 -> 4")
        page.wait_for_timeout(1500)

        other = page.locator("[data-midi='100']")
        other.hover()
        page.wait_for_timeout(200)
        check(other.get_attribute("data-yellow") is None and yellow_heads(page) == 0,
              "hover out-of-step key: no yellow", yellow_heads(page))
        at = bar(page)
        page.mouse.wheel(0, 100)
        page.wait_for_timeout(300)
        check(bar(page) == at + 1, "wheel on out-of-step key scrolls", bar(page))
        page.mouse.wheel(0, -100)
        page.wait_for_timeout(300)

        # Yellow follows the cursor off a key.
        key = page.locator(f"[data-midi='{B2}']")
        key.hover()
        page.wait_for_timeout(200)
        check(key.get_attribute("data-yellow") == "true", "key yellow again at the step")
        page.get_by_role("button", name="Next ▶").evaluate("b => b.click()")
        page.wait_for_timeout(300)
        check(page.locator(f"[data-midi='{B2}']").get_attribute("data-yellow") is None,
              "cursor moves off: key not yellow")
        # Back to the bar's first step: Prev can't step back over an empty step, a bar-wheel can.
        page.locator("[data-midi='100']").hover()
        page.wait_for_timeout(200)
        page.mouse.wheel(0, 100)
        page.wait_for_timeout(300)
        page.mouse.wheel(0, -100)
        page.wait_for_timeout(300)

        # (c) key click opens the same picker.
        page.locator(f"[data-midi='{DB3}']").click()
        page.wait_for_selector("[data-testid=finger-picker]")
        check("D" in page.get_by_test_id("finger-pick-name").inner_text(), "key click opens Db3's picker")
        page.get_by_test_id("finger-picker").get_by_role("button", name="Cancel").click()

        final = bar_notes(score, 25)
        check(final[("D-1", "3")] == "3" and final[("B", "2")] == "4", "bar 25 ends Db3 = 3, B2 = 4", final)
        after = score.read_text(encoding="utf-8").count("<fingering")
        check(after == before + 1, f"no marks lost: {before} + 1", after)
        page.screenshot(path=str(score.parent.parent / "chord_fingering.png"))
    print("FAILED: " + ", ".join(FAILS) if FAILS else "ALL PASS")
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
