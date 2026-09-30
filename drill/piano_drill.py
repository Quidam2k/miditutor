"""Piano drill engine: remembers what Todd drilled and serves what he hasn't.

Pantheon #3566 (Todd 2026-09-30). Voice-only at the piano, so the engine hands
back a chord NAME to speak and keeps the spelled notes separate (never spoken
unless he misses or asks).

Selection is a COVERAGE CYCLE: uniform random among catalog items not yet
covered in the current cycle. 'got' / 'shaky' cover an item; 'missed' leaves it
in the pool so it comes back later. When every item is covered a new cycle
starts. The cycle lives in the DB, so a partial session carries over to the
next one instead of redoing the first few every time.

Stdlib only. The MCP server (miditutor_mcp/server.py) and a future MIDI box
(TS/Electron) share catalog.json + data/drill.db.
"""
from __future__ import annotations

import json
import os
import random
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
CATALOG_PATH = Path(__file__).resolve().parent / "catalog.json"
DB_PATH = Path(os.environ.get("MIDITUTOR_DRILL_DB", ROOT / "data" / "drill.db"))
PACIFIC = ZoneInfo("America/Los_Angeles")
RESULTS = ("got", "shaky", "missed")

LETTERS = "CDEFGAB"
NATURAL_PC = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
ACC_WORD = {-2: " double flat", -1: " flat", 0: "", 1: " sharp", 2: " double sharp"}
QUALITY = {"major": (4, 3), "minor": (3, 4)}


# --- theory -------------------------------------------------------------
def _parse_note(tok: str) -> tuple[str, int]:
    letter, acc = tok[0].upper(), 0
    for ch in tok[1:]:
        acc += 1 if ch == "#" else -1 if ch == "b" else 0
    return letter, acc


def _pc(letter: str, acc: int) -> int:
    return (NATURAL_PC[letter] + acc) % 12


def spell_triad(root: str, quality: str) -> list[str]:
    """Spell a triad on alternating letters (A-C#-E, never A-Db-E)."""
    letter, acc = _parse_note(root)
    notes, pc = [(letter, acc)], _pc(letter, acc)
    idx = LETTERS.index(letter)
    for step in QUALITY[quality]:
        idx = (idx + 2) % 7
        pc = (pc + step) % 12
        nl = LETTERS[idx]
        diff = (pc - NATURAL_PC[nl]) % 12
        notes.append((nl, diff - 12 if diff > 6 else diff))
    return [n + ACC_WORD[a] for n, a in notes]


def speak_name(root: str, quality: str) -> str:
    letter, acc = _parse_note(root)
    return f"{letter}{ACC_WORD[acc]} {quality}"


# --- storage ------------------------------------------------------------
def _connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DB_PATH, timeout=10)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode=WAL")
    con.executescript(
        """
        CREATE TABLE IF NOT EXISTS cycles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            kind TEXT NOT NULL,
            started_ts TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            kind TEXT NOT NULL,
            item_id TEXT NOT NULL,
            result TEXT NOT NULL,
            said_as TEXT,
            session_date TEXT NOT NULL,
            ts TEXT NOT NULL,
            source TEXT
        );
        CREATE TABLE IF NOT EXISTS served (
            kind TEXT PRIMARY KEY,
            item_id TEXT NOT NULL,
            said_as TEXT,
            ts TEXT NOT NULL
        );
        """
    )
    return con


def _now() -> datetime:
    return datetime.now(timezone.utc)


def load_catalog(kind: str = "triad") -> list[dict]:
    items = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))["items"]
    return [i for i in items if i["kind"] == kind and i.get("enabled", True)]


def _current_cycle(con, kind: str) -> sqlite3.Row:
    row = con.execute(
        "SELECT * FROM cycles WHERE kind=? ORDER BY id DESC LIMIT 1", (kind,)
    ).fetchone()
    if row is None:
        con.execute(
            "INSERT INTO cycles(kind, started_ts) VALUES (?, ?)",
            (kind, "0000-00-00T00:00:00"),  # first cycle covers all history
        )
        row = con.execute(
            "SELECT * FROM cycles WHERE kind=? ORDER BY id DESC LIMIT 1", (kind,)
        ).fetchone()
    return row


