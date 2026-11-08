"""#5657c end-to-end check of Block (hand-position blocking) against a RUNNING hidden app.

Launch a packaged, muted, hidden copy (see memory hidden-test-copy-must-be-muted):
    MIDITUTOR_ALLOW_INJECT=1 MIDITUTOR_HIDDEN=1 MIDITUTOR_PORT=47811 ./out/MidiTutor-win32-x64/MidiTutor.exe         --mute-audio --user-data-dir=<scratch>/ud --remote-debugging-port=9347
then, with a python that has playwright:
    MIDITUTOR_URL=http://127.0.0.1:47811 MIDITUTOR_TOKEN_FILE=<scratch>/ud/api-token         MIDITUTOR_CDP=http://127.0.0.1:9347 python scripts/e2e_blocking.py

A fingered two-bar fixture (finger 1 moves C4 -> G4) gives two hand positions. Three clean
holds each; a partial hold or a hold after a wrong key doesn't count; the follower ignores it all.
"""

import os
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


def hold(notes):
    for note in notes:
        send("noteon", note)
        time.sleep(0.02)
    time.sleep(0.3)
    for note in notes:
        send("noteoff", note)
    time.sleep(0.3)


def fixture():
    measures = []
    positions = (
        (("C", 4), ("D", 4), ("E", 4), ("F", 4)),
        (("G", 4), ("A", 4), ("B", 4), ("C", 5)),
    )
    for number, notes in enumerate(positions, 1):
        attributes = ""
        if number == 1:
            attributes = """
      <attributes>
        <divisions>1</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <staves>1</staves>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>"""
        body = []
        for finger, (step, octave) in enumerate(notes, 1):
            body.append(f"""
      <note>
        <pitch><step>{step}</step><octave>{octave}</octave></pitch>
        <duration>1</duration>
        <type>quarter</type>
        <notations>
          <technical><fingering>{finger}</fingering></technical>
        </notations>
      </note>""")
        measures.append(
            f'    <measure number="{number}">{attributes}'
            + "".join(body)
            + "\n    </measure>"
        )
    return """<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list>
    <score-part id="P1"><part-name>Piano</part-name></score-part>
  </part-list>
  <part id="P1">
""" + "\n".join(measures) + """
  </part>
</score-partwise>
"""


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

    tc.load_piece("Blocking (e2e)", fixture())
    cursor = seq
    deadline = time.monotonic() + 30
    while True:
        events = tc.request(
            "GET", f"/events?since={cursor}&limit=2000"
        )["events"]
        if any(event.get("kind") == "piece" for event in events):
            break
        cursor = max(
            (event.get("seq", cursor) for event in events),
            default=cursor,
        )
        if time.monotonic() >= deadline:
            raise RuntimeError("Timed out waiting for the piece event.")
        time.sleep(0.1)
    time.sleep(1.5)

    tc.request("POST", "/loop", {"firstBar": 1, "lastBar": 2})
    time.sleep(1)

    def block_events():
        return [
            event
            for event in tc.request(
                "GET", f"/events?since={seq}&limit=5000"
            )["events"]
            if event.get("kind") == "block"
        ]

    first = [60, 62, 64, 65]
    second = [67, 69, 71, 72]

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

        page.get_by_test_id("block").click()
        time.sleep(0.8)

        block = screen().get("block")
        check("block is a dict", isinstance(block, dict))
        block = block if isinstance(block, dict) else {}
        check("position 1", block.get("position") == 1)
        check("two positions", block.get("of") == 2)
        check("first keys", block.get("keys") == ["C4", "D4", "E4", "F4"])
        check("first fingers", block.get("fingers") == ["R1", "R2", "R3", "R4"])
        check("need three holds", block.get("need") == 3)
        check("initial clean zero", block.get("clean") == 0)
        check("initially armed", block.get("armed") is True)
        check(
            "status shows position 1/2",
            "position 1/2" in page.get_by_test_id("block-status").inner_text(),
        )
        check(
            "says hold C-F together",
            page.get_by_test_id("next-notes").inner_text().strip() == "Hold together: F4 + E4 + D4 + C4",
        )
        green = page.locator('[data-testid="keyboard-strip"]').inner_text()
        check("keys carry fingers 1-4", all(d in green for d in "1234"))

        hold(first)
        hold(first)
        block = screen().get("block") or {}
        check("two clean holds", block.get("clean") == 2)
        check("still position 1", block.get("position") == 1)

        hold([60, 62, 64])
        block = screen().get("block") or {}
        check("partial hold keeps clean at two", block.get("clean") == 2)

        send("noteon", 61)
        time.sleep(0.02)
        send("noteoff", 61)
        hold(first)
        block = screen().get("block") or {}
        check("spoiled hold keeps clean at two", block.get("clean") == 2)
        events = block_events()
        check("wrong event", any(event.get("event") == "wrong" for event in events))
        check(
            "spoiled-hold event",
            any(event.get("event") == "spoiled-hold" for event in events),
        )

        hold(first)
        block = screen().get("block") or {}
        check("advanced to position 2", block.get("position") == 2)
        check("position 2 starts clean at zero", block.get("clean") == 0)
        check("second keys", block.get("keys") == ["G4", "A4", "B4", "C5"])

        state = screen()
        check("follower wrongCount stays zero", state.get("wrongCount", 0) == 0)
        check("follower lap stays one", (state.get("loop") or {}).get("lap") == 1)

        hold(second)
        hold(second)
        hold(second)
        block = screen().get("block") or {}
        check("block done", block.get("done") is True)
        check(
            "status shows all positions held clean",
            "all 2 positions held clean"
            in page.get_by_test_id("block-status").inner_text(),
        )
        check(
            "done event",
            any(event.get("event") == "done" for event in block_events()),
        )

        page.get_by_test_id("block").click()
        time.sleep(0.8)
        check("toggle ends block", screen().get("block") is None)

        page.get_by_test_id("block").click()
        time.sleep(0.8)
        check("block restarted", isinstance(screen().get("block"), dict))
        tc.request("DELETE", "/loop")
        time.sleep(0.8)
        check("Clear loop ends it", screen().get("block") is None)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        FAILS.append(f"{type(exc).__name__}: {exc}")

    if FAILS:
        print("FAILED: " + "; ".join(FAILS))
        sys.exit(1)
    print("ALL PASS")
