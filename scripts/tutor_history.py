"""tutor_history.py - permanent history of the MidiTutor practice logs (#5853).

The MidiTutor app on the Mac "Pinocchio" appends one JSON object per line to
~/Library/Application Support/MidiTutor/logs/YYYY-MM-DD.jsonl.  This script
keeps a permanent copy of those day logs on Solace and builds a per-session
summary from them.  It holds practice data only (notes, bars, laps, help
settings); nothing else is read from the Mac.

MAC READ-ONLY RULE: on the Mac the only commands ever run over ssh are
cd, ls, wc, tail, cat and printf.  Never python3, git, cc or osascript:
those pop dialogs on his screen.  Remote file names are validated against a
strict regex before they are used in a remote command.

Paths (root = env MIDITUTOR_HISTORY_DIR, else <pantheon_root>/data/tutor_history, where
pantheon_root comes from env PANTHEON_ROOT or scripts/local_config.json):
  <root>/logs/YYYY-MM-DD.jsonl       mirror of the Mac day logs
  <root>/sessions/YYYY-MM-DD.json    per-day session summaries
  <root>/sessions.jsonl              all sessions, newest first, one per line
  <root>/pull.log                    one "ISO-time  message" line per event

Host: env PINOCCHIO_HOST, else a PINOCCHIO_HOST=... line in scripts/local.env
next to this file, else "pinocchio_host" in scripts/local_config.json.

Run:
  python tutor_history.py pull
  python tutor_history.py summarize [--all | --day YYYY-MM-DD]
  python tutor_history.py show [--days N] [--piece P]
  python tutor_history.py teacher [--since YYYY-MM-DD] [--no-pull]
"""

import argparse
import json
import math
import os
import re
import statistics
import subprocess
import sys
import time
from collections import Counter
from datetime import date, datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import localcfg  # noqa: E402  machine paths and hosts, gitignored

GAP_MS = 600_000
WIN_SSH = r"C:\Windows\System32\OpenSSH\ssh.exe"
REMOTE_CD = 'cd "$HOME/Library/Application Support/MidiTutor/logs"'
REMOTE_NAME_RE = re.compile(r"^\d{4}-\d{2}-\d{2}\.jsonl$")
DAY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
WC_LINE_RE = re.compile(r"^\s*(\d+)\s+(\S+)\s*$")
HINT_FIELDS = ("keys", "names", "mini", "bare", "trainingWheels", "showKeyboard")
# ScoreFollower results that credit the note he played (a chord's first notes are "partial").
RIGHT = ("advance", "partial", "loop", "complete")


# ---------------------------------------------------------------- paths / log

def history_root():
    """The history folder; machine paths stay out of the repo (scripts/local_config.json)."""
    if os.environ.get("MIDITUTOR_HISTORY_DIR"):
        return os.environ["MIDITUTOR_HISTORY_DIR"]
    pantheon = localcfg.get("pantheon_root", "PANTHEON_ROOT")
    if not pantheon:
        raise SystemExit("set MIDITUTOR_HISTORY_DIR, or pantheon_root in scripts/local_config.json")
    return os.path.join(pantheon, "data", "tutor_history")


def _now_iso():
    return datetime.now().astimezone().isoformat(timespec="seconds")


def _log(root, msg):
    """Append 'ISO-time  message' to pull.log; never raises."""
    try:
        os.makedirs(root, exist_ok=True)
        with open(os.path.join(root, "pull.log"), "a", encoding="utf-8") as f:
            f.write(f"{_now_iso()}  {msg}\n")
    except OSError:
        pass


def _atomic_write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = f"{path}.{os.getpid()}.tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)
    os.replace(tmp, path)


def _listdir(path):
    try:
        return sorted(os.listdir(path))
    except OSError:
        return []


def get_host():
    host = os.environ.get("PINOCCHIO_HOST")
    if host and host.strip():
        return host.strip()
    env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "local.env")
    try:
        with open(env_path, "r", encoding="utf-8", errors="replace") as f:
            text = f.read()
    except OSError:
        return localcfg.get("pinocchio_host")
    for line in text.splitlines():
        line = line.strip()
        if line.startswith("PINOCCHIO_HOST="):
            value = line.split("=", 1)[1].strip().strip("'\"").strip()
            return value or None
    return localcfg.get("pinocchio_host")


# ------------------------------------------------------------------- pulling

class SshError(Exception):
    pass


def _ssh_exe():
    return WIN_SSH if os.path.exists(WIN_SSH) else "ssh"