def _covered(con, kind: str, since: str) -> set[str]:
    """Items whose LATEST result in this cycle is got/shaky (missed stays open)."""
    rows = con.execute(
        """SELECT item_id, result FROM history h
           WHERE kind=? AND ts >= ? AND id = (
               SELECT MAX(id) FROM history WHERE kind=h.kind AND item_id=h.item_id AND ts >= ?)""",
        (kind, since, since),
    ).fetchall()
    return {r["item_id"] for r in rows if r["result"] in ("got", "shaky")}


# --- public API -----------------------------------------------------------
def next_item(kind: str = "triad", rng: random.Random | None = None) -> dict:
    rng = rng or random
    catalog = load_catalog(kind)
    if not catalog:
        return {"error": f"no enabled {kind} items in catalog"}
    by_id = {i["id"]: i for i in catalog}
    with _connect() as con:
        cyc = _current_cycle(con, kind)
        covered = _covered(con, kind, cyc["started_ts"])
        pool = [i for i in by_id if i not in covered]
        new_cycle = False
        if not pool:
            con.execute(
                "INSERT INTO cycles(kind, started_ts) VALUES (?, ?)",
                (kind, _now().isoformat()),
            )
            pool, new_cycle = list(by_id), True
        last = con.execute("SELECT item_id FROM served WHERE kind=?", (kind,)).fetchone()
        if last and len(pool) > 1 and last["item_id"] in pool:
            pool.remove(last["item_id"])  # never the same chord twice in a row
        item = by_id[rng.choice(sorted(pool))]
        root = rng.choice(item["roots"])  # enharmonic items: say either name
        said = speak_name(root, item["quality"])
        con.execute(
            "INSERT OR REPLACE INTO served(kind, item_id, said_as, ts) VALUES (?,?,?,?)",
            (kind, item["id"], said, _now().isoformat()),
        )
        remaining = len([i for i in by_id if i not in covered]) if not new_cycle else len(by_id)
    return {
        "item_id": item["id"],
        "say": said,
        "answer_notes_DO_NOT_SPEAK": spell_triad(root, item["quality"]),
        "group": item.get("group"),
        "remaining_in_cycle": remaining,
        "total": len(by_id),
        "new_cycle_started": new_cycle,
    }


def record(item_id: str, result: str, kind: str = "triad", said_as: str | None = None,
           source: str = "voice", when: datetime | None = None) -> dict:
    if result not in RESULTS:
        return {"error": f"result must be one of {RESULTS}"}
    if item_id not in {i["id"] for i in load_catalog(kind)}:
        return {"error": f"unknown {kind} item {item_id!r}"}
    when = when or _now()
    with _connect() as con:
        _current_cycle(con, kind)
        if said_as is None:
            row = con.execute(
                "SELECT said_as FROM served WHERE kind=? AND item_id=?", (kind, item_id)
            ).fetchone()
            said_as = row["said_as"] if row else None
        con.execute(
            "INSERT INTO history(kind,item_id,result,said_as,session_date,ts,source) VALUES (?,?,?,?,?,?,?)",
            (kind, item_id, result, said_as, when.astimezone(PACIFIC).date().isoformat(),
             when.isoformat(), source),
        )
    return {"item_id": item_id, "result": result, **status(kind)}


def status(kind: str = "triad") -> dict:
    catalog = load_catalog(kind)
    by_id = {i["id"]: i for i in catalog}
    today = _now().astimezone(PACIFIC).date().isoformat()
    with _connect() as con:
        cyc = _current_cycle(con, kind)
        covered = _covered(con, kind, cyc["started_ts"])
        todays = con.execute(
            "SELECT item_id, result FROM history WHERE kind=? AND session_date=? ORDER BY id",
            (kind, today),
        ).fetchall()

    def name(i):
        it = by_id[i]
        return " / ".join(speak_name(r, it["quality"]) for r in it["roots"])

    return {
        "done_this_cycle": len(covered & set(by_id)),
        "total": len(by_id),
        "remaining": [name(i) for i in by_id if i not in covered],
        "today": [f"{name(r['item_id'])}: {r['result']}" for r in todays if r["item_id"] in by_id],
    }
