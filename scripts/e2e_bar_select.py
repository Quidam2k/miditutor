"""#5944: clicking a bar box (Bar / Selected first / last) selects all its text, so a typed number replaces it.

Hidden MUTED app with inject + debug port (see e2e_celebrate.py), then: python scripts/e2e_bar_select.py
"""
from __future__ import annotations

import os
import sys
import time

from playwright.sync_api import sync_playwright

from e2e_backwards import FAILS, check, tc


def main() -> int:
    tc.request("POST", "/loop", {"firstBar": 2, "lastBar": 3})
    time.sleep(1)
    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp(os.environ["MIDITUTOR_CDP"])
        page = browser.contexts[0].pages[0]
        for tid in ("bar-now", "loop-first", "loop-last"):
            box = page.locator(f"[data-testid={tid}]")
            box.click()
            sel = box.evaluate("e => [e.selectionStart, e.selectionEnd, e.value.length]")
            check(sel[0] == 0 and sel[1] == sel[2] and sel[2] > 0, f"#5944: click selects all in {tid}", sel)
            # A second click while focused places the caret (does not re-select everything).
            box.click(position={"x": 2, "y": 5})
            sel = box.evaluate("e => [e.selectionStart, e.selectionEnd]")
            check(sel[0] == sel[1], f"#5944: second click in {tid} places the caret", sel)
            page.keyboard.press("Escape")
        tc.request("DELETE", "/loop")
    print("ALL PASS" if not FAILS else f"{len(FAILS)} FAILED: {FAILS}")
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
