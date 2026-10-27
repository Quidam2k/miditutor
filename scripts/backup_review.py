"""Back up his scan-review work (#9664) into a private git repo.

The library (Q:/Personal/piano/library) is not in git, so the desk app runs this
on start and a minute after his last mark, confirm or accept:

    python -I scripts/backup_review.py --library <library> --dest <dir inside a git repo>

Copies review/*.events.jsonl, review/*.log, the proposal records
(review/<slug>.proposals/*.json), trust.json and every score he has changed
(a review log exists), then commits ONLY --dest and pushes. Unchanged -> no
commit. A failed push is retried on the next run. Last stdout line is JSON.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path


def wanted(library: Path) -> list[Path]:
    review = library / "review"
    files = [*review.glob("*.events.jsonl"), *review.glob("*.log"), *review.glob("*.proposals/*.json")]
    files += [library / f"{log.name[:-4]}.musicxml" for log in review.glob("*.log")]
    files.append(library / "trust.json")
    return [f for f in files if f.is_file()]


def copy_changed(library: Path, dest: Path) -> int:
    changed = 0
    for src in wanted(library):
        out = dest / src.relative_to(library)
        data = src.read_bytes()
        if out.is_file() and out.read_bytes() == data:
            continue
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(data)
        changed += 1
    return changed


def git(repo: Path, *args: str) -> subprocess.CompletedProcess:
    # Other sessions commit in the same repo: wait out their index.lock.
    for _ in range(5):
        r = subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True)
        if r.returncode == 0 or "index.lock" not in r.stderr:
            return r
        time.sleep(2)
    return r


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--library", type=Path, required=True)
    ap.add_argument("--dest", type=Path, required=True)
    a = ap.parse_args(argv)
    dest = a.dest.resolve()
    near = next(p for p in (dest, *dest.parents) if p.is_dir())
    top = subprocess.run(["git", "-C", str(near), "rev-parse", "--show-toplevel"], capture_output=True, text=True)
    if top.returncode != 0:
        print(json.dumps({"ok": False, "error": f"{dest} is not inside a git repo"}))
        return 1
    repo = Path(top.stdout.strip())
    changed = copy_changed(a.library, dest)
    committed = False
    if changed:
        rel = str(dest.relative_to(repo))
        git(repo, "add", "--", rel)
        r = git(repo, "commit", "-m", f"miditutor review backup: {changed} file(s)", "--", rel)
        committed = r.returncode == 0
        if not committed and "nothing" not in r.stdout + r.stderr:
            print(json.dumps({"ok": False, "changed": changed, "error": (r.stderr or r.stdout).strip()[-300:]}))
            return 1
    ahead = git(repo, "rev-list", "--count", "@{u}..HEAD")
    pushed = None
    if ahead.returncode == 0 and ahead.stdout.strip() not in ("", "0"):
        pushed = git(repo, "push", "--quiet").returncode == 0
    print(json.dumps({"ok": True, "changed": changed, "committed": committed, "pushed": pushed}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
