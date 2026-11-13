"""#5652 C end-to-end check of Score "Read ahead (experimental)" against a RUNNING hidden app.

The notes at the cursor blank out as it reaches them (not the run's first step), no hint names them,
and they come back after a wrong note. Launch as in e2e_bare.py, then:
    MIDITUTOR_URL=... MIDITUTOR_TOKEN_FILE=... MIDITUTOR_CDP=... python scripts/e2e_read_ahead.py
"""

import os
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

sys.path.insert(0, str(Path(__file__).resolve().parent))
import e2e_bare as eb  # noqa: E402
from e2e_backwards import tid  # noqa: E402
from e2e_bare import midi_of, play_step, screen, send, tc, wait_for  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
HIDDEN = (
    "() => [...document.querySelectorAll('.vf-stavenote')]"
    ".filter((g) => g.style.visibility === 'hidden').length"
)


def check(ok, label, detail=""):
    eb.check(ok, label if ok else f"{label}  {detail}")


def blanked():
    return (screen().get("readAhead") or {}).get("blanked", 0)


def main():
    wait_for(lambda: tc.state().get("rendererConnected"), 30, "renderer did not connect within 30 seconds")
    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp(os.environ["MIDITUTOR_CDP"])
        page = next(pg for ctx in browser.contexts for pg in ctx.pages if "devtools" not in pg.url)
        page.set_default_timeout(10000)
        page.get_by_role("button", name="Score", exact=True).first.click()
        tid(page, "fresh-key").select_option("C")
        before = screen().get("piece")
        tid(page, "fresh-tune").click()
        wait_for(
            lambda: screen().get("piece") != before and (screen().get("piece") or "").startswith("Fresh tune") and screen().get("remaining"),
            10,
            "fresh tune did not become ready",
        )
        time.sleep(1.5)
        if page.get_by_test_id("key-first").count():
            for n in range(60, 72):
                send("noteon", n)
                send("noteoff", n)
                time.sleep(0.15)
                if not page.get_by_test_id("key-first").count():
                    break
        # Hints for new pieces off, so only Read ahead hides them.
        settings = page.get_by_test_id("practice-settings")
        settings.click()
        page.get_by_test_id("hintsOffNew").uncheck()
        settings.click()
        next_notes = page.get_by_test_id("next-notes")
        time.sleep(0.3)

        check(screen().get("readAhead") is None, "off by default")
        check(page.evaluate(HIDDEN) == 0, "off: nothing blanked")
        check(screen()["remaining"][0] in next_notes.inner_text(), "off: hints name the next notes")

        tid(page, "read-ahead").check()
        time.sleep(0.3)
        check(screen().get("readAhead") == {"blanked": 0}, "on: the run's first step stays up", screen().get("readAhead"))

        play_step(screen()["remaining"])
        wait_for(lambda: blanked() > 0, 3, "second step not blanked")
        check(blanked() >= 1 and page.evaluate(HIDDEN) == blanked(), "on: the notes at the cursor are blanked", (blanked(), page.evaluate(HIDDEN)))
        check("…" in next_notes.inner_text(), "on: no hint names them", next_notes.inner_text())
        page.screenshot(path=str(ROOT / "screengrab" / "read_ahead.png"))

        # A wrong note brings them back.
        notes = [midi_of(n) for n in screen()["remaining"]]
        wrong = max(notes) + 1
        send("noteon", wrong)
        time.sleep(0.05)
        send("noteoff", wrong)
        wait_for(lambda: blanked() == 0, 3, "wrong note did not reveal")
        check(page.evaluate(HIDDEN) == 0, "a wrong note: the notes come back")
        check(screen()["remaining"][0] in next_notes.inner_text(), "a wrong note: the hint comes back", next_notes.inner_text())

        # Played right: the next step blanks again.
        play_step(screen()["remaining"])
        wait_for(lambda: blanked() > 0, 3, "next step not blanked")
        check(blanked() >= 1, "the next step blanks again")

        tid(page, "read-ahead").uncheck()
        time.sleep(0.3)
        check(screen().get("readAhead") is None and page.evaluate(HIDDEN) == 0, "off again: everything shows")
        saved = page.evaluate("() => JSON.parse(localStorage.getItem('miditutor-settings')).state.readAhead")
        check(saved is False, "setting persists", saved)

    print(f"\n{eb.FAILS} failed" if eb.FAILS else "\nall passed")
    return 1 if eb.FAILS else 0


if __name__ == "__main__":
    raise SystemExit(main())
