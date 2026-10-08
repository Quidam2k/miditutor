"""Run each OMR engine over the bench images and score the output.

Usage (bench venv):  .venv-omr-bench/Scripts/python bench/omr/run_bench.py [engine ...]
Engine executables default to the per-engine venvs at the repo root; override with
MIDITUTOR_BENCH_HOMR / MIDITUTOR_BENCH_OEMER. Results land in bench/omr/out/results.json
and a markdown table is printed. Each image is copied into out/<engine>/ first because
engines write their output next to their input.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

from score import score_pair

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
IMAGES = HERE / "images"
OUT = HERE / "out"
TRUTH = IMAGES / "minuet-in-g.truth.musicxml"
IMAGE_NAMES = ["clean_minuet.png", "persp.jpg", "rot_blur.jpg", "shadow.jpg",
               "tint_jpeg60.jpg", "phone_combo.jpg"]
TIMEOUT_S = 900


def _exe(env: str, venv: str, name: str) -> str:
    return os.environ.get(env) or str(REPO / venv / "Scripts" / name)


def engine_command(engine: str, image: Path, workdir: Path) -> tuple[list[str], Path]:
    """Return (argv, expected MusicXML path) for one engine run."""
    if engine == "homr":
        return [_exe("MIDITUTOR_BENCH_HOMR", ".venv-omr-homr", "homr.exe"), str(image)], \
            image.with_suffix(".musicxml")
    if engine == "oemer":
        return [_exe("MIDITUTOR_BENCH_OEMER", ".venv-omr-oemer", "oemer.exe"),
                "-o", str(workdir), str(image)], workdir / (image.stem + ".musicxml")
    raise ValueError(f"unknown engine {engine}")


def run_one(engine: str, image_name: str) -> dict:
    src = IMAGES / image_name
    workdir = OUT / engine
    workdir.mkdir(parents=True, exist_ok=True)
    image = workdir / image_name
    shutil.copyfile(src, image)
    argv, expected = engine_command(engine, image, workdir)
    if expected.exists():
        expected.unlink()  # never score a stale file from an earlier run
    record: dict = {"engine": engine, "image": image_name}
    start = time.perf_counter()
    try:
        proc = subprocess.run(argv, capture_output=True, text=True, timeout=TIMEOUT_S)
        record["seconds"] = round(time.perf_counter() - start, 1)
        record["rc"] = proc.returncode
        if proc.returncode != 0 or not expected.exists():
            lines = [ln for ln in (proc.stderr or proc.stdout).splitlines() if ln.strip()]
            record["error"] = lines[-1][:200] if lines else "no output"
            return record
    except subprocess.TimeoutExpired:
        record.update(seconds=TIMEOUT_S, rc=None, error="timeout")
        return record
    try:
        record.update(score_pair(TRUTH, expected))
    except Exception as exc:  # music21 can reject a malformed MusicXML
        record["error"] = f"unparseable output: {exc}"[:200]
    return record


def main(argv: list[str]) -> int:
    engines = argv or ["homr", "oemer"]
    results = []
    for engine in engines:
        for name in IMAGE_NAMES:
            rec = run_one(engine, name)
            results.append(rec)
            print(json.dumps(rec), flush=True)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "results.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
    print("\n| engine | image | pitch % | pitch+dur % | seconds | note |")
    print("|---|---|---|---|---|---|")
    for r in results:
        print(f"| {r['engine']} | {r['image']} | {r.get('pitch_acc', '-')} | "
              f"{r.get('pitch_dur_acc', '-')} | {r.get('seconds', '-')} | {r.get('error', '')} |")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
