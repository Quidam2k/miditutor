"""CLI: python -m importer midi|musicxml|photo <file> [-o out.musicxml] [--json]

Writes MusicXML and prints the output path (or a JSON object with --json).
Exit code 1 with a message on stderr when the conversion fails.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from importer.midi import midi_to_musicxml
from importer.musicxml import MusicXMLError, read_musicxml
from importer.omr import OMRError, photo_to_musicxml


def _run(kind: str, source: Path, title: str | None) -> str:
    if kind == "midi":
        return midi_to_musicxml(source, title=title)
    if kind == "musicxml":
        return read_musicxml(source)
    return photo_to_musicxml(source)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m importer", description=__doc__.splitlines()[0])
    parser.add_argument("kind", choices=["midi", "musicxml", "photo"])
    parser.add_argument("file", type=Path)
    parser.add_argument("-o", "--output", type=Path, help="default: <file stem>.musicxml next to the input")
    parser.add_argument("--title", help="score title (default: file name)")
    parser.add_argument("--json", action="store_true", help="print a JSON object instead of the bare path")
    args = parser.parse_args(argv)

    output = args.output or args.file.with_suffix(".musicxml")
    try:
        xml = _run(args.kind, args.file, args.title)
    except (MusicXMLError, OMRError, ValueError, OSError) as exc:
        print(f"importer: {exc}", file=sys.stderr)
        return 1
    output.write_text(xml, encoding="utf-8")
    if args.json:
        print(json.dumps({"path": str(output.resolve()), "kind": args.kind, "bytes": len(xml)}))
    else:
        print(output.resolve())
    return 0


if __name__ == "__main__":
    sys.exit(main())
