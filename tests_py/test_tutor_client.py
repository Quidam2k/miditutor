"""Exercise the HTTP client against a small local app stub."""
import base64
import io
import json
import socket
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import mido
import pytest
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
MINUET = ROOT / "src" / "renderer" / "assets" / "minuet-in-g.musicxml"

from miditutor_mcp import server, tutor_client  # noqa: E402


@pytest.fixture
def app(monkeypatch):
    seen = []
    now_ms = int(time.time() * 1000)
    events = [
        {
            "seq": 1,
            "kind": "on",
            "note": 60,
            "velocity": 90,
            "source": "test",
            "timestamp": now_ms - 60_000,
        },
        {
            "seq": 2,
            "kind": "on",
            "note": 63,
            "velocity": 100,
            "source": "test",
            "timestamp": now_ms,
        },
    ]
    gestures = [
        {
            "id": 1,
            "names": ["C4", "E4", "G4"],
            "chord": {"name": "C major"},
            "endedAt": now_ms - 60_000,
        },
        {
            "id": 2,
            "notes": [65, 69, 72],
            "names": ["F4", "A4", "C5"],
            "chord": {"name": "F major"},
            "endedAt": now_ms,
        },
    ]

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, format, *args):
            pass

        def reply(self, payload, status=200):
            data = json.dumps(payload).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def authorized(self):
            seen.append({
                "method": self.command,
                "path": self.path,
                "headers": dict(self.headers),
            })
            if self.headers.get("Authorization") != "Bearer test-token":
                self.reply({"error": "unauthorized"}, 401)
                return False
            return True

        def do_GET(self):
            if not self.authorized():
                return
            path = urlsplit(self.path).path
            if path == "/state":
                self.reply({"connected": True})
            elif path == "/events":
                self.reply({"events": events})
            elif path == "/gestures":
                self.reply({"gestures": gestures})
            elif path == "/gestures/next":
                time.sleep(0.2)
                self.reply({"timedOut": True})
            else:
                self.reply({"error": "not found"}, 404)

        def do_POST(self):
            if not self.authorized():
                return
            if urlsplit(self.path).path not in ("/task", "/piece"):
                self.reply({"error": "not found"}, 404)
                return
            length = int(self.headers.get("Content-Length", "0"))
            body = json.loads(self.rfile.read(length))
            seen[-1]["body"] = body
            self.reply(body)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    monkeypatch.setenv("MIDITUTOR_URL", f"http://127.0.0.1:{server.server_port}/")
    monkeypatch.setenv("MIDITUTOR_TOKEN", "test-token")
    thread.start()
    try:
        yield {"seen": seen, "now_ms": now_ms}
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def test_bearer_header(app):
    assert tutor_client.state() == {"connected": True}
    assert app["seen"][-1]["headers"]["Authorization"] == "Bearer test-token"


def test_recent_filters_old_notes_and_gestures(app):
    assert tutor_client.recent(seconds=5) == {
        "notes": [{"name": "D#4", "kind": "on", "t": app["now_ms"]}],
        "gestures": [{"id": 2, "names": ["F4", "A4", "C5"], "chord": "F major"}],
    }
    assert [entry["path"] for entry in app["seen"]] == [
        "/events?since=0&limit=2000",
        "/gestures?since=0&limit=500",
    ]


def test_wait_for_play_timeout(app):
    assert tutor_client.wait_for_play(timeout_s=1, after=0) == {"timedOut": True}
    url = urlsplit(app["seen"][-1]["path"])
    assert url.path == "/gestures/next"
    assert parse_qs(url.query) == {"timeoutMs": ["1000"], "after": ["0"]}


def test_show_chord_echoes(app):
    assert tutor_client.show_chord("C major", ["C4", "E4", "G4"]) == {
        "label": "C major",
        "notes": ["C4", "E4", "G4"],
    }
    assert app["seen"][-1]["headers"]["Content-Type"] == "application/json"


