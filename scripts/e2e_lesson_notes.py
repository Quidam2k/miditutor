"""#6112 end-to-end check on a hidden, muted packaged app: the Lesson notes panel and GET /notebook.

    MIDITUTOR_HIDDEN=1 MIDITUTOR_PIECES_DIR=<pieces> MIDITUTOR_PORT=47828 ./out/MidiTutor-win32-x64/MidiTutor.exe \
      --mute-audio --user-data-dir=<scratch>/ud --remote-debugging-port=9360
    MIDITUTOR_CDP=http://localhost:9360 MIDITUTOR_URL=http://127.0.0.1:47828 MIDITUTOR_TOKEN_FILE=<scratch>/ud/api-token \
      python scripts/e2e_lesson_notes.py run <pieces>

`seed` writes lesson-notebook.jsonl (two lessons, one with markup, plus a bad line) into <pieces>.
"""
from __future__ import annotations

import json
import os
import sys
import urllib.request
from pathlib import Path

CDP = os.environ.get("MIDITUTOR_CDP", "http://localhost:9360")
URL = os.environ.get("MIDITUTOR_URL", "http://127.0.0.1:47828")
FAILS: list[str] = []


def check(cond, label, detail=""):
    print(("PASS " if cond else "FAIL ") + label + (f"  {detail}" if not cond else ""))
    if not cond:
        FAILS.append(label)


def seed(pieces: Path) -> None:
    pieces.mkdir(parents=True, exist_ok=True)
    lines = [
        json.dumps({"date": "2026-10-28", "summary_md": "Older lesson: learn hands separate.", "source": "piano-lesson"}),
        "this line is not json",
        json.dumps({"date": "2026-11-06", "summary_md": "<b>Newest</b> lesson: block your fingers.", "source": "piano-lesson"}),
    ]
    (pieces / "lesson-notebook.jsonl").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("seeded", pieces)


def run() -> None:
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp(CDP)
        page = browser.contexts[0].pages[0]
        page.on("pageerror", lambda e: print("pageerror:", e))
        page.wait_for_timeout(1500)
        page.get_by_role("button", name="Score", exact=True).click()
        page.locator("[data-testid=practice-settings]").click()
        page.locator("[data-testid=lesson-notes-open]").click()
        page.wait_for_selector("[data-testid=lesson-notes]", timeout=10000)
        page.wait_for_selector("[data-testid=lesson-note]", timeout=10000)
        notes = page.locator("[data-testid=lesson-note]")
        check(notes.count() == 2, "two lessons shown, the bad line skipped", str(notes.count()))
        first = notes.first.inner_text()
        check(first.startswith("2026-11-06"), "newest lesson first", first[:20])
        check("<b>Newest</b>" in first, "the newest lesson starts open and shows markup as plain text", first)
        check(page.locator("[data-testid=lesson-notes] b").count() == 0, "no HTML element was created from the text")
        page.locator("[data-testid=lesson-notes-close]").click()
        page.wait_for_selector("[data-testid=lesson-notes]", state="detached", timeout=5000)

    token = Path(os.environ["MIDITUTOR_TOKEN_FILE"]).read_text(encoding="utf-8").strip()
    req = urllib.request.Request(URL + "/notebook", headers={"Authorization": "Bearer " + token})
    body = json.loads(urllib.request.urlopen(req, timeout=10).read())
    check([n["date"] for n in body["notes"]] == ["2026-11-06", "2026-10-28"], "GET /notebook returns them newest first", str(body)[:120])

    print("ALL PASS" if not FAILS else f"{len(FAILS)} FAIL: {FAILS}")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    if len(sys.argv) != 3 or sys.argv[1] not in ("seed", "run"):
        sys.exit(__doc__)
    seed(Path(sys.argv[2])) if sys.argv[1] == "seed" else run()
