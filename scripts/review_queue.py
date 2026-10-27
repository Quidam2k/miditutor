"""Check one marked bar of a scanned score against its scan, and apply the result (#9664).

Usage: review_queue.py propose [--library DIR] [--model M] [--timeout S] SLUG MARK_ID
       review_queue.py apply [--library DIR] SLUG PROPOSAL_ID

propose crops the scan around the marked bar, asks the claude CLI what is wrong, validates the
proposed edits against the score, and writes review/<slug>.proposals/<pid>.{json,png,musicxml}.
apply runs a ready proposal's edits through omr_fix. Both print one JSON object as the last stdout
line. Exit: 0 done, 2 bad input, 3 busy, 4 deferred by the load gate, 5 apply refused.
This script never writes the events file; the app is its only writer.
"""
import argparse
import contextlib
from datetime import datetime, timezone
from fractions import Fraction
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time
import uuid

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import omr_fix, omr_audit
from annotate_scan import Score, _child, _children, _name, _text, _note_pitch

from PIL import Image, ImageDraw

Image.MAX_IMAGE_PIXELS = None

DEFAULT_LIBRARY = Path("Q:/Personal/piano/library")
MIN_FREE_RAM_GB = 6.0       # propose waits when Solace has less available memory than this
MAX_CROP_WIDTH = 1800
BRACKET_COLOR, BRACKET_THICK = (220, 30, 30), 6
SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]*$")
ID_RE = re.compile(r"^[A-Za-z0-9-]{1,64}$")
ALLOWED_OPS = {"replace_measure", "transpose_note", "delete_note", "set_time", "set_key", "move_staff"}
STRUCTURAL_OPS = {"delete_measure", "split_measure"}
SYSTEM_PROMPT = ("You compare a scanned bar of piano music with its transcription "
                 "and answer in JSON only.")

OPS_TEXT = """Allowed edits (a JSON list; measure numbers are one-based positions):
{"op":"replace_measure","measure":N,"staves":{"1":{"1":[EVENT,...]},"2":{"1":[...]}}}
  EVENT is {"notes":["C5","E5"],"dur":"1"} (a chord) or {"rest":true,"dur":"1/2"}.
  Pitch = step, optional # or b (## or bb), octave; C4 is middle C.
  dur is a STRING fraction of quarter notes: "4" whole, "2" half, "1" quarter, "1/2" eighth,
  "1/4" 16th, "3/2" dotted quarter, "1/3" eighth-triplet.
{"op":"transpose_note","measure":N,"staff":S,"pitch":"C5" or ["C5","E5"],"semitones":-12,"voice":V}
{"op":"delete_note","measure":N,"staff":S,"pitch":"C5","voice":V}
{"op":"set_time","measure":N,"beats":3,"beat_type":4}
{"op":"set_key","measure":N,"fifths":-1}
{"op":"move_staff","measure_from":N,"measure_to":N,"from_staff":1,"to_staff":2,"voice":V}
("voice" is optional.) Do not use delete_measure or split_measure."""


class QueueError(Exception):
    """A refusal with the exit code and plain sentence the app shows."""

    def __init__(self, code, message):
        super().__init__(message)
        self.code, self.message = code, message


class _Parser(argparse.ArgumentParser):
    def error(self, message):
        raise QueueError(2, f"Bad command line: {message}")


# ---- machine state -------------------------------------------------------------------------

def available_ram_gb():
    """Available physical memory in GiB, or None where it cannot be read (non-Windows)."""
    if os.name != "nt":
        return None
    import ctypes

    class Status(ctypes.Structure):
        _fields_ = [("length", ctypes.c_ulong), ("load", ctypes.c_ulong),
                    ("total_phys", ctypes.c_ulonglong), ("avail_phys", ctypes.c_ulonglong),
                    ("total_page", ctypes.c_ulonglong), ("avail_page", ctypes.c_ulonglong),
                    ("total_virtual", ctypes.c_ulonglong), ("avail_virtual", ctypes.c_ulonglong),
                    ("avail_ext", ctypes.c_ulonglong)]

    status = Status()
    status.length = ctypes.sizeof(Status)
    if not ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
        return None
    return status.avail_phys / 2 ** 30


