"""Make a variant of a partwise MusicXML score: keep only the piano part(s) and drop chosen bars.

Usage: piece_versions.py piano-only SRC DEST [--keep-part ID ...] [--drop-bar N ...] [--force]

SRC is plain partwise .musicxml (not .mxl). Keeps the parts named by --keep-part (default: every
score-part whose part-name contains "piano"). Each --drop-bar N (SRC numbering) removes that measure
from every kept part, carrying its attributes (and a new-system/new-page print) into the next measure
so key, time, clef and divisions changes are not lost. Measures are then renumbered 1..n (a leading
implicit pickup "0" stays 0). Never overwrites SRC; refuses an existing DEST unless --force.
"""
import argparse
from pathlib import Path
import re
import sys
import xml.etree.ElementTree as ET

sys.dont_write_bytecode = True

# MusicXML child order inside <attributes>
ATTR_ORDER = ["footnote", "level", "divisions", "key", "time", "staves", "part-symbol", "instruments",
              "clef", "staff-details", "transpose", "directive", "measure-style"]


def _attr_rank(el):
    return ATTR_ORDER.index(el.tag) if el.tag in ATTR_ORDER else len(ATTR_ORDER)


def _attr_id(el):
    return (el.tag, el.get("number")) if el.tag == "clef" else (el.tag,)


def _carry_attributes(gone, nxt):
    src = gone.find("attributes")
    if src is None or not len(src):
        return
    dst = nxt.find("attributes")
    if dst is None:
        dst = ET.Element("attributes")
        pos = 0
        for i, child in enumerate(nxt):
            if child.tag == "print" or (child.tag == "barline" and child.get("location") == "left"):
                pos = i + 1
            else:
                break
        nxt.insert(pos, dst)
    have = {_attr_id(c) for c in dst}
    for c in list(src):
        if _attr_id(c) not in have:
            dst.append(c)
    dst[:] = sorted(dst, key=_attr_rank)  # stable, keeps same-tag order


def _carry_print(gone, nxt):
    pr = gone.find("print")
    if pr is not None and nxt.find("print") is None and "yes" in (pr.get("new-system"), pr.get("new-page")):
        gone.remove(pr)
        nxt.insert(0, pr)


def drop_bars(part, drop):
    measures = list(part.findall("measure"))
    for i, m in enumerate(measures):
        if m.get("number") not in drop:
            continue
        if i + 1 < len(measures):
            _carry_attributes(m, measures[i + 1])
            _carry_print(m, measures[i + 1])
        part.remove(m)


def renumber(part):
    n = 0
    for m in part.findall("measure"):
        if m.get("implicit") == "yes" and m.get("number") == "0":
            continue
        n += 1
        m.set("number", str(n))
    return n


def piano_only(src, dest, keep, drop, force):
    if src.resolve() == dest.resolve():
        raise SystemExit("refusing to overwrite SRC")
    if dest.exists() and not force:
        raise SystemExit(f"{dest} exists (use --force)")
    raw = src.read_text(encoding="utf-8-sig")
    doctype = re.search(r"<!DOCTYPE[^>]*>", raw)
    tree = ET.parse(src)
    root = tree.getroot()
    if root.tag != "score-partwise":
        raise SystemExit("SRC is not a partwise MusicXML score")
    plist = root.find("part-list")
    scores = plist.findall("score-part")
    if keep:
        keep_ids = set(keep)
    else:
        keep_ids = {s.get("id") for s in scores if "piano" in (s.findtext("part-name") or "").lower()}
    for s in scores:
        if s.get("id") not in keep_ids:
            plist.remove(s)
    kept = [p for p in root.findall("part") if p.get("id") in keep_ids]
    for p in root.findall("part"):
        if p not in kept:
            root.remove(p)
    if not kept:
        raise SystemExit("no part would remain")
    count = 0
    for p in kept:
        drop_bars(p, {str(d) for d in drop})
        count = max(count, renumber(p))
    ET.indent(tree)
    head = '<?xml version="1.0" encoding="UTF-8"?>\n' + (doctype.group(0) + "\n" if doctype else "")
    dest.write_text(head + ET.tostring(root, encoding="unicode") + "\n", encoding="utf-8")
    print(f"kept parts {sorted(p.get('id') for p in kept)}; dropped bars {sorted(drop)}; {count} measures")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    po = sub.add_parser("piano-only", help="keep piano part(s), optionally drop bars")
    po.add_argument("src", type=Path)
    po.add_argument("dest", type=Path)
    po.add_argument("--keep-part", nargs="+", default=[], metavar="ID")
    po.add_argument("--drop-bar", nargs="+", type=int, default=[], metavar="N")
    po.add_argument("--force", action="store_true")
    a = ap.parse_args(argv)
    try:
        piano_only(a.src, a.dest, a.keep_part, a.drop_bar, a.force)
    except SystemExit as e:
        if isinstance(e.code, str):
            print(e.code, file=sys.stderr)
            return 2
        raise
    return 0


if __name__ == "__main__":
    sys.exit(main())
