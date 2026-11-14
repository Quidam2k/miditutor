"""Add one piano-lesson summary to the lesson notebook MidiTutor reads (#6112).

The notebook is lesson-notebook.jsonl in the library (never in git), one JSON line per lesson,
newest first, copied to Pinocchio like homework.json. LESSON CONTENT ONLY: technique, feel, what to
fix. Never put anything else in the summary file (meals, health, errands, other dead-drop material):
the app, the tutor API and the Pinocchio copy all read this file.

    python scripts/lesson_notebook_add.py --date 2026-11-13 --summary-file lesson.md            # preview
    python scripts/lesson_notebook_add.py --date 2026-11-13 --summary-file lesson.md --write    # save + push

Safe to re-run: the same date and text changes nothing; the same date with new text replaces that
date's entry. Past lessons are backfilled by hand, one call per lesson, in any order.
The last stdout line is a JSON summary. Python 3.11, standard library only.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
import localcfg  # noqa: E402

MAX_SUMMARY_CHARS = 20_000  # the app skips longer lines
NOTEBOOK = "lesson-notebook.jsonl"
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def load(path: Path) -> list[dict[str, Any]]:
    """The valid entries of an existing notebook; a bad line is dropped, never fatal."""
    entries: list[dict[str, Any]] = []
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except (FileNotFoundError, UnicodeError):
        return entries
    for line in lines:
        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(entry, dict) and DATE.match(str(entry.get("date", ""))) and isinstance(entry.get("summary_md"), str):
            entries.append(entry)
    return entries


def merge(entries: list[dict[str, Any]], date: str, summary: str, added_at: str) -> tuple[list[dict[str, Any]], bool]:
    """Insert or replace the entry for `date`; newest first. False when nothing changed."""
    sha = hashlib.sha256(summary.encode("utf-8")).hexdigest()
    for entry in entries:
        if entry["date"] == date and entry.get("sha256") == sha:
            return entries, False
    kept = [e for e in entries if e["date"] != date]
    kept.append({"date": date, "source": "piano-lesson", "summary_md": summary, "sha256": sha, "added_at": added_at})
    kept.sort(key=lambda e: e["date"], reverse=True)
    return kept, True


def write(path: Path, entries: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", newline="\n", dir=path.parent, delete=False) as stream:
            temporary = Path(stream.name)
            for entry in entries:
                stream.write(json.dumps(entry, ensure_ascii=False) + "\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def push(path: Path) -> None:
    host = localcfg.get("pinocchio_host", "PINOCCHIO_HOST", "")
    subprocess.run(
        ["scp", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", str(path), f"{host}:MidiTutor Pieces/{NOTEBOOK}"],
        stdin=subprocess.DEVNULL, capture_output=True, text=True, encoding="utf-8", errors="replace",
        check=True, timeout=60,
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--date", required=True, help="the lesson's date, YYYY-MM-DD")
    parser.add_argument("--summary-file", required=True, help="UTF-8 lesson summary (lesson content only), or - for stdin")
    parser.add_argument("--library", type=Path,
                        default=Path(localcfg.get("library", "MIDITUTOR_LIBRARY", str(Path.home() / "piano" / "library"))))
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--no-push", action="store_true")
    args = parser.parse_args(argv)
    summary: dict[str, Any] = {"date": args.date, "entries": 0, "written": False, "pushed": False, "flags": []}
    status = 0
    try:
        if not DATE.match(args.date):
            raise ValueError("--date must be YYYY-MM-DD")
        if args.summary_file == "-":
            if hasattr(sys.stdin, "reconfigure"):
                sys.stdin.reconfigure(encoding="utf-8")
            text = sys.stdin.read()
        else:
            text = Path(args.summary_file).read_text(encoding="utf-8")
        text = text.strip()
        if not text:
            raise ValueError("the summary is empty")
        if len(text) > MAX_SUMMARY_CHARS:
            raise ValueError(f"the summary is {len(text)} characters; the limit is {MAX_SUMMARY_CHARS}")
        destination = args.library / NOTEBOOK
        pending = args.library / ".lesson_notebook_push_pending"  # a failed push is retried next run
        entries, changed = merge(load(destination), args.date, text, datetime.now(timezone.utc).isoformat())
        summary["entries"] = len(entries)
        if not args.write:
            print(json.dumps(entries[:1], ensure_ascii=False, indent=2))
        else:
            if changed:
                write(destination, entries)
                summary["written"] = True
                if not args.no_push:
                    pending.touch()
            else:
                print("unchanged")
            if pending.exists() and not args.no_push:
                try:
                    push(destination)
                    summary["pushed"] = True
                    pending.unlink(missing_ok=True)
                except (OSError, subprocess.SubprocessError) as exc:
                    print(f"push failed: {exc}", file=sys.stderr)
                    status = 2
    except (OSError, ValueError) as exc:
        print(f"lesson notebook add failed: {exc}", file=sys.stderr)
        summary["flags"].append(str(exc))
        status = 1
    finally:
        print(json.dumps(summary, ensure_ascii=False))
    return status


if __name__ == "__main__":
    raise SystemExit(main())
