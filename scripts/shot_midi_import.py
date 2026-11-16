"""#6309 Picture of an imported MusicXML score in the Pages layout, against a RUNNING hidden muted app
(launch line: memory hidden-test-copy-must-be-muted).
    MIDITUTOR_URL=... MIDITUTOR_CDP=... MIDITUTOR_TOKEN_FILE=... python scripts/shot_midi_import.py <score.musicxml> <out.png>
"""
from __future__ import annotations

import os
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from miditutor_mcp import tutor_client as tc  # noqa: E402


def main(score: Path, out: Path) -> None:
    seq = tc.state()["eventSeq"]
    tc.load_piece("Import shot", score.read_text(encoding="utf-8"))
    for _ in range(40):
        if any(e.get("kind") == "piece" for e in tc.request("GET", f"/events?since={seq}&limit=2000")["events"]):
            break
        time.sleep(0.5)
    with sync_playwright() as p:
        page = p.chromium.connect_over_cdp(os.environ["MIDITUTOR_CDP"]).contexts[0].pages[0]
        page.set_viewport_size({"width": 1400, "height": 1000})
        page.get_by_role("button", name="Score", exact=True).click()
        page.wait_for_selector("[data-testid=bar-now]", timeout=30000)
        page.get_by_test_id("layout-pages").click()
        page.wait_for_timeout(2500)
        page.screenshot(path=str(out))


if __name__ == "__main__":
    main(Path(sys.argv[1]), Path(sys.argv[2]))