def _ssh(host, remote_cmd, connect_timeout, timeout):
    """Run one remote command; return stdout bytes or raise SshError."""
    cmd = [_ssh_exe(), "-o", "BatchMode=yes",
           "-o", f"ConnectTimeout={int(connect_timeout)}", host, remote_cmd]
    try:
        r = subprocess.run(
            cmd, stdin=subprocess.DEVNULL, capture_output=True,
            timeout=max(1.0, timeout),
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    except subprocess.TimeoutExpired:
        raise SshError(f"timeout after {timeout:.0f}s")
    except OSError as e:
        raise SshError(str(e))
    if r.returncode != 0:
        err = r.stderr.decode("utf-8", errors="replace").strip().replace("\n", " ")
        raise SshError(f"exit {r.returncode}: {err[:200]}")
    return r.stdout


def parse_wc(text):
    """Parse 'wc -c' output into {name: size}, valid day-log names only."""
    sizes = {}
    for line in text.splitlines():
        m = WC_LINE_RE.match(line)
        if m and REMOTE_NAME_RE.match(m.group(2)):
            sizes[m.group(2)] = int(m.group(1))
    return sizes


def _local_size(path):
    try:
        return os.path.getsize(path)
    except OSError:
        return 0


def whole_lines(data):
    """Keep only up to and including the last newline."""
    idx = data.rfind(b"\n")
    return data[:idx + 1] if idx >= 0 else b""


def _append_bytes(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "ab") as f:
        f.write(data)


def _pull(root, host, connect_timeout, total_timeout, pulled):
    start = time.monotonic()
    cmd = f"{REMOTE_CD} && wc -c 20[0-9][0-9]-[0-1][0-9]-[0-3][0-9].jsonl"
    out = _ssh(host, cmd, connect_timeout, total_timeout)
    sizes = parse_wc(out.decode("utf-8", errors="replace"))
    for name in sorted(sizes):
        day = name[:-len(".jsonl")]
        path = os.path.join(root, "logs", name)
        remote, local = sizes[name], _local_size(path)
        if remote < local:
            _log(root, f"remote shrank: {name} remote={remote} local={local}")
            continue
        if remote == local:
            continue
        elapsed = time.monotonic() - start
        if elapsed >= total_timeout:
            _log(root, f"total timeout reached after {elapsed:.0f}s; stopping fetches")
            return
        cmd = f"{REMOTE_CD} && tail -c +{local + 1} {name}"
        data = whole_lines(_ssh(host, cmd, connect_timeout, total_timeout - elapsed))
        if data:
            _append_bytes(path, data)
            pulled[day] = len(data)
    if not pulled:
        _log(root, "nothing new")


def pull(root, host, connect_timeout=8, total_timeout=60):
    """Mirror new bytes of the Mac day logs. Returns {day: bytes_added}; never raises."""
    pulled = {}
    try:
        if not host or host.startswith("-"):
            _log(root, "no host")
            return pulled
        _pull(root, host, connect_timeout, total_timeout, pulled)
        if pulled:
            _log(root, "pulled " + " ".join(f"{d}=+{n}" for d, n in sorted(pulled.items())))
    except SshError as e:
        _log(root, f"unreachable: {e}")
    except Exception as e:  # never raise out of a scheduled pull
        _log(root, f"pull failed: {e!r}")
    return pulled


# --------------------------------------------------------------- summarizing

def _ts(ev):
    v = ev.get("timestamp")
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    return v if math.isfinite(v) else None


def _iso(ms):
    if ms is None:
        return None
    try:
        return datetime.fromtimestamp(ms / 1000).astimezone().isoformat(timespec="seconds")
    except (OverflowError, OSError, ValueError):
        return None


def _int(v):
    return v if isinstance(v, int) and not isinstance(v, bool) else None


def _widen(d, bar):
    cur = d["bars"]
    d["bars"] = [bar, bar] if cur is None else [min(cur[0], bar), max(cur[1], bar)]


def _new_session():
    return {
        "first": None, "last": None, "vels": [], "notes": 0,
        "follow": Counter(),
        "wrong_bars": Counter(), "pieces": {}, "stretches": [], "stretch": None,
        "help": set(), "bare": [], "devices": [],
        "expr": {"ok": 0, "not_ok": 0, "unknown": 0}, "seq": 0,
    }


def _merge_bars(bars):
    out = []
    for b in sorted(bars):
        if out and b <= out[-1][1] + 1:
            out[-1][1] = max(out[-1][1], b)
        else:
            out.append([b, b])
    return out


_NAME_RE = re.compile(r"^([A-Ga-g])([#b]*)(-?\d+)$")
_PC = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def _midi(name):
    """'Bb3' -> 58, 'C#5' -> 73, a MIDI int stays itself; None if unreadable."""
    if isinstance(name, int) and not isinstance(name, bool):
        return name
    m = _NAME_RE.match(name) if isinstance(name, str) else None
    if not m:
        return None
    acc = m.group(2).count("#") - m.group(2).count("b")
    return 12 * (int(m.group(3)) + 1) + _PC[m.group(1).upper()] + acc


def _slow_bars(gaps):
    """Bars where a step took over twice his usual time for this piece (the app's
    hesitation rule: >= 8 gaps, gaps over 10 s are breaks, not hesitations)."""
    usable = [g for g, _ in gaps if g <= 10_000]
    if len(usable) < 8:
        return []
    limit = 2 * statistics.median(usable)
    slow = Counter(bar for g, bar in gaps if limit < g <= 10_000)
    return [[b, c] for b, c in sorted(slow.items(), key=lambda kv: (-kv[1], kv[0]))[:10]]


def _finish_piece(p):
    top = sorted(p["wrong_bars"].items(), key=lambda kv: (-kv[1], kv[0]))[:10]
    return {"piece": p["piece"], "notes": p["notes"], "bars": p["bars"],
            "wrong": p["wrong"], "laps": p["laps"], "clean_laps": p["clean_laps"],
            "spoiled_laps": p["spoiled_laps"], "loops": p["loops"],
            "wrong_bars": [[b, c] for b, c in top],
            # per missed bar: [bar, re-struck the note before, a key next door, any other key]
            "wrong_how": [[b, *(p["how"][b][k] for k in ("restrike", "near", "other"))] for b, _ in top],
            "slow_bars": _slow_bars(p["gaps"])}


def _finish_stretch(st):
    out = {"from": _iso(st["from"]), "to": _iso(st["to"]), "piece": st["piece"],
           "known": st["known"]}
    out.update(st["hints"])
    out["notes"] = st["notes"]
    out["bars"] = st["bars"]
    return out


def _velocity(vels):
    if not vels:
        return {"min": None, "median": None, "max": None}
    return {"min": int(min(vels)), "median": round(statistics.median(vels)),
            "max": int(max(vels))}


def _finish(s):
    minutes = round((s["last"] - s["first"]) / 60000, 1)
    right = sum(s["follow"][r] for r in RIGHT)
    wrong_n = s["follow"]["wrong"]
    wrong = sorted(s["wrong_bars"].items(), key=lambda kv: (-kv[1], kv[0]))[:10]
    pieces = sorted(s["pieces"].values(),
                    key=lambda p: (p["n"] is None, p["n"] or 0))
    return {
        "start": _iso(s["first"]), "end": _iso(s["last"]), "minutes": minutes,
        "notes": s["notes"], "velocity": _velocity(s["vels"]),
        "pace_notes_per_min": round(s["notes"] / max(minutes, 0.1), 1),
        "follow": dict(sorted(s["follow"].items())),
        "right": right, "wrong": wrong_n,
        "accuracy": round(right / (right + wrong_n), 3) if right + wrong_n else None,
        "wrong_bars": [[b, c] for b, c in wrong],
        "pieces": [_finish_piece(p) for p in pieces],
        "hints": [_finish_stretch(st) for st in s["stretches"] if st["notes"] > 0],
        "help_off_bars": _merge_bars(s["help"]),
        "bare_runs": s["bare"], "devices": s["devices"], "expression": s["expr"],
    }


class _Day:
    """Walks one day's events, carrying piece/hints/loop state across sessions."""

    def __init__(self):
        self.piece = None
        self.known = False
        self.hints = {f: "unknown" for f in HINT_FIELDS}
        self.loop = None
        self.his_note = False  # was the last noteon his (hardware)? follow events trail it
        self.sessions = []
        self.cur = None
        self.pending = []
        self.handlers = {
            "piece": self._on_piece, "hints": self._on_hints, "loop": self._on_loop,
            "follow": self._on_follow, "lap": self._on_lap,
            "lap-spoiled": self._on_spoiled, "celebrate": self._on_celebrate,
            "bare-done": self._on_bare, "device": self._on_device,
            "expression": self._on_expression,
        }

    # -- session boundaries
    def close(self):
        if self.cur is not None:
            self.sessions.append(_finish(self.cur))
            self.cur = None

    def _gap_check(self, ts):
        if ts is not None and self.cur is not None and ts - self.cur["last"] > GAP_MS:
            self.close()

    def _open(self):
        self.cur = _new_session()
        pending, self.pending = self.pending, []
        for ev in pending:
            self._apply(ev)

    # -- feeding
    def feed(self, ev):
        ts = _ts(ev)
        if ev.get("kind") == "noteon":
            self._on_noteon(ev, ts)
            return
        self._gap_check(ts)
        if self.cur is None:
            self.pending.append(ev)
        else:
            self._apply(ev)

    def _apply(self, ev):
        handler = self.handlers.get(ev.get("kind"))
        if handler:
            handler(ev, _ts(ev))

    # -- per-session helpers
    def _piece_entry(self):
        pieces = self.cur["pieces"]
        if self.piece not in pieces:
            pieces[self.piece] = {
                "piece": self.piece, "notes": 0, "bars": None, "wrong": 0, "laps": 0,
                "clean_laps": 0, "spoiled_laps": 0, "loops": [], "n": None,
                "wrong_bars": Counter(), "how": {}, "exp": {}, "gaps": [],
                "last_right": None}
        return pieces[self.piece]

    def _stretch(self):
        s = self.cur
        key = (self.piece, self.known, tuple(self.hints[f] for f in HINT_FIELDS))
        st = s["stretch"]
        if st is None or st["key"] != key:
            st = {"key": key, "piece": self.piece, "known": self.known,
                  "hints": dict(self.hints), "from": None, "to": None,
                  "notes": 0, "bars": None}
            s["stretch"] = st
            s["stretches"].append(st)
        return st

    def _help_off(self):
        return self.known and (self.hints["keys"] == "none"
                               or self.hints["bare"] is True)

    # -- handlers
    def _on_noteon(self, ev, ts):
        self.his_note = ev.get("source") == "hardware" and ts is not None
        if not self.his_note:
            return
        self._gap_check(ts)
        if self.cur is None:
            self._open()
        s = self.cur
        if s["first"] is None:
            s["first"] = ts
        s["last"] = ts
        s["notes"] += 1
        vel = ev.get("velocity")
        if isinstance(vel, (int, float)) and not isinstance(vel, bool) and math.isfinite(vel):
            s["vels"].append(vel)
        pe = self._piece_entry()
        pe["notes"] += 1
        if pe["n"] is None:
            s["seq"] += 1
            pe["n"] = s["seq"]
        st = self._stretch()
        st["notes"] += 1
        if st["from"] is None:
            st["from"] = ts
        st["to"] = ts

    def _on_piece(self, ev, ts):
        self.piece = ev.get("piece")

    def _on_hints(self, ev, ts):
        self.hints = {f: ev.get(f) for f in HINT_FIELDS}
        self.known = True

    def _on_loop(self, ev, ts):
        if ev.get("cleared") is True:
            self.loop = None
            return
        fb, lb = _int(ev.get("firstBar")), _int(ev.get("lastBar"))
        if fb is not None and lb is not None:
            self.loop = (fb, lb)

    def _on_follow(self, ev, ts):
        if not self.his_note:  # judged an injected (test) note, not his
            return
        s = self.cur
        result = ev.get("result")
        key = result if isinstance(result, str) and result else "other"
        s["follow"][key] += 1
        pe = self._piece_entry()
        st = self._stretch()
        bar = _int(ev.get("bar"))
        step = _int(ev.get("step"))
        if step is not None and isinstance(ev.get("expected"), list):
            pe["exp"][step] = {m for m in map(_midi, ev["expected"]) if m is not None}
        if key in RIGHT and step is not None and bar is not None and ts is not None:
            last = pe["last_right"]
            if last is not None and step == last[0] + 1:
                pe["gaps"].append((ts - last[1], bar))
            pe["last_right"] = (step, ts)
        if key == "wrong":
            pe["wrong"] += 1
            if bar is not None:
                s["wrong_bars"][bar] += 1
                pe["wrong_bars"][bar] += 1
                note, here = _midi(ev.get("note")), pe["exp"].get(step, set())
                before = pe["exp"].get(step - 1, set()) if step is not None else set()
                how = pe["how"].setdefault(bar, Counter())
                if note is not None and note in before and note not in here:
                    how["restrike"] += 1
                elif note is not None and here and min(abs(note - e) for e in here) <= 2:
                    how["near"] += 1
                else:
                    how["other"] += 1
        if bar is not None:
            _widen(pe, bar)
            _widen(st, bar)
            if self._help_off():
                s["help"].add(bar)

    def _on_lap(self, ev, ts):
        fb, lb = _int(ev.get("firstBar")), _int(ev.get("lastBar"))
        if fb is not None and lb is not None:
            self.loop = (fb, lb)
        pe = self._piece_entry()
        pe["laps"] += 1
        if self.loop is not None:
            for entry in pe["loops"]:
                if (entry["firstBar"], entry["lastBar"]) == self.loop:
                    break
            else:
                entry = {"firstBar": self.loop[0], "lastBar": self.loop[1], "laps": 0}
                pe["loops"].append(entry)
            entry["laps"] += 1

    def _on_spoiled(self, ev, ts):
        if ev.get("first") is True:
            self._piece_entry()["spoiled_laps"] += 1

    def _on_celebrate(self, ev, ts):
        if ev.get("what") == "lap":
            self._piece_entry()["clean_laps"] += 1

    def _on_bare(self, ev, ts):
        self.cur["bare"].append({k: ev.get(k) for k in
                                 ("label", "cleared", "misses", "early", "ms")})

    def _on_device(self, ev, ts):
        self.cur["devices"].append({"at": _iso(ts), "connected": ev.get("connected"),
                                    "name": ev.get("name")})

    def _on_expression(self, ev, ts):
        ok = ev.get("ok")
        key = "ok" if ok is True else "not_ok" if ok is False else "unknown"
        self.cur["expr"][key] += 1


def summarize_day(lines):
    """Pure: summarize one day's JSONL lines into sessions. No I/O."""
    day = _Day()
    bad = 0
    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            ev = json.loads(line)
        except ValueError:
            bad += 1
            continue
        if not isinstance(ev, dict):
            bad += 1
            continue
        day.feed(ev)
    day.close()
    return {"sessions": day.sessions, "bad_lines": bad}


# ------------------------------------------------------------ summary files

def _read_log_lines(path):
    with open(path, "rb") as f:
        text = f.read().decode("utf-8", errors="replace")
    return text.split("\n")


def _mirrored_days(root):
    days = []
    for name in _listdir(os.path.join(root, "logs")):
        if REMOTE_NAME_RE.match(name):
            days.append(name[:-len(".jsonl")])
    return days


def _read_session_files(root):
    """Return [(day, summary dict)] for every sessions/*.json, oldest day first."""
    out = []
    for name in _listdir(os.path.join(root, "sessions")):
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}\.json", name):
            continue
        try:
            with open(os.path.join(root, "sessions", name), "r", encoding="utf-8") as f:
                data = json.load(f)
        except (OSError, ValueError):
            continue
        if isinstance(data, dict):
            out.append((name[:-len(".json")], data))
    return out


