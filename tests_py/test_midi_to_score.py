"""Pantheon #4046 (d): MIDI import. Run: .venv/Scripts/python.exe tests_py/test_midi_to_score.py"""
import json
import os
import random
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import midi_to_score as m  # noqa: E402

FAILS = []


def check(name, cond):
    print(("PASS " if cond else "FAIL ") + name)
    if not cond:
        FAILS.append(name)


# 1. Hand split: chords split at middle C; a lone note near middle C follows the nearer hand.
rh, lh = m.split_hands([(0, 1, [48, 64, 67]), (1, 1, [62]), (2, 1, [59])])
check("split: chord tones by middle C", rh[0][2] == [64, 67] and lh[0][2] == [48])
check("split: lone 59 after RH 62 stays RH", rh[-1][2] == [59])
rh, lh = m.split_hands([(0, 1, [50]), (1, 1, [52]), (2, 1, [59])])
check("split: lone 59 after LH 52 goes LH", lh[-1][2] == [59] and not rh)

# 2. One voice per hand: overlaps clip at the next onset, same-onset notes merge.
mono = m.monophonize([(0, 2, [60]), (0, 1, [64]), (1, 1, [65])])
check("mono: merged + clipped", mono == [(0, 1, [60, 64]), (1, 1, [65])])

# 3. Pickup: a 3/8 tune that starts an eighth early is pushed so the bass lands on bar lines.
bass = [(o, 0.5, [45]) for o in (0.5, 2.0, 3.5, 5.0)]
check("pickup: shift found", m.pickup_shift([[(0.0, 0.25, [76])], bass], 1.5) == 1.0)
check("pickup: aligned file left alone", m.pickup_shift([[], [(o, 1.0, [45]) for o in (0, 3, 6)]], 3.0) == 0.0)

# 4. Spelling follows the key; titles keep their capitals.
check("spell: sharps", m.spell(63, False) == "D#4" and m.spell(63, True) == "E-4")
check("title", m.nice_title("fur_Elise_WoO59") == "Fur Elise WoO59")

# 5. End to end with music21: one-track two-hand file, G major 3/4, played a little unevenly.
from music21 import chord, key, meter, note, stream, tempo  # noqa: E402

lib = Path(tempfile.mkdtemp())
src = stream.Stream()
src.append([tempo.MetronomeMark(number=90), key.KeySignature(1), meter.TimeSignature("3/4")])
rng = random.Random(4)
for bar in range(8):
    src.insert(bar * 3, chord.Chord([43, 50], quarterLength=3))  # LH G2+D3 dotted half
    for beat, midi in enumerate((67, 71, 74)):  # RH G4 B4 D5
        jitter = rng.uniform(-0.04, 0.04)  # a played take is never exactly on the grid
        src.insert(max(0, bar * 3 + beat + jitter), note.Note(midi, quarterLength=0.95))
mid = lib / "test_tune.mid"
src.write("midi", fp=str(mid))
out = m.convert(mid, lib)
xml = out.read_text(encoding="utf-8")
check("e2e: written as slug", out.name == "test-tune.musicxml")
check("e2e: two staves", "<staves>2</staves>" in xml)
check("e2e: 3/4 + one sharp", "<beats>3</beats>" in xml and "<fifths>1</fifths>" in xml)
check("e2e: marker", m.MARKER in xml and "Music21</creator>" not in xml)
check("e2e: 8 bars", xml.count("<measure ") == 8)
trust = json.loads((lib / "trust.json").read_text(encoding="utf-8"))
check("e2e: trust unverified with no-fingering note",
      trust["test-tune.musicxml"]["status"] == "unverified" and "no fingering" in trust["test-tune.musicxml"]["note"])
check("e2e: never overwrites", m.convert(mid, lib).name == "test-tune-2.musicxml")

# 6. Sweep: tripwire skips; an empty inbox never imports music21 (it runs every 15 minutes).
env = dict(os.environ, MIDITUTOR_LIBRARY=str(lib))
state = lib / "load.json"
state.write_text('{"tripped": true}', encoding="utf-8")
(lib / "midi-in").mkdir(exist_ok=True)
(lib / "midi-in" / "x.mid").write_bytes(mid.read_bytes())
run = subprocess.run([sys.executable, str(ROOT / "scripts" / "midi_to_score.py"), "sweep", "--no-pinocchio", "--no-uploads"],
                     env=dict(env, MIDITUTOR_LOAD_STATE=str(state)), capture_output=True, text=True)
check("sweep: tripwire skip", "tripwire" in run.stdout and (lib / "midi-in" / "x.mid").exists())
(lib / "midi-in" / "x.mid").unlink()
probe = ("import sys; sys.path.insert(0, r'%s'); import midi_to_score as m; "
         "m.sweep(m.Path(r'%s'), True, True); print('music21' in sys.modules)") % (ROOT / "scripts", lib)
run = subprocess.run([sys.executable, "-c", probe], env=dict(env, MIDITUTOR_LOAD_STATE=str(lib / "none.json")),
                     capture_output=True, text=True)
check("sweep: empty inbox skips music21", run.stdout.strip().endswith("False"))

print("FAILS:", FAILS)
sys.exit(1 if FAILS else 0)
