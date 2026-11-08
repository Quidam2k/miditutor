"""#5652 I end-to-end check on a hidden app: Notes asks due ("faded") notes first and moves their due days.

Seed a FRESH scratch user-data dir first:
    python scripts/e2e_review.py <scratch> --seed
then start the packaged app hidden and muted on it with MIDITUTOR_TEST_SESSION=1 (see e2e_note_trainer.py for
the env), and with MIDITUTOR_URL / MIDITUTOR_TOKEN_FILE / MIDITUTOR_CDP set:
    python scripts/e2e_review.py <scratch>
"""
from __future__ import annotations

import datetime as dt
import json
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

sys.path.insert(0, str(Path(__file__).resolve().parent))
from e2e_note_trainer import FAILS, SHOTS, check, next_note, open_notes, opened, strike  # noqa: E402

TODAY = dt.date.today()
DAY = lambda n: (TODAY + dt.timedelta(days=n)).isoformat()  # noqa: E731
DUE = {"treble:E4": {"interval": 3, "due": DAY(-1)}, "treble:F5": {"interval": 0, "due": DAY(0)}}
LATER = {"treble:A4": {"interval": 4, "due": DAY(12)}}


def seed(scratch: Path) -> None:
    scratch.mkdir(parents=True, exist_ok=True)
    stat = {"attempts": 4, "hits": 3, "avgMs": 1800, "recent": [True, False, True, True]}
    record = {"stats": {k: stat for k in [*DUE, *LATER]}, "today": None, "mixups": {}, "ladder": {}, "review": {**DUE, **LATER}}
    (scratch / "note-stats.json").write_text(json.dumps(record), encoding="utf-8")


def main() -> int:
    if len(sys.argv) == 3 and sys.argv[2] == "--seed":
        seed(Path(sys.argv[1]).resolve())
        return 0
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    scratch = Path(sys.argv[1]).resolve()
    with sync_playwright() as p:
        page = opened(p)
        page.wait_for_timeout(1500)
        open_notes(page)
        page.get_by_role("button", name="Treble", exact=True).click()
        due = page.get_by_test_id("note-due")
        page.wait_for_selector("[data-testid=note-due]", timeout=3000)
        check(due.get_attribute("data-due") == "2", "shows the 2 due notes", due.inner_text())
        check("Due today: 2" in due.inner_text(), "says Due today: 2", due.inner_text())

        # Answer every note fast and right; the due ones should come up within the first dozen.
        old = None
        asked: list[str] = []
        for _ in range(14):
            note_id, midi = next_note(page, old)
            old = note_id
            asked.append(note_id)
            strike(midi)
            page.wait_for_timeout(150)
            if all(k in asked[1:] for k in DUE):
                break
        # The first note is untimed, so it can't clear a due note: look from the second on.
        check(all(k in asked[1:] for k in DUE), "both due notes asked early", asked)
        page.wait_for_function("() => document.querySelector('[data-testid=note-due]').dataset.due === '0'", timeout=3000)
        check(due.get_attribute("data-due") == "0", "fast rights clear them", due.inner_text())
        page.screenshot(path=str(SHOTS / "note_review.png"))

        # A miss makes that note due today.
        page.wait_for_timeout(900)
        note_id, midi = next_note(page, old)
        strike(midi + 2)
        page.wait_for_timeout(300)
        check(due.get_attribute("data-due") == "1", "a miss is due today", (note_id, due.inner_text()))
        missed = note_id
        page.wait_for_timeout(1700)

    time.sleep(0.5)
    review = json.loads((scratch / "note-stats.json").read_text(encoding="utf-8")).get("review", {})
    if missed != "treble:E4":
        check(review.get("treble:E4") == {"interval": 6, "due": DAY(6)}, "file: E4 pushed out 6 days", review.get("treble:E4"))
    if missed != "treble:F5":
        check(review.get("treble:F5") == {"interval": 1, "due": DAY(1)}, "file: F5 pushed out 1 day", review.get("treble:F5"))
    if missed != "treble:A4":
        check(review.get("treble:A4") == LATER["treble:A4"], "file: a not-due note keeps its day", review.get("treble:A4"))
    check(review.get(missed) == {"interval": 0, "due": DAY(0)}, "file: the miss is due today", (missed, review.get(missed)))
    print(f"\n{len(FAILS)} failed" if FAILS else "\nall passed")
    return 1 if FAILS else 0


if __name__ == "__main__":
    raise SystemExit(main())