def _rebuild_aggregate(root):
    rows = []
    for day, data in sorted(_read_session_files(root), key=lambda x: x[0], reverse=True):
        sessions = [s for s in data.get("sessions", []) if isinstance(s, dict)]
        for s in reversed(sessions):
            rows.append(json.dumps({"day": day, **s}, ensure_ascii=True))
    _atomic_write(os.path.join(root, "sessions.jsonl"),
                  "".join(r + "\n" for r in rows))


def summarize_days(root, days=None):
    """Write sessions/<day>.json for the given days (None = all mirrored), then
    rebuild sessions.jsonl. Returns the list of days written."""
    if days is None:
        days = _mirrored_days(root)
    done = []
    for day in sorted(set(days)):
        if not DAY_RE.match(day):
            continue
        path = os.path.join(root, "logs", day + ".jsonl")
        try:
            lines = _read_log_lines(path)
        except OSError:
            continue
        summary = {"day": day, **summarize_day(lines)}
        _atomic_write(os.path.join(root, "sessions", day + ".json"),
                      json.dumps(summary, ensure_ascii=True))
        done.append(day)
    _rebuild_aggregate(root)
    return done


# --------------------------------------------------------------------- query

def _last_pull(root):
    try:
        with open(os.path.join(root, "pull.log"), "rb") as f:
            f.seek(0, os.SEEK_END)
            f.seek(max(0, f.tell() - 4096))
            tail = f.read().decode("utf-8", errors="replace")
    except OSError:
        return None
    lines = [ln for ln in tail.splitlines() if ln.strip()]
    return lines[-1] if lines else None