def _pid_alive(pid):
    if pid <= 0:
        return False
    if os.name != "nt":
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return False
        except PermissionError:
            return True
        return True
    import ctypes
    from ctypes import wintypes
    kernel = ctypes.windll.kernel32
    kernel.OpenProcess.restype = wintypes.HANDLE
    kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel.GetExitCodeProcess.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD)]
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    handle = kernel.OpenProcess(0x1000, False, pid)
    if not handle:
        return False
    try:
        code = wintypes.DWORD()
        return bool(kernel.GetExitCodeProcess(handle, ctypes.byref(code))) and code.value == 259
    finally:
        kernel.CloseHandle(handle)


@contextlib.contextmanager
def queue_lock(library, name=".queue.lock"):
    """Single-flight lock file holding our pid; a stale one (dead pid) is replaced once.

    Checks and applies take separate locks: Accept must not wait behind a minute-long check."""
    lock = Path(library) / "review" / name
    lock.parent.mkdir(parents=True, exist_ok=True)
    for attempt in (1, 2):
        try:
            fd = os.open(str(lock), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        except FileExistsError:
            try:
                pid = int(lock.read_text(encoding="utf-8").strip())
            except (OSError, ValueError):
                pid = 0
            if attempt == 2 or _pid_alive(pid):
                raise QueueError(3, "Another check is running.")
            lock.unlink(missing_ok=True)
            continue
        with os.fdopen(fd, "w") as handle:
            handle.write(str(os.getpid()))
        break
    try:
        yield
    finally:
        lock.unlink(missing_ok=True)


# ---- files ---------------------------------------------------------------------------------

def _sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def _write_json(path, data):
    path = Path(path)
    tmp = path.with_name(path.name + f".{uuid.uuid4().hex[:8]}.tmp")
    tmp.write_text(json.dumps(data, indent=1, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, path)


def _read_events(path):
    events = []
    try:
        lines = Path(path).read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return events
    for line in lines:
        try:
            event = json.loads(line)
        except ValueError:
            continue
        if isinstance(event, dict):
            events.append(event)
    return events


def _score_path(library, slug):
    path = Path(library) / f"{slug}.musicxml"
    if not path.is_file():
        raise QueueError(2, f"There is no piece called {slug}.")
    return path


def _check_ids(slug, other, label):
    if not SLUG_RE.match(slug or ""):
        raise QueueError(2, "That piece name isn't valid.")
    if not ID_RE.match(other or ""):
        raise QueueError(2, f"That {label} id isn't valid.")


# ---- bar listing ---------------------------------------------------------------------------

def _num(text):
    try:
        return Fraction(text)
    except (ValueError, TypeError, ZeroDivisionError):
        return None


def _part_measures(score):
    parts = _children(score.root, "part")
    if not parts:
        raise ValueError("The score has no part.")
    return _children(parts[0], "measure")


def _inherited(measures, index):
    """Latest divisions, time and key fifths declared up to and including measures[index]."""
    divisions = time = fifths = None
    for measure in measures[:index + 1]:
        for attributes in _children(measure, "attributes"):
            value = _num(_text(attributes, "divisions"))
            if value:
                divisions = value
            node = _child(attributes, "time")
            if node is not None and _text(node, "beats") and _text(node, "beat-type"):
                time = f"{_text(node, 'beats')}/{_text(node, 'beat-type')}"
            node = _child(attributes, "key")
            value = _num(_text(node, "fifths")) if node is not None else None
            if value is not None:
                fifths = int(value)
    return divisions, time, fifths


def _pitch_str(note):
    pitch = _note_pitch(note)
    if pitch is None:
        return None
    step, alter, octave = pitch
    alter = int(alter)
    return step + ("#" * alter if alter > 0 else "b" * -alter) + str(octave)


def _lane_key(value):
    return (0, int(value)) if value.isdigit() else (1, value)


def measure_listing(score, position):
    """The bar at one-based position, in the replace_measure staves format."""
    measures = _part_measures(score)
    measure = measures[position - 1]
    divisions, time, fifths = _inherited(measures, position - 1)
    if divisions is None:
        raise ValueError("The score declares no divisions.")
    lanes, ends, grace = {}, {}, []
    cursor, gaps, last_event, last_staff = Fraction(0), False, None, "1"
    for element in measure:
        name = _name(element)
        if name in ("backup", "forward", "note") and _child(element, "grace") is None:
            length = (_num(_text(element, "duration", "0")) or Fraction(0)) / divisions
        if name == "backup":
            cursor -= length
        elif name == "forward":
            lane = (_text(element, "staff", last_staff), _text(element, "voice", "1"))
            last_event = {"rest": True, "dur": str(length)}
            lanes.setdefault(lane, []).append(last_event)
            gaps = gaps or cursor != ends.get(lane, Fraction(0))
            cursor += length
            ends[lane] = cursor
        elif name == "note":
            label = _pitch_str(element)
            if _child(element, "grace") is not None:
                if label:
                    grace.append(label)
                continue
            if _child(element, "chord") is not None and last_event is not None:
                if label and "notes" in last_event:
                    last_event["notes"].append(label)
                continue
            lane = (_text(element, "staff", "1"), _text(element, "voice", "1"))
            last_staff = lane[0]
            if _child(element, "rest") is not None:
                last_event = {"rest": True, "dur": str(length)}
            elif label:
                last_event = {"notes": [label], "dur": str(length)}
            else:
                last_event = None
            if last_event is not None:
                lanes.setdefault(lane, []).append(last_event)
                gaps = gaps or cursor != ends.get(lane, Fraction(0))
                ends[lane] = cursor + length
            cursor += length
    staves = {}
    for (staff, voice) in sorted(lanes, key=lambda k: (_lane_key(k[0]), _lane_key(k[1]))):
        staves.setdefault(staff, {})[voice] = lanes[(staff, voice)]
    return {"measure": position, "number": measure.get("number"), "time": time,
            "key_fifths": fifths, "staves": staves, "grace": grace, "has_backup_gaps": gaps}


# ---- crop ----------------------------------------------------------------------------------

def crop_box(system, measure, page_size):
    """(x0, y0, x1, y1, tx0, tx1): crop box on the page and the target bar's x range in the crop.

    The crop spans the bar and one bar either side, padded by two staff spacings; it starts two
    spacings above the system so the red bracket has room above the staff."""
    barlines, spacing = system["barlines"], system["spacing"]
    k = measure - system["measures"][0]
    if not 0 <= k < len(barlines) - 1:
        raise ValueError("That bar is not inside the mapped system.")
    width, height = page_size
    pad = 2 * spacing
    x0 = max(0, barlines[max(0, k - 1)] - pad)
    x1 = min(width, barlines[min(len(barlines) - 1, k + 2)] + pad)
    y0 = max(0, system["y0"] - 2 * spacing)
    y1 = min(height, system["y1"])
    return int(x0), int(y0), int(x1), int(y1), int(barlines[k] - x0), int(barlines[k + 1] - x0)


def make_crop(library, slug, layout, system, measure, out_path, circle=None):
    """Write the bracketed scan crop of the target bar to out_path.

    circle: his circle on the scan ({cx, cy, r} in the system's review crop px), drawn in red too
    so the check looks at what he circled (#9764)."""
    file = system.get("page")
    page = next((p for p in layout.get("pages", []) if p.get("file") == file), {})
    path = Path(library) / "pages" / slug / str(file)
    if not path.is_file():
        raise QueueError(2, "The scan page for that bar is missing.")
    rgb = Image.open(path).convert("RGB")
    angle = page.get("angle") or 0
    if angle:
        rgb = rgb.rotate(angle, resample=Image.BILINEAR, fillcolor=(255, 255, 255))
    x0, y0, x1, y1, tx0, tx1 = crop_box(system, measure, rgb.size)
    crop = rgb.crop((x0, y0, x1, y1))
    y = min(int(1.5 * system["spacing"]), crop.height - 1)
    ImageDraw.Draw(crop).rectangle(
        [tx0, y - BRACKET_THICK // 2, tx1, y + BRACKET_THICK // 2 - 1], fill=BRACKET_COLOR)
    if circle:
        scale = layout.get("crop_scale") or 1
        cx, cy = circle["cx"] / scale - x0, system["y0"] + circle["cy"] / scale - y0
        r = circle["r"] / scale
        ImageDraw.Draw(crop).ellipse([cx - r, cy - r, cx + r, cy + r], outline=BRACKET_COLOR, width=BRACKET_THICK)
    if crop.width > MAX_CROP_WIDTH:
        crop = crop.resize((MAX_CROP_WIDTH, max(1, round(crop.height * MAX_CROP_WIDTH / crop.width))),
                           Image.LANCZOS)
    crop.save(out_path, "PNG")


# ---- model ---------------------------------------------------------------------------------

def call_claude(prompt, image_path, model, timeout):
    """Run the claude CLI on the prompt with the crop readable as crop.png. Returns (text, usd)."""
    exe = shutil.which("claude") or shutil.which("claude.cmd")
    if not exe:
        raise RuntimeError("The claude program wasn't found.")
    env = {k: v for k, v in os.environ.items() if k != "ANTHROPIC_API_KEY"}
    cmd = [exe, "-p", "--model", model, "--output-format", "json", "--tools", "Read",
           "--allowedTools", "Read", "--setting-sources", "", "--strict-mcp-config",
           "--disable-slash-commands", "--no-session-persistence", "--system-prompt", SYSTEM_PROMPT]
    with tempfile.TemporaryDirectory() as work:
        shutil.copyfile(image_path, Path(work) / "crop.png")
        try:
            done = subprocess.run(cmd, input=prompt, text=True, encoding="utf-8", errors="replace",
                                  capture_output=True, timeout=timeout, cwd=work, env=env,
                                  creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        except subprocess.TimeoutExpired:
            raise RuntimeError("The checker took too long.")
        except OSError as error:
            raise RuntimeError(f"The checker couldn't start ({error}).")
    if done.returncode != 0:
        raise RuntimeError("The checker failed: " + (done.stderr or "").strip()[:200])
    try:
        data = json.loads(done.stdout)
    except ValueError:
        raise RuntimeError("The checker's output wasn't readable.")
    if not isinstance(data, dict) or data.get("is_error"):
        raise RuntimeError("The checker reported an error.")
    return str(data.get("result") or ""), float(data.get("total_cost_usd") or 0)


def parse_answer(text):
    """First JSON object in the text (fences stripped) that carries a verdict, else None."""
    text = re.sub(r"```[A-Za-z]*", "", text or "")
    decoder = json.JSONDecoder()
    for match in re.finditer(r"\{", text):
        try:
            value, _ = decoder.raw_decode(text, match.start())
        except ValueError:
            continue
        if isinstance(value, dict) and "verdict" in value:
            return value
    return None


def _title(score):
    for tag in ("work", "movement-title"):
        node = _child(score.root, tag)
        if node is not None:
            text = _text(node, "work-title") if tag == "work" else (node.text or "").strip()
            if text:
                return text
    return None


def describe_notes(notes):
    """His circled notes as the prompt names them: "E3 (lower staff, beat 2)"."""
    words = {1: "upper staff", 2: "lower staff"}
    return ", ".join(f"{n.get('name')} ({words.get(n.get('staff'), 'staff ' + str(n.get('staff')))}, beat {n.get('beat')})"
                     for n in notes if isinstance(n, dict))


def build_prompt(score, target, listings, note, rejections, earlier, circled=None):
    """The stdin prompt for the model. circled: the notes he circled in the target bar, if any."""
    here = listings[target]
    lines = [
        "Look at crop.png in the current directory (use the Read tool). It is a scan of a piano "
        "score. The red bracket above the staves marks the bar to check; the bars on either side "
        "are context.",
        f"Piece: {_title(score) or '(untitled)'}",
        f"Time signature: {here['time']}. Key (fifths): {here['key_fifths']}.",
        "", "The transcription of those bars (replace_measure format), target bar labelled:"]
    for position in sorted(listings):
        label = "TARGET bar" if position == target else "context bar"
        lines.append(f"{label}, measure {position}: {json.dumps(listings[position])}")
    lines += ["", f"Todd's note on this mark: {note or '(none)'}"]
    if circled:
        lines.append(f"He circled these notes of the target bar: {describe_notes(circled)}. Look at those "
                     "first; the red circle on the scan (when there is one) shows where. Change other notes "
                     "of the bar only if they are also wrong.")
    if rejections:
        lines.append("He marked earlier answers still wrong, with these notes:")
        lines += [f"- {n}" for n in rejections]
    for record in earlier:
        lines.append(f"An earlier proposal he rejected: {record.get('explanation') or '(no explanation)'}"
                     f" Edits: {json.dumps(record.get('edits') or [])}")
    lines += [
        "", OPS_TEXT, "", "Rules:",
        f"- Change only measure position {target}; use exactly {target} as the measure in every edit.",
        "- Prefer the smallest edit (transpose_note or delete_note) over replace_measure.",
        "- With replace_measure, give every staff and voice of the bar.",
        "- If the bar already matches the scan, say so (verdict \"correct\", no edits).",
        "", "Answer with ONLY a JSON object, no other text:",
        '{"verdict": "fix" | "correct" | "unsure", "explanation": "<one or two plain sentences '
        'for a pianist>", "edits": [...]}']
    return "\n".join(lines)


# ---- validation ----------------------------------------------------------------------------

def _same_bar(value, target):
    try:
        return int(value) == target and not isinstance(value, bool)
    except (TypeError, ValueError):
        return False


def _bar_flags(path, target):
    """Lint flags on the bar and the bar either side (a broken tie shows up next door)."""
    return [f for f in omr_audit.lint_piece(path)["flags"]
            if not f.get("raw_only") and abs(f.get("measure", 0) - target) <= 1]


def validate(score_path, edits, target):
    """Check edits against the score. Returns (new_bytes, log_lines, flags_before, flags_after)."""
    if not isinstance(edits, list) or not edits:
        raise ValueError("The checker gave no edits.")
    for edit in edits:
        op = edit.get("op") if isinstance(edit, dict) else None
        if op in STRUCTURAL_OPS:
            raise ValueError("It needs a bigger change than one bar; fix it by hand.")
        if op not in ALLOWED_OPS:
            raise ValueError("The checker proposed an edit type that isn't allowed.")
        keys = ("measure_from", "measure_to") if op == "move_staff" else ("measure",)
        if not all(_same_bar(edit.get(k), target) for k in keys):
            raise ValueError(f"The checker proposed a change outside bar {target}.")
    score, log = Score(score_path), []
    baseline = omr_fix._serialize(score)  # re-serialised: raw bytes always differ in formatting
    score.root = omr_fix.apply_edits(score.root, edits, log.append)
    data = omr_fix._serialize(score)
    if data == baseline:
        raise ValueError("The change made no difference.")
    candidate = Path(score_path).parent / "review" / f".cand-{uuid.uuid4().hex}.musicxml"
    candidate.parent.mkdir(parents=True, exist_ok=True)
    try:
        candidate.write_bytes(data)
        after = _bar_flags(candidate, target)
    finally:
        candidate.unlink(missing_ok=True)
    before = {(f["measure"], f["staff"], f["check"]) for f in _bar_flags(score_path, target)}
    added = [f for f in after if (f["measure"], f["staff"], f["check"]) not in before]
    if added:
        raise ValueError(f"It would add a new problem in bar {added[0]['measure']}: "
                         f"{added[0]['check'].replace('_', ' ')}.")
    return data, log, [f for f in _bar_flags(score_path, target)], after


# ---- propose -------------------------------------------------------------------------------

def run_propose(library, slug, mark_id, model, timeout, caller=call_claude):
    """Returns (exit_code, payload_dict). Raises nothing for expected refusals."""
    try:
        return 0, {"ok": True, "proposal": _propose(Path(library), slug, mark_id, model, timeout, caller)}
    except QueueError as error:
        return error.code, {"ok": False, "error": error.message}


def _propose(library, slug, mark_id, model, timeout, caller):
    _check_ids(slug, mark_id, "mark")
    score_path = _score_path(library, slug)
    with queue_lock(library):
        free = available_ram_gb()
        if free is not None and free < MIN_FREE_RAM_GB:
            raise QueueError(4, "Solace is short of memory; the check will wait.")
        review = library / "review"
        events = _read_events(review / f"{slug}.events.jsonl")
        mark = next((e for e in events if e.get("kind") == "mark" and e.get("id") == mark_id), None)
        if mark is None:
            raise QueueError(2, "That mark wasn't found.")
        if any(e.get("kind") in ("withdraw", "accept") and e.get("mark") == mark_id for e in events):
            raise QueueError(2, "That mark is no longer open.")
        target = mark.get("measure")
        if type(target) is not int:
            raise QueueError(2, "That mark isn't on a bar.")
        rejects = sorted((e for e in events if e.get("kind") == "reject" and e.get("mark") == mark_id),
                         key=lambda e: e.get("ts") or 0)
        notes = [str(e["note"]) for e in rejects if e.get("note")]
        proposals = review / f"{slug}.proposals"
        proposals.mkdir(parents=True, exist_ok=True)
        earlier = []
        for path in proposals.glob("*.json"):
            try:
                record = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            # Only answers he has since called still wrong (not ones a score change made stale).
            if (isinstance(record, dict) and record.get("mark") == mark_id
                    and record.get("status") in ("ready", "no_change")
                    and rejects and (record.get("created") or 0) <= (rejects[-1].get("ts") or 0)):
                earlier.append(record)
        earlier.sort(key=lambda r: r.get("created") or 0)

        score_sha = _sha(score_path)
        try:
            layout = json.loads((review / f"{slug}.layout.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            raise QueueError(2, "The layout is out of date; open the piece again.")
        if layout.get("score_sha256") != score_sha:
            raise QueueError(2, "The layout is out of date; open the piece again.")
        system = next((s for s in layout.get("systems", []) if s.get("index") == mark.get("system")), None)
        span = system.get("measures") if system else None
        if not span or not span[0] <= target <= span[1] or not system.get("barlines"):
            raise QueueError(2, "That bar isn't mapped to the scan yet.")
        try:
            score = Score(score_path)
            count = len(_part_measures(score))
            if not 1 <= target <= count:
                raise QueueError(2, "That bar isn't in the score.")
            listings = {p: measure_listing(score, p)
                        for p in range(max(1, target - 1), min(count, target + 1) + 1)}
        except (ValueError, IndexError) as error:
            raise QueueError(2, f"The score couldn't be read ({error}).")

        pid = uuid.uuid4().hex
        crop = proposals / f"{pid}.png"
        try:
            circle = mark.get("circle")
            make_crop(library, slug, layout, system, target, crop,
                      circle if isinstance(circle, dict) and circle.get("side") == "scan" else None)
        except (OSError, ValueError, KeyError, TypeError) as error:  # a malformed circle in the log too
            raise QueueError(2, f"The scan couldn't be cropped ({error}).")
        record = {"id": pid, "mark": mark_id, "slug": slug, "status": "failed", "reason": None,
                  "explanation": "", "edits": [], "measure": target, "staff": mark.get("staff"),
                  "base_sha256": score_sha, "crop": f"review/{slug}.proposals/{pid}.png",
                  "proposed": None, "flags_before": [], "flags_after": [], "model": model,
                  "usd": 0.0, "created": int(time.time() * 1000), "rejections_seen": len(rejects)}
        circled = mark.get("notes") if isinstance(mark.get("notes"), list) else None
        prompt = build_prompt(score, target, listings, mark.get("note"), notes, earlier, circled)
        try:
            text, usd = caller(prompt, crop, model, timeout)
            record["usd"] = float(usd or 0)
            answer = parse_answer(text)
            verdict = answer.get("verdict") if answer else None
            if verdict not in ("fix", "correct", "unsure"):
                record["reason"] = "The checker's answer wasn't usable."
            else:
                record["explanation"] = str(answer.get("explanation") or "")
                edits = answer.get("edits")
                if verdict != "fix":
                    record["status"] = "no_change"
                else:
                    record["edits"] = edits if isinstance(edits, list) else []
                    try:
                        data, _, before, after = validate(score_path, record["edits"], target)
                    except ValueError as error:
                        record["reason"] = str(error)
                    else:
                        (proposals / f"{pid}.musicxml").write_bytes(data)
                        record.update(status="ready", flags_before=before, flags_after=after,
                                      proposed=f"review/{slug}.proposals/{pid}.musicxml")
        except RuntimeError as error:
            record["reason"] = str(error)
        _write_json(proposals / f"{pid}.json", record)
        return record


# ---- apply ---------------------------------------------------------------------------------

def run_apply(library, slug, pid):
    """Returns (exit_code, payload_dict)."""
    try:
        return 0, _apply(Path(library), slug, pid)
    except QueueError as error:
        return error.code, {"ok": False, "error": error.message}


def _apply(library, slug, pid):
    _check_ids(slug, pid, "proposal")
    score_path = _score_path(library, slug)
    with queue_lock(library, ".apply.lock"):
        proposals = library / "review" / f"{slug}.proposals"
        try:
            record = json.loads((proposals / f"{pid}.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            raise QueueError(2, "That proposal wasn't found.")
        if not isinstance(record, dict) or record.get("status") != "ready":
            raise QueueError(5, "That proposal can't be applied.")
        before = _sha(score_path)
        if before != record.get("base_sha256"):
            raise QueueError(5, "The score changed since this was checked.")
        edits_file = proposals / f".apply-{uuid.uuid4().hex}.json"
        out, err = io.StringIO(), io.StringIO()
        try:
            edits_file.write_text(json.dumps({"edits": record.get("edits")}), encoding="utf-8")
            with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                code = omr_fix.main([str(score_path), str(edits_file)])
        finally:
            edits_file.unlink(missing_ok=True)
        if code != 0:
            raise QueueError(2, err.getvalue().strip() or "The edits couldn't be applied.")
        after = _sha(score_path)
        lines = [line for line in out.getvalue().splitlines() if line.strip()]
        stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        entry = (f"{stamp} accept proposal={pid} mark={record.get('mark')} bar={record.get('measure')} "
                 f"{before[:12]} -> {after[:12]}\n" + "".join(f"  {line}\n" for line in lines))
        with open(library / "review" / f"{slug}.log", "a", encoding="utf-8") as log:
            log.write(entry)
        return {"ok": True, "before": before, "after": after, "proposal": pid,
                "mark": record.get("mark"), "log": lines}


# ---- command line --------------------------------------------------------------------------

def _parser():
    parser = _Parser(description=__doc__.split("\n")[0])
    sub = parser.add_subparsers(dest="command", required=True, parser_class=_Parser)
    propose = sub.add_parser("propose")
    propose.add_argument("--library", type=Path, default=DEFAULT_LIBRARY)
    propose.add_argument("--model", default="claude-sonnet-5-5")
    propose.add_argument("--timeout", type=int, default=300)
    propose.add_argument("slug")
    propose.add_argument("mark_id")
    apply = sub.add_parser("apply")
    apply.add_argument("--library", type=Path, default=DEFAULT_LIBRARY)
    apply.add_argument("slug")
    apply.add_argument("proposal_id")
    return parser


def main(argv=None):
    try:
        args = _parser().parse_args(argv)
        if args.command == "propose":
            code, payload = run_propose(args.library, args.slug, args.mark_id, args.model, args.timeout)
        else:
            code, payload = run_apply(args.library, args.slug, args.proposal_id)
    except QueueError as error:
        code, payload = error.code, {"ok": False, "error": error.message}
    except Exception as error:  # the app parses the last line, so never leave without one
        code, payload = 2, {"ok": False, "error": f"Unexpected problem: {error}"}
    print(json.dumps(payload, ensure_ascii=True), flush=True)
    return code


if __name__ == "__main__":
    sys.exit(main())
