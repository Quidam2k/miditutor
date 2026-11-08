"""#5652 D end-to-end check on a hidden app: a repeated wrong key becomes a mix-up pair, and the drill clears it.

Start the packaged app hidden and muted on a scratch user-data dir with MIDITUTOR_TEST_SESSION=1 (see
e2e_note_trainer.py for the env), then with MIDITUTOR_URL / MIDITUTOR_TOKEN_FILE / MIDITUTOR_CDP set:
    python scripts/e2e_mixups.py <scratch>
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

sys.path.insert(0, str(Path(__file__).resolve().parent))
from e2e_note_trainer import FAILS, SHOTS, asked, check, next_note, open_notes, opened, strike  # noqa: E402

LETTERS = "CDEFGAB"
WHITE = [0, 2, 4, 5, 7, 9, 11]


def read_as_treble(midi: int) -> tuple[int, str]:
    """The key at a bass note's staff place in the treble clef: 12 letter steps up (G2 -> E4)."""
    octave, letter = midi // 12 - 1, WHITE.index(midi % 12)
    step = octave * 7 + letter + 12
    o, l = divmod(step, 7)
    return (o + 1) * 12 + WHITE[l], f"{LETTERS[l]}{o}"


def main() -> int:
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    scratch = Path(sys.argv[1]).resolve()
    with sync_playwright() as p:
        page = opened(p)
        page.wait_for_timeout(1500)
        open_notes(page)
        page.get_by_role("button", name="Bass", exact=True).click()
        page.wait_for_timeout(200)
        box = page.get_by_test_id("note-trainer")
        if box.get_attribute("data-key"):
            page.get_by_text("Keys:").click()
            page.wait_for_timeout(200)
        check(page.get_by_test_id("note-mixups").inner_text().endswith("None yet"), "no mix-ups at the start")

        # Misread one bass note as treble twice; play everything else right.
        old = None
        target = None
        misses = 0
        for _ in range(120):
            note_id, midi = next_note(page, old)
            old = note_id
            if target is None and note_id.startswith("bass:") and midi % 12 in WHITE:
                target = note_id
            if note_id == target:
                wrong, wrong_name = read_as_treble(midi)
                strike(wrong)
                misses += 1
                if misses == 2:
                    break
            else:
                strike(midi)
            page.wait_for_timeout(100)
        check(misses == 2, "the target note came up twice", (target, misses))
        page.wait_for_timeout(300)
        panel = page.get_by_test_id("note-mixups")
        rows = panel.get_by_test_id("note-mixup")
        text = rows.first.inner_text().replace("\n", " ") if rows.count() else ""
        name = target.split(":")[1]
        check(rows.count() == 1, "one mix-up pair listed", panel.inner_text())
        check(name in text and f"you played {wrong_name}" in text and "2×" in text, "the row names both notes and the count", text)
        check("read as treble clef" in text, "the row says he read it as treble", text)
        page.screenshot(path=str(SHOTS / "note_mixups.png"))

        # The drill: only the pair's two notes, until five right answers on the asked one clear it.
        page.wait_for_timeout(1700)
        page.get_by_test_id("note-mixup-drill").click()
        page.wait_for_function("() => document.querySelector('[data-testid=note-trainer]').dataset.drilling === '1'", timeout=3000)
        check(box.get_attribute("data-key") is None, "drill: no key signature")
        allowed = {target, f"treble:{wrong_name}"}
        seen: set[str] = set()
        right = 0
        note_id, midi = asked(page)
        for _ in range(40):
            seen.add(note_id)
            check(note_id in allowed, "drill asks only the pair", note_id)
            strike(midi)
            if note_id == target:
                right += 1
            if right == 5:
                break
            note_id, midi = next_note(page, note_id) if len(allowed) > 1 else asked(page)
        check(right == 5, "five right answers on the asked note", right)
        check(seen == allowed, "drill asks both notes of the pair", seen)
        page.wait_for_function("() => !document.querySelector('[data-testid=note-trainer]').dataset.drilling", timeout=5000)
        check(panel.inner_text().endswith("All cleared"), "pair cleared, drill ended by itself", panel.inner_text())
        page.screenshot(path=str(SHOTS / "note_mixups_cleared.png"))

    time.sleep(0.5)
    saved = json.loads((scratch / "note-stats.json").read_text(encoding="utf-8"))
    pair = saved.get("mixups", {}).get(f"{target}>{wrong_name}")
    check(pair is not None and pair["count"] == 2 and pair["since"] == 5, "file: the pair is on disk, cleared", pair)
    print(f"\n{len(FAILS)} failed" if FAILS else "\nall passed")
    return 1 if FAILS else 0


if __name__ == "__main__":
    raise SystemExit(main())