def _matches_piece(session, piece):
    needle = piece.lower()
    for p in session.get("pieces", []):
        name = p.get("piece") if isinstance(p, dict) else None
        if isinstance(name, str) and needle in name.lower():
            return True
    return False


def _day_totals(sessions):
    totals = {}
    for s in sessions:
        t = totals.setdefault(s["day"], {"day": s["day"], "sessions": 0,
                                         "minutes": 0.0, "notes": 0, "wrong": 0})
        t["sessions"] += 1
        t["minutes"] = round(t["minutes"] + (s.get("minutes") or 0), 1)
        t["notes"] += s.get("notes") or 0
        t["wrong"] += s.get("wrong") or 0
    return sorted(totals.values(), key=lambda t: t["day"], reverse=True)


def history(root, days=7, piece=None):
    """Recent sessions (newest first), per-day totals and mirror status."""
    today = date.today()
    cutoff = today - timedelta(days=max(1, days) - 1)
    sessions = []
    for day, data in _read_session_files(root):
        try:
            d = date.fromisoformat(day)
        except ValueError:
            continue
        if not cutoff <= d <= today:
            continue
        for s in data.get("sessions", []):
            if not isinstance(s, dict):
                continue
            if piece and not _matches_piece(s, piece):
                continue
            sessions.append({"day": day, **s})
    sessions.sort(key=lambda s: (s["day"], s.get("start") or ""), reverse=True)
    return {
        "sessions": sessions,
        "days": _day_totals(sessions),
        "mirror": {"last_pull": _last_pull(root),
                   "days_mirrored": len(_mirrored_days(root))},
    }


