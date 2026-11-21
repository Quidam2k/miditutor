"""#6654 end-to-end: finger saves by file name, backups hidden, a failed save kept and saved later.

Hidden, muted test copy over a SCRATCH Pieces folder (never his files) holding:
  sorcerers-apprentice.musicxml, sorcerers-apprentice.pre-b3-4-fix.musicxml (a backup),
  "Todd's Test Piece.musicxml" (a title-named file, as a pushed piece is saved).
    MIDITUTOR_PIECES_DIR=<s>/pieces MIDITUTOR_HIDDEN=1 MIDITUTOR_PORT=47811 \
      ./out/MidiTutor-win32-x64/MidiTutor.exe --mute-audio --user-data-dir=<s>/ud --remote-debugging-port=9347
then:
    python scripts/e2e_save_names.py <s>/pieces <s>/ud

Checks:
 1. the picker lists The Sorcerer's Apprentice once (the backup is hidden);
 2. writeScore saves a title-named file and refuses a backup, a path and a missing file;
 3. with the score read-only, a wheel finger edit says "not saved yet" and lands in
    <ud>/unsaved-edits.json; after a reload (as after a restart) with the file writable again,
    opening the piece puts the edit back, saves it, and empties the queue.
"""
from __future__ import annotations

import json
import os
import re
import stat
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright
from e2e_backwards import tid  # noqa: E402  toolbar menus
from e2e_chord_fingering import bar_notes, chord_at_cursor, go_to_bar

CDP = os.environ.get("MIDITUTOR_CDP", "http://127.0.0.1:9347")
FAILS: list[str] = []


def check(cond, label, detail=""):
    print(("PASS " if cond else "FAIL ") + label + ("" if cond else f"  {detail}"))
    if not cond:
        FAILS.append(label)


def open_sorcerer(page) -> None:
    sel = page.locator("select").first
    value = sel.evaluate("s => [...s.options].find((o) => /sorcerer/i.test(o.text)).value")
    sel.select_option(value)
    page.wait_for_function("() => document.querySelectorAll('.vf-notehead').length > 50", timeout=60000)
    page.wait_for_timeout(1500)


def write_score(page, stem: str, xml: str) -> str:
    return page.evaluate(
        """async ([stem, xml]) => {
          try { await window.tutorBridge.writeScore(stem, xml); return 'ok'; }
          catch (e) { return String(e && e.message || e); }
        }""",
        [stem, xml],
    )


def main() -> int:
    pieces, ud = Path(sys.argv[1]), Path(sys.argv[2])
    score = pieces / "sorcerers-apprentice.musicxml"
    queue = ud / "unsaved-edits.json"
    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp(CDP)
        page = browser.contexts[0].pages[0]
        page.on("console", lambda m: m.type == "error" and print("console:", m.text))
        page.get_by_role("button", name="Score", exact=True).click()
        page.wait_for_selector("[data-testid=loop-bars]", timeout=30000)
        page.wait_for_timeout(1500)

        # 1. one Sorcerer's in the picker
        names = page.locator("select").first.evaluate("s => [...s.options].map((o) => o.text)")
        sorc = [n for n in names if re.search("sorcerer", n, re.I)]
        check(len(sorc) == 1, "picker lists Sorcerer's once (backup hidden)", sorc)

        # 2. names writeScore takes and refuses
        titled = pieces / "Todd's Test Piece.musicxml"
        xml = titled.read_text(encoding="utf-8")
        marked = xml.replace("<score-partwise", "<!-- e2e-6654 --><score-partwise", 1)
        check(write_score(page, "Todd's Test Piece", marked) == "ok", "saves a title-named file")
        check("e2e-6654" in titled.read_text(encoding="utf-8"), "title-named file has the new text")
        backup = pieces / "sorcerers-apprentice.pre-b3-4-fix.musicxml"
        before_backup = backup.read_bytes()
        for stem in ("sorcerers-apprentice.pre-b3-4-fix", "../sorcerers-apprentice", "pieces/x"):
            got = write_score(page, stem, marked)
            check("bad piece name" in got, f"refuses {stem!r}", got)
        check("no such piece" in write_score(page, "not-here", marked), "missing file says no such piece")
        check(backup.read_bytes() == before_backup, "backup untouched")

        # 3. a failed save is kept, then saved after a reload
        tid(page, "score-wheel-fingers").check()
        open_sorcerer(page)
        go_to_bar(page, 25)
        page.wait_for_timeout(500)
        start = bar_notes(score, 25)
        original = score.read_bytes()
        os.chmod(score, stat.S_IREAD)
        try:
            _low, high = chord_at_cursor(page)
            page.mouse.move(high["x"], high["y"])
            page.wait_for_timeout(200)
            page.evaluate(
                """({ x, y }) => document.elementFromPoint(x, y).dispatchEvent(
                     new WheelEvent('wheel', { deltaY: -100, clientX: x, clientY: y, bubbles: true, cancelable: true }))""",
                high,
            )
            msg = ""
            for _ in range(40):
                page.wait_for_timeout(250)
                msg = page.evaluate("() => document.querySelector('[data-testid=finger-msg]')?.textContent || ''")
                if "not saved yet" in msg or "saving failed" in msg or "saved" in msg:
                    break
            check("not saved yet" in msg, "read-only save says 'not saved yet'", msg)
            check(score.read_bytes() == original, "file unchanged while read-only")
            entries = json.loads(queue.read_text(encoding="utf-8")) if queue.exists() else []
            check(len(entries) == 1 and entries[0]["stem"] == "sorcerers-apprentice", "edit queued in unsaved-edits.json", entries)
        finally:
            os.chmod(score, stat.S_IREAD | stat.S_IWRITE)
        if not entries:
            return 1
        want = entries[0]
        page.reload()  # as after a restart: the edit is now only in the queue
        page.get_by_role("button", name="Score", exact=True).click()
        page.wait_for_selector("[data-testid=loop-bars]", timeout=30000)
        open_sorcerer(page)
        for _ in range(40):
            page.wait_for_timeout(250)
            if not queue.exists():
                break
        check(not queue.exists(), "queue emptied after the retry")
        after = bar_notes(score, 25)
        check(after != start, "finger change written to the file", {"before": start, "after": after})
        check(str(want["digit"]) in [v for v in after.values() if v], "queued digit is in bar 25", {"want": want, "after": after})
        msg = page.evaluate("() => document.querySelector('[data-testid=finger-msg]')?.textContent || ''")
        check("Saved 1 finger change" in msg, "says it saved the waiting change", msg)
    print("ALL PASS" if not FAILS else f"{len(FAILS)} FAILED: {FAILS}")
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
