"""JP 10/9 "Key first" end-to-end check on a hidden app: in Notes with Keys on, each new key's sharps or flats are
played before its first note shows.

Start the packaged app hidden and muted on a FRESH scratch user-data dir with MIDITUTOR_TEST_SESSION=1 (see
e2e_note_trainer.py for the env), then with MIDITUTOR_URL / MIDITUTOR_TOKEN_FILE / MIDITUTOR_CDP set:
    python scripts/e2e_key_first.py
"""
from __future__ import annotations

import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

sys.path.insert(0, str(Path(__file__).resolve().parent))
from e2e_note_trainer import FAILS, SHOTS, asked, check, opened, strike  # noqa: E402

FIFTHS = {"C": 0, "G": 1, "D": 2, "A": 3, "E": 4, "B": 5, "F": -1, "Bb": -2, "Eb": -3, "Ab": -4, "Db": -5}
SHARPS = [66, 61, 68, 63, 70]  # F# C# G# D# A# (octave 4)
FLATS = [70, 63, 68, 61, 66]  # Bb Eb Ab Db Gb


def main() -> int:
    with sync_playwright() as p:
        page = opened(p)
        page.wait_for_timeout(1500)
        page.get_by_role("button", name="Practice", exact=True).click()
        page.get_by_role("button", name="Notes", exact=True).click()
        page.wait_for_selector("[data-testid=note-trainer][data-note-id]", timeout=15000)
        page.get_by_role("button", name="Treble", exact=True).click()
        check("on" in page.get_by_text("Key first:").inner_text(), "Key first is on by default")
        box = page.get_by_test_id("note-trainer")
        tested = False
        for _ in range(40):
            page.wait_for_timeout(200)
            key = box.get_attribute("data-key")
            gate = box.get_attribute("data-gate") == "1"
            if gate:
                fifths = FIFTHS[key]
                need = (SHARPS if fifths > 0 else FLATS)[: abs(fifths)]
                panel = page.get_by_test_id("note-key-first")
                check(f"{key} major" in panel.inner_text(), "says the key", panel.inner_text())
                check(page.locator("[data-testid=note-trainer] svg .vf-stavenote").count() == 0, "no note drawn yet")
                wrong = next(n for n in range(60, 72) if n % 12 not in {m % 12 for m in need})
                strike(wrong)
                page.wait_for_timeout(150)
                check("not in this key" in panel.inner_text(), "a wrong key is flagged", panel.inner_text())
                check(box.get_attribute("data-gate") == "1", "a wrong key doesn't open it")
                page.screenshot(path=str(SHOTS / "note_key_first.png"))
                for n in need:
                    strike(n + 12)  # another octave
                    page.wait_for_timeout(100)
                check(box.get_attribute("data-gate") is None, "its accidentals open it", key)
                page.wait_for_timeout(100)
                check(page.locator("[data-testid=note-trainer] svg .vf-stavenote").count() == 1, "the note shows")
                _, midi = asked(page)
                strike(midi)
                page.wait_for_timeout(200)
                check("text-emerald-400" in page.get_by_test_id("note-feedback").get_attribute("class"), "then the note is answered")
                tested = True
                break
            _, midi = asked(page)
            strike(midi)
            page.wait_for_timeout(950)
        check(tested, "met a key with accidentals")

        # Off: a new key goes straight to its note.
        page.get_by_text("Key first:").click()
        page.get_by_text("Keys:").click()
        page.get_by_text("Keys:").click()
        page.wait_for_timeout(300)
        check(box.get_attribute("data-gate") is None, "off: no gate on a new key")
        page.get_by_text("Key first:").click()
    print(f"\n{len(FAILS)} failed" if FAILS else "\nall passed")
    return 1 if FAILS else 0


if __name__ == "__main__":
    raise SystemExit(main())