# ------------------------------------------------------ teacher summary (#5517)
# A plain-words roll-up since his last lesson for Todd to read and forward to JP
# himself. Nothing here sends anything anywhere.

LIBRARY = localcfg.get("library", "MIDITUTOR_LIBRARY", os.path.expanduser("~/piano/library"))
TREND_SESSIONS, TREND_DAYS = 4, 3  # fewer than this is a snapshot, not a trend


def valid_day(text):
    """A real calendar day 'YYYY-MM-DD' (not just its shape), else None."""
    if not isinstance(text, str) or not DAY_RE.match(text):
        return None
    try:
        return date.fromisoformat(text)
    except ValueError:
        return None


def last_lesson_date(library):
    best = None
    try:
        with open(os.path.join(library, "lesson-notebook.jsonl"), encoding="utf-8") as f:
            for line in f:
                try:
                    d = json.loads(line).get("date")
                except (ValueError, AttributeError):
                    continue
                if valid_day(d) and (best is None or d > best):
                    best = d
    except OSError:
        pass
    return best


def _title_key(name):
    """'Love Dance (from KA)' and 'love dance' match; so do a slug and its title."""
    name = re.sub(r"\s*\([^)]*\)\s*$", "", name or "")
    return re.sub(r"[^a-z0-9]+", "", name.lower())


