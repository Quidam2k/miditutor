"""Map each printed system of a scanned piano score to its pixel band, barlines and MusicXML measures.

Usage: review_layout.py [--library DIR] [--force] [slug ...]

Reads <library>/<slug>.musicxml and <library>/pages/<slug>/NN.png (300-dpi scans). Writes
review/<slug>.layout.json and review-pages/<slug>/sNN.jpg (one crop per system) under the library,
never the repo. No slugs = every slug that has both scans and a score. Up-to-date slugs are skipped
unless --force. Pages are processed one at a time; there is no multiprocessing.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import xml.etree.ElementTree as ET

sys.dont_write_bytecode = True

import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None

DEFAULT_LIBRARY = Path("Q:/Personal/piano/library")
VERSION = 1
DARK_LEVEL = 170            # gray below this counts as ink
ANGLE_RANGE_TENTHS = 20     # deskew search: -2.0..+2.0 degrees in 0.1 steps
LINE_FRAC = 0.5             # staff line row: darkness > this * the darkest row
LINE_ROW_GAP = 1            # merge staff-line rows no further apart than this
STAFF_EVEN = 0.25           # a staff's line gaps are within this fraction of their median
MIN_SPACING, MAX_SPACING = 8, 60   # staff line spacing in px at 300 dpi
BORDER_DARK = 0.5           # a column inked over this fraction of the page is the scan's edge
EXTENT_GAP = 25             # a staff line's ink stretch bridges gaps up to this (not up to a label beside the staff)
BARLINE_DARK = 0.95         # barline candidate: ink fraction through every staff
BARLINE_GAP = 18            # merge candidate columns no further apart than this
EDGE_TOL = 12               # barline this close to a staff end is kept whatever its scores
EDGE_SPACINGS = 4           # a line this many staff spaces from a staff end is the system edge
OUTSIDE_TOL = 12            # drop runs this far outside the staff extent
GAP_MARGIN = 3              # rows skipped next to a staff when measuring the gap between staves
SPACE_MARGIN = 3            # rows skipped next to a line when measuring staff spaces
ISO_NEAR, ISO_FAR = 5, 14   # isolation windows: [x0-FAR, x0-NEAR) and [x1+NEAR, x1+FAR)
CONNECTED_GAPFILL = 0.5     # gapfill needed to call barlines connected between staves
MAX_ISOLATION = 0.25        # unconnected style: barline must be this clean on either side
BAND_SPACINGS = 4           # system band extends this many line spacings past the staves
CROP_SCALE = 0.5            # 300 dpi scan -> 150 dpi crop
JPEG_QUALITY = 85


# ---- small helpers -------------------------------------------------------------------------

def _runs(indices, gap):
    """Group sorted indices into [first, last] runs where neighbours are at most gap apart."""
    out = []
    for i in indices:
        i = int(i)
        if out and i - out[-1][1] <= gap:
            out[-1][1] = i
        else:
            out.append([i, i])
    return out


def _local(tag):
    return tag.rsplit("}", 1)[-1]


def _kids(element, name):
    return [c for c in element if _local(c.tag) == name]


def _sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


# ---- MusicXML ------------------------------------------------------------------------------

def read_score(path):
    """Return dict: measures [(position, number attr)] of the first part, breaks, staves_per_system."""
    root = ET.parse(path).getroot()
    parts = _kids(root, "part")
    if not parts:
        raise ValueError("score has no <part>")
    staves = 0
    for part in parts:
        count = 1
        for node in part.iter():
            if _local(node.tag) == "staves" and (node.text or "").strip().isdigit():
                count = int(node.text.strip())
                break
        staves += count
    measures, breaks = [], []
    for pos, measure in enumerate(_kids(parts[0], "measure"), 1):
        measures.append((pos, measure.get("number")))
        new_system = any(c.get("new-system") == "yes" for c in _kids(measure, "print"))
        if pos == 1 or new_system:
            breaks.append(pos)
    return {"measures": measures, "breaks": breaks, "staves_per_system": staves}


def map_measures(scan_counts, xml_breaks, xml_total):
    """Per scan system, (first, last) one-based measure positions or None when not provable."""
    n = len(scan_counts)
    result = [None] * n
    if None not in scan_counts and sum(scan_counts) == xml_total:
        pos = 1
        for i, count in enumerate(scan_counts):
            result[i] = (pos, pos + count - 1)
            pos += count
        return result
    ends_ok = set(xml_breaks) | {xml_total + 1}
    pos, front = 1, 0
    while front < n:
        count = scan_counts[front]
        if count is None or count < 1 or pos + count not in ends_ok:
            break
        result[front] = (pos, pos + count - 1)
        pos += count
        front += 1
    end, back = xml_total + 1, n - 1
    while back >= front:
        count = scan_counts[back]
        start = None if count is None or count < 1 else end - count
        if start is None or start < pos or start not in xml_breaks:
            break
        result[back] = (start, end - 1)
        end = start
        back -= 1
    return result


# ---- scan analysis -------------------------------------------------------------------------

def best_angle(gray):
    """Deskew angle in degrees: the rotation that makes row ink density most uneven."""
    small = gray.resize((gray.width // 2, gray.height // 2))
    best_score, best = -1.0, 0.0
    for tenth in range(-ANGLE_RANGE_TENTHS, ANGLE_RANGE_TENTHS + 1):
        angle = tenth / 10
        rotated = np.asarray(small.rotate(angle, resample=Image.BILINEAR, fillcolor=255))
        score = float(np.var((rotated < DARK_LEVEL).mean(axis=1)))
        if score > best_score:
            best_score, best = score, angle
    return best


def find_staves(dark):
    """Return (staves, spacing, warnings); staves are lists of 5 line y centres."""
    frac = dark.mean(axis=1)
    if frac.max() <= 0:
        return [], 0, ["no ink on page"]
    rows = np.where(frac > LINE_FRAC * frac.max())[0]
    lines = [(a + b) // 2 for a, b in _runs(rows, LINE_ROW_GAP)]
    # A staff is 5 consecutive lines evenly spaced; anything else (a bold title, a long
    # bracket or hairpin under a staff, the page edge) is a stray line and is skipped.
    staves, strays, i = [], 0, 0
    while i < len(lines):
        group = lines[i:i + 5]
        gaps = [b - a for a, b in zip(group, group[1:])]
        mid = float(np.median(gaps)) if gaps else 0
        if len(group) == 5 and MIN_SPACING <= mid <= MAX_SPACING and \
                all(abs(g - mid) <= STAFF_EVEN * mid for g in gaps):
            staves.append(group)
            i += 5
        else:
            strays += 1
            i += 1
    warnings = [f"skipped {strays} line(s) that are not part of a staff"] if strays else []
    gaps = [b - a for st in staves for a, b in zip(st, st[1:])]
    spacing = int(round(float(np.median(gaps)))) if gaps else 0
    return staves, spacing, warnings


def staff_extent(dark, staff, border):
    """[x_left, x_right]: the median start and end of the staff's 5 lines, each line's longest
    inked stretch (gaps up to EXTENT_GAP bridged). One faint line or a hole punch can't move it."""
    starts, ends = [], []
    for y in staff:
        found = _runs(np.where(dark[y - 1:y + 2].any(axis=0) & ~border)[0], EXTENT_GAP)
        if found:
            a, b = max(found, key=lambda r: r[1] - r[0])
            starts.append(a)
            ends.append(b)
    if len(starts) < 3:
        return None
    return [int(np.median(starts)), int(np.median(ends))]


