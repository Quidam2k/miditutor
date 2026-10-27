"""Align the bars of a piece's Harder version(s) to its Easy version for "My mix" (#9627).

Usage: align_versions.py SLUG [--library DIR] [--own-solace] [--dry-run]

Reads SLUG's group in DIR/versions.json (default Q:/Personal/piano/library). Each version that is
not "Easy", not "My mix" and not mixable:false is compared bar by bar with the Easy file on the
highest sounding pitch class at every onset (any staff), the Harder one shifted into the Easy
key. Bars are matched by DTW with an LCS cost (the arrangement embellishes), then cut into
sections at 4-bar boundaries of the Easy file. Writes group["align"][harderFile] =
{semis, bars, sections}. A Harder file whose key changes inside is skipped. Needs the compute
gate of omr_second_engine (RAM free, Todd idle); --own-solace is his per-occasion grant for idle.
"""
import argparse
import json
import os
from pathlib import Path
import sys
import xml.etree.ElementTree as ET

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from omr_second_engine import gate_ok, input_idle_s, ram_avail_gb  # noqa: E402

LIBRARY = Path("Q:/Personal/piano/library")
STEP_PC = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def _midi(pitch):
    return (12 * (int(pitch.findtext("octave")) + 1) + STEP_PC[pitch.findtext("step")]
            + round(float(pitch.findtext("alter") or 0)))


def melody(measure):
    """Pitch classes of the highest pitch at each onset, over all staves, in time order."""
    cursor = onset = 0
    top = {}
    for el in measure:
        dur = int(float(el.findtext("duration") or 0))
        if el.tag == "backup":
            cursor -= dur
        elif el.tag == "forward":
            cursor += dur
        elif el.tag == "note" and el.find("grace") is None:
            chord = el.find("chord") is not None
            if not chord:
                onset = cursor
            pitch = el.find("pitch")
            if pitch is not None:
                top[onset] = max(top.get(onset, -1), _midi(pitch))
            if not chord:
                cursor += dur
    return [top[t] % 12 for t in sorted(top)]


def parse_bars(path):
    """[{number, fifths, melody}] for the first part's measures that have an integer number."""
    part = ET.parse(path).getroot().find("part")
    bars = []
    fifths = 0
    for m in part.findall("measure"):
        try:
            number = int(m.get("number"))
        except (TypeError, ValueError):
            continue
        for f in m.findall("attributes/key/fifths"):
            fifths = int(f.text)
        bars.append({"number": number, "fifths": fifths, "melody": melody(m)})
    return bars


def key_changes(bars):
    return any(b["fifths"] != bars[0]["fifths"] for b in bars)


def semis_between(harder_fifths, easy_fifths):
    """Signed shift from the harder tonic to the easy tonic, -6..+5 (D major to C major is -2)."""
    d = ((easy_fifths * 7) % 12 - (harder_fifths * 7) % 12) % 12
    return d - 12 if d >= 6 else d


def bar_cost(a, b):
    """0 for the same pitch-class sequence, 1 for nothing shared; LCS because arrangements embellish."""
    if not a and not b:
        return 0.0
    if not a or not b:
        return 1.0
    prev = [0] * (len(b) + 1)
    for x in a:
        cur = [0]
        for j, y in enumerate(b):
            cur.append(prev[j] + 1 if x == y else max(prev[j + 1], cur[j]))
        prev = cur
    return 1 - 2 * prev[-1] / (len(a) + len(b))


def dtw(a, b, cost=bar_cost):
    """Cheapest monotone path over bar lists a, b as [(i, j)] indices; diagonal wins ties."""
    n, m = len(a), len(b)
    inf = float("inf")
    d = [[inf] * m for _ in range(n)]
    for i in range(n):
        for j in range(m):
            best = 0.0 if i == j == 0 else min(
                d[i - 1][j - 1] if i and j else inf,
                d[i - 1][j] if i else inf,
                d[i][j - 1] if j else inf)
            d[i][j] = best + cost(a[i], b[j])
    path = [(n - 1, m - 1)]
    while path[-1] != (0, 0):
        i, j = path[-1]
        steps = [(i - 1, j - 1), (i - 1, j), (i, j - 1)]
        path.append(min((s for s in steps if s[0] >= 0 and s[1] >= 0), key=lambda s: d[s[0]][s[1]]))
    return path[::-1]


