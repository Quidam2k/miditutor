"""#6121 hidden-app check: pieces whose scan layout can't drive the print still fill the sheet.

    MIDITUTOR_REVIEW_LIBRARY=<desk review library> python scripts/e2e_binder_fill.py seed <pieces-dir>
    MIDITUTOR_HIDDEN=1 MIDITUTOR_PRINT_NO_DIALOG=1 MIDITUTOR_PIECES_DIR=<pieces-dir> MIDITUTOR_PORT=47829 \
      ./out/MidiTutor-win32-x64/MidiTutor.exe --mute-audio --user-data-dir=<scratch>/ud --remote-debugging-port=9361
    MIDITUTOR_CDP=http://localhost:9361 python scripts/e2e_binder_fill.py run <pieces-dir>

seed copies Sorcerer's Apprentice (exact layout: its print must not change), Scotland The Brave (layout
match none) and Minuet In G Major (partial) from the desk library. run prints all three; the PDFs and
HTML land in <pieces-dir>/print, then scripts/measure_binder_ink.py reads the ink.
"""
from __future__ import annotations

import os
import shutil
import sys
from pathlib import Path

LIBRARY = Path(os.environ.get("MIDITUTOR_REVIEW_LIBRARY", ""))
CDP = os.environ.get("MIDITUTOR_CDP", "http://localhost:9361")
PIECES = [("sorcerers-apprentice", "Sorcerer"), ("scotland-the-brave", "Scotland"), ("minuet-in-g-major", "Minuet In G")]


def seed(pieces: Path) -> None:
    if not (LIBRARY / "sorcerers-apprentice.musicxml").exists():
        sys.exit("set MIDITUTOR_REVIEW_LIBRARY to the desk review library")
    (pieces / "review").mkdir(parents=True, exist_ok=True)
    for slug, _ in PIECES:
        shutil.copy(LIBRARY / f"{slug}.musicxml", pieces / f"{slug}.musicxml")
        for ext in ("layout.json", "events.jsonl"):
            src = LIBRARY / "review" / f"{slug}.{ext}"
            if src.exists():
                shutil.copy(src, pieces / "review" / src.name)
    print("seeded", pieces)


def run(pieces: Path) -> None:
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp(CDP)
        page = browser.contexts[0].pages[0]
        page.on("pageerror", lambda e: print("pageerror:", e))
        page.wait_for_timeout(1500)
        page.get_by_role("button", name="Score", exact=True).click()
        for slug, label in PIECES:
            page.wait_for_function(
                f"() => [...document.querySelector('select').options].some((o) => o.text.includes({label!r}))",
                timeout=15000)
            select = page.locator("select").first
            select.select_option(label=next(o for o in select.locator("option").all_inner_texts() if label in o))
            page.wait_for_selector("[data-testid=print-binder]:not([disabled])", timeout=30000)
            page.locator("[data-testid=print-binder]").click()
            page.wait_for_selector("[data-testid=binder-preview]", timeout=180000)
            page.locator("[data-testid=binder-preview-print]").click()
            page.wait_for_function(
                "() => /Saved|failed/.test(document.querySelector('[data-testid=print-binder-note]')?.innerText ?? '')",
                timeout=180000)
            print(slug, page.locator("[data-testid=print-binder-note]").inner_text())
            page.wait_for_selector("[data-testid=binder-preview]", state="detached", timeout=10000)


if __name__ == "__main__":
    if len(sys.argv) != 3 or sys.argv[1] not in ("seed", "run"):
        sys.exit(__doc__)
    (seed if sys.argv[1] == "seed" else run)(Path(sys.argv[2]))
