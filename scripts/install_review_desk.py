"""Install the desk scan-review app (#9664) and its "MidiTutor Review" desktop shortcut.

    npx electron-forge package
    .venv/Scripts/python.exe -I scripts/install_review_desk.py

Copies the packaged build out of out/ (which every package run replaces) into
%LOCALAPPDATA%/MidiTutor Review, then points the shortcut at it with the review
flags. The exe is a GUI app, so it opens no console window; its Python helpers
run hidden. Re-run after each package to update; it refuses while the app is open.
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
BUILD = REPO / "out" / "MidiTutor-win32-x64"
DEST = Path(os.environ["LOCALAPPDATA"]) / "MidiTutor Review"
EXE = DEST / "MidiTutor.exe"
LIBRARY = r"Q:\Personal\piano\library"
BACKUP = r"Q:\project-reports\miditutor\review-backup"
NAME = "MidiTutor Review"


def ps(script: str, *args: str) -> str:
    # Values go in through the environment ($env:A0, $env:A1 ...), never pasted into the script text.
    env = dict(os.environ, **{f"A{i}": a for i, a in enumerate(args)})
    return subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", script],
                          capture_output=True, text=True, check=True, env=env).stdout.strip()


def flags() -> str:
    return " ".join([f'--review-library="{LIBRARY}"', f'--review-python="{REPO / ".venv" / "Scripts" / "python.exe"}"',
                     f'--review-scripts="{REPO / "scripts"}"', f'--review-backup="{BACKUP}"'])


def main() -> int:
    if not (BUILD / "MidiTutor.exe").is_file():
        sys.exit(f"No packaged build in {BUILD} - run: npx electron-forge package")
    if EXE.is_file():
        # Windows won't rename a running exe: that is the "is it open" test.
        try:
            EXE.rename(EXE.with_suffix(".exe.chk"))
            EXE.with_suffix(".exe.chk").rename(EXE)
        except PermissionError:
            sys.exit(f"{NAME} is open - close it first.")
    r = subprocess.run(["robocopy", str(BUILD), str(DEST), "/MIR", "/NFL", "/NDL", "/NJH", "/NJS", "/NP"])
    if r.returncode >= 8:
        sys.exit(f"robocopy failed ({r.returncode})")
    lnk = ps("$l = Join-Path ([Environment]::GetFolderPath('Desktop')) ($env:A0 + '.lnk');"
             "$s = (New-Object -ComObject WScript.Shell).CreateShortcut($l);"
             "$s.TargetPath = $env:A1; $s.Arguments = $env:A2; $s.WorkingDirectory = $env:A3;"
             "$s.IconLocation = $env:A1 + ',0'; $s.Description = $env:A4; $s.Save(); $l",
             NAME, str(EXE), flags(), str(DEST), "Review scanned scores against the page and fix misread bars")
    print(f"Installed {EXE}")
    print(f"Shortcut {lnk}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
