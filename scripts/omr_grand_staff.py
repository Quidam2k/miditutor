#!/usr/bin/env python3
"""Join homr per-page MusicXML reads of a vocal + piano score into one
piano-only, two-staff, partwise MusicXML file.

Usage:
  omr_grand_staff.py OUT TITLE PAGE.musicxml [PAGE.musicxml ...] [--force]
      [--lh-insert-rest PAGE:BAR ...] [--rh-insert-rest PAGE:BAR ...]
      [--drop-bar PAGE:BAR ...] [--fit-rests]
  omr_grand_staff.py --check FILE.musicxml
"""
import argparse
import copy
import math
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

DOCTYPE = (
    '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" '
    '"http://www.musicxml.org/dtds/partwise.dtd">'
)
LH_VOICE_BASE = 5
STEPS = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
NOTE_EARLY = {"grace", "chord", "pitch", "rest", "unpitched", "duration", "tie",
              "instrument", "footnote", "level"}
NOTE_LATE = {"beam", "notations", "lyric", "play"}


class BuildError(ValueError):
    """Raised when the pages cannot be joined."""


# --------------------------------------------------------------------------
# Loading
# --------------------------------------------------------------------------

def _load(page):
    """Return (root_element, display_name) for a path, XML string, tree or element."""
    if isinstance(page, ET.ElementTree):
        return page.getroot(), None
    if isinstance(page, ET.Element):
        return page, None
    if isinstance(page, str) and page.lstrip().startswith("<"):
        return ET.fromstring(page), None
    return ET.parse(str(page)).getroot(), str(page)


def _int(text):
    return int(round(float(text.strip())))


def _parse_ts(time_el):
    beats = time_el.findtext("beats")
    bt = time_el.findtext("beat-type")
    if not beats or not bt:
        return None
    nums = re.findall(r"\d+", beats)
    if not nums or not re.search(r"\d+", bt):
        return None
    return sum(int(x) for x in nums), int(re.search(r"\d+", bt).group())


def _norm_spec(spec):
    """Normalise a list of (page, bar) tuples or 'PAGE:BAR' strings to {page: [bars]}."""
    out = {}
    for item in spec or []:
        if isinstance(item, str):
            m = re.fullmatch(r"\s*(\d+):(\d+)\s*", item)
            if not m:
                raise BuildError(f"bad PAGE:BAR value {item!r}")
            page, bar = int(m.group(1)), int(m.group(2))
        else:
            page, bar = int(item[0]), int(item[1])
        out.setdefault(page, []).append(bar)
    return out


# --------------------------------------------------------------------------
# Reading one hand of one page
# --------------------------------------------------------------------------

def read_part(part, staff, gdiv):
    """Read the measures of one part, keeping only source staff `staff`.

    Returns a list of measure records with onsets/durations scaled to gdiv.
    """
    recs = []
    cur_div = 1
    ts = (4, 4)
    for m in part.findall("measure"):
        rec = {"notes": [], "dirs": [], "key": None, "time": None, "clefs": [],
               "barlines": [], "print": None, "end": 0, "ts_end": ts}
        cur = 0
        prev = 0
        for ch in m:
            scale = gdiv // cur_div
            tag = ch.tag
            if tag == "attributes":
                d = ch.find("divisions")
                if d is not None and d.text:
                    cur_div = _int(d.text)
                    scale = gdiv // cur_div
                k = ch.find("key")
                if k is not None and rec["key"] is None:
                    rec["key"] = k
                t = ch.find("time")
                if t is not None:
                    if rec["time"] is None:
                        rec["time"] = t
                    parsed = _parse_ts(t)
                    if parsed:
                        ts = parsed
                for c in ch.findall("clef"):
                    if c.get("number", "1") == staff:
                        rec["clefs"].append(c)
            elif tag == "note":
                de = ch.find("duration")
                dur = _int(de.text) * scale if de is not None and de.text else 0
                chord = ch.find("chord") is not None
                grace = ch.find("grace") is not None
                if chord:
                    onset = prev
                elif grace:
                    onset = cur
                    prev = onset
                else:
                    onset = cur
                    prev = cur
                    cur += dur
                if ch.findtext("staff", "1").strip() == staff:
                    rec["notes"].append({
                        "el": ch, "onset": onset, "dur": dur, "chord": chord,
                        "grace": grace, "voice": ch.findtext("voice", "1").strip(),
                    })
            elif tag == "backup":
                cur -= _int(ch.findtext("duration", "0")) * scale
            elif tag == "forward":
                cur += _int(ch.findtext("duration", "0")) * scale
            elif tag == "direction":
                if ch.findtext("staff", "1").strip() == staff:
                    rec["dirs"].append((ch, cur))
            elif tag == "barline":
                rec["barlines"].append(ch)
            elif tag == "print":
                rec["print"] = ch
        ends = [n["onset"] + n["dur"] for n in rec["notes"] if not n["grace"]]
        rec["end"] = max(ends) if ends else 0
        rec["ts_end"] = ts
        recs.append(rec)
    return recs


