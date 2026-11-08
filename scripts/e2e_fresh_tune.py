"""#11354 end-to-end check of Fresh tune against a RUNNING hidden app.

Launch a packaged, muted, hidden copy (see memory hidden-test-copy-must-be-muted):
    MIDITUTOR_ALLOW_INJECT=1 MIDITUTOR_HIDDEN=1 MIDITUTOR_PORT=47811 ./out/MidiTutor-win32-x64/MidiTutor.exe
        --mute-audio --user-data-dir=<scratch>/ud --remote-debugging-port=9347   (one line)
then, with a python that has playwright:
    MIDITUTOR_URL=http://127.0.0.1:47811 MIDITUTOR_TOKEN_FILE=<scratch>/ud/api-token
        MIDITUTOR_CDP=http://127.0.0.1:9347 python scripts/e2e_fresh_tune.py   (one line)

A fresh G-major tune starts with hints off. A wrong note restores hints, completing
the tune records its result, and subsequent requests exercise minor tunes and freshness.
"""

import os
import re
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from miditutor_mcp import tutor_client as tc


FAILS = []


def check(label, condition):
    print(f"{'PASS' if condition else 'FAIL'}: {label}")
    if not condition:
        FAILS.append(label)


def send(kind, note):
    return tc.request(
        "POST",
        "/inject",
        {"notes": [note], "kind": kind, "velocity": 64},
    )


def screen():
    return tc.state().get("screen") or {}


LETTERS = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def midi_of(name):  # "F#4", "Bb3"
    m = re.fullmatch(r"([A-G])(#|b{1,2}|x)?(-?\d)", name)
    alter = {None: 0, "#": 1, "x": 2, "b": -1, "bb": -2}[m.group(2)]
    return 12 * (int(m.group(3)) + 1) + LETTERS[m.group(1)] + alter


def main():
    cdp = os.environ.get("MIDITUTOR_CDP", "").strip()
    if not cdp:
        raise RuntimeError(
            "MIDITUTOR_CDP is required; set it to the running hidden app's "
            "Chrome DevTools Protocol endpoint."
        )

    from playwright.sync_api import sync_playwright

    deadline = time.monotonic() + 30
    while not tc.state().get("rendererConnected"):
        if time.monotonic() >= deadline:
            raise RuntimeError("Timed out waiting for rendererConnected.")
        time.sleep(0.2)

    seq = tc.state()["eventSeq"]

    def fresh_events():
        return [
            event
            for event in tc.request(
                "GET", f"/events?since={seq}&limit=5000"
            )["events"]
            if event.get("kind") == "fresh-tune"
        ]

    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp(cdp)
        page = next(
            (
                page
                for context in browser.contexts
                for page in context.pages
                if "devtools" not in page.url
            ),
            None,
        )
        if page is None:
            raise RuntimeError("No app page found at MIDITUTOR_CDP.")

        # The app opens on Practice; Fresh tune lives on the Score tab.
        page.get_by_role("button", name="Score", exact=True).first.click()
        page.get_by_test_id("fresh-key").wait_for(timeout=15000)
        page.get_by_test_id("fresh-key").select_option("G")
        page.get_by_test_id("fresh-tune").click()

        deadline = time.monotonic() + 10
        while True:
            s = screen()
            if (s.get("piece") or "").startswith("Fresh tune") and s.get("remaining"):
                break
            if time.monotonic() >= deadline:
                raise RuntimeError("Timed out waiting for the fresh G-major tune.")
            time.sleep(0.1)

        check("G-major label", s["piece"].endswith("(G major)"))
        remaining = s["remaining"]

        events = [event for event in fresh_events() if event.get("key") == "G"]
        check("fresh-tune event for G", bool(events))
        if not events:
            raise RuntimeError("No fresh-tune event for G.")
        first_id = events[-1]["id"]

        hints = page.get_by_test_id("next-notes").inner_text()
        check("hints start with ellipsis", "…" in hints)
        check(
            "remaining notes initially hidden",
            all(note not in hints for note in remaining),
        )

        remaining_midi = {midi_of(note) for note in remaining}
        wrong = max(remaining_midi) + 1
        while wrong in remaining_midi:
            wrong += 1

        send("noteon", wrong)
        time.sleep(0.05)
        send("noteoff", wrong)
        time.sleep(0.4)

        check("one wrong note", screen().get("wrongCount") == 1)
        check(
            "wrong note restores hints",
            remaining[0] in page.get_by_test_id("next-notes").inner_text(),
        )

        for _ in range(200):
            s = screen()
            if not s.get("remaining"):
                break
            notes = [midi_of(note) for note in s["remaining"]]
            for note in notes:
                send("noteon", note)
                time.sleep(0.02)
            time.sleep(0.12)
            for note in notes:
                send("noteoff", note)
            time.sleep(0.15)

        events = tc.request(
            "GET", f"/events?since={seq}&limit=5000"
        )["events"]
        done = [
            event
            for event in events
            if event.get("kind") == "fresh-done"
            and event.get("id") == first_id
        ]
        check("fresh-done event for first tune", bool(done))
        result = done[-1] if done else {}
        check("completed tune key is G", result.get("key") == "G")
        check("completed tune records one wrong note", result.get("wrong") == 1)
        check("completed tune records positive time", result.get("ms", 0) > 0)
        check(
            "completed tune records positive integer bpm",
            type(result.get("bpm")) is int and result["bpm"] > 0,
        )

        previous_label = screen().get("piece")
        page.get_by_test_id("fresh-key").select_option("a")
        page.get_by_test_id("fresh-tune").click()

        deadline = time.monotonic() + 10
        while True:
            label = screen().get("piece") or ""
            if label != previous_label and label.endswith("(A minor)"):
                check("A-minor request loads a fresh tune", True)
                print("A minor: loaded a fresh tune")
                break
            message = page.get_by_test_id("sight-msg")
            if message.count() and "No fresh minor tune left" in message.inner_text():
                check("A-minor request reports no fresh minor tune left", True)
                print("A minor: No fresh minor tune left")
                break
            if time.monotonic() >= deadline:
                raise RuntimeError(
                    "Timed out waiting for an A-minor tune or exhaustion message."
                )
            time.sleep(0.1)

        previous_label = screen().get("piece")
        previous_event_count = len(fresh_events())
        page.get_by_test_id("fresh-key").select_option("G")
        page.get_by_test_id("fresh-tune").click()

        deadline = time.monotonic() + 10
        while True:
            label = screen().get("piece") or ""
            events = fresh_events()[previous_event_count:]
            if label != previous_label and events:
                break
            if time.monotonic() >= deadline:
                raise RuntimeError("Timed out waiting for another fresh G-major tune.")
            time.sleep(0.1)

        check("second G-major label", label.endswith("(G major)"))
        check("second fresh-tune event key is G", events[-1].get("key") == "G")
        check("second fresh-tune event has an id", "id" in events[-1])
        check("second tune differs from first", events[-1].get("id") != first_id)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        FAILS.append(f"{type(exc).__name__}: {exc}")

    if FAILS:
        print("FAILED: " + "; ".join(FAILS))
        sys.exit(1)
    print("ALL PASS")
