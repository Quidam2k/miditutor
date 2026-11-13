"""
#11354 item 3 end-to-end check of '5 min, no hints' and 'Hints off for new pieces' against a RUNNING hidden app

Launch:
    MIDITUTOR_ALLOW_INJECT=1 MIDITUTOR_HIDDEN=1 MIDITUTOR_PORT=47811 ./out/MidiTutor-win32-x64/MidiTutor.exe --mute-audio --user-data-dir=<scratch>/ud --remote-debugging-port=9347
    MIDITUTOR_URL=http://127.0.0.1:47811 MIDITUTOR_TOKEN_FILE=<scratch>/ud/api-token MIDITUTOR_CDP=http://127.0.0.1:9347 python scripts/e2e_bare.py
"""

import os
import re
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright
from e2e_backwards import tid  # noqa: E402  #6054 toolbar menus

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from miditutor_mcp import tutor_client as tc

FAILS = 0


def check(ok, label):
    global FAILS
    print(f"{'PASS' if ok else 'FAIL'}: {label}", flush=True)
    if not ok:
        FAILS += 1


def send(kind, note): return tc.request("POST", "/inject", {"notes": [note], "kind": kind, "velocity": 64})
def screen(): return tc.state().get("screen") or {}


LETTERS = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def midi_of(name):  # "F#4", "Bb3"
    m = re.fullmatch(r"([A-G])(#|b{1,2}|x)?(-?\d)", name)
    alter = {None: 0, "#": 1, "x": 2, "b": -1, "bb": -2}[m.group(2)]
    return 12 * (int(m.group(3)) + 1) + LETTERS[m.group(1)] + alter


def wait_for(predicate, timeout, label):
    deadline = time.monotonic() + timeout
    while True:
        result = predicate()
        if result:
            return result
        if time.monotonic() >= deadline:
            raise TimeoutError(label)
        time.sleep(0.1)


def play_step(remaining):
    notes = [midi_of(name) for name in remaining]
    try:
        for note in notes:
            send("noteon", note)
            time.sleep(0.02)
        time.sleep(0.12)
    finally:
        for note in notes:
            send("noteoff", note)
    time.sleep(0.15)


def main():
    wait_for(
        lambda: tc.state().get("rendererConnected"),
        30,
        "renderer did not connect within 30 seconds",
    )
    seq = tc.state()["eventSeq"]

    def events():
        return tc.request("GET", f"/events?since={seq}&limit=5000")["events"]

    def event_of(kind):
        return next((event for event in events() if event.get("kind") == kind), None)

    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp(os.environ["MIDITUTOR_CDP"])
        page = next(
            page
            for context in browser.contexts
            for page in context.pages
            if "devtools" not in page.url
        )
        page.set_default_timeout(10000)
        page.get_by_role("button", name="Score", exact=True).first.click()
        tid(page, "fresh-key").select_option("G")
        before = screen().get("piece")
        tid(page, "fresh-tune").click()

        # A new label: a fresh tune from an earlier run may still be on screen.
        def fresh_ready():
            current = screen()
            return (
                current.get("piece") != before
                and (current.get("piece") or "").startswith("Fresh tune")
                and bool(current.get("remaining"))
            )

        wait_for(fresh_ready, 10, "fresh tune did not become ready")
        # The tune shows a beat before its notes are judged; let it settle.
        time.sleep(1.5)
        check(fresh_ready(), "fresh tune is ready")
        # Key first (JP 10/9): every pitch class clears any signature's gate.
        if page.get_by_test_id("key-first").count():
            for n in range(60, 72):
                send("noteon", n)
                send("noteoff", n)
                time.sleep(0.15)
                if not page.get_by_test_id("key-first").count():
                    break
        check(page.get_by_test_id("key-first").count() == 0, "key-first gate cleared")
        next_notes = page.get_by_test_id("next-notes")
        check("…" in next_notes.inner_text(), "new-piece hints are hidden")

        settings = page.get_by_test_id("practice-settings")
        settings.click()
        hints_off = page.get_by_test_id("hintsOffNew")
        hints_off.uncheck()
        time.sleep(0.3)
        check(
            screen()["remaining"][0] in next_notes.inner_text(),
            "turning the setting off restores hints",
        )
        hints_off.check()
        time.sleep(0.3)
        check("…" in next_notes.inner_text(), "turning the setting on hides hints")
        settings.click()

        label = screen()["piece"]
        tid(page, "bare-start").click()
        stop = page.get_by_test_id("bare-stop")
        stop.wait_for(state="visible")
        check(stop.is_visible(), "no-hints run is active")
        check(
            re.fullmatch(r"No hints [45]:\d\d ■", stop.inner_text()) is not None,
            "no-hints countdown is shown",
        )
        started = wait_for(lambda: event_of("bare-start"), 5, "missing bare-start event")
        check(started.get("label") == label, "bare-start event has the piece label")

        miss_bar = screen()["measure"]
        notes = [midi_of(name) for name in screen()["remaining"]]
        wrong = max(notes) + 1
        send("noteon", wrong)
        time.sleep(0.05)
        send("noteoff", wrong)
        time.sleep(0.4)
        check(screen().get("wrongCount") == 1, "one wrong note is counted")
        time.sleep(1.5)
        check("…" in next_notes.inner_text(), "a miss does not reveal hints")

        bars_seen = {miss_bar}
        for _ in range(200):
            current = screen()
            if not current["remaining"]:
                break
            bars_seen.add(current["measure"])
            play_step(current["remaining"])
        check(not screen()["remaining"], "piece completed within 200 steps")

        # The countdown ticks, so the button never reads as "stable" in a hidden window.
        stop.click(force=True)
        done = wait_for(lambda: event_of("bare-done"), 5, "missing bare-done event")
        cleared = done.get("cleared")
        check(done.get("misses") == 1, "bare-done reports one miss")
        check(done.get("early") is True, "bare-done reports an early stop")
        check(done.get("ms", 0) > 0, "bare-done reports positive elapsed time")
        check(cleared == len(bars_seen) - 1, "all bars except the missed bar cleared")
        message = page.get_by_test_id("bare-msg").inner_text()
        check(
            message.startswith("Stopped:")
            and f"{cleared} bar" in message
            and "1 miss" in message,
            "stopped result shows cleared bars and one miss",
        )
        check(tid(page, "bare-start").is_visible(), "start button returns")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        check(False, f"{type(exc).__name__}: {exc}")
    print("ALL PASS" if FAILS == 0 else f"{FAILS} FAILS", flush=True)
    sys.exit(1 if FAILS else 0)