def _empty_rest_record(ts, gdiv, staff):
    dur = round(gdiv * 4 * ts[0] / ts[1])
    note = ET.Element("note")
    ET.SubElement(note, "rest", {"measure": "yes"})
    ET.SubElement(note, "duration").text = str(dur)
    ET.SubElement(note, "voice").text = "1"
    ET.SubElement(note, "staff").text = staff
    return {"notes": [{"el": note, "onset": 0, "dur": dur, "chord": False,
                       "grace": False, "voice": "1"}],
            "dirs": [], "key": None, "time": None, "clefs": [], "barlines": [],
            "print": None, "end": dur, "ts_end": ts}


def _apply_inserts(recs, bars, page, hand, gdiv):
    for b in sorted(bars, reverse=True):
        if not 1 <= b <= len(recs) + 1:
            raise BuildError(
                f"page {page}: --{hand}-insert-rest bar {b} out of range (1..{len(recs) + 1})")
        if b >= 2:
            ts = recs[b - 2]["ts_end"]
        elif recs:
            ts = recs[0]["ts_end"]
        else:
            ts = (4, 4)
        recs.insert(b - 1, _empty_rest_record(ts, gdiv, "1"))


def _fmt(x):
    return f"{x:g}"


# --------------------------------------------------------------------------
# Building output
# --------------------------------------------------------------------------

def _make_note(n, voice, staff_no, ):
    el = copy.deepcopy(n["el"])
    for tag in ("lyric", "voice", "staff"):
        for c in list(el.findall(tag)):
            el.remove(c)
    de = el.find("duration")
    if de is not None:
        de.text = str(n["dur"])
    idx = -1
    for i, c in enumerate(el):
        if c.tag in NOTE_EARLY:
            idx = i
    v = ET.Element("voice")
    v.text = str(voice)
    el.insert(idx + 1, v)
    pos = len(el)
    for i, c in enumerate(el):
        if c.tag in NOTE_LATE:
            pos = i
            break
    s = ET.Element("staff")
    s.text = str(staff_no)
    el.insert(pos, s)
    return el


def _time_el(tag, dur):
    e = ET.Element(tag)
    ET.SubElement(e, "duration").text = str(dur)
    return e


def _place_direction(src, onset, staff_no):
    el = copy.deepcopy(src)
    types = [c for c in el if c.tag == "direction-type"]
    sounds = [c for c in el if c.tag == "sound"]
    others = [c for c in el if c.tag not in ("direction-type", "sound", "offset", "staff")]
    for c in list(el):
        el.remove(c)
    for c in types:
        el.append(c)
    if onset > 0:
        off = ET.Element("offset")
        off.text = str(onset)
        el.append(off)
    for c in others:
        el.append(c)
    st = ET.Element("staff")
    st.text = str(staff_no)
    el.append(st)
    for c in sounds:
        el.append(c)
    return el


# quarter-note length -> (type, dots) for the rest lengths _fit_rests may write
REST_TYPES = {4: ("whole", 0), 3: ("half", 1), 2: ("half", 0), 1.5: ("quarter", 1),
              1: ("quarter", 0), 0.75: ("eighth", 1), 0.5: ("eighth", 0), 0.25: ("16th", 0)}


def _end(notes):
    heads = [n for n in notes if not n["chord"] and not n["grace"]]
    return max((n["onset"] + n["dur"] for n in heads), default=0)


def _with_rest(n, new, gdiv):
    """Copy of rest note n lengthened/shortened to `new`, or None if not a plain rest length."""
    kind = REST_TYPES.get(new / gdiv) if new > 0 else None
    if kind is None:
        return None
    el = copy.deepcopy(n["el"])
    for c in el.findall("dot"):
        el.remove(c)
    t = el.find("type")
    if t is None:
        t = ET.SubElement(el, "type")
    t.text = kind[0]
    at = list(el).index(t) + 1
    for _ in range(kind[1]):
        el.insert(at, ET.Element("dot"))
    return dict(n, el=el, dur=new)


