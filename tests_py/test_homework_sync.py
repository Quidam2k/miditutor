"""Pantheon #5058: homework parser. Run: .venv/Scripts/python.exe tests_py/test_homework_sync.py

Synthetic lesson text only: the teacher's real doc is private and never committed.
"""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import homework_sync as hs  # noqa: E402

FAILS = []


def check(name, cond):
    print(("PASS " if cond else "FAIL ") + name)
    if not cond:
        FAILS.append(name)


DOC = """Lesson Log

10/23

Sorcerer’s Apprentice

  - Start at the last measure of page and build to where you stopped

Scales/Arpeggios - E minor

Triads - Memorize by color

  - There are four major groups:
      - WWW: C, F, G, Dm, Em, Am
      - BBB: F\\#/Gb, D\\#m/Ebm
  - Chords with B/Bb are unique:
      - Bbm: BBW

O

10/9

Scales/Arpeggios - A minor

  - Both the natural and harmonic minor for the scale
"""


def parse(text):
    date, lines = hs.newest_entry(text)
    items, unparsed, flags = hs.parse_entry(lines)
    return date, {i["id"]: i for i in items}, unparsed, flags


# 1. Newest entry only; E minor with no type stated is flagged, never defaulted.
date, items, unparsed, flags = parse(DOC)
check("newest entry", date == "10/23" and "scale:A-minor" not in items)
check("E minor scale, no type", items["scale:E-minor"]["types"] == [] and "arpeggio:E-minor" in items)
check("E minor flagged", any("E minor" in f for f in flags))
tri = items["triads"]
check("triad groups, # unescaped", tri["groups"]["WWW"][-1] == "Am" and tri["groups"]["BBB"] == ["F#/Gb", "D#m/Ebm"])
check("unique chord colour", tri["groups"]["Bbm"] == "BBW")
check("pieces", "piece:sorcerers-apprentice" in items and "piece:o" in items)

# 1b. A date range is a lesson header too: otherwise the newest entry is skipped for the older one.
date, items, _, _ = parse("10/28-10/30\n\nScales/Arpeggios - G major\n\n10/23\n\nScales/Arpeggios - A major\n")
check("date range is newest entry", date == "10/28-10/30" and "scale:G-major" in items and "scale:A-major" not in items)
date, _, _, _ = parse("10/28 - 10/30\n\nScales/Arpeggios - G major\n")
check("date range, spaces kept verbatim", date == "10/28 - 10/30")
date, items, _, _ = parse("10/23\n\nScales/Arpeggios - A major\n\n10/9-10/16\n\nScales/Arpeggios - G major\n")
check("older range ends the entry", date == "10/23" and "scale:G-major" not in items)

# 2. Types come from the entry's own bullets.
_, items, _, flags = parse(DOC.split("10/23")[0] + DOC[DOC.index("10/9"):])
check("A minor natural + harmonic", items["scale:A-minor"]["types"] == ["natural", "harmonic"] and not flags)

# 3. Several keys, fingering, breaks, intervals.
_, items, _, _ = parse("7/29\n\nScales/Arpeggios - C, G, D, A, E major\n  - RH arp: 123 123 5\n")
check("five majors x scale+arpeggio", len(items) == 10 and items["scale:G-major"]["types"] == ["major"])
check("fingering on arpeggio only", items["arpeggio:C-major"]["fingering"] == {"RH arp": "123 123 5"}
      and "fingering" not in items["scale:C-major"])
_, items, _, flags = parse("8/5\n\nScales/Arpeggios - Break from scales\n")
check("break flagged, no items", not items and flags and "no scale" in flags[0])
_, items, _, _ = parse("8/26\n\nInterval practice: <https://www.musictheory.net/exercises/interval>\n"
                       "  - Intervals: m2, M2, A4, D5, P8\n  - GOAL IS 10 CORRECT A DAY\n")
iv = items["intervals"]
check("intervals normalised", iv["intervals"] == ["m2", "M2", "A4", "d5", "P8"] and iv["daily_goal"] == 10)

# 4. Piece files: whole-word match, backups skipped.
lib = Path(tempfile.mkdtemp())
for name in ("sorcerers-apprentice.musicxml", "sorcerers-apprentice.pre-annotate.musicxml",
             "o-from-o.musicxml", "dream-echoes.musicxml"):
    (lib / name).write_text("<score-partwise/>", encoding="utf-8")
_, items, _, _ = parse(DOC)
matched = {i["id"]: i for i in hs.match_piece_files(list(items.values()), list(lib.glob("*.musicxml")))}
check("piece file matched", matched["piece:sorcerers-apprentice"]["file"] == "sorcerers-apprentice.musicxml"
      and "files" not in matched["piece:sorcerers-apprentice"])
check("'O' only hits whole words", matched["piece:o"]["file"] == "o-from-o.musicxml" and "files" not in matched["piece:o"])

# 5. --write is a no-op the second time (it runs daily).
doc = lib / "doc.txt"
doc.write_text(DOC, encoding="utf-8")
cmd = [sys.executable, str(ROOT / "scripts" / "homework_sync.py"), "--homework-file", str(doc),
       "--library", str(lib), "--write", "--no-push"]
first = json.loads(subprocess.run(cmd, capture_output=True, text=True).stdout.splitlines()[-1])
second = subprocess.run(cmd, capture_output=True, text=True).stdout.splitlines()
check("write then unchanged", first["written"] and "unchanged" in second and not json.loads(second[-1])["written"])
check("summary carries flags", any("E minor" in f for f in first["flags"]))

print("FAILS:", FAILS)
# #5015: pytest collects this file; the exit below only runs as a script.
def test_script_checks():
    assert not FAILS, FAILS


if __name__ == "__main__":
    sys.exit(1 if FAILS else 0)
