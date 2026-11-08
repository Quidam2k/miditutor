"""#5652 E end-to-end check on a hidden app: Notes "Where you slow down" names his three slowest slices.

Seed a FRESH scratch user-data dir first:
    python scripts/e2e_hesitation.py <scratch> --seed
then start the packaged app hidden and muted on it with MIDITUTOR_TEST_SESSION=1 (see e2e_note_trainer.py for
the env), and with MIDITUTOR_URL / MIDITUTOR_TOKEN_FILE / MIDITUTOR_CDP set:
    python scripts/e2e_hesitation.py <scratch>
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

sys.path.insert(0, str(Path(__file__).resolve().parent))
from e2e_note_trainer import FAILS, SHOTS, check, next_note, open_notes, opened, strike  # noqa: E402

SLICES = {
    "all": {"n": 40, "avgMs": 1500},
    "clef:bass": {"n": 20, "avgMs": 2600},
    "pos:below": {"n": 10, "avgMs": 3100},
    "key:flat": {"n": 12, "avgMs": 2200},
    "acc:natural": {"n": 3, "avgMs": 6000},  # too few to show
    "clef:treble": {"n": 20, "avgMs": 1100},
}


def seed(scratch: Path) -> None:
    scratch.mkdir(parents=True, exist_ok=True)
    (scratch / "note-stats.json").write_text(json.dumps({"stats": {}, "today": None, "slices": SLICES}), encoding="utf-8")


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
        page.wait_for_selector("[data-testid=note-hesitation]", timeout=3000)
        panel = page.get_by_test_id("note-hesitation")
        keys = [e.get_attribute("data-key") for e in page.get_by_test_id("note-slow-spot").all()]
        check(keys == ["pos:below", "clef:bass", "key:flat"], "three slowest, slowest first", keys)
        text = panel.inner_text()
        check("ledger lines below" in text and "3.1 s" in text and "+1.6 s" in text, "says where, how slow, how much slower", text)
        check("natural" not in text, "a slice with 3 answers isn't shown", text)
        check("usual 1.5 s" in text, "says his usual time", text)
        page.screenshot(path=str(SHOTS / "note_hesitation.png"))

        old = None
        for _ in range(6):
            note_id, midi = next_note(page, old)
            old = note_id
            strike(midi)
            page.wait_for_timeout(150)
        page.wait_for_timeout(1200)

    time.sleep(0.5)
    saved = json.loads((scratch / "note-stats.json").read_text(encoding="utf-8")).get("slices", {})
    # The first note on the tab isn't timed, so 5 of the 6 count.
    check(saved.get("all", {}).get("n") == 45, "file: timed hits added to 'all'", saved.get("all"))
    check(saved.get("clef:treble", {}).get("n") == 25, "file: and to treble clef", saved.get("clef:treble"))
    check(saved.get("clef:bass") == SLICES["clef:bass"], "file: bass untouched by treble notes", saved.get("clef:bass"))
    print(f"\n{len(FAILS)} failed" if FAILS else "\nall passed")
    return 1 if FAILS else 0


if __name__ == "__main__":
    raise SystemExit(main())
