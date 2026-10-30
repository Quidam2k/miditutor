"""#10256 end-to-end check on a hidden Electron app: stacked left-hand fingers read top to bottom in
the same order as the notes they belong to (bars 23-25 of Sorcerer's), on a COPY of the score.

    MIDITUTOR_HIDDEN=1 MIDITUTOR_WINDOW_SIZE=1600x900 MIDITUTOR_PORT=47812 MIDITUTOR_VITE_PORT=5183 \
      MIDITUTOR_PIECES_DIR=<copy> npx electron-forge start -- --remote-debugging-port=9346 --user-data-dir=<scratch>
    MIDITUTOR_CDP=http://127.0.0.1:9346 python scripts/e2e_lh_fingering_order.py <copy>/sorcerers-apprentice.musicxml

It reads the marks from the file and the labels from the drawn SVG, and never changes the file.
"""
from __future__ import annotations

import hashlib
import os
import re
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

CDP = os.environ.get("MIDITUTOR_CDP", "http://127.0.0.1:9346")
SHOTS = Path(__file__).resolve().parent.parent / "screengrab"
ALTER = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
FAILS: list[str] = []


def check(cond, label, detail="") -> None:
    print(("PASS " if cond else "FAIL ") + label + ("" if cond else f"  {detail}"))
    if not cond:
        FAILS.append(label)


def lh_chord(xml: str, bar: int) -> list[str]:
    """Fingers of the bar's first left-hand chord, highest note first: the order they should read."""
    measure = re.search(rf'<measure[^>]*number="{bar}".*?</measure>', xml, re.S).group(0)
    notes = []
    for n in re.findall(r"<note\b.*?</note>", measure, re.S):
        if "<rest" in n or "<staff>2" not in n:
            continue
        step = re.search(r"<step>(.)", n).group(1)
        alter = re.search(r"<alter>(-?\d)", n)
        octave = int(re.search(r"<octave>(\d)", n).group(1))
        finger = re.search(r"<fingering[^>]*>(\d)", n)
        if "<chord" not in n and len(notes) > 1:
            break
        if "<chord" not in n:
            notes = []
        notes.append((12 * (octave + 1) + ALTER[step] + int(alter.group(1) if alter else 0), finger.group(1) if finger else None))
    return [f for _, f in sorted(notes, reverse=True) if f]


def bar(page) -> int:
    return int(page.get_by_test_id("bar-now").input_value())


def go_to_bar(page, wanted: int) -> None:
    for _ in range(400):
        now = bar(page)
        if now == wanted:
            return
        page.get_by_role("button", name="Next ▶" if now < wanted else "◀ Prev").click()
        page.wait_for_timeout(30)
    sys.exit(f"could not reach bar {wanted}")


def drawn_stack(page) -> list[str]:
    """The purple finger labels under the two-note chord nearest the cursor, top to bottom."""
    return page.evaluate(
        """() => {
          const cursor = document.querySelector('img[id^=cursorImg]')?.getBoundingClientRect();
          const chords = [...document.querySelectorAll('.vf-stavenote')]
            .filter((g) => g.querySelectorAll('.vf-notehead').length === 2)
            .map((g) => g.getBoundingClientRect())
            .filter((r) => r.width > 0 && r.top > (cursor?.top ?? 0) + (cursor?.height ?? 0) / 2)
            .sort((a, b) => Math.abs(a.left - cursor.left) - Math.abs(b.left - cursor.left));
          const c = chords[0];
          if (!c) return [];
          const cx = c.left + c.width / 2;
          return [...document.querySelectorAll('svg text')]
            .filter((t) => /^[1-5]$/.test(t.textContent.trim()) && t.style.fill.replace(/ /g, '') === 'rgb(124,58,237)')
            .map((t) => ({ text: t.textContent.trim(), r: t.getBoundingClientRect() }))
            .filter(({ r }) => Math.abs(r.left + r.width / 2 - cx) < 14 && r.top >= c.top)
            .sort((a, b) => a.r.top - b.r.top)
            .map(({ text }) => text);
        }"""
    )


def main() -> int:
    score = Path(sys.argv[1])
    before = hashlib.sha256(score.read_bytes()).hexdigest()
    xml = score.read_text(encoding="utf-8")
    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp(CDP)
        page = browser.contexts[0].pages[0]
        page.on("console", lambda m: m.type == "error" and print("console:", m.text))
        page.reload()
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
        for number in (23, 24, 25):
            go_to_bar(page, number)
            page.wait_for_timeout(600)
            want, got = lh_chord(xml, number), drawn_stack(page)
            print(f"bar {number}: file high-to-low {want}, drawn top-to-bottom {got}")
            check(len(want) == 2 and got == want, f"bar {number} reads in note order", (want, got))
            page.screenshot(path=str(SHOTS / f"lh_fingering_bar{number}.png"))
    check(hashlib.sha256(score.read_bytes()).hexdigest() == before, "the file is untouched")
    print(f"\n{len(FAILS)} failed" if FAILS else "\nall passed")
    return 1 if FAILS else 0


if __name__ == "__main__":
    raise SystemExit(main())
