"""#5260 end-to-end check on a hidden Electron app: the note trainer, and its record across a real kill.

Start the app on a scratch user-data dir with MIDITUTOR_TEST_SESSION=1 (a hidden copy otherwise
neither reads nor writes the record):
    MIDITUTOR_HIDDEN=1 MIDITUTOR_TEST_SESSION=1 MIDITUTOR_WINDOW_SIZE=1200x800 MIDITUTOR_PORT=47812 \
      MIDITUTOR_VITE_PORT=5183 npx electron-forge start -- --remote-debugging-port=9346 --user-data-dir=<scratch>
then, with MIDITUTOR_URL=http://127.0.0.1:47812, MIDITUTOR_TOKEN_FILE=<scratch>/api-token and
MIDITUTOR_CDP=http://127.0.0.1:9346:
    python scripts/e2e_note_trainer.py drill <scratch>   # plays the drill; hard-kills the app right after its last answer
    (start the app again)
    python scripts/e2e_note_trainer.py check <scratch>   # the record survived; the drill is up with no click
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from miditutor_mcp import tutor_client as tc  # noqa: E402

CDP = os.environ.get("MIDITUTOR_CDP", "http://127.0.0.1:9346")
FAILS: list[str] = []
SHOTS = ROOT / "screengrab"


def check(cond, label, detail="") -> None:
    print(("PASS " if cond else "FAIL ") + label + ("" if cond else f"  {detail}"))
    if not cond:
        FAILS.append(label)


def strike(note: int) -> None:
    for kind in ("noteon", "noteoff"):
        result = tc.request("POST", "/inject", {"notes": [note], "kind": kind, "velocity": 64})
        if "error" in result:
            sys.exit(f"inject failed: {result}")


def asked(page) -> tuple[str, int]:
    box = page.get_by_test_id("note-trainer")
    return box.get_attribute("data-note-id"), int(box.get_attribute("data-midi"))


def next_note(page, old_id: str | None) -> tuple[str, int]:
    """The note after this one: the same id can't come twice running, so a change means it's up."""
    page.wait_for_function(
        "(old) => { const e = document.querySelector('[data-testid=note-trainer]');"
        " return e && e.dataset.noteId && e.dataset.noteId !== old; }",
        arg=old_id or "",
        timeout=5000,
    )
    return asked(page)


def open_notes(page) -> None:
    page.get_by_role("button", name="Practice", exact=True).click()
    page.get_by_role("button", name="Notes", exact=True).click()
    page.wait_for_selector("[data-testid=note-trainer][data-note-id]", timeout=15000)


def opened(p):
    browser = p.chromium.connect_over_cdp(CDP)
    page = browser.contexts[0].pages[0]
    page.on("console", lambda m: m.type == "error" and print("console:", m.text))
    page.on("pageerror", lambda e: print("pageerror:", e))
    return page


def record(scratch: Path) -> dict:
    return json.loads((scratch / "note-stats.json").read_text(encoding="utf-8"))


def app_pids(scratch: Path) -> list[str]:
    # The folder name only: the command line may spell the path with either slash.
    needle = scratch.name.replace("'", "''")
    cmd = (
        "Get-CimInstance Win32_Process -Filter \"Name='electron.exe'\" | "
        f"Where-Object {{ $_.CommandLine -like '*{needle}*' -and $_.CommandLine -notlike '*--type=*' }} | "
        "ForEach-Object { $_.ProcessId }"
    )
    out = subprocess.run(["powershell", "-NoProfile", "-Command", cmd], capture_output=True, text=True, check=True)
    return out.stdout.split()


def phase_drill(scratch: Path) -> None:
    pids = app_pids(scratch)
    check(bool(pids), "found the app's main process", scratch)
    with sync_playwright() as p:
        page = opened(p)
        page.wait_for_timeout(1500)
        open_notes(page)
        check(page.get_by_text("Start Practice").count() == 0, "no Start button to click")

        # Bass alone first: the bug was bass drawing from the C4-E4 start range.
        page.get_by_role("button", name="Bass", exact=True).click()
        page.wait_for_timeout(200)
        old = None
        for _ in range(12):
            note_id, midi = next_note(page, old)
            check(note_id.startswith("bass:") and 40 <= midi <= 60, "bass note in E2-C4", note_id)
            strike(midi)
            old = note_id
        page.wait_for_timeout(1000)

        page.get_by_role("button", name="Both", exact=True).click()
        page.wait_for_timeout(200)
        # Changing the clef asks a new note at once, so this one is already up.
        old = None
        seen: list[str] = []
        attempts, hits = 12, 12
        for i in range(36):
            note_id, midi = next_note(page, old)
            seen.append(note_id)
            old = note_id
            name = note_id.split(":")[1]
            feedback = page.get_by_test_id("note-feedback")
            if i % 4 == 3:
                # A semitone off, which is always a real wrong key.
                strike(midi + 1)
                page.wait_for_function(
                    "() => document.querySelector('[data-testid=note-feedback]').innerText.includes('it was')",
                    timeout=3000,
                )
                text = feedback.inner_text()
                check(text.endswith(f", it was {name}") and text.startswith("You played "), "a miss says both notes", text)
                if i == 3:
                    page.screenshot(path=str(SHOTS / "note_trainer_miss.png"))
            else:
                strike(midi)
                hits += 1
                page.wait_for_function(
                    "() => document.querySelector('[data-testid=note-feedback]').innerText.startsWith('You played')",
                    timeout=3000,
                )
                text = feedback.inner_text()
                # The first of a clef switch isn't timed; all others show seconds.
                check(re.fullmatch(rf"You played {re.escape(name)}( · \d+\.\d s)?", text) is not None,
                      "a hit shows the spelling asked for", text)
            attempts += 1

        clefs = {s.split(":")[0] for s in seen}
        check(clefs == {"treble", "bass"}, "Both draws from both clefs", seen)
        names = [s.split(":")[1] for s in seen]
        # Coverage, not chance: unseen notes weigh most, but 36 picks may miss a spelling. Report it.
        print("sharps seen:", sum("#" in n for n in names), "flats seen:", sum("b" in n for n in names))
        check(any("#" in n for n in names) or any("b" in n for n in names), "black keys come up", names)

        today = page.get_by_test_id("note-today").inner_text()
        check(f"{attempts} notes" in today, "today's count", today)
        check(f"{round(hits / attempts * 100)}% right" in today, "today's hit rate", today)
        slow = page.get_by_test_id("note-slowest").inner_text()
        check("% right" in slow, "slowest notes listed", slow)
        page.screenshot(path=str(SHOTS / "note_trainer_stats.png"))
        print("today:", today.replace("\n", " | "))

        # One more answer, then a hard kill right behind it: this is the write that has to survive.
        page.wait_for_timeout(1700)
        note_id, midi = next_note(page, old)
        strike(midi)
        time.sleep(0.25)
        for pid in pids:
            subprocess.run(["taskkill", "/F", "/PID", pid], capture_output=True)
        (scratch / "expect.json").write_text(json.dumps({"attempts": attempts + 1, "hits": hits + 1, "last": note_id}))
        print("killed", pids, "after answering", note_id)


def phase_check(scratch: Path) -> None:
    want = json.loads((scratch / "expect.json").read_text())
    saved = record(scratch)
    check(saved["today"]["attempts"] == want["attempts"], "file: the answer before the kill is on disk", saved["today"])
    check(saved["today"]["hits"] == want["hits"], "file: hits", saved["today"])
    check(sum(s["attempts"] for s in saved["stats"].values()) == want["attempts"], "file: per-note attempts add up")
    check(want["last"] in saved["stats"], "file: the last note has its row", want["last"])
    with sync_playwright() as p:
        page = opened(p)
        page.wait_for_timeout(1500)
        open_notes(page)
        today = page.get_by_test_id("note-today").inner_text()
        check(f"{want['attempts']} notes" in today, "today's count came back after the kill", today)
        check("% right" in page.get_by_test_id("note-slowest").inner_text(), "slowest notes came back")
        check(page.get_by_test_id("note-trainer").get_attribute("data-note-id") is not None, "a note is up with no click")
        old, midi = asked(page)
        strike(midi)
        next_note(page, old)
        today = page.get_by_test_id("note-today").inner_text()
        check(f"{want['attempts'] + 1} notes" in today, "the count carries on from there", today)

        # Switching tabs and back keeps the record.
        def switch_tabs() -> None:
            page.get_by_role("button", name="Intervals", exact=True).click()
            page.wait_for_timeout(200)
            page.get_by_role("button", name="Notes", exact=True).click()
            page.wait_for_selector("[data-testid=note-trainer][data-note-id]", timeout=5000)

        switch_tabs()
        check(f"{want['attempts'] + 1} notes" in page.get_by_test_id("note-today").inner_text(), "tab switch keeps it")

        # Hold the miss on screen: a screenshot of a hidden window can outlast the feedback.
        red = "() => document.querySelector('[data-testid=note-trainer] svg').innerHTML.includes('#ef4444')"
        page.evaluate("() => { window.__realTimeout = window.setTimeout; window.setTimeout = () => 0; }")
        note_id, midi = asked(page)
        name = note_id.split(":")[1]
        strike(midi + 1)
        page.wait_for_function(red, timeout=3000)
        text = page.get_by_test_id("note-feedback").inner_text()
        check(text.startswith("You played ") and text.endswith(f", it was {name}"), "the near miss says both notes", text)
        check(page.evaluate(red), "the near miss is drawn red on the staff")
        page.screenshot(path=str(SHOTS / "note_trainer_miss.png"))
        switch_tabs()

        # A key far off the staff: said in words, not drawn, so the staff can't clip it.
        note_id, midi = asked(page)
        name = note_id.split(":")[1]
        strike(21)
        page.wait_for_function(
            "() => document.querySelector('[data-testid=note-feedback]').innerText.includes('it was')", timeout=3000
        )
        check(page.get_by_test_id("note-feedback").inner_text() == f"You played A0, it was {name}",
              "the far miss says both notes", page.get_by_test_id("note-feedback").inner_text())
        check(not page.evaluate(red), "the far miss isn't drawn")
        page.screenshot(path=str(SHOTS / "note_trainer_far_miss.png"))
        page.evaluate("() => { window.setTimeout = window.__realTimeout; }")


def main() -> int:
    if len(sys.argv) != 3 or sys.argv[1] not in ("drill", "check"):
        sys.exit(__doc__)
    scratch = Path(sys.argv[2]).resolve()
    {"drill": phase_drill, "check": phase_check}[sys.argv[1]](scratch)
    print(f"\n{len(FAILS)} failed" if FAILS else "\nall passed")
    return 1 if FAILS else 0


if __name__ == "__main__":
    raise SystemExit(main())
