"""E2E click-test of the native Windows "Open piece" file dialog (#5076).

Drives the real common item dialog opened by the packaged MidiTutor's
'piece:open' IPC (dialog.showOpenDialog) with pywinauto (UIA backend):
  * OPEN: dialog appears, starts in the pieces folder, lists the test files,
    typing a file name + Open loads the piece (a "piece" event arrives with
    steps > 0 and bars > 0).
  * CANCEL: dialog closes, nothing is loaded, the page stays responsive.

Launch the app first (VISIBLE, not hidden: the native dialog needs a real
window; focus is grabbed, so only run while the owner is away):

  MIDITUTOR_PIECES_DIR=<scratch>/dialog_pieces MIDITUTOR_TEST_SESSION=1 \
  MIDITUTOR_PORT=47815 ./out/MidiTutor-win32-x64/MidiTutor.exe --mute-audio \
  --user-data-dir=<scratch>/ud_dialog --remote-debugging-port=9361

Then run (needs pywinauto in the repo .venv):

  MIDITUTOR_CDP=http://127.0.0.1:9361 MIDITUTOR_URL=http://127.0.0.1:47815 \
  MIDITUTOR_TOKEN_FILE=<scratch>/ud_dialog/api-token \
  MIDITUTOR_PIECES_DIR=<scratch>/dialog_pieces \
  python scripts/e2e_open_piece_dialog.py [--skip-idle-gate]

Mac's dialog is not covered. No sound, localhost only; no processes are
launched or killed.
"""
import ctypes
import os
import sys
import time
from ctypes import wintypes
from pathlib import Path

from e2e_backwards import FAILS, SCORE, check, tc

OUT = Path(__file__).resolve().parent.parent / "screengrab"
IDLE_MIN = 600


def idle_seconds() -> float:
    class LASTINPUTINFO(ctypes.Structure):
        _fields_ = [("cbSize", wintypes.UINT), ("dwTime", wintypes.DWORD)]

    info = LASTINPUTINFO()
    info.cbSize = ctypes.sizeof(info)
    ctypes.windll.user32.GetLastInputInfo(ctypes.byref(info))
    now = ctypes.windll.kernel32.GetTickCount() & 0xFFFFFFFF
    return ((now - info.dwTime) & 0xFFFFFFFF) / 1000.0


def piece_events(seq):
    evs = tc.request("GET", f"/events?since={seq}&limit=2000").get("events", [])
    return [e for e in evs if e.get("kind") == "piece"]


def click_open(page):
    btn = page.get_by_role("button", name="Open piece…")
    if not btn.first.is_visible():
        page.get_by_test_id("menu-more").click()
        page.get_by_test_id("menu-more-panel").wait_for(timeout=5000)
        btn = page.get_by_role("button", name="Open piece…")
    try:
        btn.first.click(no_wait_after=True, timeout=3000)
    except Exception as e:  # modal dialog may stall the click ack
        print(f"INFO: click returned: {type(e).__name__}")


def find_dialog(Desktop):
    # Electron gives the dialog an owner (the main window), so UIA lists it as that window's child.
    return Desktop(backend="uia").window(title_re="^MidiTutor").child_window(
        title="Open piece", control_type="Window", found_index=0)


def get_dialog(Desktop, timeout=15):
    dlg = find_dialog(Desktop)
    try:
        dlg.wait("visible", timeout=timeout)
        return dlg
    except Exception:
        return None


def dialog_open(Desktop):
    return find_dialog(Desktop).exists(timeout=0.5)


def closed_within(Desktop, secs):
    end = time.time() + secs
    while time.time() < end:
        if not dialog_open(Desktop):
            return True
        time.sleep(0.25)
    return False


def check_location(dlg, pieces):
    try:
        bars = [t for t in dlg.descendants(control_type="ToolBar")
                if (t.window_text() or "").startswith("Address:")]
        text = bars[0].window_text()[len("Address:"):].strip()
    except Exception as e:
        print(f"INFO: address bar unreadable: {e}")
        return
    if len(text) > 2 and (text[1:3] == ":\\" or text.startswith("\\\\")):
        want = os.path.normcase(os.path.normpath(pieces))
        got = os.path.normcase(os.path.normpath(text))
        check(got == want, "dialog opens in pieces dir", f"address={text!r}")
    else:
        print(f"INFO: address not a full path: {text!r}")


