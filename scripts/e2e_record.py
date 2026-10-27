"""End-to-end take recorder sync test (#9574) against the RUNNING app.

    MIDITUTOR_HIDDEN=1 MIDITUTOR_PORT=47931 MIDITUTOR_VITE_PORT=5183 npm start  # #9926 own Vite port beside a dev copy
    MIDITUTOR_URL=http://127.0.0.1:47931 python scripts/e2e_record.py --seconds 30

Use --analyze <mp4> to check an existing recording without contacting the app.
Recordings are never deleted. Set MIDITUTOR_FFMPEG to override bundled ffmpeg.
"""
from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
import time
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from miditutor_mcp import tutor_client as tc  # noqa: E402

PIECE = ROOT / "src" / "renderer" / "assets" / "expression-test.musicxml"
NOTES = [60, 62, 64, 65, 67, 65, 64, 62, 60, 62, 64, 65, 67, 69, 71, 72,
         72, 71, 69, 67, 65, 67, 69, 71, 72, 71, 69, 67, 64, 60]
FAILS: list[str] = []
VERBOSE = "--verbose" in sys.argv


def check(cond: bool, label: str, detail: object = "") -> None:
    print(("PASS " if cond else "FAIL ") + label + (f"  {detail}" if not cond else ""))
    if not cond:
        FAILS.append(label)


def api(method: str, path: str, body: dict | None = None, timeout: float = 10) -> dict:
    result = tc.request(method, path, body, timeout=timeout)
    if "error" in result:
        raise RuntimeError(f"{method} {path}: {result}")
    return result


def record(seconds: float) -> tuple[Path, int, float]:
    api("POST", "/piece", {"title": "Recorder sync (e2e)",
                           "musicxml": PIECE.read_text(encoding="utf-8")})
    time.sleep(1.5)  # the loop applies to the piece on screen, so let it load first
    api("POST", "/loop", {"firstBar": 1, "lastBar": 8})
    time.sleep(1.0)
    started = time.perf_counter()
    result = api("POST", "/record", {"action": "start"})
    if result.get("ok") is not True:
        raise RuntimeError(f"record start failed: {result}")
    count = 0
    try:
        time.sleep(1.0)
        deadline = time.perf_counter() + seconds
        while time.perf_counter() < deadline:
            note = NOTES[count % len(NOTES)]
            velocity = 50 if (count + 1) % 7 == 0 else 80
            api("POST", "/inject", {"notes": [note], "kind": "noteon", "velocity": velocity})
            count += 1
            if count % 100 == 0:
                collect_events()
            try:
                time.sleep(0.45)
            finally:
                api("POST", "/inject", {"notes": [note], "kind": "noteoff", "velocity": 0})
            time.sleep(0.25)
        time.sleep(1.0)
    finally:
        # Measure call boundaries, excluding the stop request's save/encode time.
        stopped = time.perf_counter()
        result = api("POST", "/record", {"action": "stop"}, timeout=900)
    check(result.get("ok") is True, "record stop succeeded", result)
    check(not result.get("recording", {}).get("lastError"), "no recording error", result)
    if not result.get("path"):
        raise RuntimeError(f"stop returned no recording path: {result}")
    return Path(result["path"]), count, stopped - started


