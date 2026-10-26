"""Convert MIDI into piano MusicXML; sweep local, phone, and Pinocchio inboxes."""
from __future__ import annotations

import argparse
import json
import math
import os
import re
import shlex
import shutil
import sqlite3
import subprocess
import tempfile
import traceback
import unicodedata
from contextlib import closing
from copy import deepcopy
from datetime import datetime
from itertools import groupby
from pathlib import Path
from typing import Any

Event = tuple[float, float, list[int]]
REMOTE = "MidiTutor Pieces/MIDI drop"
MARKER = "<software>miditutor midi_to_score</software>"
# The Score tab shows this next to the piece (#4046: say there is no fingering).
TRUST_NOTE = "Converted from MIDI: no fingering, and the hand split is a guess."

def split_hands(events: list[Event]) -> tuple[list[Event], list[Event]]:
    """Split on middle C, smoothing isolated middle-register notes by proximity."""
    hands: tuple[list[Event], list[Event]] = ([], [])
    previous: list[list[int]] = [[], []]
    for offset, group in groupby(sorted(events, key=lambda e: e[0]), key=lambda e: e[0]):
        batch = list(group)
        pitches = sorted({p for _, _, ps in batch for p in ps})
        assignments = {p: int(p < 60) for p in pitches}
        if len(pitches) == 1 and 55 <= pitches[0] <= 64:
            pitch = pitches[0]
            distances = [min((abs(pitch - p) for p in ps), default=math.inf) for ps in previous]
            if distances[0] != distances[1]:
                assignments[pitch] = int(distances[1] < distances[0])
        for hand in (0, 1):
            current = [p for p in pitches if assignments[p] == hand]
            for _, duration, ps in batch:
                selected = sorted({p for p in ps if assignments[p] == hand})
                if selected:
                    hands[hand].append((offset, duration, selected))
            if current:
                previous[hand] = current
    return hands

def pickup_shift(hands: list[list[Event]], bar: float) -> float:
    """How far to push everything so strong notes land on downbeats (a MIDI file has no pickup bar).

    Scores each 16th-note shift by the length of the notes that would start a bar, bass notes
    counted double, and keeps 0 unless another shift clearly wins. Only the first 8 bars vote:
    a pickup only moves the start, and later repeats or partial bars would outvote it.
    """
    def weight(shift: float) -> float:
        return sum(duration * (2 if hand else 1)
                   for hand, events in enumerate(hands) for offset, duration, _ in events
                   if offset < 8 * bar and abs((offset + shift + 1e-6) % bar) < 1e-5)
    shifts = [i * 0.25 for i in range(int(round(bar / 0.25)))]
    best = max(shifts, key=weight)
    return best if weight(best) > 1.25 * weight(0.0) else 0.0

SHARPS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
FLATS = ["C", "D-", "D", "E-", "E", "F", "G-", "G", "A-", "A", "B-", "B"]

def spell(midi: int, flats: bool) -> str:
    """music21 pitch name for a MIDI number: flats in flat keys, sharps otherwise (D# in A minor, not Eb)."""
    return f"{(FLATS if flats else SHARPS)[midi % 12]}{midi // 12 - 1}"

def nice_title(stem: str) -> str:
    """'fur_Elise_WoO59' -> 'Fur Elise WoO59': capitalize lowercase words, leave the rest alone."""
    return " ".join(w[:1].upper() + w[1:] for w in re.split(r"[_\s-]+", stem) if w)

def monophonize(events: list[Event]) -> list[Event]:
    """Merge simultaneous pitches and clip durations at the following onset."""
    merged = []
    for offset, group in groupby(sorted(events, key=lambda e: e[0]), key=lambda e: e[0]):
        batch = list(group)
        pitches = sorted({p for _, _, ps in batch for p in ps})
        if pitches:
            merged.append((offset, max(d for _, d, _ in batch), pitches))
    result = []
    for index, (offset, duration, pitches) in enumerate(merged):
        triplet = abs(offset * 3 - round(offset * 3)) < 1e-7
        straight = abs(offset * 4 - round(offset * 4)) < 1e-7
        duration = max(duration, 1 / 3 if triplet and not straight else 0.25)
        if index + 1 < len(merged):
            duration = min(duration, merged[index + 1][0] - offset)
        result.append((offset, duration, pitches))
    return result