def _resize(notes, i, new, gdiv):
    """Set rest i to `new`, moving every later note by the change; None if impossible."""
    n = notes[i]
    r = _with_rest(n, new, gdiv)
    if r is None:
        return None
    d = new - n["dur"]
    return notes[:i] + [r] + [dict(m, onset=m["onset"] + d) if m["onset"] > n["onset"] else m
                              for m in notes[i + 1:]]


def _compact(notes):
    """Close the gaps between consecutive notes (homr's cross-staff backups leave
    stray ones); the first note keeps its onset."""
    out, t, head = [], None, None
    for n in notes:
        if n["chord"]:
            out.append(dict(n, onset=head))
            continue
        if t is None:
            t = n["onset"]
        head = t
        out.append(dict(n, onset=t))
        if not n["grace"]:
            t += n["dur"]
    return out


def _rests(notes):
    return [i for i, n in enumerate(notes)
            if n["el"].find("rest") is not None and not n["chord"] and not n["grace"]]


def _fit_rests(notes, bar_len, gdiv):
    """Repair an overfull run so it fills its bar EXACTLY, touching only timing:
    close stray gaps, shorten one rest, or turn long rests into eighth rests (homr
    often reads an eighth rest as a long one). Pitches and note lengths are never
    changed. A repair is used only if the run then ends exactly at the bar line;
    otherwise the notes come back unchanged."""
    if _end(notes) <= bar_len:
        return notes
    eighth = gdiv // 2
    for base in (notes, _compact(notes)):
        over = _end(base) - bar_len
        if over == 0:
            return base
        if over < 0:
            continue
        for i in _rests(base):
            cand = _resize(base, i, base[i]["dur"] - over, gdiv)
            if cand is not None and _end(cand) == bar_len:
                return cand
        cand = base
        for i in sorted(_rests(base), key=lambda i: -base[i]["dur"]):
            if cand[i]["dur"] <= eighth:
                break
            nxt = _resize(cand, i, eighth, gdiv)
            if nxt is None:
                break
            cand = nxt
            if _end(cand) == bar_len:
                return cand
            if _end(cand) < bar_len:
                break
    return notes


def _staff_runs(rec, staff_no, voice_base, gdiv=None, fit=False):
    """Return (direction_elements, [(elements, end_time), ...]) for one staff."""
    groups = {}
    for n in rec["notes"]:
        groups.setdefault(n["voice"], []).append(n)
    # homr sometimes writes two lines in ONE voice by backing up mid-voice (a rest
    # under running eighths). Split each source voice so no run overlaps itself:
    # a head note joins the first run that has ended by its onset; a chord tone
    # joins its head's run.
    split = []
    for notes in groups.values():
        subs = []  # [notes, end]
        last = None
        for n in sorted(notes, key=lambda n: n["onset"]):  # stable
            if n["chord"] and last is not None and last[0][-1]["onset"] == n["onset"]:
                last[0].append(n)
                continue
            end = n["onset"] + (0 if n["grace"] else n["dur"])
            for s in subs:
                if s[1] <= n["onset"]:
                    break
            else:
                s = [[], 0]
                subs.append(s)
            s[0].append(n)
            s[1] = max(s[1], end)
            last = s
        split.extend(s[0] for s in subs)
    if fit and gdiv:
        ts = rec["ts_end"]
        bar_len = gdiv * 4 * ts[0] // ts[1]
        split = [_fit_rests(notes, bar_len, gdiv) for notes in split]
    runs = []
    for i, notes in enumerate(split):
        voice = voice_base + i
        els = []
        t = 0
        head = None  # onset of the last head note written in this run
        for n in notes:
            if n["chord"] and head != n["onset"]:
                # Its head was on the dropped vocal staff: it becomes a head itself.
                n = dict(n, chord=False, el=copy.deepcopy(n["el"]))
                n["el"].remove(n["el"].find("chord"))
            if not n["chord"]:
                head = n["onset"]
            if not n["chord"] and n["onset"] > t:
                els.append(_time_el("forward", n["onset"] - t))
                t = n["onset"]
            els.append(_make_note(n, voice, staff_no))
            if not n["chord"] and not n["grace"]:
                t += n["dur"]
        runs.append((els, t))
    dirs = [_place_direction(d, onset, staff_no) for d, onset in rec["dirs"]]
    return dirs, runs


def _clean_key(k):
    k = copy.deepcopy(k)
    k.attrib.pop("number", None)
    return k