def audio_onsets(audio: np.ndarray) -> np.ndarray:
    frame = 40  # 5 ms at 8000 Hz; 20 frames = 100 ms, 8 frames = 40 ms.
    usable = audio[:len(audio) // frame * frame]
    rms = np.sqrt(np.mean(usable.reshape(-1, frame) ** 2, axis=1))
    onsets = []
    low, armed = 0, False
    for i, level in enumerate(rms):
        baseline = float(np.median(rms[max(0, i - 20):i])) if i else 0.0
        threshold = max(4 * baseline, 0.02)
        if level < threshold / 2:
            low += 1
            armed = armed or low >= 8
        else:
            if armed and level > threshold:
                start = i * frame
                # Search this frame and 30 ms ahead using the next 30 ms's peak.
                window = np.abs(audio[start:start + frame + 240])
                peak = float(np.max(np.abs(audio[start:start + 240])))
                crossing = np.flatnonzero(window > 0.25 * peak)
                if crossing.size:
                    onsets.append((start + int(crossing[0])) / 8000)
                armed = False
            low = 0
    return np.asarray(onsets, dtype=float)


_SEEN: dict[int, dict] = {}


def collect_events() -> list[dict]:
    """The app keeps only its last 2000 events, which a long take outruns, so
    the take loop calls this as it goes and every event seen is kept."""
    for e in api("GET", "/events?since=0&limit=2000")["events"]:
        _SEEN[e["seq"]] = e
    return [_SEEN[seq] for seq in sorted(_SEEN)]


def follow_marks(take: str | None = None) -> dict[str, list[float]]:
    """Seconds into the last take of each follower verdict. At a 'loop' wrap the
    app redraws the whole score, so the cursor paints late on screen itself:
    reported, not counted against the recorder's sync. An 'ignored' note changes
    nothing on screen, so it has no frame to match."""
    events = collect_events()
    starts = [e for e in events if e.get("kind") == "recording" and e.get("state") == "started"
              and take in (None, e.get("id"))]
    marks: dict[str, list[float]] = {"loop": [], "ignored": []}
    if starts:
        t0 = starts[-1]["startedAt"]
        for e in events:
            if e.get("kind") == "follow" and e.get("result") in marks and e["timestamp"] >= t0:
                marks[e["result"]].append((e["timestamp"] - t0) / 1000)
    return marks


def analyze(path: Path, expected: int | None = None, marks: dict[str, list[float]] | None = None) -> float:
    restarts = (marks or {}).get("loop", [])
    invisible = (marks or {}).get("ignored", [])
    ffmpeg = os.environ.get("MIDITUTOR_FFMPEG") or str(
        ROOT / "node_modules" / "ffmpeg-static" / ("ffmpeg.exe" if os.name == "nt" else "ffmpeg")
    )
    probe = subprocess.run([ffmpeg, "-i", str(path)], capture_output=True, timeout=30)
    info = probe.stderr.decode("utf-8", errors="replace")
    size = re.search(r"Video:[^\r\n]*?\b(\d{2,5})x(\d{2,5})\b", info)
    if not size:
        raise RuntimeError(f"cannot determine video dimensions: {info}")
    src_w, src_h = map(int, size.groups())
    if src_h <= 80:
        raise RuntimeError(f"video is too short to crop: {src_w}x{src_h}")
    height = max(2, 2 * round((src_h - 80) * 320 / src_w / 2))
    clock = re.search(r"Duration: (\d+):(\d+):(\d+(?:\.\d+)?)", info)
    duration = int(clock[1]) * 3600 + int(clock[2]) * 60 + float(clock[3]) if clock else 600.0
    rate = re.search(r"(\d+(?:\.\d+)?) fps", info)
    fps = float(rate.group(1)) if rate else 30.0
    if fps <= 0:
        raise RuntimeError(f"invalid video frame rate: {fps}")

    def decode(args: list[str]) -> bytes:
        result = subprocess.run(
            [ffmpeg, "-v", "error", "-i", str(path), *args],
            capture_output=True, timeout=120 + 2 * duration,
        )
        if result.returncode:
            raise RuntimeError(result.stderr.decode("utf-8", errors="replace"))
        return result.stdout

    raw_audio = decode(["-vn", "-ac", "1", "-ar", "8000", "-f", "s16le", "-"])
    audio = np.frombuffer(raw_audio, dtype="<i2").astype(np.float64) / 32768
    onsets = audio_onsets(audio)
    raw_video = decode([
        "-an", "-vf", f"crop=iw:ih-80:0:80,scale=320:{height},format=gray",
        "-f", "rawvideo", "-",
    ])
    frame_bytes = 320 * height
    if len(raw_video) % frame_bytes:
        raise RuntimeError("decoded video contains an incomplete frame")
    frames = np.frombuffer(raw_video, dtype=np.uint8).reshape(-1, height, 320)
    check(len(frames) >= 2, "video has at least two frames", len(frames))
    # Pixels that moved by more than 25 grey levels: a cursor step or a key
    # highlight is a small region, so a whole-frame mean would miss it.
    diffs = np.asarray([
        np.count_nonzero(np.abs(np.subtract(frames[i], frames[i - 1], dtype=np.int16)) > 25)
        for i in range(1, len(frames))
    ])
    threshold = max(12.0, 6 * float(np.median(diffs))) if diffs.size else 12.0
    changes = (np.flatnonzero(diffs > threshold) + 1) / fps
    errors, matched_at = [], []
    for onset in onsets:
        index = int(np.searchsorted(changes, onset - 0.1))
        if index < len(changes) and changes[index] <= onset + 0.4:
            errors.append(float(changes[index] - onset))
            matched_at.append(float(onset))
    print(f"onsets: {len(onsets)}; matched: {len(errors)}; injected: {expected}")
    if VERBOSE:
        print("onset s -> error ms:", [(round(a, 2), round(x * 1000)) for a, x in zip(matched_at, errors)])
    if errors:
        absolute_ms = np.abs(errors) * 1000
        print(f"|error| median / p90 / max: {np.median(absolute_ms):.2f} / "
              f"{np.percentile(absolute_ms, 90):.2f} / {np.max(absolute_ms):.2f} ms; "
              f"mean error: {np.mean(errors) * 1000:+.2f} ms")
    else:
        print("error median / p90 / max / mean: n/a (no matched onsets)")
    visible = [a for a in onsets if not any(abs(a - r) < 0.05 for r in invisible)]
    check(len(visible) > 0 and len(errors) >= 0.9 * len(visible),
          "at least 90% of on-screen notes matched", f"{len(errors)}/{len(visible)}")
    if expected is not None:
        check(abs(len(onsets) - expected) <= 2, "onset count within +/-2 of injected notes")
    near_restart = [any(abs(a - r) < 0.05 for r in restarts) for a in matched_at]
    for a, x, skip in zip(matched_at, errors, near_restart):
        if skip:
            print(f"loop restart at {a:.2f} s: score redraw painted {x * 1000:.0f} ms after the note (app-side)")
    timed = [x for x, skip in zip(errors, near_restart) if not skip]
    check(bool(timed) and max(map(abs, timed)) < 0.050, "maximum sync error < 50 ms",
          f"max {max(map(abs, timed)) * 1000:.0f} ms" if timed else "no notes")
    return len(audio) / 8000


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seconds", type=float, default=30)
    parser.add_argument("--analyze", type=Path, metavar="MP4")
    parser.add_argument("--verbose", action="store_true", help="print every per-note error")
    args = parser.parse_args()
    try:
        if args.analyze:
            analyze(args.analyze, marks=follow_marks(args.analyze.stem))
        else:
            if not np.isfinite(args.seconds) or args.seconds <= 0:
                raise ValueError("--seconds must be positive and finite")
            path, count, elapsed = record(args.seconds)
            print(f"recording: {path}")
            exists = path.is_file() and path.stat().st_size > 0
            check(exists, "recording exists and is nonempty", path)
            if exists:
                duration = analyze(path, count, follow_marks())
                check(abs(duration - elapsed) <= 0.2, "audio duration matches wall clock",
                      f"audio={duration:.3f}s wall={elapsed:.3f}s")
            recording = api("GET", "/state").get("recording", {})
            check(recording.get("state") == "idle", "recorder returned to idle", recording)
            check(recording.get("lastPath") == str(path), "lastPath matches saved path", recording)
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError, tc.TutorUnavailable) as exc:
        check(False, "recorder test completed", str(exc))
    print(f"\n{len(FAILS)} failure(s)" if FAILS else "\nALL PASS")
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