def _unique(path: Path) -> Path:
    candidate, number = path, 2
    while candidate.exists():
        candidate = path.with_name(f"{path.stem}-{number}{path.suffix}")
        number += 1
    return candidate

def _read(path: Path, default: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default

def _atomic_json(path: Path, data: object) -> None:
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as file:
        temporary = Path(file.name)
    try:
        temporary.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)

def _log(library: Path, message: str, dry: bool = False) -> None:
    if dry:
        print(message)
        return
    path = library / "midi-in" / "sweep.log"
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as file:
        stamp = datetime.now().astimezone().isoformat(timespec="seconds")
        file.write(f"{stamp} {' '.join(message.splitlines())}\n")

def _trust(library: Path, name: str) -> None:
    path = library / "trust.json"
    try:
        data = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
        if not isinstance(data, dict):
            raise ValueError("expected a JSON object")
        # Shape agreed with the OMR audit, which owns trust.json (#9644): flat, merge-only.
        data[name] = dict(status="unverified", note=TRUST_NOTE, source="midi_to_score")
        _atomic_json(path, data)
    except (OSError, ValueError) as error:
        _log(library, f"failed: trust.json update skipped: {error}")

def _mark(xml: str) -> str:
    """Swap music21's own <software> line for ours, which the app looks for."""
    return re.sub(r"<software>[^<]*</software>", MARKER, xml, count=1)

def convert(path: Path, library: Path, title: str | None = None) -> Path:
    """Parse a MIDI lazily, reduce it to two hands, and publish a unique score."""
    from music21 import chord, clef, converter, instrument, key, layout
    from music21 import metadata, meter, note, stream, tempo

    path, library = Path(path), Path(library)
    score = converter.parse(str(path), quantizePost=True, quarterLengthDivisors=(4, 3))
    ts = next(iter(score.recurse().getElementsByClass(meter.TimeSignature)), meter.TimeSignature("4/4"))
    ks = next(iter(score.recurse().getElementsByClass(key.KeySignature)), None)
    if ks is None:
        try:
            ks = score.analyze("key")
        except Exception:
            ks = key.KeySignature(0)
    mm = next(iter(score.recurse().getElementsByClass(tempo.MetronomeMark)), None)
    meta = score.metadata
    candidate = (meta.title or "").strip() if meta else ""
    generic = r"(track|part|piano|grand piano|acoustic grand piano|untitled|midi(?: file)?|music21 fragment)(?:[ _-]*\d+)?"
    if not candidate or re.fullmatch(generic, candidate, re.I):
        candidate = nice_title(path.stem)
    title = title if title is not None else candidate
    parts = []
    for part in list(score.parts) or [score]:
        events = []
        for element in part.recurse().notes:
            if not isinstance(element, (note.Note, chord.Chord)):
                continue
            inst = element.getContextByClass(instrument.Instrument)
            if inst is not None and inst.midiChannel == 9:
                continue
            pitches = [int(p.midi) for p in element.pitches]
            if pitches and element.quarterLength > 0:
                events.append((float(element.getOffsetInHierarchy(score)), float(element.quarterLength), pitches))
        if events:
            parts.append(events)
    if not parts:
        raise ValueError("MIDI contains no pitched notes")
    if len(parts) == 2:
        parts.sort(key=lambda es: sum(p for _, _, ps in es for p in ps) / sum(len(ps) for _, _, ps in es), reverse=True)
        hands = parts
    else:
        hands = split_hands([e for part in parts for e in part])
    shift = pickup_shift(hands, ts.barDuration.quarterLength)
    hands = [monophonize([(offset + shift, duration, ps) for offset, duration, ps in hand]) for hand in hands]
    flats = ks.sharps < 0
    end = max(offset + duration for hand in hands for offset, duration, _ in hand)
    output = stream.Score()
    output.metadata = metadata.Metadata(title=title)
    output.metadata.composer = meta.composer if meta else None
    staves = []
    for index, events in enumerate(hands):
        staff = stream.PartStaff(id=("RH", "LH")[index])
        staff.partName = "Piano"
        staff.insert(0, clef.TrebleClef() if index == 0 else clef.BassClef())
        staff.insert(0, key.KeySignature(ks.sharps))
        staff.insert(0, deepcopy(ts))
        if index == 0 and mm is not None:
            staff.insert(0, deepcopy(mm))
        for offset, duration, pitches in events:
            names = [spell(p, flats) for p in pitches]
            item = note.Note(names[0]) if len(names) == 1 else chord.Chord(names)
            item.quarterLength = duration
            staff.insert(offset, item)
        staff.makeRests(refStreamOrTimeRange=[0, end], fillGaps=True, inPlace=True)
        staff.makeNotation(inPlace=True)
        output.insert(0, staff)
        staves.append(staff)
    output.insert(0, layout.StaffGroup(staves, symbol="brace", barTogether=True))
    slug = unicodedata.normalize("NFKD", title).encode("ascii", "ignore").decode()
    slug = re.sub(r"[^a-z0-9]+", "-", slug.lower()).strip("-")[:80].rstrip("-") or "score"
    library.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(suffix=".musicxml", dir=library, delete=False) as file:
        temporary = Path(file.name)
    try:
        output.write("musicxml", fp=temporary)
        xml = _mark(temporary.read_text(encoding="utf-8"))
        # music21 fills in "Music21" as the composer and repeats the title as a movement title.
        xml = re.sub(r"\s*<creator type=\"composer\">Music21</creator>", "", xml)
        xml = re.sub(r"\s*<movement-title>[^<]*</movement-title>", "", xml, count=1)
        destination = _unique(library / f"{slug}.musicxml")
        with destination.open("x", encoding="utf-8") as file:
            file.write(xml)
    finally:
        temporary.unlink(missing_ok=True)
    _trust(library, destination.name)
    return destination

