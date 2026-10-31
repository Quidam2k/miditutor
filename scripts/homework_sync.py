"""Turn the newest dated entry of JP's lesson log into homework.json for the tutor (#5058).

The log is a private Google Doc, so the calling agent fetches its text with the Drive connector
and passes it in; homework.json lives in the library (never in git) and is copied to Pinocchio.

    python scripts/homework_sync.py --homework-file doc.txt            # preview
    python scripts/homework_sync.py --homework-file doc.txt --write    # save + push

The last stdout line is a JSON summary; its `unparsed` and `flags` go to Jarvis, not Todd.
Python 3.11, standard library only.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

Item = dict[str, Any]
DATE = re.compile(r"^\s*(\d{1,2}/\d{1,2}(?:\s*-\s*\d{1,2}/\d{1,2})?)\s*$")


def unescape(text: str) -> str:
    return text.replace("\\#", "#").replace("\\!", "!")


def slug(text: str) -> str:
    text = text.replace("'", "").replace("’", "")
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def newest_entry(text: str) -> tuple[str, list[str]]:
    date: str | None = None
    lines: list[str] = []
    for line in unescape(text).lstrip("\ufeff").splitlines():
        match = DATE.fullmatch(line)
        if match:
            if date is not None:
                break
            date = match[1]
        elif date is not None:
            lines.append(line)
    if date is None:
        raise ValueError("no dated lesson entry found")
    return date, lines


def scale_items(source: str, rest: str, bullets: list[str]
                ) -> tuple[list[Item], list[str], list[str]]:
    if re.search(r"break|next week|next time", rest, re.I):
        return [], [], [f"no scale this week: {rest}"]
    match = re.fullmatch(r"(.+?)\s+(major|minor)", rest, re.I)
    keys = []
    if match:
        for token in match[1].split(","):
            key = re.fullmatch(r"([A-G])\s*(#|b|sharp|flat)?", token.strip(), re.I)
            if not key:
                break
            accidental = (key[2] or "").lower().replace("sharp", "#").replace("flat", "b")
            keys.append(key[1].upper() + accidental)
        else:
            return make_scales(source, keys, match[2].lower(), bullets)
    return [], [source], [f"scale key or quality not understood: {rest}"]


def make_scales(source: str, keys: list[str], quality: str, bullets: list[str]
                ) -> tuple[list[Item], list[str], list[str]]:
    types = ["major"] if quality == "major" else [
        name for name in ("natural", "harmonic", "melodic")
        if any(re.search(rf"\b{name}\b", bullet, re.I) for bullet in bullets)
    ]
    fingerings: dict[str, dict[str, str]] = {"scale": {}, "arpeggio": {}}
    notes = []
    for bullet in bullets:
        match = re.fullmatch(r"(RH|LH)\s+(arp(?:eggio)?s?|scales?)\s*:\s*(.+)", bullet, re.I)
        if match:
            kind = "scale" if match[2].lower().startswith("scale") else "arpeggio"
            fingerings[kind][f"{match[1].upper()} {match[2]}"] = match[3]
        else:
            notes.append(bullet)
    items: list[Item] = []
    flags = []
    for key in keys:
        if quality == "minor" and not types:
            flags.append(f"scale type not stated for {key} minor (natural, harmonic or melodic?)")
        for kind in ("scale", "arpeggio"):
            item: Item = {"id": f"{kind}:{key}-{quality}", "kind": kind,
                          "label": f"{key} {quality} {kind}", "source": source,
                          "key": key, "quality": quality}
            if kind == "scale":
                item["types"] = list(types)
            if fingerings[kind]:
                item["fingering"] = dict(fingerings[kind])
            if notes:
                item["notes"] = list(notes)
            items.append(item)
    return items, [], flags


def url_from(text: str) -> str | None:
    match = re.search(r"https?://[^\s<>]+", text)
    return match[0] if match else None


def other_item(heading: str, bullets: list[str]) -> Item:
    item: Item = {"source": heading}
    triads = re.fullmatch(r"Triads?\s*-\s*(.*)", heading, re.I)
    if triads:
        rest = triads[1]
        label = "Triads by colour" if re.search(r"\bcolou?r\b", rest, re.I) else rest
        item.update(id="triads", kind="triads", label=label, groups={}, notes=[])
        chord = r"[A-G][#b]?m?(?:/[A-G][#b]?m?)?"
        for bullet in bullets:
            group = re.fullmatch(r"([WB]{3})\s*:\s*(.+)", bullet)
            unique = re.fullmatch(rf"({chord})\s*:\s*([WB]{{3}})", bullet)
            if group:
                item["groups"][group[1]] = [s.strip() for s in group[2].split(",") if s.strip()]
            elif unique:
                item["groups"][unique[1]] = unique[2]
            else:
                item["notes"].append(bullet)
    elif re.match(r"Interval practice\s*:", heading, re.I):
        item.update(id="intervals", kind="intervals", label="Interval practice",
                    intervals=[], daily_goal=None, clefs=None, url=url_from(heading))
        notes = []
        for bullet in bullets:
            intervals = re.fullmatch(r"Intervals\s*:\s*(.*)", bullet, re.I)
            clefs = re.fullmatch(r"Clefs\s*:\s*(.*)", bullet, re.I)
            goal = re.search(r"(\d+)\s+correct", bullet, re.I)
            if intervals:
                item["intervals"] = [re.sub(r"^D(?=\d)", "d", s.strip())
                                     for s in intervals[1].split(",") if s.strip()]
            if clefs:
                item["clefs"] = clefs[1]
            if goal:
                item["daily_goal"] = int(goal[1])
            if not (intervals or clefs or goal):
                notes.append(bullet)
        if notes:
            item["notes"] = notes
    elif re.match(r"Note ID\s*:", heading, re.I):
        item.update(id="note-id", kind="note-id", label="Note identification",
                    url=url_from(heading))
        if bullets:
            item["notes"] = list(bullets)
    elif re.match(r"Written assignments\s*-", heading, re.I) or heading.endswith("?"):
        item.update(id=f"task:{slug(heading)}", kind="task", label=heading)
        if bullets:
            item["notes"] = list(bullets)
    else:
        title, separator, comment = heading.partition(" - ")
        item.update(id=f"piece:{slug(title)}", kind="piece", label=title,
                    title=title, notes=([comment] if separator else []) + bullets, file=None)
    return item


def parse_entry(lines: list[str]) -> tuple[list[Item], list[str], list[str]]:
    sections: list[tuple[str, list[str]]] = []
    items: list[Item] = []
    unparsed: list[str] = []
    flags: list[str] = []
    for raw in lines:
        line = unescape(raw)
        if not line.strip():
            continue
        if line[0].isspace():
            if sections:
                sections[-1][1].append(re.sub(r"^-\s*", "", line.strip()))
            else:
                unparsed.append(line.strip())
        else:
            sections.append((line.strip(), []))
    for heading, bullets in sections:
        scale = re.fullmatch(r"Scales/Arpeggios\s*-\s*(.*)", heading, re.I)
        if scale:
            parsed, unknown, warnings = scale_items(heading, scale[1], bullets)
            items.extend(parsed)
            unparsed.extend(unknown)
            flags.extend(warnings)
        else:
            items.append(other_item(heading, bullets))
    return items, unparsed, flags


def match_piece_files(items: list[Item], files: list[Path]) -> list[Item]:
    result = []
    for original in items:
        item = dict(original)
        if item["kind"] == "piece":
            name = slug(item["title"])
            matches = sorted(
                (p for p in files if ".pre-annotate." not in p.name.lower()
                 and name and f"-{name}-" in f"-{slug(p.stem)}-"),  # whole words: "O" must not hit "dream-echoes"
                key=lambda p: (len(p.stem), p.name.casefold(), p.name),
            )
            item["file"] = matches[0].name if matches else None
            if len(matches) > 1:
                item["files"] = [p.name for p in matches]
        result.append(item)
    return result


def write_if_changed(destination: Path, document: Item) -> bool:
    try:
        previous = json.loads(destination.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, UnicodeError):
        previous = None
    if isinstance(previous, dict) and all(
        previous.get(key) == document[key] for key in ("date", "items", "unparsed", "flags")
    ):
        return False
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", newline="\n",
                                         dir=destination.parent, delete=False) as stream:
            temporary = Path(stream.name)
            json.dump(document, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, destination)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    return True


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--homework-file", required=True, help="UTF-8 lesson log, or - for stdin")
    parser.add_argument("--library", type=Path,
                        default=Path(os.environ.get("MIDITUTOR_LIBRARY", "Q:/Personal/piano/library")))
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--no-push", action="store_true")
    args = parser.parse_args(argv)
    summary: Item = {"date": None, "items": 0, "unparsed": [], "flags": [],
                     "written": False, "pushed": False}
    status = 0
    try:
        if args.homework_file == "-":
            if hasattr(sys.stdin, "reconfigure"):
                sys.stdin.reconfigure(encoding="utf-8")
            text = sys.stdin.read()
        else:
            text = Path(args.homework_file).read_text(encoding="utf-8")
        date, lines = newest_entry(text)
        items, unparsed, flags = parse_entry(lines)
        items = match_piece_files(items, list(args.library.glob("*.musicxml")))
        document = {"date": date, "generated_at": datetime.now(timezone.utc).isoformat(),
                    "items": items, "unparsed": unparsed, "flags": flags}
        summary.update(date=date, items=len(items), unparsed=unparsed, flags=flags)
        destination = args.library / "homework.json"
        # A push that failed (Pinocchio asleep) is retried on the next run, even if unchanged.
        pending = args.library / ".homework_push_pending"
        if not args.write:
            print(json.dumps(document, ensure_ascii=False, indent=2))
        else:
            summary["written"] = write_if_changed(destination, document)
            if not summary["written"]:
                print("unchanged")
            elif not args.no_push:
                pending.touch()
            if pending.exists() and not args.no_push:
                host = os.environ.get("PINOCCHIO_HOST", "toddwalker@192.168.50.27")
                try:
                    subprocess.run(
                        ["scp", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10",
                         str(destination), f"{host}:MidiTutor Pieces/homework.json"],
                        stdin=subprocess.DEVNULL, capture_output=True, text=True,
                        encoding="utf-8", errors="replace", check=True, timeout=60,
                        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                    )
                    summary["pushed"] = True
                    pending.unlink(missing_ok=True)
                except (OSError, subprocess.SubprocessError) as exc:
                    print(f"push failed: {exc}", file=sys.stderr)
                    status = 2
    except (OSError, ValueError) as exc:
        print(f"homework sync failed: {exc}", file=sys.stderr)
        summary["flags"] = [*summary["flags"], f"homework sync failed: {exc}"]
        status = 1
    finally:
        print(json.dumps(summary, ensure_ascii=False))
    return status


if __name__ == "__main__":
    raise SystemExit(main())
