"""Exercise the HTTP client against a small local app stub."""
import json
import socket
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

import pytest

from miditutor_mcp import tutor_client


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
            if urlsplit(self.path).path != "/task":
                self.reply({"error": "not found"}, 404)
                return
            length = int(self.headers.get("Content-Length", "0"))
            self.reply(json.loads(self.rfile.read(length)))

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