def _safe_name(name: str) -> str:
    name = re.split(r"[/\\]", name)[-1]
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", name).strip(" .") or "upload.mid"
    reserved = re.match(r"^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)", name, re.I)
    return ("_" if reserved else "") + name

def _uploads(library: Path, inbox: Path, dry: bool) -> list[Path]:
    seen_path = inbox / ".uploads_seen.json"
    seen = _read(seen_path, [])
    seen = set(seen if isinstance(seen, list) else [])
    db_path = Path(os.environ.get("MIDITUTOR_PANTHEON_DB", "Q:/Pantheon/data/pantheon.db"))
    planned = []
    try:
        with closing(sqlite3.connect(db_path.resolve().as_uri() + "?mode=ro", uri=True)) as db:
            rows = db.execute("SELECT id, original_name, filename, file_path FROM uploads "
                              "WHERE lower(coalesce(original_name, filename)) LIKE '%.mid' "
                              "OR lower(coalesce(original_name, filename)) LIKE '%.midi'").fetchall()
    except sqlite3.Error as error:
        _log(library, f"failed: uploads database: {error}", dry)
        return planned
    for upload_id, original, filename, source in rows:
        if upload_id in seen or not source or not Path(source).is_file():
            continue
        destination = _unique(inbox / _safe_name(original or filename or "upload.mid"))
        try:
            if not dry:
                shutil.copy2(source, destination)
                seen.add(int(upload_id))
                _atomic_json(seen_path, sorted(seen))
            _log(library, f"{'would copy' if dry else 'copied'}: {source} -> {destination}", dry)
            planned.append(destination)
        except (OSError, ValueError) as error:
            _log(library, f"failed: upload {upload_id}: {error}", dry)
    return planned

def _run(program: str, *args: str) -> str:
    command = [program, "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", *args]
    return subprocess.run(command, check=True, capture_output=True, text=True,
                          encoding="utf-8", errors="replace", stdin=subprocess.DEVNULL,
                          timeout=60, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0)).stdout

def _pull(library: Path, inbox: Path, host: str, dry: bool) -> list[Path]:
    planned = []
    try:
        command = f'ls -1 "$HOME/{REMOTE}"'
        if not dry:
            command = f'mkdir -p "$HOME/{REMOTE}/done"; ' + command
        names = _run("ssh", host, command).splitlines()
    except (OSError, subprocess.SubprocessError) as error:
        _log(library, f"failed: Pinocchio SSH: {error}", dry)
        return planned
    for name in names:
        if not name.lower().endswith((".mid", ".midi")) or "/" in name:
            continue
        destination = _unique(inbox / _safe_name(name))
        temporary = None
        try:
            if not dry:
                with tempfile.NamedTemporaryFile(dir=inbox, suffix=".part", delete=False) as file:
                    temporary = Path(file.name)
                _run("scp", f"{host}:{REMOTE}/{name}", str(temporary))
                os.replace(temporary, destination)
                _log(library, f"pulled: {name} -> {destination}")
                source = '"$HOME"/' + shlex.quote(f"{REMOTE}/{name}")
                target = '"$HOME"/' + shlex.quote(f"{REMOTE}/done/")
                _run("ssh", host, f"mv -- {source} {target}")
            else:
                _log(library, f"would pull and archive: {name} -> {destination}", True)
            planned.append(destination)
        except (OSError, subprocess.SubprocessError) as error:
            _log(library, f"failed: Pinocchio pull/archive {name}: {error}", dry)
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)
    return planned

