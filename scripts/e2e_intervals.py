"""#5652 J end-to-end check on a hidden app: Intervals "Name it" (JP's require-quality) and the per-interval record.

Seed a FRESH scratch user-data dir first (a Notes record that must survive):
    python scripts/e2e_intervals.py <scratch> --seed
then start the packaged app hidden and muted on it with MIDITUTOR_TEST_SESSION=1 (see e2e_note_trainer.py for
the env), and with MIDITUTOR_URL / MIDITUTOR_TOKEN_FILE / MIDITUTOR_CDP set:
    python scripts/e2e_intervals.py <scratch>
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

sys.path.insert(0, str(Path(__file__).resolve().parent))
from e2e_note_trainer import FAILS, SHOTS, check, opened, strike  # noqa: E402

NOTE_STATS = {"treble:G4": {"attempts": 9, "hits": 8, "avgMs": 1400, "recent": [True] * 8}}
HARD = {"treble:M7": {"attempts": 5, "hits": 2, "avgMs": 5000, "recent": [False, True, False, True, False]}}


def seed(scratch: Path) -> None:
    scratch.mkdir(parents=True, exist_ok=True)
    (scratch / "note-stats.json").write_text(json.dumps({"stats": NOTE_STATS, "intervals": HARD}), encoding="utf-8")


def card(page, old: str | None) -> tuple[str, list[int], str]:
    page.wait_for_function(
        "(old) => { const e = document.querySelector('[data-testid=interval-trainer]');"
        " return e && e.dataset.phase === 'awaiting-input' && e.dataset.midi && e.dataset.midi !== old; }",
        arg=old or "", timeout=6000)
    box = page.get_by_test_id("interval-trainer")
    midi = box.get_attribute("data-midi")
    return midi, [int(x) for x in midi.split(",")], box.get_attribute("data-interval")


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
        page.get_by_role("button", name="Practice", exact=True).click()
        page.get_by_role("button", name="Intervals", exact=True).click()
        page.get_by_role("button", name="Treble", exact=True).click()
        check(page.get_by_text("Name it:").count() == 1, "Name it toggle shown")
        page.get_by_role("button", name="Start Practice").click()
        names = page.get_by_test_id("interval-name")

        # 1. Right name, then the notes: counts, and the name is hidden until he picks.
        key, notes, short = card(page, None)
        check(names.inner_text().strip() == "", "name hidden before he picks", names.inner_text())
        page.locator(f"[data-testid=interval-names] button[data-short='{short}']").click()
        page.wait_for_timeout(100)
        check(names.inner_text().strip() != "", "name shown once picked", names.inner_text())
        for n in notes:
            strike(n)
        page.wait_for_timeout(300)
        check(page.get_by_text("1 / 10 right today").count() == 1, "right name + notes counts toward 10")
        first = short

        # 2. Wrong name: lit red, right one green, he plays on, it doesn't count.
        key, notes, short = card(page, key)
        wrong = "P8" if short != "P8" else "m2"
        page.locator(f"[data-testid=interval-names] button[data-short='{wrong}']").click()
        page.wait_for_timeout(100)
        cls_wrong = page.locator(f"[data-testid=interval-names] button[data-short='{wrong}']").get_attribute("class")
        cls_right = page.locator(f"[data-testid=interval-names] button[data-short='{short}']").get_attribute("class")
        check("bg-red-600" in cls_wrong and "bg-emerald-600" in cls_right, "wrong name red, right one green")
        page.screenshot(path=str(SHOTS / "interval_name_it.png"))
        for n in notes:
            strike(n)
        page.wait_for_timeout(300)
        check(page.get_by_text("1 / 10 right today").count() == 1, "a wrong name doesn't count")
        second = short

        # 3. Name it off mid-card: name shown, the notes alone finish it.
        key, notes, short = card(page, key)
        page.get_by_text("Name it:").click()
        page.wait_for_timeout(100)
        check(page.get_by_test_id("interval-names").count() == 0, "off: no name buttons")
        check(names.inner_text().strip() != "", "off: name shown", names.inner_text())
        for n in notes:
            strike(n)
        page.wait_for_timeout(300)
        check(page.get_by_text("2 / 10 right today").count() == 1, "off: playing both counts")
        hard = [e.get_attribute("data-short") for e in page.get_by_test_id("interval-hard").all()]
        check(hard[:1] == ["M7"] or "M7" in hard, "hardest list shows the seeded M7", hard)
        page.wait_for_timeout(1500)
        page.get_by_text("Name it:").click()

    time.sleep(0.5)
    saved = json.loads((scratch / "note-stats.json").read_text(encoding="utf-8"))
    iv = saved.get("intervals", {})
    check(saved.get("stats") == NOTE_STATS, "file: the Notes record survives", saved.get("stats"))
    check(iv.get(f"treble:{first}", {}).get("hits", 0) >= 1, "file: right card recorded", iv.get(f"treble:{first}"))
    s2 = iv.get(f"treble:{second}", {})
    check(False in s2.get("recent", []), "file: wrong name recorded as a miss", s2)
    print(f"\n{len(FAILS)} failed" if FAILS else "\nall passed")
    return 1 if FAILS else 0


if __name__ == "__main__":
    raise SystemExit(main())
