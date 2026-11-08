"""#5652 B end-to-end check on a hidden app: Notes "Eyes up" hides the note after a window (Timer) or on the pedal.

Start the packaged app hidden and muted on a FRESH scratch user-data dir with MIDITUTOR_TEST_SESSION=1 and
MIDITUTOR_ALLOW_INJECT=1 (see e2e_note_trainer.py), then with MIDITUTOR_URL / MIDITUTOR_TOKEN_FILE / MIDITUTOR_CDP set:
    python scripts/e2e_eyes_up.py
"""
from __future__ import annotations

import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

sys.path.insert(0, str(Path(__file__).resolve().parent))
from e2e_note_trainer import FAILS, GREEN, SHOTS, asked, check, next_note, open_notes, opened, strike, tc  # noqa: E402

NOTE_DRAWN = "() => document.querySelector('[data-testid=note-trainer] svg').innerHTML.includes('vf-stavenote')"


def pedal(down: bool) -> None:
    result = tc.request("POST", "/inject-pedal", {"down": down})
    if "error" in result:
        sys.exit(f"pedal inject failed: {result}")


def main() -> int:
    with sync_playwright() as p:
        page = opened(p)
        page.wait_for_timeout(1500)
        open_notes(page)
        page.get_by_role("button", name="Treble", exact=True).click()
        keys = page.get_by_text("Keys:")
        if "on" in keys.inner_text():
            keys.click()
        page.wait_for_timeout(300)
        box = page.get_by_test_id("note-trainer")

        # Off by default: nothing hides, no line.
        check(page.get_by_test_id("note-eyes-up").count() == 0, "off by default: no eyes-up line")
        page.wait_for_timeout(3500)
        check(box.get_attribute("data-hidden") is None and page.evaluate(NOTE_DRAWN), "off: the note stays up")

        # Timer: the note on screen now was asked untimed, so its answer leaves the window at 3 s.
        page.get_by_role("button", name="Timer", exact=True).click()
        page.wait_for_selector("[data-testid=note-eyes-up]", timeout=2000)
        check("3.0 s" in page.get_by_test_id("note-eyes-up").inner_text(), "says the 3 s window", page.get_by_test_id("note-eyes-up").inner_text())
        old, midi = asked(page)
        strike(midi)
        page.wait_for_timeout(200)
        check(box.get_attribute("data-eyes-up-ms") == "3000", "untimed answer leaves 3 s", box.get_attribute("data-eyes-up-ms"))

        # A timed note: up at first, hidden after 3 s, and not a miss for that.
        old, midi = next_note(page, old)
        page.wait_for_timeout(1500)
        check(box.get_attribute("data-hidden") is None and page.evaluate(NOTE_DRAWN), "timer: up during the window")
        page.wait_for_function("() => document.querySelector('[data-testid=note-trainer]').dataset.hidden === '1'", timeout=3000)
        check(not page.evaluate(NOTE_DRAWN), "timer: the note is gone from the staff after 3 s")
        check(page.get_by_test_id("note-feedback").inner_text().strip() == "", "hiding is not a miss: no feedback yet")
        strike(midi)
        page.wait_for_function(GREEN, timeout=2000)
        check(box.get_attribute("data-hidden") is None, "answered: the note comes back, green")
        took = page.get_by_test_id("note-feedback").inner_text()
        check(box.get_attribute("data-eyes-up-ms") == "2700", "right within twice the window: 10% shorter", (box.get_attribute("data-eyes-up-ms"), took))

        # A miss: 25% longer.
        old, midi = next_note(page, old)
        strike(midi + 1)
        page.wait_for_timeout(200)
        check(box.get_attribute("data-eyes-up-ms") == "3400", "a miss: 25% longer (2.7 -> 3.4 s)", box.get_attribute("data-eyes-up-ms"))

        # Fast right answers bring it down a step at a time.
        windows = []
        for _ in range(4):
            old, midi = next_note(page, old)
            page.wait_for_timeout(300)
            strike(midi)
            page.wait_for_timeout(150)
            windows.append(int(box.get_attribute("data-eyes-up-ms")))
        check(windows == sorted(windows, reverse=True) and windows[-1] < 3400, "fast answers shrink it", windows)

        # Pedal: no timer. The note stays until the pedal goes down.
        page.get_by_role("button", name="Pedal", exact=True).click()
        page.wait_for_timeout(200)
        check("pedal" in page.get_by_test_id("note-eyes-up").inner_text(), "pedal mode says so", page.get_by_test_id("note-eyes-up").inner_text())
        old, midi = next_note(page, old)
        page.wait_for_timeout(5500)
        check(box.get_attribute("data-hidden") is None and page.evaluate(NOTE_DRAWN), "pedal: no timer, still up after 5 s")
        pedal(True)
        page.wait_for_timeout(200)
        check(box.get_attribute("data-hidden") == "1" and not page.evaluate(NOTE_DRAWN), "pedal down: the note hides")
        page.screenshot(path=str(SHOTS / "eyes_up_hidden.png"))
        strike(midi)
        page.wait_for_function(GREEN, timeout=2000)
        check(box.get_attribute("data-hidden") is None, "pedal: answered, back and green")
        pedal(False)

        # Off again: the line goes and nothing hides.
        page.get_by_role("button", name="Off", exact=True).click()
        page.wait_for_timeout(200)
        check(page.get_by_test_id("note-eyes-up").count() == 0, "off: line gone")
        saved = page.evaluate("() => JSON.parse(localStorage.getItem('miditutor-settings')).state")
        check(saved.get("eyesUp") == "off" and saved.get("eyesUpMs") == windows[-1], "setting and window persist", (saved.get("eyesUp"), saved.get("eyesUpMs")))

    print(f"\n{len(FAILS)} failed" if FAILS else "\nall passed")
    return 1 if FAILS else 0


if __name__ == "__main__":
    raise SystemExit(main())