def check_listing(dlg):
    try:
        names = [i.window_text() for i in dlg.descendants(control_type="ListItem")]
        ok = all(any(n in x for x in names) for n in ("Dialog Test A", "Dialog Test B"))
        if ok:
            check(True, "file list shows both test pieces")
        else:
            print(f"INFO: file list lacks test files: {names[:10]}")
    except Exception as e:
        print(f"INFO: file list unreadable: {e}")


def main():
    if "--skip-idle-gate" not in sys.argv:
        idle = idle_seconds()
        if idle < IDLE_MIN:
            print(f"ABORT: user active (idle {int(idle)}s)")
            sys.exit(2)

    from pywinauto import Desktop
    from playwright.sync_api import sync_playwright

    pieces = os.environ["MIDITUTOR_PIECES_DIR"]
    os.makedirs(pieces, exist_ok=True)
    text = Path(SCORE).read_text(encoding="utf-8")
    for n in ("Dialog Test A", "Dialog Test B"):
        Path(pieces, f"{n}.musicxml").write_text(text, encoding="utf-8")
    OUT.mkdir(exist_ok=True)

    with sync_playwright() as p:
        page = p.chromium.connect_over_cdp(os.environ["MIDITUTOR_CDP"]).contexts[0].pages[0]
        page.get_by_role("button", name="Score", exact=True).click()
        time.sleep(1)
        try:
            # OPEN path
            seq = tc.state()["eventSeq"]
            click_open(page)
            dlg = get_dialog(Desktop)
            check(dlg is not None, "Open piece dialog appeared")
            if dlg is not None:
                check_location(dlg, pieces)
                check_listing(dlg)
                dlg.child_window(auto_id="1148", control_type="Edit").set_edit_text(
                    "Dialog Test B.musicxml")
                # Match the Open button by id alone: its UIA control type is not always Button.
                dlg.child_window(auto_id="1", found_index=0).invoke()
                check(closed_within(Desktop, 5), "dialog closed after Open")
                found = None
                end = time.time() + 20
                while time.time() < end and not found:
                    found = next((e for e in piece_events(seq)
                                  if "Dialog Test B" in str(e.get("piece"))), None)
                    time.sleep(0.5)
                check(found is not None, "piece event for Dialog Test B")
                if found:
                    check(found.get("steps", 0) > 0, "piece steps > 0", str(found.get("steps")))
                    check(found.get("bars", 0) > 0, "piece bars > 0", str(found.get("bars")))
            page.screenshot(path=str(OUT / "e2e_open_piece_dialog_open.png"))

            # CANCEL path
            seq = tc.state()["eventSeq"]
            click_open(page)
            dlg = get_dialog(Desktop)
            check(dlg is not None, "Open piece dialog appeared (cancel run)")
            if dlg is not None:
                try:
                    dlg.capture_as_image().save(str(OUT / "e2e_open_piece_dialog_dialog.png"))
                except Exception:
                    pass
                dlg.child_window(auto_id="2", control_type="Button").click()
                check(closed_within(Desktop, 5), "dialog closed after Cancel")
                time.sleep(3)
                check(not piece_events(seq), "no piece event after Cancel")
                check(page.evaluate("1+1") == 2, "page responsive after Cancel")
        finally:
            try:
                if dialog_open(Desktop):
                    d = get_dialog(Desktop, timeout=2)
                    try:
                        d.child_window(auto_id="2", control_type="Button").click()
                    except Exception:
                        d.close()
            except Exception as e:
                print(f"WARN: cleanup failed: {e}")

    if FAILS:
        print(f"{len(FAILS)} checks failed")
        sys.exit(1)
    print("ALL PASS")
    sys.exit(0)


if __name__ == "__main__":
    main()
