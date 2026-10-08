"""Photo of a printed score -> MusicXML (optical music recognition).

Not wired yet: slice E will benchmark engines (homr, oemer, Audiveris) and
plug the chosen one in behind photo_to_musicxml. Callers should catch
OMRError and fall back to showing the photo alone.
"""

from __future__ import annotations

import os


class OMRError(RuntimeError):
    """Photo could not be turned into a score."""


def photo_to_musicxml(path: str | os.PathLike[str]) -> str:
    """Return MusicXML text (score-partwise) for the score photographed at path."""
    raise OMRError("OMR not wired yet (slice E)")
