"""#6090 Measure where the ink is on each side of a binder PDF (no paper needed).

    /q/Pantheon/.venv-omnivoice/Scripts/python.exe scripts/measure_binder_ink.py <binder.pdf> [--shots <prefix>]

Prints, per side, the ink bounding box in inches and the margins. "Printable" is the sheet less the
0.3 in edge and 0.45 in folio strip at the bottom. The hole side is the left on a front (odd sides),
the right on a back (even sides). Exits 1 if the hole-side margin is under 0.55 in, or a full page
(the sides that carry the most systems) fills under 85% of the printable height.
"""
from __future__ import annotations

import sys

import fitz  # PyMuPDF

DPI = 100
EDGE, FOLIO, HOLE_MIN, FILL_MIN = 0.3, 0.45, 0.55, 0.85


def main(path: str, shot: str | None) -> int:
    doc = fitz.open(path)
    rows = []
    for i, page in enumerate(doc):
        pix = page.get_pixmap(dpi=DPI, colorspace=fitz.csGRAY)
        w, h, s = pix.width, pix.height, pix.samples
        xs, ys = [], []
        # Ink = clearly dark pixels, ignoring the folio strip at the bottom.
        limit = int(h - FOLIO * DPI * 0.6)
        for y in range(0, limit):
            row = s[y * w:(y + 1) * w]
            hits = [x for x, v in enumerate(row) if v < 128]
            if hits:
                ys.append(y)
                xs.extend((hits[0], hits[-1]))
        if not ys:
            rows.append((i + 1, None))
            continue
        left, right, top, bottom = min(xs) / DPI, (w - max(xs)) / DPI, min(ys) / DPI, max(ys) / DPI
        rows.append((i + 1, (left, right, top, bottom - top)))
        if shot:
            page.get_pixmap(dpi=60).save(f"{shot}-side{i + 1}.png")
    printable_h = 11 - EDGE - FOLIO
    bad = []
    heights = [r[1][3] for r in rows if r[1]]
    full = max(heights) if heights else 0
    for n, m in rows:
        if m is None:
            print(f"side {n}: blank")
            continue
        left, right, top, ink_h = m
        hole = left if n % 2 else right
        fill = ink_h / printable_h
        print(f"side {n}: left {left:.2f} in, right {right:.2f} in (hole side {'left' if n % 2 else 'right'} = {hole:.2f}), "
              f"top {top:.2f} in, ink height {ink_h:.2f} in = {fill:.0%} of {printable_h:.2f} in printable")
        if hole < HOLE_MIN:
            bad.append(f"side {n}: hole-side margin {hole:.2f} < {HOLE_MIN}")
        if ink_h >= 0.7 * printable_h and fill < FILL_MIN:  # a full page, not the short last one
            bad.append(f"side {n}: fills only {fill:.0%}")
    print("PASS" if not bad else "FAIL " + "; ".join(bad))
    return 1 if bad else 0


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    sys.exit(main(sys.argv[1], sys.argv[3] if len(sys.argv) > 3 and sys.argv[2] == "--shots" else None))