def _mean_cols(block, a, b):
    a, b = max(a, 0), min(b, block.shape[1])
    return float(block[:, a:b].mean()) if b > a and block.shape[0] else 0.0


def barline_runs(dark, system, x_left, x_right):
    """Candidate barline runs for one system, each with its gapfill and isolation scores."""
    ok = None
    for st in system:
        col = dark[st[0] - 1:st[-1] + 2].mean(axis=0) >= BARLINE_DARK
        ok = col if ok is None else ok & col
    found = []
    for x0, x1 in _runs(np.where(ok)[0], BARLINE_GAP):
        if x1 < x_left - OUTSIDE_TOL or x0 > x_right + OUTSIDE_TOL:
            continue
        found.append({"x0": x0, "x1": x1,
                      "gapfill": _gapfill(dark, system, x0, x1),
                      "isolation": _isolation(dark, system, x0, x1)})
    return found


def _gapfill(dark, system, x0, x1):
    """Ink fraction between consecutive staves at the barline columns (1.0 for one staff)."""
    if len(system) < 2:
        return 1.0
    parts = [dark[a[-1] + GAP_MARGIN:b[0] - GAP_MARGIN + 1, x0:x1 + 1]
             for a, b in zip(system, system[1:])]
    parts = [p.ravel() for p in parts if p.size]
    return float(np.concatenate(parts).mean()) if parts else 0.0


def _isolation(dark, system, x0, x1):
    """Worst ink fraction in the staff spaces just left and right of the barline."""
    worst = 0.0
    for st in system:
        space = [y for y in range(st[0], st[-1] + 1) if min(abs(y - line) for line in st) > SPACE_MARGIN]
        if not space:
            continue
        block = dark[space]
        for a, b in ((x0 - ISO_FAR, x0 - ISO_NEAR), (x1 + ISO_NEAR, x1 + ISO_FAR)):
            worst = max(worst, _mean_cols(block, a, b))
    return worst