def bar_places(library):
    """{title key: {bar: (page, line on page, nth bar in line)}} from exact Review layouts."""
    import xml.etree.ElementTree as ET
    out = {}
    rdir = os.path.join(library, "review")
    for n in sorted(_listdir(rdir)):
        if not n.endswith(".layout.json"):
            continue
        try:
            with open(os.path.join(rdir, n), encoding="utf-8") as f:
                lay = json.load(f)
            if lay.get("match") != "exact":
                continue
            per_page, places = {}, {}
            for sy in lay["systems"]:
                page = int(re.sub(r"\D", "", str(sy["page"])))
                per_page[page] = per_page.get(page, 0) + 1
                a, b = sy["measures"]
                for bar in range(a, b + 1):
                    places[bar] = (page, per_page[page], bar - a + 1)
        except (OSError, ValueError, KeyError, TypeError, AttributeError):
            continue
        keys = {_title_key(n[:-len(".layout.json")])}
        try:  # the title is a bonus key; an unreadable score still leaves the file-name map
            root = ET.parse(os.path.join(library, lay["score"])).getroot()
            for tag in ("work/work-title", "movement-title"):
                el = root.find(tag)
                if el is not None and el.text and el.text.strip():
                    keys.add(_title_key(el.text.strip()))
        except (OSError, KeyError, TypeError, ET.ParseError):
            pass
        for k in keys:
            out.setdefault(k, {}).update(places)
    return out


