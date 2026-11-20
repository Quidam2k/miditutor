"""#6530 D end-to-end: the speed-vs-misses banner, against a RUNNING hidden muted app (see memory
hidden-test-copy-must-be-muted; env MIDITUTOR_URL / MIDITUTOR_TOKEN_FILE / MIDITUTOR_CDP, and
MIDITUTOR_LOG_DIR = the copy's <user-data-dir>/logs, where yesterday's day log is seeded).

Seeded yesterday: bar 1 looped 5 times clean at 70 and once at 120 with 2 wrong.
Played now: 3 laps of bar 1 at ~120 with a wrong note each -> the 3rd lap finds the advice,
but it must NOT show while he keeps playing; after a 4 s pause it shows "above ~120, try 70".
[Play it slower] -> loop cleared, whole-piece Keep going at 70 (no climb). Then stop.
"""

import json
import os
import sys
import time
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from miditutor_mcp import tutor_client as tc
from scripts.e2e_lap_tempo import fixture, load
from scripts.e2e_overrun import FAILS, check, events_since, tap, wait_for


def screen():
    return tc.state().get("screen") or {}


def seed(log_dir, piece):
    day = (date.today() - timedelta(days=1)).isoformat()
    t = int(time.time() * 1000) - 86_400_000
    rows = [{"kind": "piece", "piece": piece, "timestamp": t}]
    for i, (bpm, wrong) in enumerate([(70, 0)] * 5 + [(120, 2)]):
        rows.append({"kind": "lap", "lap": i + 1, "firstBar": 1, "lastBar": 1, "bpm": bpm, "wrong": wrong,
                     "wrongBars": [1] if wrong else [], "skipped": False, "timestamp": t + 1000 * (i + 1)})
    path = Path(log_dir) / f"{day}.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf8") as f:
        for r in rows:
            f.write(json.dumps(r) + "\n")
    return path


def fast_lap_with_miss():
    for n in (60, 62):
        tap(n)
        time.sleep(0.44)
    tap(61)  # C#: wrong
    time.sleep(0.05)
    for n in (64, 65):
        tap(n)
        time.sleep(0.44)


def main():
    from playwright.sync_api import sync_playwright

    wait_for(lambda: tc.state().get("rendererConnected"), 30)
    piece = load("Speed misses (e2e)")
    name = piece.get("piece")
    print("piece:", name, "seeded:", seed(os.environ["MIDITUTOR_LOG_DIR"], name))

    tc.request("POST", "/loop", {"firstBar": 1, "lastBar": 1})
    time.sleep(1)
    seq = tc.state()["eventSeq"]
    for _ in range(3):
        fast_lap_with_miss()
    laps = wait_for(lambda: len(events_since(seq, "lap")) >= 3 and events_since(seq, "lap"), 5) or []
    print("laps:", [(lap.get("bpm"), lap.get("wrong")) for lap in laps])
    check("3 laps, each with 1 wrong", len(laps) >= 3 and all(lap.get("wrong") == 1 for lap in laps[:3]))

    # Still playing (a note a second): no banner mid-passage.
    for n in (60, 62, 64, 65, 60):
        tap(n)
        time.sleep(0.94)
    check("no banner while he keeps playing", screen().get("advice") is None and not events_since(seq, "advice"))

    shown = wait_for(lambda: [e for e in events_since(seq, "advice") if e.get("shown")], 8) or [{}]
    adv = screen().get("advice") or {}
    print("advice:", shown[0], "screen:", adv)
    check("banner shows after a pause", bool(shown[0]) and adv.get("rule") == "speed")
    check("advice: above ~120, try 70, bars 1-1", 100 <= (adv.get("above") or 0) <= 140 and adv.get("tryBpm") == 70
          and (adv.get("first"), adv.get("last")) == (1, 1))

    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp(os.environ["MIDITUTOR_CDP"])
        page = next(pg for ctx in browser.contexts for pg in ctx.pages if "devtools" not in pg.url)
        check("banner text", "Try the whole piece at ♩ = 70" in page.get_by_test_id("advice").inner_text())
        seq = tc.state()["eventSeq"]
        page.get_by_test_id("advice-slower").click()
        on = wait_for(lambda: [e for e in events_since(seq, "keep") if e.get("on") is True], 8) or [{}]
        print("keep on:", on[0])
        check("Play it slower: whole-piece Keep going at 70",
              (on[0].get("bpm"), on[0].get("looping"), on[0].get("firstBar"), on[0].get("lastBar")) == (70, False, 1, 3))
        check("no climb, loop cleared, banner gone",
              not [e for e in events_since(seq, "climb") if e.get("on")] and screen().get("loop") is None
              and screen().get("advice") is None)
        acted = [e for e in events_since(seq, "advice") if e.get("action") == "slower"]
        check("advice action logged", bool(acted) and acted[0].get("tryBpm") == 70)
        page.get_by_test_id("keep-going").click()
        time.sleep(0.5)
        check("Keep going stopped", screen().get("keep") is None or "bpm" not in (screen().get("keep") or {}))

    print("passed" if not FAILS else f"failed: {FAILS}")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
