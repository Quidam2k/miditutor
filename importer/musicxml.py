"""Read MusicXML files (.musicxml, .xml, and zipped .mxl) as text.

Validates only enough to refuse files that are not a score: the document
root must be score-partwise or score-timewise.
"""

from __future__ import annotations

import os
import posixpath
import xml.etree.ElementTree as ET
import zipfile
from pathlib import PurePosixPath

SCORE_ROOTS = {"score-partwise", "score-timewise"}


class MusicXMLError(ValueError):
    """The file is not a readable MusicXML score."""


def _mxl_root_path(archive: zipfile.ZipFile) -> str:
    """The score inside a compressed .mxl: container.xml's rootfile, else the first XML part."""
    names = archive.namelist()
    try:
        container = ET.fromstring(archive.read("META-INF/container.xml"))
        for rootfile in container.iter():
            if rootfile.tag.endswith("rootfile") and rootfile.get("full-path"):
                return rootfile.get("full-path")
    except KeyError:
        pass
    for name in names:
        if name.lower().endswith((".xml", ".musicxml")) and not name.startswith("META-INF/"):
            return name
    raise MusicXMLError("compressed MusicXML (.mxl) has no score document inside")


def _text_of(path: str | os.PathLike[str]) -> str:
    suffix = PurePosixPath(os.fspath(path)).suffix.lower()
    if suffix == ".mxl":
        try:
            with zipfile.ZipFile(os.fspath(path)) as archive:
                member = posixpath.normpath(_mxl_root_path(archive))
                return archive.read(member).decode("utf-8")
        except (zipfile.BadZipFile, KeyError, UnicodeDecodeError) as exc:
            raise MusicXMLError(f"cannot read .mxl archive: {exc}") from exc
    with open(os.fspath(path), "rb") as handle:
        return handle.read().decode("utf-8-sig")


def read_musicxml(path: str | os.PathLike[str]) -> str:
    """Return the score as MusicXML text, after checking it parses and is a score."""
    text = _text_of(path)
    try:
        root = ET.fromstring(text.encode("utf-8"))
    except ET.ParseError as exc:
        raise MusicXMLError(f"not well-formed XML: {exc}") from exc
    if root.tag not in SCORE_ROOTS:
        raise MusicXMLError(f"not a MusicXML score (root element is <{root.tag}>)")
    if root.find(".//note") is None:
        raise MusicXMLError("MusicXML score contains no notes")
    return text
