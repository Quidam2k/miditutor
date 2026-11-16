"""#6309 importer.quantize: one grid per beat. Run: .venv/Scripts/python.exe tests_py/test_quantize.py"""
import random
import sys
from fractions import Fraction
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from importer import quantize as q  # noqa: E402

FAILS = []


def check(name, cond):
    print(("PASS " if cond else "FAIL ") + name)
    if not cond:
        FAILS.append(name)


# 1. A clean file with real triplets AND 16ths in the same bar comes back untouched, rests and all.
clean = [
    (0.0, 1 / 3, [60]), (1 / 3, 1 / 3, [62]), (2 / 3, 1 / 3, [64]),   # beat 1: triplet eighths
    (1.0, 0.25, [65]), (1.25, 0.25, [67]), (1.5, 0.25, [69]), (1.75, 0.25, [71]),  # beat 2: 16ths
    (2.0, 0.5, [72]), (3.0, 0.25, [74]),   # eighth, then a rest, then a 16th with a 16th rest after
]
check("clean: unchanged", q.snap_events(clean) == clean)
check("clean: no gap closing", q.snap_events(clean, close=False) == clean)

# 2. The same bar played a little loosely (a triplet and a 16th point are only 0.083 apart) snaps back to those same values (triplets stay triplets, 16ths stay 16ths).
rng = random.Random(7)
loose = [(o + rng.uniform(-0.035, 0.035), d, p) for o, d, p in clean[:7]]
snapped = q.snap_events(loose)
check("loose: onsets back on the clean grid",
      all(abs(a[0] - b[0]) < 1e-9 for a, b in zip(snapped, clean[:7])))

# 3. Never a mixed beat: every onset lies on 16ths or on triplets, and every length is writable.
mess = [(o + rng.uniform(-0.07, 0.07), rng.choice([0.2, 0.3, 0.45, 0.9]), [60]) for o in
        [i * 0.25 + (i // 4) * 0.0 for i in range(40)] + [10 + i / 3 for i in range(9)]]
out = q.snap_events(mess)
check("mess: onsets on one grid", all(q._on_grid(o) for o, _, _ in out))
check("mess: lengths writable", all(q._writable(Fraction(d).limit_denominator(24)) for _, d, _ in out))

# 4. Small gaps after a note are closed, a real eighth rest is kept.
gappy = [(0.03, 0.2, [60]), (0.51, 0.2, [62]), (1.5, 0.45, [64]), (2.01, 0.5, [65])]
res = q.snap_events(gappy)
check("gaps: 16th gap closed", abs(res[0][1] - 0.5) < 1e-9)
check("gaps: eighth rest kept", abs(res[2][0] + res[2][1] - 2.0) > 0.4 or res[2][1] <= 0.5)

# 5. fit_gap: a 16th note across a triplet boundary prints cleanly.
check("fit_gap: 7/12 -> 1/3", abs(q.fit_gap(7 / 12, 7 / 12) - 1 / 3) < 1e-9)
check("fit_gap: writable left alone", q.fit_gap(0.5, 0.5) == 0.5 and q.fit_gap(1 / 3, 2 / 3) == 1 / 3)

print("FAILS:", FAILS)
sys.exit(1 if FAILS else 0)