def keep_barlines(runs, x_left, x_right, connected):
    """Keep system-edge runs, plus (connected style) gap-filling or (isolated style) clean runs."""
    runs = sorted(runs, key=lambda r: r["x0"])
    keep = []
    for k, r in enumerate(runs):
        centre = (r["x0"] + r["x1"]) // 2
        edge = (k == 0 and abs(centre - x_left) <= EDGE_TOL) or \
               (k == len(runs) - 1 and abs(centre - x_right) <= EDGE_TOL)
        if edge or (connected and r["gapfill"] >= CONNECTED_GAPFILL) or \
                (not connected and r["isolation"] <= MAX_ISOLATION):
            keep.append(r)
    return keep


def analyze_page(path, per_system):
    """Return (page_info, raw_systems, rotated_rgb_image). Coordinates are in the rotated frame."""
    rgb = Image.open(path).convert("RGB")
    angle = best_angle(rgb.convert("L"))
    if angle:
        rgb = rgb.rotate(angle, resample=Image.BILINEAR, fillcolor=(255, 255, 255))
    dark = np.asarray(rgb.convert("L")) < DARK_LEVEL
    info = {"file": Path(path).name, "angle": angle, "status": "ok", "reason": None, "warnings": []}
    staves, spacing, info["warnings"] = find_staves(dark)
    if not staves or len(staves) % per_system:
        info["status"] = "error"
        info["reason"] = f"found {len(staves)} staves, not a multiple of {per_system} staves per system"
        return info, [], rgb
    # The scan's own dark edge (shadow, page border) is ink down most of the page; it is
    # never part of a staff, and bridging into it would move the system's start.
    border = dark.mean(axis=0) > BORDER_DARK
    raw = []
    for i in range(0, len(staves), per_system):
        system = staves[i:i + per_system]
        extent = staff_extent(dark, system[0], border)
        if extent is None:
            info["status"] = "error"
            info["reason"] = f"staff {i + 1} has no extent"
            return info, [], rgb
        raw.append({"staves": system, "x_left": extent[0], "x_right": extent[1],
                    "runs": barline_runs(dark, system, extent[0], extent[1])})
    multi = [r["gapfill"] for s in raw for r in s["runs"]] if per_system > 1 else []
    connected = bool(multi) and float(np.median(multi)) >= CONNECTED_GAPFILL
    height = dark.shape[0]
    for s in raw:
        keep = keep_barlines(s.pop("runs"), s["x_left"], s["x_right"], connected)
        # A system starts and ends at its staff ends: a line there is the edge itself; a
        # missing one (no opening line, a hole punch over the closing one) is the staff end.
        # Within EDGE_SPACINGS of a staff end (brace ink, a courtesy clef or time signature)
        # no bar fits, so a line there is the edge and the edge snaps to it.
        tol = EDGE_SPACINGS * spacing
        xs = [(r["x0"] + r["x1"]) // 2 for r in keep]
        left = [x for x in xs if x - s["x_left"] <= tol]
        right = [x for x in xs if s["x_right"] - x <= tol]
        if left:
            s["x_left"] = min(left)
        if right:
            s["x_right"] = max(right)
        inner = [x for x in xs if x - s["x_left"] > tol and s["x_right"] - x > tol]
        s["barlines"] = [s["x_left"], *inner, s["x_right"]]
        s["spacing"] = spacing
        s["y0"] = max(0, s["staves"][0][0] - BAND_SPACINGS * spacing)
        s["y1"] = min(height, s["staves"][-1][-1] + BAND_SPACINGS * spacing)
        s["bars"] = len(s["barlines"]) - 1
    for a, b in zip(raw, raw[1:]):
        mid = (a["staves"][-1][-1] + b["staves"][0][0]) // 2
        a["y1"], b["y0"] = min(a["y1"], mid), max(b["y0"], mid)
    return info, raw, rgb


def save_crop(rgb, system, path):
    crop = rgb.crop((0, system["y0"], rgb.width, system["y1"]))
    size = (max(1, round(crop.width * CROP_SCALE)), max(1, round(crop.height * CROP_SCALE)))
    path.parent.mkdir(parents=True, exist_ok=True)
    crop.resize(size, Image.LANCZOS).save(path, "JPEG", quality=JPEG_QUALITY)


# ---- one piece -----------------------------------------------------------------------------

def page_files(library, slug):
    return sorted((Path(library) / "pages" / slug).glob("*.png"), key=lambda p: p.name)


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=path.name, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="ascii") as f:
            json.dump(data, f, indent=1, sort_keys=False, ensure_ascii=True)
        os.replace(tmp, path)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


