"""#6771 end-to-end: an app error reaches a Jarvis event by itself, inside a minute.

Hidden, muted test copy that is allowed to send (MIDITUTOR_REPORT_ERRORS=1), under a fresh
letters-only machine name (the watch latches machine|where|message for 24 h):
    MIDITUTOR_HIDDEN=1 MIDITUTOR_REPORT_ERRORS=1 MIDITUTOR_MACHINE=e2e-<letters> \
      MIDITUTOR_PANTHEON_URL=<Pantheon WebUI url> MIDITUTOR_PANTHEON_CERT=<its cert.pem> \
      MIDITUTOR_PIECES_DIR=<s>/pieces MIDITUTOR_PORT=47812 \
      ./out/MidiTutor-win32-x64/MidiTutor.exe --mute-audio --user-data-dir=<s>/ud --remote-debugging-port=9348
then:
    PANTHEON_DB=<pantheon.db> python scripts/e2e_error_report.py e2e-<letters>
Forces writeScore('e2e-missing') (a save of a piece that is not there), then reads Pantheon's
DB read-only: one new device_logs MidiTutorError row from that machine, then the scheduler's
miditutor_app_error orch_event naming it, each timed from the forced failure. Needs the
scheduler running miditutor_error_watch (Pantheon 9cfb6e52).
"""
from __future__ import annotations

import os
import sqlite3
import sys
import time

from playwright.sync_api import sync_playwright

CDP = os.environ.get("MIDITUTOR_CDP", "http://127.0.0.1:9348")
DB = os.environ["PANTHEON_DB"]  # read-only
LIMIT_S = 60


def poll(sql: str, params: tuple, deadline: float):
    while time.time() < deadline:
        con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True, timeout=10)
        try:
            row = con.execute(sql, params).fetchone()
        finally:
            con.close()
        if row:
            return row
        time.sleep(2)
    return None


def main() -> int:
    machine = sys.argv[1]
    con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True, timeout=10)
    last_log = con.execute("SELECT COALESCE(MAX(id), 0) FROM device_logs").fetchone()[0]
    last_ev = con.execute("SELECT COALESCE(MAX(id), 0) FROM orch_events").fetchone()[0]
    con.close()
    with sync_playwright() as p:
        page = p.chromium.connect_over_cdp(CDP).contexts[0].pages[0]
        t0 = time.time()
        got = page.evaluate(
            """async () => {
              try { await window.tutorBridge.writeScore('e2e-missing', '<score-partwise/>'); return 'saved?!'; }
              catch (e) { return String(e && e.message || e); }
            }""")
    print(f"forced failure: {got}")
    deadline = t0 + LIMIT_S
    tag = f'%"machine": "{machine}"%'
    log = poll(
        "SELECT id, message, extras FROM device_logs WHERE id > ? AND flavor='miditutor' "
        "AND tag='MidiTutorError' AND (extras LIKE ? OR extras LIKE ?) ORDER BY id",
        (last_log, tag, f'%"machine":"{machine}"%'), deadline)
    if not log:
        print(f"FAIL: no MidiTutorError device_logs row from {machine} within {LIMIT_S} s")
        return 1
    print(f"PASS device_logs #{log[0]} after {time.time() - t0:.0f} s: {log[1][:120]}")
    ev = poll(
        "SELECT id, content FROM orch_events WHERE id > ? AND event_type='miditutor_app_error' "
        "AND owner_persona='jarvis' AND content LIKE ? ORDER BY id", (last_ev, f"%{machine}%"), deadline)
    if not ev:
        print(f"FAIL: no miditutor_app_error orch_event within {LIMIT_S} s")
        return 1
    print(f"PASS orch_events #{ev[0]} after {time.time() - t0:.0f} s: {ev[1][:160]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
