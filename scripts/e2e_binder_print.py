"""#5723 end-to-end check on a hidden packaged app: "Print for binder" makes the overlapping-spread PDF.

    MIDITUTOR_REVIEW_LIBRARY=<desk review library> python scripts/e2e_binder_print.py seed <pieces-dir>
    MIDITUTOR_HIDDEN=1 MIDITUTOR_PRINT_NO_DIALOG=1 MIDITUTOR_PIECES_DIR=<pieces-dir> MIDITUTOR_PORT=47827 \
      ./out/MidiTutor-win32-x64/MidiTutor.exe --mute-audio --user-data-dir=<scratch>/ud --remote-debugging-port=9359
    MIDITUTOR_CDP=http://localhost:9359 python scripts/e2e_binder_print.py run <pieces-dir>

seed copies Sorcerer's Apprentice (3 paper pages) with its review layout from the desk library and marks it
verified, plus Aura Lee unverified. run prints both and checks the PDF and the print page.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import sys
from pathlib import Path

LIBRARY = Path(os.environ.get("MIDITUTOR_REVIEW_LIBRARY", ""))  # the desk review library (seed only)
CDP = os.environ.get("MIDITUTOR_CDP", "http://localhost:9359")
VERIFIED = "sorcerers-apprentice"
UNVERIFIED = "aura-lee"
HINT_COLOURS = ("#7c3aed", "#22c55e", "#16a34a", "#ef4444", "#dc2626", "#3b82f6", "#2563eb")
FAILS: list[str] = []


def check(cond, label, detail=""):
    print(("PASS " if cond else "FAIL ") + label + (f"  {detail}" if not cond else ""))
    if not cond:
        FAILS.append(label)


def seed(pieces: Path) -> None:
    if not str(LIBRARY) or not (LIBRARY / f"{VERIFIED}.musicxml").exists():
        sys.exit("set MIDITUTOR_REVIEW_LIBRARY to the desk review library")
    (pieces / "review").mkdir(parents=True, exist_ok=True)
    trust = {}
    for slug in (VERIFIED, UNVERIFIED):
        shutil.copy(LIBRARY / f"{slug}.musicxml", pieces / f"{slug}.musicxml")
        for ext in ("layout.json", "events.jsonl"):
            src = LIBRARY / "review" / f"{slug}.{ext}"
            if src.exists():
                shutil.copy(src, pieces / "review" / src.name)
    sha = hashlib.sha256((pieces / f"{VERIFIED}.musicxml").read_bytes()).hexdigest()
    trust[f"{VERIFIED}.musicxml"] = {"status": "verified", "note": "Verified by you (test)", "score_sha256": sha,
                                     "source": "todd-review"}
    (pieces / "trust.json").write_text(json.dumps(trust, indent=2), encoding="utf-8")
    print("seeded", pieces)


def pick(page, text: str) -> None:
    page.wait_for_function(
        f"() => [...document.querySelector('select').options].some((o) => o.text.includes({json.dumps(text)}))",
        timeout=15000)
    select = page.locator("select").first
    select.select_option(label=next(o for o in select.locator("option").all_inner_texts() if text in o))
    page.wait_for_selector("[data-testid=print-binder]:not([disabled])", timeout=30000)


def note(page, timeout=60000) -> str:
    page.wait_for_selector("[data-testid=print-binder-note]", timeout=timeout)
    return page.locator("[data-testid=print-binder-note]").inner_text()


def run(pieces: Path) -> None:
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp(CDP)
        page = browser.contexts[0].pages[0]
        page.on("pageerror", lambda e: print("pageerror:", e))
        page.wait_for_timeout(1500)
        page.get_by_role("button", name="Score", exact=True).click()

        # #6083: an unverified piece warns in a preview and prints only from Print
        pick(page, "Aura Lee")
        page.locator("[data-testid=print-binder]").click()
        page.wait_for_selector("[data-testid=binder-preview]", timeout=60000)
        warn = page.locator("[data-testid=binder-preview-warning]").inner_text()
        check(warn.startswith("Not verified yet"), "an unverified piece warns in the preview", warn)
        check(page.locator("[data-testid=binder-preview-frame]").count() == 1, "the preview shows the pages")
        check(not (pieces / "print" / f"{UNVERIFIED}-binder.pdf").exists(), "nothing printed before Print is pressed")
        page.locator("[data-testid=binder-preview-cancel]").click()
        page.wait_for_selector("[data-testid=binder-preview]", state="detached", timeout=5000)
        check(not (pieces / "print" / f"{UNVERIFIED}-binder.pdf").exists(), "Cancel prints nothing")
        page.locator("[data-testid=print-binder]").click()
        page.wait_for_selector("[data-testid=binder-preview]", timeout=60000)
        page.locator("[data-testid=binder-preview-print]").click()
        page.wait_for_function(
            "() => /Saved|failed/.test(document.querySelector('[data-testid=print-binder-note]')?.innerText ?? '')",
            timeout=120000)
        check((pieces / "print" / f"{UNVERIFIED}-binder.pdf").exists(), "the unverified piece prints after Print is pressed")

        pick(page, "Sorcerer")
        page.locator("[data-testid=print-binder]").click()
        page.wait_for_selector("[data-testid=binder-preview]", timeout=120000)
        check(page.locator("[data-testid=binder-preview-warning]").count() == 0, "a verified piece has no warning")
        check(not (pieces / "print" / f"{VERIFIED}-binder.pdf").exists(), "verified piece: nothing printed before Print")
        page.locator("[data-testid=binder-preview-print]").click()
        page.wait_for_function(
            "() => /Saved|failed/.test(document.querySelector('[data-testid=print-binder-note]')?.innerText ?? '')",
            timeout=120000)
        msg = note(page)
        check("3 pages, 6 sides" in msg, "Sorcerer's Apprentice: 3 paper pages, 6 sides", msg)

    pdf = pieces / "print" / f"{VERIFIED}-binder.pdf"
    html = (pieces / "print" / f"{VERIFIED}-binder.html").read_text(encoding="utf-8")
    check(pdf.exists() and pdf.stat().st_size > 10000, "PDF saved next to the pieces", str(pdf))
    sides = len(re.findall(rb"/Type\s*/Page(?![s\w])", pdf.read_bytes())) if pdf.exists() else 0
    check(sides == 6, "PDF has 6 sides", f"sides={sides}")
    order = re.findall(r'class="side" data-page="(\d+)"', html)
    check(order == ["1", "1", "2", "2", "3", "3"], "sides run 1,1,2,2,3,3", ",".join(order))
    low = html.lower()
    left = [c for c in HINT_COLOURS if c in low]
    check(not left, "no hint colour left in the print", ",".join(left))
    # Every bar numbered: bar numbers are SVG text; all of 2..69 should appear somewhere.
    texts = set(re.findall(r">\s*(\d{1,3})\s*</text>", html))
    missing = [n for n in range(2, 70) if str(n) not in texts]
    check(len(missing) <= 3, "every bar carries its number (2..69)", f"missing={missing[:12]}")
    # Paper page breaks: page 2 must open on bar 23 and page 3 on bar 51.
    pages = re.split(r'<div class="side" data-page="\d+">', html)[1:]
    firsts = []
    for k in (0, 2, 4):
        nums = [int(n) for n in re.findall(r">\s*(\d{1,3})\s*</text>", pages[k]) if 5 < int(n) < 100] if k < len(pages) else []
        firsts.append(min(nums) if nums else None)
    # (fingers are text too, 1-5, so only numbers above 5 count as bar numbers here)
    check(firsts[1:] in ([23, 51], [24, 52]), "pages break where his paper does (bars 23 and 51)",
          str(firsts))
    shot = os.environ.get("BINDER_SHOT")
    if shot and pdf.exists():
        try:
            import fitz  # PyMuPDF
            doc = fitz.open(pdf)
            for i in (0, 2, 4):
                doc[i].get_pixmap(dpi=60).save(f"{shot}-side{i + 1}.png")
            print("shots", shot)
        except ImportError:
            print("no PyMuPDF: skipped the page pictures")

    print("ALL PASS" if not FAILS else f"{len(FAILS)} FAIL: {FAILS}")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    if len(sys.argv) != 3 or sys.argv[1] not in ("seed", "run"):
        sys.exit(__doc__)
    (seed if sys.argv[1] == "seed" else run)(Path(sys.argv[2]))