def sections_from_path(path, costs=None):
    """Cut a [[easyBar, harderBar]] path at diagonal steps landing on a 4-bar boundary of the easy bars."""
    costs = costs or [0.0] * len(path)
    runs = [[0]]
    for i in range(1, len(path)):
        (pe, ph), (e, h) = path[i - 1], path[i]
        if e == pe + 1 and h == ph + 1 and (e - 1) % 4 == 0:
            runs.append([])
        runs[-1].append(i)
    return [{"easy": [min(path[i][0] for i in r), max(path[i][0] for i in r)],
             "harder": [min(path[i][1] for i in r), max(path[i][1] for i in r)],
             "cost": round(sum(costs[i] for i in r) / len(r), 2)} for r in runs]


def align(easy_bars, harder_bars):
    semis = semis_between(harder_bars[0]["fifths"], easy_bars[0]["fifths"])
    shifted = [[(pc + semis) % 12 for pc in b["melody"]] for b in harder_bars]
    path = dtw([b["melody"] for b in easy_bars], shifted)
    costs = [bar_cost(easy_bars[i]["melody"], shifted[j]) for i, j in path]
    bars = [[easy_bars[i]["number"], harder_bars[j]["number"]] for i, j in path]
    return {"semis": semis, "bars": bars, "sections": sections_from_path(bars, costs)}


def write_json(path, data):
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("slug")
    ap.add_argument("--library", type=Path, default=LIBRARY)
    ap.add_argument("--own-solace", action="store_true", help="skip the idle gate (RAM gate still applies)")
    ap.add_argument("--dry-run", action="store_true", help="print the align JSON, write nothing")
    a = ap.parse_args(argv)
    ram, idle = ram_avail_gb(), input_idle_s()
    if not gate_ok(ram_gb=ram, idle_s=idle, own_solace=a.own_solace):
        print(f"gate closed: {ram:.1f} GB RAM free, idle {idle:.0f}s (need 12 GB and 10 min, or --own-solace)",
              file=sys.stderr)
        return 2
    vpath = a.library / "versions.json"
    data = json.loads(vpath.read_text(encoding="utf-8"))
    group = data.get(a.slug)
    if group is None:
        print(f"no group {a.slug!r} in {vpath}", file=sys.stderr)
        return 2
    easy = next((v for v in group["versions"] if v["label"] == "Easy"), None)
    if easy is None:
        print(f"{a.slug} has no Easy version", file=sys.stderr)
        return 2
    easy_bars = parse_bars(a.library / easy["file"])
    if key_changes(easy_bars):
        print(f"key changes inside {easy['file']}; not mixable until repaired")
        return 0
    found = {}
    for v in group["versions"]:
        if v is easy or v.get("mixable") is False or v["label"] == "My mix":
            continue
        bars = parse_bars(a.library / v["file"])
        if key_changes(bars):
            print(f"key changes inside {v['file']}; not mixable until repaired")
            continue
        found[v["file"]] = align(easy_bars, bars)
        print(f"{v['file']}: semis {found[v['file']]['semis']:+d}")
        for s in found[v["file"]]["sections"]:
            print(f"  easy {s['easy'][0]}-{s['easy'][1]}  harder {s['harder'][0]}-{s['harder'][1]}  cost {s['cost']}")
    if a.dry_run:
        print(json.dumps(found, indent=2))
    elif found:
        group.setdefault("align", {}).update(found)
        write_json(vpath, data)
    return 0


if __name__ == "__main__":
    sys.exit(main())
