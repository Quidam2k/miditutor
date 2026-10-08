"""MidiTutor HTTP client: the MCP server's hands on the music box.

Read the API token afresh for each call; the app may have just started.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


class TutorUnavailable(Exception):
    """The app is unreachable, or its API token is not available yet."""


def _token_path() -> Path:
    configured = os.environ.get("MIDITUTOR_TOKEN_FILE")
    if configured:
        return Path(configured).expanduser()
    if os.name == "nt":
        appdata = os.environ.get("APPDATA")
        root = Path(appdata) if appdata else Path.home() / "AppData" / "Roaming"
        return root / "MidiTutor" / "api-token"
    if hasattr(os, "uname") and os.uname().sysname == "Darwin":
        return Path.home() / "Library" / "Application Support" / "MidiTutor" / "api-token"
    return Path.home() / ".config" / "MidiTutor" / "api-token"


def request(
    method: str, path: str, body: dict | None = None, timeout: float = 10, raw: bool = False
) -> dict | bytes:
    """Call the local API; server errors come back as error/status dictionaries.
    raw=True returns the response body as bytes (e.g. /screenshot)."""
    base_url = os.environ.get("MIDITUTOR_URL", "http://127.0.0.1:47800").rstrip("/")
    unavailable = (
        f"MidiTutor app isn't reachable at {base_url}. "
        "Is it open on the music box (and the SSH tunnel up)?"
    )
    token = os.environ.get("MIDITUTOR_TOKEN", "").strip()
    if not token:
        token_path = _token_path()
        try:
            token = token_path.read_text(encoding="utf-8").strip()
        except (OSError, UnicodeError):
            token = ""
        if not token:
            raise TutorUnavailable(
                f"{unavailable} (no API token found at {token_path})"
            )

    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = Request(
        f"{base_url}/{path.lstrip('/')}",
        data=data,
        headers=headers,
        method=method.upper(),
    )
    try:
        with urlopen(req, timeout=timeout) as response:
            payload = response.read()
            if raw:
                return payload
            return json.loads(payload) if payload else {}
    except HTTPError as exc:
        with exc:
            try:
                payload = json.loads(exc.read())
            except (ValueError, UnicodeError):
                payload = {}
        error = payload.get("error") if isinstance(payload, dict) else None
        return {"error": error or str(exc.reason), "status": exc.code}
    except (URLError, ConnectionError, TimeoutError) as exc:
        raise TutorUnavailable(unavailable) from exc


def state() -> dict:
    """What the app and keyboard are doing right now."""
    return request("GET", "/state")


def _note_name(note: int) -> str:
    names = ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")
    return f"{names[note % 12]}{note // 12 - 1}"


def recent(seconds: float | None = None, limit: int = 50) -> dict:
    """Recent notes and gestures, trimmed for a conversation at the piano."""
    cutoff = None if seconds is None else time.time() * 1000 - seconds * 1000
    event_result = request("GET", "/events?since=0&limit=2000")
    if "error" in event_result:
        return event_result
    gesture_result = request("GET", "/gestures?since=0&limit=500")
    if "error" in gesture_result:
        return gesture_result

    events = event_result.get("events", [])
    gestures = gesture_result.get("gestures", [])
    if cutoff is not None:
        events = [event for event in events if event["timestamp"] >= cutoff]
        gestures = [gesture for gesture in gestures if gesture["endedAt"] >= cutoff]
    events = events[-limit:] if limit > 0 else []
    gestures = gestures[-limit:] if limit > 0 else []

    compact_gestures = []
    for gesture in gestures:
        chord = gesture.get("chord")
        if isinstance(chord, dict):
            chord = chord.get("name")
        compact_gestures.append(
            {"id": gesture["id"], "names": gesture["names"], "chord": chord}
        )
    return {
        "notes": [
            {
                "name": _note_name(event["note"]),
                "kind": event["kind"],
                "t": event["timestamp"],
            }
            for event in events
        ],
        "gestures": compact_gestures,
    }


def wait_for_play(timeout_s: float = 30, after: int | None = None) -> dict:
    """Wait for the next gesture, allowing the app time to finish its long poll."""
    params = {"timeoutMs": int(timeout_s * 1000)}
    if after is not None:
        params["after"] = after
    return request(
        "GET", f"/gestures/next?{urlencode(params)}", timeout=timeout_s + 5
    )


def show_chord(label: str, notes: list[str]) -> dict:
    """Put a named chord on the app's staff."""
    return request("POST", "/task", {"label": label, "notes": notes})


def get_task() -> dict:
    """Read the task currently on the staff."""
    return request("GET", "/task")


def clear_task() -> dict:
    """Clear the task from the staff."""
    return request("DELETE", "/task")


def load_piece(
    title: str, musicxml: str, photo_data_url: str | None = None
) -> dict:
    """Load a piece, with an optional photo of the score."""
    body = {"title": title, "musicxml": musicxml}
    if photo_data_url is not None:
        body["photo"] = photo_data_url
    return request("POST", "/piece", body)


def inject(notes: list[int], kind: str = "chord", hold_ms: int = 300) -> dict:
    """Play MIDI notes through the app's development input."""
    return request("POST", "/inject", {"notes": notes, "kind": kind, "holdMs": hold_ms})


def screenshot(dest: str | Path) -> dict:
    """Save a PNG of the app window to dest."""
    data = request("GET", "/screenshot", timeout=15, raw=True)
    if isinstance(data, dict):
        return data
    Path(dest).write_bytes(data)
    return {"path": str(dest), "bytes": len(data)}