def _push(library: Path, inbox: Path, host: str, files: list[Path], dry: bool) -> None:
    path = inbox / ".pending_push.json"
    previous = _read(path, [])
    previous = previous if isinstance(previous, list) else []
    pending = list(dict.fromkeys([str(p) for p in previous] + [str(p) for p in files]))
    failed = []
    for name in pending:
        try:
            if not dry:
                _run("scp", name, f"{host}:MidiTutor Pieces/")
            _log(library, f"{'would push' if dry else 'pushed'}: {name}", dry)
        except (OSError, subprocess.SubprocessError) as error:
            failed.append(name)
            _log(library, f"failed: push {name}: {error}", dry)
    if not dry and failed != previous:
        _atomic_json(path, failed)

def sweep(library: Path, no_pinocchio: bool = False, no_uploads: bool = False,
          dry_run: bool = False) -> int:
    state = _read(Path(os.environ.get("MIDITUTOR_LOAD_STATE",
                                    "Q:/Pantheon/data/runtime/solace_load_state.json")), {})
    if isinstance(state, dict) and state.get("tripped"):
        _log(Path(library), "skipped: solace load tripwire", dry_run)
        if not dry_run:
            print("skipped: solace load tripwire")
        return 0
    library = Path(library)
    inbox = library / "midi-in"
    if not dry_run:
        inbox.mkdir(parents=True, exist_ok=True)
    host = os.environ.get("PINOCCHIO_HOST", "toddwalker@192.168.50.27")
    planned = _uploads(library, inbox, dry_run) if not no_uploads else []
    if not no_pinocchio:
        planned += _pull(library, inbox, host, dry_run)
    sources = [p for p in inbox.iterdir() if p.is_file()
               and p.suffix.lower() in (".mid", ".midi")] if inbox.exists() else []
    written, failures = [], 0
    for source in sorted(set(sources + (planned if dry_run else []))):
        if dry_run:
            actions = "convert and move to done" + (", push score" if not no_pinocchio else "")
            print(f"would {actions}: {source}")
            continue
        try:
            output = convert(source, library)
            written.append(output)
        except Exception:
            failures += 1
            details = traceback.format_exc()
            folder = inbox / "failed"
            folder.mkdir(exist_ok=True)
            destination = _unique(folder / source.name)
            shutil.move(str(source), destination)
            destination.with_name(destination.name + ".err").write_text(details, encoding="utf-8")
            _log(library, f"failed: {source.name}: {details.splitlines()[-1]}")
            continue
        done = inbox / "done"
        done.mkdir(exist_ok=True)
        shutil.move(str(source), _unique(done / source.name))
        _log(library, f"converted: {source.name} -> {output}")
    if not no_pinocchio:
        # trust.json rides along so the Score tab can label the new piece as converted from MIDI.
        trust = [library / "trust.json"] if written and (library / "trust.json").exists() else []
        _push(library, inbox, host, written + trust, dry_run)
    print(f"sweep{' dry-run' if dry_run else ''}: {len(written)} converted, {failures} failed")
    return 0

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    for command in ("convert", "sweep"):
        sub = commands.add_parser(command)
        sub.add_argument("--library", type=Path, default=Path(os.environ.get(
            "MIDITUTOR_LIBRARY", "Q:/Personal/piano/library")))
        if command == "convert":
            sub.add_argument("path", type=Path)
            sub.add_argument("--title")
        else:
            for flag in ("no-pinocchio", "no-uploads", "dry-run"):
                sub.add_argument("--" + flag, action="store_true")
    args = parser.parse_args(argv)
    if args.command == "convert":
        print(convert(args.path, args.library, args.title))
        return 0
    return sweep(args.library, args.no_pinocchio, args.no_uploads, args.dry_run)


if __name__ == "__main__":
    raise SystemExit(main())
