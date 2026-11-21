"""#6661 end-to-end check of "Tie to previous" / "Tie to next" on a hidden Electron app.

Runs on a COPY of Sorcerer's Apprentice in a scratch Pieces folder, never his files. Start the
hidden, muted test copy first (memory hidden-test-copy-must-be-muted), e.g.
    MIDITUTOR_PIECES_DIR=<scratch>/pieces MIDITUTOR_ALLOW_INJECT=1 MIDITUTOR_HIDDEN=1 MIDITUTOR_PORT=47811 \
      ./out/MidiTutor-win32-x64/MidiTutor.exe --mute-audio --user-data-dir=<scratch>/ud --remote-debugging-port=9347
then
    MIDITUTOR_CDP=http://127.0.0.1:9347 MIDITUTOR_URL=http://127.0.0.1:47811 MIDITUTOR_TOKEN_FILE=<scratch>/ud/api-token \
      python scripts/e2e_tie_marks.py <scratch>/pieces/sorcerers-apprentice.musicxml

His case (page 1, line 1): bar 1's A-flat 5 is tied over, rests, then A-flat 5 again in bar 2. At bar 1 he
opens the picker from the strip's A-flat 5 key and uses "Tie to next": bar 2's A-flat 5 gets the hold
mark in the file, a blue tie arc is drawn on it, and the tutor no longer asks for it. "Untie from next"
takes it all back. "Tie to previous" on that bar-2 note does the same from the other end.
"""
from __future__ import annotations

import os
import re
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from miditutor_mcp import tutor_client as tc  # noqa: E402

CDP = os.environ.get("MIDITUTOR_CDP", "http://127.0.0.1:9347")
AB5 = 80
FAILS: list[str] = []


def check(cond, label, detail=""):
    print(("PASS " if cond else "FAIL ") + label + ("" if cond else f"  {detail}"))
    if not cond:
        FAILS.append(label)


def held_in_bar(path: Path, bar: int) -> list[str]:
    """Pitches (step+alter+octave) of the notes marked hold in that bar."""
    xml = path.read_text(encoding="utf-8")
    measure = re.search(rf'<measure[^>]*number="{bar}".*?</measure>', xml, re.S).group(0)
    out = []
    for n in re.findall(r"<note\b.*?</note>", measure, re.S):
        if 'other-play type="miditutor"' in n:
            p = re.search(r"<step>(\w)</step>\s*(?:<alter>(-?\d)</alter>)?\s*<octave>(\d)</octave>", n)
            out.append(p.group(1) + (p.group(2) or "") + p.group(3))
    return out


def wait_file(path: Path, bar: int, want: list[str], label: str):
    for _ in range(40):
        if held_in_bar(path, bar) == want:
            break
        time.sleep(0.25)
    check(held_in_bar(path, bar) == want, label, held_in_bar(path, bar))


def arcs(page) -> list[str]:
    return page.evaluate("() => [...document.querySelectorAll('[data-testid=tie-mark]')].map((a) => a.getAttribute('data-target'))")


def arc_gap(page) -> float | None:
    """Screen px from the arc's end to the nearest notehead's top-left corner (the arc arrives there)."""
    return page.evaluate(
        """() => {
          const a = document.querySelector('[data-testid=tie-mark]');
          if (!a) return null;
          const r = a.getBoundingClientRect();
          const gaps = [...document.querySelectorAll('.vf-notehead')].map((h) => h.getBoundingClientRect())
            .filter((h) => h.width > 0).map((h) => Math.hypot(h.left - r.right, h.top - r.bottom));
          return Math.min(...gaps);
        }"""
    )


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


def screen_layout() -> str | None:
    return (tc.state().get("screen") or {}).get("scoreLayout")


def pick_key(page, midi: int) -> None:
    page.locator(f"[data-testid=keyboard-strip] [data-midi='{midi}']").first.click()
    page.wait_for_selector("[data-testid=finger-picker]")


def step_to_ab5(page, wanted: int) -> bool:
    """Put the cursor on the step of bar `wanted` that asks for Ab5; False if none does.

    Coming back with Prev lands on a bar's LAST step, so look backwards through the bar too.
    """
    def asks() -> bool | None:
        s = tc.state().get("screen") or {}
        if s.get("measure") != wanted:
            return None
        return bool({"Ab5", "G#5"} & set(s.get("remaining") or []))

    for name in ("◀ Prev", "Next ▶"):
        go_to_bar(page, wanted)
        page.wait_for_timeout(300)
        for _ in range(16):
            got = asks()
            if got is None:
                break
            if got:
                return True
            page.get_by_role("button", name=name).click()
            page.wait_for_timeout(150)
    return False


def asked_in_bar2(page) -> bool:
    return step_to_ab5(page, 2)