def ordinal(n):
    if 10 <= n % 100 <= 20:
        return f"{n}th"
    return f"{n}" + {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")


def _md(d):
    return f"{d.strftime('%b')} {d.day}"


def _where(bar, places):
    if bar in places:
        pg, ln, nth = places[bar]
        return f"page {pg}, line {ln}, {ordinal(nth)} bar"
    return f"bar {bar} as the app counts (no page map for this piece yet)"


def _how_words(restrike, near, other):
    parts = []
    if restrike:
        parts.append(f"{restrike} replayed the note before")
    if near:
        parts.append(f"{near} hit a key next door")
    if other:
        parts.append(f"{other} other wrong notes")
    return ", ".join(parts)


def _plural(n, word):
    return f"{n} {word}" + ("" if n == 1 else "s")


def _teacher_pieces(sessions):
    pieces = {}
    for x in sessions:
        for p in x.get("pieces", []):
            if not p.get("piece") or not p.get("notes"):
                continue
            d = pieces.setdefault(p["piece"], {"notes": 0, "laps": 0, "clean": 0, "loops": Counter(),
                                               "wrong": Counter(), "how": {}, "slow": Counter(),
                                               "by_day": {}})
            d["notes"] += p["notes"]
            d["laps"] += p.get("laps", 0)
            d["clean"] += p.get("clean_laps", 0)
            for lp in p.get("loops", []):
                d["loops"][(lp["firstBar"], lp["lastBar"])] += lp["laps"]
            for bar, n in p.get("wrong_bars", []):
                d["wrong"][bar] += n
            for bar, *kinds in p.get("wrong_how", []):
                d["how"][bar] = [a + b for a, b in zip(d["how"].get(bar, [0, 0, 0]), kinds)]
            for bar, n in p.get("slow_bars", []):
                d["slow"][bar] += n
            day = d["by_day"].setdefault(x["day"], {"wrong": Counter(), "bars": None})
            day["wrong"].update({b: n for b, n in p.get("wrong_bars", [])})
            if p.get("bars"):
                lo, hi = p["bars"]
                old = day["bars"]
                day["bars"] = [min(lo, old[0]), max(hi, old[1])] if old else [lo, hi]
    return pieces


def teacher_since(library, since=None, today=None):
    """(first day, lesson day or None): `since`, else the day after his last lesson,
    else the last 7 days."""
    today = today or date.today()
    if since:
        return since, None
    lesson = last_lesson_date(library)
    if lesson:
        return (date.fromisoformat(lesson) + timedelta(days=1)).isoformat(), lesson
    return (today - timedelta(days=6)).isoformat(), None


def teacher(root, library=LIBRARY, since=None, today=None):
    today = today or date.today()
    since, lesson = teacher_since(library, since, today)
    since_d = date.fromisoformat(since)
    after = f" (since the {_md(date.fromisoformat(lesson))} lesson)" if lesson else ""
    if since_d > today:
        return f"# Practice{after}\n\nNo practice logged since that lesson yet.\n"
    h = history(root, days=max(1, (today - since_d).days + 1))
    sessions = sorted((x for x in h["sessions"] if since <= x["day"] <= today.isoformat()),
                      key=lambda x: (x["day"], x.get("start") or ""))
    lines = [f"# Practice {_md(since_d)} – {_md(today)}{after}", ""]
    if not sessions:
        return "\n".join(lines + ["No practice logged in these days."]) + "\n"
    days = sorted({x["day"] for x in sessions})
    minutes = round(sum(x.get("minutes") or 0 for x in sessions))
    lines.append(f"Based on {_plural(len(sessions), 'session')} on {_plural(len(days), 'day')}, "
                 f"{minutes} minutes in all.")
    trend = len(sessions) >= TREND_SESSIONS and len(days) >= TREND_DAYS
    if not trend:
        lines.append("That is only a little playing, so read this as a snapshot, not a trend.")
    acc = [x["accuracy"] for x in sessions if x.get("accuracy") is not None]
    if trend and len(acc) >= 2:
        lines.append(f"Right notes: {round(acc[0] * 100)}% in the first session, "
                     f"{round(acc[-1] * 100)}% in the latest.")
    places = bar_places(library)
    for title, d in sorted(_teacher_pieces(sessions).items(), key=lambda kv: -kv[1]["notes"]):
        tbl = places.get(_title_key(title), {})
        lines += ["", f"## {title}", ""]
        if not (d["laps"] or d["loops"] or d["wrong"]):
            lines.append(f"- Played {_plural(d['notes'], 'note')}, no wrong notes logged.")
        if d["laps"]:
            lines.append(f"- {d['laps']} times through a loop, {d['clean']} of them with no wrong note.")
        if d["loops"]:
            parts = [(f"bar {a}" if a == b else f"bars {a}–{b}") + f" ({n} times)"
                     for (a, b), n in d["loops"].most_common(4)]
            lines.append("- Looped (app bar numbers): " + ", ".join(parts) + ".")
        if d["wrong"]:
            lines.append("- Missed most:")
            for bar, n in d["wrong"].most_common(4):
                how = _how_words(*d["how"].get(bar, [0, 0, 0]))
                lines.append(f"  - {_where(bar, tbl)}: {_plural(n, 'wrong note')}" + (f" ({how})" if how else ""))
        slow = [b for b, n in d["slow"].most_common(3) if n >= 3]
        if slow:
            lines.append("- Slowed down most at: " + "; ".join(_where(b, tbl) for b in slow) + ".")
        ordered = sorted(d["by_day"])
        if trend and len(ordered) >= 2:
            latest = d["by_day"][ordered[-1]]
            span = latest["bars"]
            earlier = Counter()
            for day in ordered[:-1]:
                earlier.update(d["by_day"][day]["wrong"])
            better = [b for b, n in earlier.most_common() if n >= 3 and not latest["wrong"].get(b)
                      and span and span[0] <= b <= span[1]][:3]
            if better:
                lines.append(f"- No misses on {_md(date.fromisoformat(ordered[-1]))} where he missed before: "
                             + "; ".join(_where(b, tbl) for b in better) + ".")
    return "\n".join(lines) + "\n"


# ----------------------------------------------------------------------- CLI

def _dump(obj, **kw):
    print(json.dumps(obj, ensure_ascii=True, **kw))


def _has_sessions(root):
    return any(n.endswith(".json") for n in _listdir(os.path.join(root, "sessions")))


def cmd_pull():
    root = history_root()
    pulled = {}
    summarized = []
    try:
        host = get_host()
        if host is None:
            _log(root, "no host")
        else:
            pulled = pull(root, host)
        first = not _has_sessions(root)
        if first or pulled:
            summarized = summarize_days(root, None if first else sorted(pulled))
    except Exception as e:
        _log(root, f"pull command failed: {e!r}")
    _dump({"pulled": pulled, "summarized": summarized})
    return 0


def cmd_summarize(args):
    root = history_root()
    days = None if args.all or not args.day else [args.day]
    _dump({"summarized": summarize_days(root, days)})
    return 0


def cmd_show(args):
    _dump(history(history_root(), days=args.days, piece=args.piece), indent=1)
    return 0


def teacher_report(root, since=None, do_pull=True, connect_timeout=8, total_timeout=60):
    """Pull (optional), re-summarize the days the summary covers (so days summed up
    before #5517 get their how/slow data too), then write it."""
    if do_pull:
        try:
            host = get_host()
            if host:
                pull(root, host, connect_timeout, total_timeout)
        except Exception as e:
            _log(root, f"teacher pull failed: {e!r}")
    first, _ = teacher_since(LIBRARY, since)
    summarize_days(root, [d for d in _mirrored_days(root) if d >= first])
    return teacher(root, since=since)


def cmd_teacher(args):
    print(teacher_report(history_root(), since=args.since, do_pull=not args.no_pull))
    return 0


def build_parser():
    ap = argparse.ArgumentParser(description="MidiTutor practice history (#5853)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("pull", help="pull new log bytes from the Mac, then summarize")
    sp = sub.add_parser("summarize", help="rebuild session summaries")
    group = sp.add_mutually_exclusive_group()
    group.add_argument("--all", action="store_true", help="all mirrored days (default)")
    group.add_argument("--day", help="a single day, YYYY-MM-DD")
    sh = sub.add_parser("show", help="print recent history as JSON")
    sh.add_argument("--days", type=int, default=7)
    sh.add_argument("--piece", default=None)
    te = sub.add_parser("teacher", help="plain-words practice summary since the last lesson (#5517)")
    te.add_argument("--since", default=None, help="first day, YYYY-MM-DD (default: day after the last lesson)")
    te.add_argument("--no-pull", action="store_true", help="use the mirror as it is")
    return ap


def main(argv=None):
    ap = build_parser()
    args = ap.parse_args(argv)
    if args.cmd == "pull":
        return cmd_pull()
    if args.cmd == "summarize":
        if args.day and not DAY_RE.match(args.day):
            ap.error("--day must look like YYYY-MM-DD")
        return cmd_summarize(args)
    if args.cmd == "teacher":
        if args.since and not valid_day(args.since):
            ap.error("--since must be a real day, YYYY-MM-DD")
        return cmd_teacher(args)
    return cmd_show(args)


if __name__ == "__main__":
    sys.exit(main())