def _build_measure(num, rh, lh, first, new_page, gdiv, first_key, first_time, fit=False):
    m = ET.Element("measure", {"number": str(num)})

    # print
    src_print = rh["print"]
    want_system = src_print is not None and src_print.get("new-system") == "yes"
    if want_system or new_page:
        pr = copy.deepcopy(src_print) if want_system else ET.Element("print")
        if new_page:
            pr.set("new-page", "yes")
        m.append(pr)

    # left barlines
    rights = []
    for b in rh["barlines"]:
        if b.get("location", "right") == "left":
            m.append(copy.deepcopy(b))
        else:
            rights.append(copy.deepcopy(b))

    # attributes
    attrs = ET.Element("attributes")
    if first:
        ET.SubElement(attrs, "divisions").text = str(gdiv)
        if first_key is not None:
            attrs.append(_clean_key(first_key))
        else:
            ET.SubElement(ET.SubElement(attrs, "key"), "fifths").text = "0"
        if first_time is not None:
            attrs.append(copy.deepcopy(first_time))
        else:
            t = ET.SubElement(attrs, "time")
            ET.SubElement(t, "beats").text = "4"
            ET.SubElement(t, "beat-type").text = "4"
        ET.SubElement(attrs, "staves").text = "2"
        for number, sign, line in (("1", "G", "2"), ("2", "F", "4")):
            c = ET.SubElement(attrs, "clef", {"number": number})
            ET.SubElement(c, "sign").text = sign
            ET.SubElement(c, "line").text = line
    else:
        if rh["key"] is not None:
            attrs.append(_clean_key(rh["key"]))
        if rh["time"] is not None:
            attrs.append(copy.deepcopy(rh["time"]))
        for number, rec in (("1", rh), ("2", lh)):
            for c in rec["clefs"]:
                c = copy.deepcopy(c)
                c.set("number", number)
                attrs.append(c)
    if len(attrs):
        m.append(attrs)

    # body
    all_runs = []
    for staff_no, rec, base in ((1, rh, 1), (2, lh, LH_VOICE_BASE)):
        dirs, runs = _staff_runs(rec, staff_no, base, gdiv, fit)
        if not runs:
            if dirs:
                runs = [(dirs, 0)]
        else:
            runs[0] = (dirs + runs[0][0], runs[0][1])
        all_runs.extend(runs)
    for i, (els, t) in enumerate(all_runs):
        for e in els:
            m.append(e)
        if i < len(all_runs) - 1 and t > 0:
            m.append(_time_el("backup", t))

    for b in rights:
        m.append(b)
    return m


