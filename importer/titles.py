"""Piece titles for imported files (no music21 here, so scripts can import it cheaply)."""
from __future__ import annotations

import re


def nice_title(stem: str) -> str:
    """'fur_Elise_WoO59' -> 'Fur Elise WoO59': capitalize lowercase words, leave the rest alone."""
    return " ".join(w[:1].upper() + w[1:] for w in re.split(r"[_\s-]+", stem) if w)


def _words(text: str) -> list[str]:
    return [w for w in re.split(r"[^a-z0-9]+", text.lower()) if w]


def pick_title(embedded: str, stem: str) -> str:
    """The file's own title, unless it is only the first word(s) of the file name (#6368).

    A MIDI track named "Spin" in spin-the-wheel-intermediate.mid is a poor title; the file
    name, tidied, is the fuller one. No usable embedded title: the tidied file name.
    """
    own, full = _words(embedded), _words(stem)
    if not own or (len(own) < len(full) and full[: len(own)] == own):
        return nice_title(stem)
    return embedded.strip()
