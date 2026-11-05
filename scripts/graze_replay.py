"""Replay a day's practice log against the graze rule (#5516) to check GRAZE_MS.

    python scripts/graze_replay.py <log.json|log.jsonl> [--window 80]

Takes the tutor API's GET /log reply ({"entries": [...]}) or the raw .jsonl. Lists every
strike the rule would call a graze (struck within the window after the strike that
finished a step, and not a note of that step), then every other strike under 100 ms
after a finish, which is what a real fast pair would look like. Exit 1 if any flagged
strike is at or past the window (a bug in this replay, not in his playing).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path


def entries(path: Path) -> list[dict]:
    text = path.read_text(encoding="utf8")
    if text.lstrip().startswith("{\"file\""):
        return json.loads(text)["entries"]
    return [json.loads(line) for line in text.splitlines() if line.strip()]


def main(argv: list[str]) -> int:
    window = int(argv[argv.index("--window") + 1]) if "--window" in argv else 80
    follows = sorted((e for e in entries(Path(argv[0])) if e.get("kind") == "follow"), key=lambda e: e["timestamp"])
    finish_ms, finish_notes = None, set()
    flagged, near = [], []
    for e in follows:
        gap = None if finish_ms is None else e["timestamp"] - finish_ms
        if gap is not None and e["name"] not in finish_notes and e["result"] != "ignored":
            row = f"{gap:4d} ms  bar {e.get('bar')}: {e['name']} (vel {e['velocity']}) after {'/'.join(sorted(finish_notes))}"
            if gap < window:
                flagged.append((gap, row))
            elif gap < 100:
                near.append(row)
        if e["result"] in ("advance", "loop", "complete"):
            finish_ms, finish_notes = e["timestamp"], set(e["expected"])
    print(f"{len(follows)} strikes; window {window} ms; {len(flagged)} grazes:")
    for _, row in flagged:
        print("  " + row)
    print(f"{len(near)} other strikes {window}-99 ms after a finish (should be real notes):")
    for row in near:
        print("  " + row)
    return 1 if any(gap >= window for gap, _ in flagged) else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
