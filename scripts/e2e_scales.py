"""#10130 end-to-end check of two-octave homework scales against a RUNNING hidden app.
Needs CDP and a scratch Pieces folder holding a test homework.json (E minor scale with no type,
G major scale whose RH fingering is "JP-TEST 123 1234", E minor arpeggio):
    (sleep 170) | MIDITUTOR_HIDDEN=1 MIDITUTOR_PORT=47931 MIDITUTOR_VITE_PORT=5183 \
      MIDITUTOR_PIECES_DIR=<scratch> npx electron-forge start -- --remote-debugging-port=9333
    MIDITUTOR_URL=http://127.0.0.1:47931 python scripts/e2e_scales.py
"""
from __future__ import annotations

import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from miditutor_mcp import tutor_client as tc  # noqa: E402

NATURAL_UP = [0, 2, 3, 5, 7, 8, 10, 12, 14, 15, 17, 19, 20, 22, 24]
RH_UP = [1, 2, 3, 1, 2, 3, 4, 1, 2, 3, 1, 2, 3, 4, 5]
LH_UP = [5, 4, 3, 2, 1, 3, 2, 1, 4, 3, 2, 1, 3, 2, 1]
FAILS: list[str] = []


def check(cond: bool, label: str, detail: object = "") -> None:
    print(("PASS " if cond else "FAIL ") + label + (f"  {detail}" if not cond else ""))
    if not cond:
        FAILS.append(label)


def strike(note: int) -> None:
    result = tc.request("POST", "/inject", {"notes": [note], "kind": "chord", "holdMs": 30})
    if "error" in result:
        sys.exit(f"inject failed: {result}")
    time.sleep(0.08)


def mirrored(up: list[int]) -> list[int]:
    return up + up[-2::-1]


with sync_playwright() as p:
    browser = p.chromium.connect_over_cdp("http://127.0.0.1:9333")
    page = browser.contexts[0].pages[0]
    notes = page.locator("[data-testid=scale-note]")
    fingers = page.locator("[data-testid=scale-finger]")

    def finger_list() -> list[int]:
        return [int(x) for x in fingers.all_inner_texts()]

    def open_item(label: str) -> None:
        page.get_by_role("button", name="Practice", exact=True).click()
        page.get_by_role("button", name="Homework", exact=True).click()
        page.get_by_role("button", name=label).click()
        page.wait_for_timeout(200)

    open_item("E minor scale")
    body = page.locator("body")
    check("two octaves" in body.inner_text(), "says two octaves")
    check(notes.count() == 29, "29 notes", notes.count())
    check(page.locator("button.bg-indigo-600", has_text="natural").count() == 1, "natural is the default type")
    check("Standard fingering, not JP's" in body.inner_text(), "fingering labelled as not JP's")
    check(finger_list() == mirrored(RH_UP), "RH numbers", finger_list())

    for offset in mirrored(NATURAL_UP):
        strike(52 + offset)
    page.wait_for_timeout(1600)
    check("Left hand" in body.inner_text(), "29 right notes moves on to the left hand")
    check(finger_list() == mirrored(LH_UP), "LH numbers", finger_list())

    page.get_by_role("button", name="melodic").click()
    page.wait_for_timeout(200)
    names = [t.split()[0] for t in notes.all_inner_texts()]
    check(names[12] == "C#" and names[13] == "D#" and names[15] == "D" and names[16] == "C", "melodic up raised, down natural", names)
    check(finger_list() == mirrored(RH_UP), "melodic RH numbers", finger_list())

    page.get_by_role("button", name="harmonic").click()
    page.wait_for_timeout(200)
    names = [t.split()[0] for t in notes.all_inner_texts()]
    check(names[13] == "D#" and names[15] == "D#", "harmonic keeps the raised seventh", names)

    open_item("G major scale")
    check("JP-TEST 123 1234" in body.inner_text(), "JP's written fingering shows")
    check("Standard fingering" not in body.inner_text() and fingers.count() == 0, "no numbers beside JP's")

    open_item("E minor arpeggio")
    check("one octave" in body.inner_text() and notes.count() == 7, "arpeggio stays one octave", notes.count())
    check(fingers.count() == 0, "arpeggio has no numbers")
    browser.close()

print("ALL PASS" if not FAILS else f"FAILED: {FAILS}")
sys.exit(1 if FAILS else 0)
