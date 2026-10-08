"""MidiTutor MCP server: the Pantheon's hands on Todd's piano practice (#3566).

Same shape as audiplex-dj: a stdio FastMCP server registered in the persona
.mcp.json files, so Karen (piano lead) and Jarvis can drive practice directly.
The piano_* tools are the voice drill. The tutor_* tools talk to the running
MidiTutor app (Electron) over its loopback HTTP API (see tutor_client.py): see
what Todd plays live, put a chord task or a piece on his screen, check it.
Remote box: tunnel first (ssh -L 47800:127.0.0.1:47800 pinocchio) and set
MIDITUTOR_TOKEN to the box's api-token.

Run: python -m miditutor_mcp.server   (cwd = repo root, PYTHONPATH = repo root)
"""
from __future__ import annotations

import time

from mcp.server.fastmcp import FastMCP

from drill import piano_drill
from miditutor_mcp import tutor_client
from miditutor_mcp.tutor_client import TutorUnavailable

mcp = FastMCP("miditutor")

def _tutor(fn, *args, **kwargs) -> dict:
    """Call the app; turn 'app not running' into a plain error dict."""
    try:
        return fn(*args, **kwargs)
    except TutorUnavailable as e:
        return {"error": str(e), "app_unreachable": True}


# (task id, attempts already handed back), so piano_check_chord reports each
# attempt once even across calls. Only the current task matters.
_seen: tuple[int, int] = (0, 0)


@mcp.tool()
def piano_next_chord(show: bool = False) -> dict:
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

    show=True (he is at the keyboard with the app open): also puts the chord
    NAME on his screen (never the notes) and arms a key check. Then call
    piano_check_chord(item_id) instead of asking him to say the letters.
    """
    item = piano_drill.next_item("triad")
    if show and "item_id" in item:
        # The app parses the drill's spellings ("E flat") as-is.
        pushed = _tutor(tutor_client.show_chord, item["say"], item["answer_notes_DO_NOT_SPEAK"])
        item["on_screen"] = "task" in pushed
        if "error" in pushed:
            item["screen_error"] = pushed["error"]
    return item


@mcp.tool()
def piano_check_chord(item_id: str, timeout_s: float = 45) -> dict:
    """After piano_next_chord(show=True): wait for Todd's next attempt at the
    keys and grade it (octave and inversion don't matter).

    Returns as soon as he plays something, so you can react by ear. A correct
    attempt is RECORDED for you: 'got' if it was his first try, 'shaky' if he
    needed more than one. A wrong attempt is not recorded; say a short
    correction and call this again, or call piano_record(item_id, 'missed') to
    move on. timed_out=True means he hasn't played anything yet.
    """
    global _seen
    got = _tutor(tutor_client.get_task)
    if "error" in got:
        return got
    task = got.get("task")
    if not task:
        return {"error": "no chord task on screen; call piano_next_chord(show=True) first"}
    tid = task["id"]
    after = got.get("lastGestureId", 0)  # anything played from here on wakes the wait
    deadline = time.monotonic() + timeout_s
    while True:
        attempts = task.get("attempts") or []
        seen = _seen[1] if _seen[0] == tid else 0
        if len(attempts) > seen:
            _seen = (tid, len(attempts))
            last = attempts[-1]
            out = {
                "verdict": last["verdict"],
                "played": last["names"],
                "missing": last["missing"],
                "extra": last["extra"],
                "attempt": len(attempts),
                "chord": task["label"],
            }
            if last["verdict"] == "correct":
                result = "got" if len(attempts) == 1 else "shaky"
                out["recorded"] = piano_drill.record(item_id, result, source="keys")
            return out
        left = deadline - time.monotonic()
        if left <= 0:
            return {"timed_out": True, "chord": task["label"]}
        polled = _tutor(tutor_client.wait_for_play, timeout_s=min(left, 30), after=after)
        if "error" in polled:
            return polled
        task = polled.get("task") or task
        if polled.get("gesture"):
            after = polled["gesture"]["id"]


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


@mcp.tool()
def tutor_status() -> dict:
    """Is the MidiTutor app up, is the keyboard connected, and what is on his
    screen right now (piece, bar, what he must play next, wrong-note count,
    current chord task)."""
    return _tutor(tutor_client.state)


@mcp.tool()
def tutor_recent(seconds: float = 30, limit: int = 50) -> dict:
    """What Todd played in the last `seconds`: raw notes (note-on/off with
    names like F#4) and gestures (notes struck together, with the chord name
    when they form one, e.g. "E minor"). source 'inject' = a test, not him."""
    return _tutor(tutor_client.recent, seconds=seconds, limit=limit)


@mcp.tool()
def tutor_wait_for_play(timeout_s: float = 30) -> dict:
    """Block until Todd plays his next note or chord (up to timeout_s, max 110)
    and return it: notes, names, chord name. Use it to listen live."""
    return _tutor(tutor_client.wait_for_play, timeout_s=min(timeout_s, 110))


@mcp.tool()
def tutor_show_chord(label: str, notes: list[str]) -> dict:
    """Put a chord task on his screen and arm a check. label is what he sees
    (e.g. "D major"); notes are the spelled answer (["D", "F#", "A"]), which
    stays hidden until he plays. Then tutor_check or tutor_wait_for_play."""
    return _tutor(tutor_client.show_chord, label, notes)


@mcp.tool()
def tutor_check() -> dict:
    """The current chord task and how his attempts went (attempts list,
    latest verdict: correct / incomplete / wrong, missing and extra notes)."""
    return _tutor(tutor_client.get_task)


@mcp.tool()
def tutor_clear() -> dict:
    """Take the chord task off his screen."""
    return _tutor(tutor_client.clear_task)


if __name__ == "__main__":
    mcp.run()