def main() -> int:
    score = Path(sys.argv[1])
    if "piano" in str(score).lower() and "library" in str(score).lower() or "MidiTutor Pieces" in str(score):
        sys.exit("refusing to touch a real score: pass a scratch copy")
    check(held_in_bar(score, 2) == [], "copy starts with no hold in bar 2", held_in_bar(score, 2))
    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp(CDP)
        page = browser.contexts[0].pages[0]
        page.on("console", lambda m: m.type == "error" and print("console:", m.text))
        page.reload()
        page.get_by_role("button", name="Score", exact=True).click()
        page.wait_for_selector("[data-testid=loop-bars]", timeout=30000)
        sel = page.get_by_test_id("piece-select")
        page.wait_for_function("() => [...document.querySelectorAll('[data-testid=piece-select] option')].some((o) => /sorcerer/i.test(o.text))", timeout=30000)
        value = sel.evaluate("s => [...s.options].find((o) => /sorcerer/i.test(o.text) || o.value.includes('sorcerers')).value")
        sel.select_option(value)
        page.wait_for_function("() => document.querySelectorAll('.vf-notehead').length > 50", timeout=60000)
        page.wait_for_timeout(2000)

        check(asked_in_bar2(page), "before: bar 2 asks for Ab5 (after its rests)")
        check(arcs(page) == [], "before: no tie arcs drawn", arcs(page))

        # Tie to next from bar 1's A-flat 5.
        check(step_to_ab5(page, 1), "bar 1 has a step asking for Ab5")
        pick_key(page, AB5)
        btn = page.get_by_test_id("tie-next-toggle")
        check(btn.inner_text() == "Tie to next" and btn.is_enabled(), "picker offers Tie to next", btn.inner_text())
        check(page.get_by_test_id("hold-toggle").inner_text() == "Tie to previous", "picker names Tie to previous")
        btn.click()
        wait_file(score, 2, ["A-15"], "Tie to next marks bar 2's Ab5 in the file")
        page.wait_for_function("() => document.querySelectorAll('.vf-notehead').length > 50", timeout=60000)
        page.wait_for_timeout(1500)
        drawn = arcs(page)
        check(len(drawn) == 1 and drawn[0].startswith("2:1:") and drawn[0].endswith(f":{AB5}"), "one tie arc, on bar 2's Ab5", drawn)
        check((arc_gap(page) or 99) < 4, "strip: the arc ends at a notehead", arc_gap(page))
        page.keyboard.press("p")  # #6373: P flips to Pages and back
        page.wait_for_timeout(2500)
        check(screen_layout() == "pages" and len(arcs(page)) == 1 and (arc_gap(page) or 99) < 4, "pages: the arc is drawn at a notehead",
              (screen_layout(), arcs(page), arc_gap(page)))
        page.keyboard.press("p")
        page.wait_for_timeout(2500)
        check(not asked_in_bar2(page), "after: bar 2 no longer asks for Ab5")

        # The picker on bar 1 now shows it tied; untie from there.
        check(step_to_ab5(page, 1), "bar 1 has a step asking for Ab5")
        pick_key(page, AB5)
        btn = page.get_by_test_id("tie-next-toggle")
        check(btn.inner_text() == "Untie from next", "picker shows Untie from next", btn.inner_text())
        btn.click()
        wait_file(score, 2, [], "Untie from next clears the file")
        page.wait_for_timeout(1500)
        check(arcs(page) == [], "untie: arc gone", arcs(page))
        check(asked_in_bar2(page), "untie: bar 2 asks for Ab5 again")

        # Tie to previous from bar 2's own A-flat 5 (the cursor is on it now).
        pick_key(page, AB5)
        check(page.get_by_test_id("hold-toggle").inner_text() == "Tie to previous", "bar 2 picker: Tie to previous")
        page.get_by_test_id("hold-toggle").click()
        wait_file(score, 2, ["A-15"], "Tie to previous marks bar 2's Ab5")
        page.wait_for_timeout(1500)
        check(len(arcs(page)) == 1, "tie to previous draws the arc", arcs(page))
        # The cursor skips the held note now, so untie it from bar 1's end.
        check(step_to_ab5(page, 1), "bar 1 has a step asking for Ab5")
        pick_key(page, AB5)
        page.get_by_test_id("tie-next-toggle").click()
        wait_file(score, 2, [], "and Untie from next takes off a Tie to previous mark")
        page.wait_for_timeout(1500)

        events = tc.request("GET", "/events?since=0&limit=2000")["events"]
        vias = [e.get("data", e).get("via") for e in events if e.get("kind") == "hold"]
        check(vias[:4] == ["next", "next", "previous", "next"], "day log records which button", vias)
    print("FAILED: " + ", ".join(FAILS) if FAILS else "ALL PASS")
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
