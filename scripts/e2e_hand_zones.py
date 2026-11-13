"""#11354 item 4 end-to-end check of Score > "Hand zones" against a RUNNING hidden app.

Launch as in scripts/e2e_bare.py (hidden, muted, packaged, port 47811, CDP 9347), then:
    MIDITUTOR_URL=http://127.0.0.1:47811 MIDITUTOR_TOKEN_FILE=<scratch>/ud/api-token MIDITUTOR_CDP=http://127.0.0.1:9347 python scripts/e2e_hand_zones.py
On the built-in Minuet in G (two hands) it turns zones on, checks both hands are shaded and the
screen report matches the drawing, saves screengrab/e2e-hand-zones.png, and turns them off.
"""

import os
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright
from e2e_backwards import tid  # noqa: E402  #6054 toolbar menus

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from miditutor_mcp import tutor_client as tc  # noqa: E402

FAILS = []


def check(label, ok):
    print(f"{'PASS' if ok else 'FAIL'}: {label}")
    if not ok:
        FAILS.append(label)


def zones():
    return (tc.state().get("screen") or {}).get("handZones")


def main():
    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp(os.environ["MIDITUTOR_CDP"])
        page = next(pg for c in browser.contexts for pg in c.pages if "devtools" not in pg.url)
        page.get_by_role("button", name="Score", exact=True).first.click()
        page.locator("select").first.select_option("minuet")
        tid(page, "hand-zones").wait_for(timeout=15000)
        page.wait_for_function("() => !!document.querySelector('[data-testid=hand-zones]:not([disabled])')", timeout=15000)
        time.sleep(1.0)
        tid(page, "hand-zones").click()
        page.get_by_test_id("zones-msg").wait_for(timeout=5000)
        time.sleep(0.5)
        z = zones()
        check("screen reports hand zones", bool(z))
        z = z or {}
        check("right hand has positions", z.get("right", 0) > 0)
        check("left hand has positions", z.get("left", 0) > 0)
        bands = page.get_by_test_id("zone-band")
        check("bands drawn, as many as reported", bands.count() > 0 and bands.count() == z.get("bands"))
        check("both hands shaded", page.locator("[data-testid=zone-band][data-hand=R]").count() > 0
              and page.locator("[data-testid=zone-band][data-hand=L]").count() > 0)
        check("a fishing mark per reported jump", page.get_by_test_id("fishing-mark").count() == len(z.get("shifts", [])))
        msg = page.get_by_test_id("zones-msg").inner_text()
        check("message names both hands", msg.startswith(f"Right {z.get('right')} position") and f"left {z.get('left')}" in msg)
        print("zones:", z.get("right"), "R,", z.get("left"), "L, shifts", z.get("shifts"))
        (ROOT / "screengrab").mkdir(exist_ok=True)
        page.screenshot(path=str(ROOT / "screengrab" / "e2e-hand-zones.png"))
        tid(page, "hand-zones").click()
        time.sleep(0.3)
        check("off again: no bands, no report", page.get_by_test_id("zone-band").count() == 0 and not zones())


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        FAILS.append(f"{type(exc).__name__}: {exc}")
    print("FAILED: " + "; ".join(FAILS) if FAILS else "ALL PASS")
    sys.exit(1 if FAILS else 0)
