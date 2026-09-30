"""MidiTutor MCP server: the Pantheon's hands on Todd's piano practice (#3566).

Same shape as audiplex-dj: a stdio FastMCP server registered in the persona
.mcp.json files, so Karen (piano lead) and Jarvis can drive practice directly.
Today it is the voice drill; when the MIDI box exists, keyboard-aware tools
(what did he just play, show this on the staff) land here too.

Run: python -m miditutor_mcp.server   (cwd = repo root, PYTHONPATH = repo root)
"""
from __future__ import annotations

from mcp.server.fastmcp import FastMCP

from drill import piano_drill

mcp = FastMCP("miditutor")

@mcp.tool()
def piano_next_chord() -> dict:
    """The next triad for Todd to derive at the piano, picked truly at random from
    the ones he has NOT covered yet this cycle (so a short session never just
    redoes the first few). Catalog = the teacher's 9/25 triads-by-colour list (24).

    Speak `say` only (e.g. "E flat major"). `answer_notes_DO_NOT_SPEAK` is the
    correct letter-skipping spelling, for checking him and for a miss walkthrough.
    After he answers, call piano_record(item_id, result).

    PIANO RULES (Todd 2026-09-30): he is voice-only at the piano (phone in
    pocket; text-only = unsaid). Say ONLY the chord name; he derives the notes
    aloud. Never speak answer_notes unless he misses or asks. A correction goes
    out BEFORE the next chord, one idea per turn, so it lands by ear. Karen leads.
    """
    return piano_drill.next_item("triad")


@mcp.tool()
def piano_record(item_id: str, result: str) -> dict:
    """Record how Todd did on the chord you just served.

    result: 'got' (clean), 'shaky' (got there with help/hesitation), 'missed'
    (wrong or blanked; the chord stays in the pool and comes back later).
    Returns the running tally (done_this_cycle / total, remaining names).
    Never read a score back unless he asks; when he asks, say it plainly.
    """
    return piano_drill.record(item_id, result)


@mcp.tool()
def piano_drill_status() -> dict:
    """How far through the chord list Todd is: done_this_cycle of total, the
    names still remaining, and today's chords with results. Use it when he asks
    "how many have we done / how many are left", or at the end of a session."""
    return piano_drill.status("triad")


if __name__ == "__main__":
    mcp.run()
