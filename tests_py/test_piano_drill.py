"""Pantheon #3566: piano drill coverage cycle. Run: python tests_py/test_piano_drill.py"""
import importlib
import os
import random
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
FAILS = []


def check(name, cond):
    print(("PASS " if cond else "FAIL ") + name)
    if not cond:
        FAILS.append(name)


def fresh():
    os.environ["MIDITUTOR_DRILL_DB"] = str(Path(tempfile.mkdtemp()) / "drill.db")
    import drill.piano_drill as pd
    return importlib.reload(pd)


# 1. 24 draws, all 'got', cover all 24 with no repeat; draw 25 opens a new cycle.
pd = fresh()
rng = random.Random(1)
seen = []
for _ in range(24):
    it = pd.next_item(rng=rng)
    seen.append(it["item_id"])
    pd.record(it["item_id"], "got")
check("24 draws cover all 24, no repeats", len(set(seen)) == 24 == len(seen))
check("status 24/24 at cycle end", pd.status()["done_this_cycle"] == 24)
it = pd.next_item(rng=rng)
check("draw 25 starts a new cycle", it["new_cycle_started"] and it["remaining_in_cycle"] == 24)
check("never same chord twice in a row across cycles", it["item_id"] != seen[-1])

# 2. Partial session carries over (reload module = new session/process).
pd = fresh()
first = []
for _ in range(9):
    it = pd.next_item(rng=rng)
    first.append(it["item_id"])
    pd.record(it["item_id"], "got")
pd = importlib.reload(pd)
nxt = [pd.next_item(rng=random.Random(s))["item_id"] for s in range(50)]
check("next session never serves a covered chord", not (set(nxt) & set(first)))
check("status shows 15 remaining", len(pd.status()["remaining"]) == 15)

# 3. Missed stays in the pool; got removes it.
pd = fresh()
it = pd.next_item(rng=rng)
pd.record(it["item_id"], "missed")
check("missed chord still remaining", pd.status()["done_this_cycle"] == 0)
pd.record(it["item_id"], "got")
check("later 'got' covers it", pd.status()["done_this_cycle"] == 1)

# 4. Answer spelling = letter-skip; name only in 'say'.
check("A major spelled with C sharp", pd.spell_triad("A", "major") == ["A", "C sharp", "E"])
check("G sharp major spelled B sharp", pd.spell_triad("G#", "major") == ["G sharp", "B sharp", "D sharp"])
it = pd.next_item(rng=rng)
check("say is a name, not notes", it["say"].endswith(("major", "minor")) and "," not in it["say"])

# 5. Bad input refused.
check("bad result refused", "error" in pd.record("triad:C", "great"))
check("unknown id refused", "error" in pd.record("triad:H", "got"))

print("ALL PASS" if not FAILS else f"{len(FAILS)} FAILED")
sys.exit(1 if FAILS else 0)