def build(pages, title, lh_insert=None, rh_insert=None, drop=None, fit_rests=False):
    """Join per-page homr MusicXML into one piano grand-staff ElementTree."""
    lh_ins = _norm_spec(lh_insert)
    rh_ins = _norm_spec(rh_insert)
    drops = _norm_spec(drop)
    npages = len(pages)
    for name, spec in (("lh-insert-rest", lh_ins), ("rh-insert-rest", rh_ins),
                       ("drop-bar", drops)):
        for p in spec:
            if not 1 <= p <= npages:
                raise BuildError(f"--{name}: page {p} out of range (1..{npages})")

    loaded = [_load(p) for p in pages]
    roots = [r for r, _ in loaded]
    for i, root in enumerate(roots, 1):
        if root.tag != "score-partwise":
            raise BuildError(f"page {i}: not a partwise MusicXML score")

    divs = [1]
    for root in roots:
        for d in root.iter("divisions"):
            if d.text and d.text.strip():
                divs.append(_int(d.text))
    gdiv = math.lcm(*[d for d in divs if d > 0])

    page_recs = []
    for i, root in enumerate(roots, 1):
        label = f"page {i}" + (f" ({loaded[i - 1][1]})" if loaded[i - 1][1] else "")
        parts = root.findall("part")
        if not parts:
            raise BuildError(f"{label}: no <part> found")
        if len(parts) >= 2:
            first_staves = _int(parts[0].findtext(".//attributes/staves", "1"))
            rh_staff = "2" if first_staves >= 2 else "1"
            rh = read_part(parts[0], rh_staff, gdiv)
            lh = read_part(parts[1], "1", gdiv)
        else:
            staves = _int(parts[0].findtext(".//attributes/staves", "1"))
            if staves < 2:
                raise BuildError(f"{label}: single part with only one staff")
            print(f"warning: {label}: single 2-staff part; staff 1 taken as RH, "
                  f"staff 2 as LH", file=sys.stderr)
            rh = read_part(parts[0], "1", gdiv)
            lh = read_part(parts[0], "2", gdiv)
        page_recs.append((rh, lh))

    errors = []
    for p, (rh, lh) in enumerate(page_recs, 1):
        try:
            _apply_inserts(lh, lh_ins.get(p, []), p, "lh", gdiv)
            _apply_inserts(rh, rh_ins.get(p, []), p, "rh", gdiv)
            for b in sorted(set(drops.get(p, [])), reverse=True):
                for hand, recs in (("RH", rh), ("LH", lh)):
                    if not 1 <= b <= len(recs):
                        raise BuildError(
                            f"page {p}: --drop-bar {b} out of range for {hand} "
                            f"(1..{len(recs)})")
                    gone = recs.pop(b - 1)
                    # A dropped bar (often a courtesy signature read as a bar) hands its
                    # key, time and clef changes to the next bar so they are not lost.
                    if b - 1 < len(recs):
                        nxt = recs[b - 1]
                        for k in ("key", "time"):
                            if nxt[k] is None:
                                nxt[k] = gone[k]
                        nxt["clefs"] = gone["clefs"] + nxt["clefs"]
        except BuildError as e:
            errors.append(str(e))
            continue
        if len(rh) != len(lh):
            errors.append(
                f"page {p}: bar count mismatch: RH has {len(rh)} bars, LH has {len(lh)} bars\n"
                f"  RH bar durations (quarter notes): {[_fmt(r['end'] / gdiv) for r in rh]}\n"
                f"  LH bar durations (quarter notes): {[_fmt(r['end'] / gdiv) for r in lh]}")
    if errors:
        raise BuildError("\n".join(errors))

    first_key = first_time = None
    for rh, _ in page_recs:
        for r in rh:
            if first_key is None and r["key"] is not None:
                first_key = r["key"]
            if first_time is None and r["time"] is not None:
                first_time = r["time"]

    root = ET.Element("score-partwise", {"version": "4.0"})
    work = ET.SubElement(root, "work")
    ET.SubElement(work, "work-title").text = title
    plist = ET.SubElement(root, "part-list")
    sp = ET.SubElement(plist, "score-part", {"id": "P1"})
    ET.SubElement(sp, "part-name").text = "Piano"
    part = ET.SubElement(root, "part", {"id": "P1"})

    num = 0
    for p, (rh, lh) in enumerate(page_recs, 1):
        for j, (r, l) in enumerate(zip(rh, lh)):
            num += 1
            part.append(_build_measure(
                num, r, l, first=(num == 1), new_page=(p > 1 and j == 0),
                gdiv=gdiv, first_key=first_key, first_time=first_time, fit=fit_rests))
    return ET.ElementTree(root)


def write_file(tree, path):
    ET.indent(tree, space="  ")
    body = ET.tostring(tree.getroot(), encoding="unicode")
    text = '<?xml version="1.0" encoding="UTF-8"?>\n' + DOCTYPE + "\n" + body + "\n"
    Path(path).write_text(text, encoding="utf-8")


# --------------------------------------------------------------------------
# Lint
# --------------------------------------------------------------------------

def _pitch(note):
    p = note.find("pitch")
    if p is None:
        return None
    step = p.findtext("step", "C").strip()
    alter = float(p.findtext("alter", "0") or 0)
    octave = int(p.findtext("octave", "4"))
    midi = 12 * (octave + 1) + STEPS.get(step, 0) + alter
    acc = ("#" if alter > 0 else "b") * abs(round(alter))
    return midi, f"{step}{acc}{octave}"