def layout_piece(library, slug, out_dir=None):
    """Lay out one piece, write review/<slug>.layout.json and the crops, return the JSON dict.

    out_dir (default: the library) is where review/ and review-pages/ are written.
    """
    library = Path(library)
    out_dir = Path(out_dir) if out_dir else library
    score_path = library / f"{slug}.musicxml"
    score = read_score(score_path)
    pages = page_files(library, slug)
    if not pages:
        raise ValueError(f"no page scans in pages/{slug}")
    crops = out_dir / "review-pages" / slug
    if crops.is_dir():
        for old in crops.glob("s*.jpg"):
            if re.fullmatch(r"s\d+\.jpg", old.name):
                old.unlink()
    page_info, systems, slots = [], [], []
    for page in pages:
        info, raw, rgb = analyze_page(page, score["staves_per_system"])
        page_info.append(info)
        if info["status"] == "error":
            slots.append(None)      # unknown number of systems: one unmappable placeholder
        for s in raw:
            s["index"] = len(systems) + 1
            s["page"] = info["file"]
            s["crop"] = f"review-pages/{slug}/s{s['index']:02d}.jpg"
            save_crop(rgb, s, out_dir / s["crop"])
            systems.append(s)
            slots.append(s)
        del rgb
    total = len(score["measures"])
    spans = map_measures([s["bars"] if s else None for s in slots], score["breaks"], total)
    out_systems = []
    for s, span in zip(slots, spans):
        if s is None:
            continue
        numbers = [score["measures"][span[0] - 1][1], score["measures"][span[1] - 1][1]] if span else None
        out_systems.append({
            "index": s["index"], "page": s["page"], "y0": s["y0"], "y1": s["y1"],
            "spacing": s["spacing"], "staves": s["staves"],
            "x_left": s["x_left"], "x_right": s["x_right"], "barlines": s["barlines"],
            "bars": s["bars"],
            "measures": list(span) if span else None, "numbers": numbers, "crop": s["crop"]})
    mapped = sum(1 for s in out_systems if s["measures"])
    errors = any(p["status"] == "error" for p in page_info)
    if mapped == 0:
        match = "none"
    else:
        match = "exact" if mapped == len(out_systems) and not errors else "partial"
    data = {
        "version": VERSION, "slug": slug, "score": score_path.name,
        "score_sha256": _sha256(score_path),
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "crop_scale": CROP_SCALE,
        "xml": {"measures": total, "breaks": score["breaks"],
                "staves_per_system": score["staves_per_system"]},
        "scan": {"bars": sum(s["bars"] for s in systems), "systems": len(systems)},
        "match": match, "pages": page_info, "systems": out_systems}
    write_json(out_dir / "review" / f"{slug}.layout.json", data)
    return data


# ---- CLI -----------------------------------------------------------------------------------

def is_current(out_dir, slug, score_path):
    path = Path(out_dir) / "review" / f"{slug}.layout.json"
    try:
        data = json.loads(path.read_text(encoding="ascii"))
        return (data.get("version") == VERSION and data.get("score_sha256") == _sha256(score_path)
                and all((Path(out_dir) / s["crop"]).is_file() for s in data["systems"]))
    except (OSError, ValueError, KeyError, TypeError):
        return False


def all_slugs(library):
    pages = Path(library) / "pages"
    if not pages.is_dir():
        return []
    return sorted(d.name for d in pages.iterdir()
                  if d.is_dir() and any(d.glob("*.png")) and (Path(library) / f"{d.name}.musicxml").is_file())


def main(argv=None):
    ap = argparse.ArgumentParser(description="Lay out scanned score systems against MusicXML measures.")
    ap.add_argument("slugs", nargs="*")
    ap.add_argument("--library", default=str(DEFAULT_LIBRARY))
    ap.add_argument("--out-dir", default=None, help="write review/ and review-pages/ here instead (testing)")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args(argv)
    library = Path(args.library)
    out_dir = Path(args.out_dir) if args.out_dir else library
    failed = False
    for slug in args.slugs or all_slugs(library):
        try:
            if not args.force and is_current(out_dir, slug, library / f"{slug}.musicxml"):
                print(f"{slug}: skipped (current)")
                continue
            d = layout_piece(library, slug, out_dir)
            print(f"{slug}: {d['match']} scan={d['scan']['bars']} xml={d['xml']['measures']} "
                  f"systems={d['scan']['systems']}")
        except Exception as exc:  # report and carry on with the next slug
            failed = True
            print(f"{slug}: ERROR {str(exc).encode('ascii', 'replace').decode('ascii')}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