def test_http_error_and_token_reresolution(app, monkeypatch):
    monkeypatch.setenv("MIDITUTOR_TOKEN", "wrong-token")
    assert tutor_client.state() == {"error": "unauthorized", "status": 401}
    monkeypatch.setenv("MIDITUTOR_TOKEN", "test-token")
    assert tutor_client.state() == {"connected": True}


def test_unavailable_when_nothing_listens(monkeypatch):
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    url = f"http://127.0.0.1:{port}"
    monkeypatch.setenv("MIDITUTOR_URL", url)
    monkeypatch.setenv("MIDITUTOR_TOKEN", "test-token")
    with pytest.raises(tutor_client.TutorUnavailable) as caught:
        tutor_client.request("GET", "/state", timeout=0.5)
    assert str(caught.value) == (
        f"MidiTutor app isn't reachable at {url}. "
        "Is it open on the music box (and the SSH tunnel up)?"
    )


def test_unavailable_without_token(app, monkeypatch, tmp_path):
    token_path = tmp_path / "missing-api-token"
    monkeypatch.delenv("MIDITUTOR_TOKEN", raising=False)
    monkeypatch.setenv("MIDITUTOR_TOKEN_FILE", str(token_path))
    with pytest.raises(tutor_client.TutorUnavailable) as caught:
        tutor_client.state()
    url = tutor_client.os.environ["MIDITUTOR_URL"].rstrip("/")
    assert str(caught.value) == (
        f"MidiTutor app isn't reachable at {url}. "
        "Is it open on the music box (and the SSH tunnel up)?"
        f" (no API token found at {token_path})"
    )
    assert app["seen"] == []


def test_load_piece_midi_is_converted_by_the_importer(app, tmp_path):
    midi_path = tmp_path / "tiny.mid"
    midi = mido.MidiFile(ticks_per_beat=480)
    track = mido.MidiTrack()
    midi.tracks.append(track)
    track.append(mido.Message("note_on", note=60, velocity=80, time=0))
    track.append(mido.Message("note_off", note=60, velocity=0, time=480))
    midi.save(midi_path)

    result = server.tutor_load_piece(str(midi_path), title="Tiny")
    assert result == {"ok": True, "title": "Tiny", "score": True, "photo": False}
    body = app["seen"][-1]["body"]
    assert body["title"] == "Tiny"
    assert "<score-partwise" in body["musicxml"]
    assert "photo" not in body


def test_load_piece_musicxml_is_sent_as_is(app):
    result = server.tutor_load_piece(str(MINUET))
    assert result["ok"] and result["score"] and result["title"] == "minuet-in-g"
    assert app["seen"][-1]["body"]["musicxml"] == MINUET.read_text(encoding="utf-8")


def test_load_piece_photo_is_shown_even_when_omr_fails(app, tmp_path, monkeypatch):
    photo_path = tmp_path / "page.png"
    Image.new("RGB", (3000, 2000), (200, 30, 30)).save(photo_path)
    # Point OMR at a missing engine so this test never runs a real recognizer.
    monkeypatch.setenv("MIDITUTOR_OMR_HOMR", str(tmp_path / "no-such-homr.exe"))

    result = server.tutor_load_piece(str(photo_path))
    assert result == {
        "ok": True,
        "title": "page",
        "score": False,
        "photo": True,
        "omr_error": "OMR engine not installed (homr). Set MIDITUTOR_OMR_HOMR or see bench/omr/README.md",
    }
    body = app["seen"][-1]["body"]
    assert "musicxml" not in body
    assert body["photo"].startswith("data:image/jpeg;base64,")
    photo = Image.open(io.BytesIO(base64.b64decode(body["photo"].split(",", 1)[1])))
    assert max(photo.size) == 2000


def test_load_piece_reports_bad_input_without_pushing(app, tmp_path):
    text = tmp_path / "notes.txt"
    text.write_text("hello", encoding="utf-8")
    assert "Unsupported file type" in server.tutor_load_piece(str(text))["error"]
    assert "No file at" in server.tutor_load_piece(str(tmp_path / "missing.mxl"))["error"]
    assert all(entry["path"] != "/piece" for entry in app["seen"])