def check(tree):
    """Lint an output tree; return a list of report lines."""
    root = tree.getroot() if hasattr(tree, "getroot") else tree
    part = root.find("part")
    if part is None:
        return ["no <part> found"]
    lines = []
    div = 1
    ts = (4, 4)
    nmeasures = over = under = 0
    counts = {"1": 0, "2": 0}
    lo = {}
    hi = {}
    rh_low = lh_high = 0

    for m in part.findall("measure"):
        nmeasures += 1
        num = m.get("number", str(nmeasures))
        for a in m.findall("attributes"):
            d = a.find("divisions")
            if d is not None and d.text:
                div = _int(d.text)
            t = a.find("time")
            if t is not None:
                parsed = _parse_ts(t)
                if parsed:
                    ts = parsed
        expected = ts[0] * 4 / ts[1] * div
        unit = div * 4 / ts[1]
        runs = []
        run = {"sum": 0, "staff": None, "voice": None}

        for ch in m:
            if ch.tag == "note":
                staff = ch.findtext("staff", "1").strip()
                if run["staff"] is None:
                    run["staff"] = staff
                    run["voice"] = ch.findtext("voice", "1").strip()
                if ch.find("chord") is None and ch.find("grace") is None:
                    run["sum"] += _int(ch.findtext("duration", "0"))
                pt = _pitch(ch)
                if pt is not None and staff in counts:
                    counts[staff] += 1
                    if staff not in lo or pt[0] < lo[staff][0]:
                        lo[staff] = pt
                    if staff not in hi or pt[0] > hi[staff][0]:
                        hi[staff] = pt
                    if staff == "1" and pt[0] < 48:
                        rh_low += 1
                    if staff == "2" and pt[0] > 72:
                        lh_high += 1
            elif ch.tag == "forward":
                run["sum"] += _int(ch.findtext("duration", "0"))
            elif ch.tag == "backup":
                runs.append(run)
                run = {"sum": 0, "staff": None, "voice": None}
        runs.append(run)

        for r in runs:
            if r["staff"] is None:
                continue
            diff = r["sum"] - expected
            if abs(diff) < 1e-9:
                continue
            beats = round(diff / unit, 3)
            if diff > 0:
                over += 1
                lines.append(f"bar {num} staff {r['staff']} voice {r['voice']}: "
                             f"overfull +{_fmt(beats)} beats")
            else:
                under += 1
                lines.append(f"bar {num} staff {r['staff']} voice {r['voice']}: "
                             f"underfull {_fmt(beats)} beats")

    def rng(s):
        return f"{lo[s][1]}..{hi[s][1]}" if s in lo else "none"

    lines.append(f"measures: {nmeasures}")
    lines.append(f"overfull: {over}")
    lines.append(f"underfull: {under}")
    lines.append(f"notes: staff 1 = {counts['1']}, staff 2 = {counts['2']}")
    lines.append(f"range staff 1: {rng('1')}")
    lines.append(f"range staff 2: {rng('2')}")
    lines.append(f"RH notes below C3: {rh_low}")
    lines.append(f"LH notes above C5: {lh_high}")
    return lines


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------

def _page_bar(value):
    m = re.fullmatch(r"(\d+):(\d+)", value)
    if not m:
        raise argparse.ArgumentTypeError(f"expected PAGE:BAR, got {value!r}")
    return int(m.group(1)), int(m.group(2))


def main(argv=None):
    ap = argparse.ArgumentParser(
        description="Join homr page reads of a vocal+piano score into one piano grand staff.")
    ap.add_argument("files", nargs="*", help="OUT TITLE PAGE.musicxml [PAGE.musicxml ...]")
    ap.add_argument("--check", metavar="FILE", help="lint FILE only, no write")
    ap.add_argument("--force", action="store_true", help="overwrite OUT")
    ap.add_argument("--lh-insert-rest", action="append", default=[], type=_page_bar,
                    metavar="PAGE:BAR")
    ap.add_argument("--rh-insert-rest", action="append", default=[], type=_page_bar,
                    metavar="PAGE:BAR")
    ap.add_argument("--drop-bar", action="append", default=[], type=_page_bar,
                    metavar="PAGE:BAR")
    ap.add_argument("--fit-rests", action="store_true",
                    help="shorten one rest per overfull voice so it fits the bar (pitches untouched)")
    args = ap.parse_intermixed_args(argv)

    if args.check:
        try:
            tree = ET.parse(args.check)
        except (OSError, ET.ParseError) as e:
            print(f"error: cannot read {args.check}: {e}", file=sys.stderr)
            return 2
        for line in check(tree):
            print(line)
        return 0

    if len(args.files) < 3:
        ap.error("need OUT TITLE and at least one PAGE.musicxml")
    out = Path(args.files[0])
    title = args.files[1]
    pages = args.files[2:]
    if out.exists() and not args.force:
        print(f"error: {out} exists; use --force to overwrite", file=sys.stderr)
        return 2
    try:
        tree = build(pages, title, args.lh_insert_rest, args.rh_insert_rest, args.drop_bar,
                     args.fit_rests)
    except BuildError as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    except (OSError, ET.ParseError) as e:
        print(f"error: cannot read input: {e}", file=sys.stderr)
        return 2
    write_file(tree, out)
    print(f"wrote {out}")
    for line in check(tree):
        print(line)
    return 0


if __name__ == "__main__":
    sys.exit(main())
