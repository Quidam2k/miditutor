"""#5652 A end-to-end check on a hidden app: Notes "Ladder" starts on the landmarks and adds a note once they're known.

Start the packaged app hidden and muted on a FRESH scratch user-data dir with MIDITUTOR_TEST_SESSION=1 (see
e2e_note_trainer.py for the env), then with MIDITUTOR_URL / MIDITUTOR_TOKEN_FILE / MIDITUTOR_CDP set:
    python scripts/e2e_ladder.py <scratch>
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

sys.path.insert(0, str(Path(__file__).resolve().parent))
from e2e_note_trainer import FAILS, SHOTS, check, next_note, open_notes, opened, strike  # noqa: E402

ORDER = ["treble:C4", "treble:G4", "treble:C5", "treble:D4", "treble:F4", "treble:A4", "treble:B4"]


def main() -> int:
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    scratch = Path(sys.argv[1]).resolve()
    with sync_playwright() as p:
        page = opened(p)
        page.wait_for_timeout(1500)
        open_notes(page)
        page.get_by_role("button", name="Treble", exact=True).click()
        page.get_by_text("Ladder:").click()
        page.wait_for_selector("[data-testid=note-ladder]", timeout=3000)
        # The ladder's first note is asked a render after the panel shows.
        page.wait_for_function("() => !document.querySelector('[data-testid=note-trainer]').dataset.key", timeout=3000)
        box = page.get_by_test_id("note-trainer")
        panel = page.get_by_test_id("note-ladder")
        check(panel.get_attribute("data-level") == "3", "starts on the 3 treble landmarks", panel.inner_text())
        check("Next: D4" in panel.inner_text(), "says the next note", panel.inner_text())

        old = None
        levels: list[int] = []
        for _ in range(80):
            level = int(panel.get_attribute("data-level"))
            note_id, midi = next_note(page, old)
            old = note_id
            check(note_id in ORDER[: int(panel.get_attribute("data-level"))], "asks only notes in play", (note_id, level))
            check(box.get_attribute("data-key") is None, "no key signature on the ladder")
            strike(midi)
            page.wait_for_timeout(150)
            levels.append(int(panel.get_attribute("data-level")))
            if levels[-1] >= 5:
                break
        check(levels[-1] >= 5, "two notes added after the set was known", levels[-10:])
        check(all(b - a in (0, 1) for a, b in zip(levels, levels[1:])), "adds one note at a time", levels)
        text = panel.inner_text()
        check("+ F4" in text or "+ A4" in text, "says the note it added", text)
        page.screenshot(path=str(SHOTS / "note_ladder.png"))

        # A miss on a note in play doesn't take a note away.
        top = int(panel.get_attribute("data-level"))
        note_id, midi = next_note(page, old)
        strike(midi + 1)
        page.wait_for_timeout(300)
        check(int(panel.get_attribute("data-level")) == top, "a miss keeps the level", panel.inner_text())
        page.wait_for_timeout(1700)
        page.get_by_text("Ladder:").click()
        page.wait_for_timeout(300)
        check(page.get_by_test_id("note-ladder").count() == 0, "ladder off: panel gone")

    time.sleep(0.5)
    saved = json.loads((scratch / "note-stats.json").read_text(encoding="utf-8"))
    check(saved.get("ladder", {}).get("treble") == top, "file: the level is saved", saved.get("ladder"))
    print(f"\n{len(FAILS)} failed" if FAILS else "\nall passed")
    return 1 if FAILS else 0


if __name__ == "__main__":
    raise SystemExit(main())
