"""Photo of a printed score -> MusicXML (optical music recognition).

Engine: homr (github.com/liebharc/homr), chosen by the slice-E bench in
bench/omr/README.md. It runs as a separate process from its own venv so its
dependencies never touch the app's Python.

Configuration:
  MIDITUTOR_OMR_HOMR     path to the homr executable (homr.exe on Windows)
                         default: <repo>/.venv-omr-homr/Scripts/homr.exe if it exists
  MIDITUTOR_OMR_TIMEOUT  seconds before giving up (default 300)

Callers should catch OMRError and fall back to showing the photo alone.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from pathlib import Path

from importer.musicxml import MusicXMLError, read_musicxml

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_TIMEOUT_S = 300


class OMRError(RuntimeError):
    """Photo could not be turned into a score."""


def engine_path() -> Path | None:
    """The homr executable to run, or None when no engine is installed."""
    configured = os.environ.get("MIDITUTOR_OMR_HOMR")
    if configured:
        return Path(configured)
    default = REPO_ROOT / ".venv-omr-homr" / "Scripts" / "homr.exe"
    return default if default.exists() else None


def _timeout() -> float:
    try:
        return float(os.environ.get("MIDITUTOR_OMR_TIMEOUT", DEFAULT_TIMEOUT_S))
    except ValueError:
        return DEFAULT_TIMEOUT_S


def photo_to_musicxml(path: str | os.PathLike[str]) -> str:
    """Return MusicXML text (score-partwise) for the score photographed at path."""
    source = Path(path)
    if not source.is_file():
        raise OMRError(f"photo not found: {source}")
    exe = engine_path()
    if exe is None or not exe.is_file():
        raise OMRError(
            "OMR engine not installed (homr). Set MIDITUTOR_OMR_HOMR or see bench/omr/README.md"
        )
    with tempfile.TemporaryDirectory(prefix="miditutor-omr-") as work_dir:
        # homr writes its output next to its input, so work on a copy in a scratch dir.
        work = Path(work_dir) / f"photo{source.suffix.lower()}"
        shutil.copyfile(source, work)
        try:
            proc = subprocess.run(
                [str(exe), str(work)],
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=_timeout(),
            )
        except subprocess.TimeoutExpired as exc:
            raise OMRError(f"OMR timed out after {exc.timeout:.0f} s") from exc
        except OSError as exc:
            raise OMRError(f"could not start the OMR engine: {exc}") from exc
        output = work.with_suffix(".musicxml")
        if proc.returncode != 0 or not output.exists():
            lines = [ln for ln in (proc.stderr or "").splitlines() if ln.strip()]
            reason = lines[-1][:200] if lines else "no output"
            raise OMRError(f"OMR found no score in the photo ({reason})")
        try:
            return read_musicxml(output)
        except MusicXMLError as exc:
            raise OMRError(f"OMR produced unreadable MusicXML: {exc}") from exc
