"""Tests for scripts/review_queue.py (scan review proposals and apply). No network, no real claude."""
import hashlib
import json
import os
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

import pytest
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import review_queue as rq  # noqa: E402
import omr_fix  # noqa: E402
from annotate_scan import Score  # noqa: E402

SLUG = "demo"
MARK = "mark-1"


def _note(step, octave, dur, staff, chord=False):
    head = "<chord/>" if chord else ""
    return (f"<note>{head}<pitch><step>{step}</step><octave>{octave}</octave></pitch>"
            f"<duration>{dur}</duration><voice>1</voice><staff>{staff}</staff></note>")


def _bar(number, top, bottom, first=False):
    attrs = ""
    if first:
        attrs = ("<attributes><divisions>2</divisions><key><fifths>0</fifths></key>"
                 "<time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves>"
                 '<clef number="1"><sign>G</sign><line>2</line></clef>'
                 '<clef number="2"><sign>F</sign><line>4</line></clef></attributes>')
    return (f'<measure number="{number}">{attrs}{top}<backup><duration>8</duration></backup>'
            f"{bottom}</measure>")


def _score_text():
    quarters = "".join(_note(s, o, 2, 1) for s, o in (("C", 5), ("E", 5), ("G", 5), ("C", 6)))
    bars = [_bar(1, _note("C", 5, 8, 1), _note("C", 3, 8, 2), first=True),
            _bar(2, quarters, _note("C", 3, 8, 2)),
            _bar(3, _note("D", 5, 8, 1), _note("D", 3, 8, 2))]
    return ('<?xml version="1.0" encoding="UTF-8"?>\n<score-partwise version="3.1">'
            '<work><work-title>Demo Piece</work-title></work>'
            '<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>'
            '<part id="P1">' + "".join(bars) + "</part></score-partwise>\n")


@pytest.fixture(autouse=True)
def plenty_of_ram(monkeypatch):
    monkeypatch.setattr(rq, "available_ram_gb", lambda: 32.0)


@pytest.fixture
def lib(tmp_path):
    score = tmp_path / f"{SLUG}.musicxml"
    score.write_text(_score_text(), encoding="utf-8")
    pages = tmp_path / "pages" / SLUG
    pages.mkdir(parents=True)
    image = Image.new("RGB", (3000, 1200), "white")
    draw = ImageDraw.Draw(image)
    for x in (100, 1000, 1900, 2800):
        draw.line([(x, 100), (x, 900)], fill="black", width=3)
    image.save(pages / "01.png")
    review = tmp_path / "review"
    review.mkdir()
    layout = {"score_sha256": hashlib.sha256(score.read_bytes()).hexdigest(), "crop_scale": 0.5,
              "pages": [{"file": "01.png", "angle": 0}],
              "systems": [{"index": 1, "page": "01.png", "y0": 100, "y1": 900, "spacing": 20,
                           "barlines": [100, 1000, 1900, 2800], "measures": [1, 3]}]}
    (review / f"{SLUG}.layout.json").write_text(json.dumps(layout), encoding="utf-8")
    mark = {"id": MARK, "kind": "mark", "system": 1, "measure": 2, "staff": 1,
            "note": "last note looks too high", "ts": 1}
    _events(tmp_path, [mark])
    return tmp_path


def _events(lib, events, extra_lines=()):
    lines = [json.dumps(e) for e in events] + list(extra_lines)
    (lib / "review" / f"{SLUG}.events.jsonl").write_text("\n".join(lines) + "\n", encoding="utf-8")


def _fake(answer, seen=None):
    def caller(prompt, image_path, model, timeout):
        if seen is not None:
            seen.append(prompt)
        return (answer if isinstance(answer, str) else json.dumps(answer)), 0.01
    return caller


FIX = {"verdict": "fix", "explanation": "The last note is an octave too high.",
       "edits": [{"op": "transpose_note", "measure": 2, "staff": 1, "pitch": "C6", "semitones": -12}]}


def _sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def _last_json(capsys):
    return json.loads(capsys.readouterr().out.strip().splitlines()[-1])


def _score(lib):
    return Score(lib / f"{SLUG}.musicxml")


# ---- listing and crop ----------------------------------------------------------------------

def _lanes(root, position):
    """{(staff, voice): [(pitches, duration ticks)]} read straight from the XML."""
    measure = list(root.find("part"))[position - 1]
    lanes = {}
    for note in measure.findall("note"):
        key = (note.findtext("staff"), note.findtext("voice"))
        pitch = None
        if note.find("pitch") is not None:
            pitch = note.findtext("pitch/step") + note.findtext("pitch/octave")
        if note.find("chord") is not None:
            lanes[key][-1][0].append(pitch)
        else:
            lanes.setdefault(key, []).append(([pitch], note.findtext("duration")))
    return lanes


def test_listing_format_and_inheritance(lib):
    listing = rq.measure_listing(_score(lib), 2)
    assert listing["time"] == "4/4" and listing["key_fifths"] == 0 and listing["number"] == "2"
    assert listing["staves"]["1"]["1"] == [{"notes": [n], "dur": "1"} for n in ("C5", "E5", "G5", "C6")]
    assert listing["staves"]["2"]["1"] == [{"notes": ["C3"], "dur": "4"}]
    assert listing["grace"] == [] and listing["has_backup_gaps"] is False


def test_listing_chords_rests_accidentals_grace_and_forward(tmp_path):
    text = _score_text().replace(
        _note("D", 5, 8, 1),
        '<note><grace/><pitch><step>B</step><alter>-1</alter><octave>4</octave></pitch>'
        '<voice>1</voice><staff>1</staff></note>'
        '<note><pitch><step>F</step><alter>1.0</alter><octave>5</octave></pitch><duration>3</duration>'
        '<voice>1</voice><staff>1</staff></note>' + _note("A", 5, 3, 1, chord=True)
        + '<note><rest/><duration>1</duration><voice>1</voice><staff>1</staff></note>'
        '<forward><duration>4</duration><voice>1</voice></forward>')
    path = tmp_path / "x.musicxml"
    path.write_text(text, encoding="utf-8")
    listing = rq.measure_listing(Score(path), 3)
    assert listing["grace"] == ["Bb4"]
    assert listing["staves"]["1"]["1"] == [{"notes": ["F#5", "A5"], "dur": "3/2"},
                                           {"rest": True, "dur": "1/2"}, {"rest": True, "dur": "2"}]
    assert listing["has_backup_gaps"] is False


def test_listing_flags_a_voice_that_starts_late(tmp_path):
    text = _score_text().replace(_note("D", 3, 8, 2),
                                 '<forward><duration>2</duration></forward>' + _note("D", 3, 6, 2))
    path = tmp_path / "x.musicxml"
    path.write_text(text, encoding="utf-8")
    # the forward has no staff, so it lands in staff 1's lane after the top voice: still a gap on staff 2
    assert rq.measure_listing(Score(path), 3)["has_backup_gaps"] is True


@pytest.mark.parametrize("position", [1, 2, 3])
def test_listing_round_trips_through_replace_measure(lib, position):
    score = _score(lib)
    listing = rq.measure_listing(score, position)
    edit = {"op": "replace_measure", "measure": position, "staves": listing["staves"]}
    new_root = omr_fix.apply_edits(score.root, [edit])
    assert _lanes(new_root, position) == _lanes(score.root, position)


def test_crop_box_first_middle_last():
    system = {"y0": 100, "y1": 900, "spacing": 20, "barlines": [100, 1000, 1900, 2800], "measures": [1, 3]}
    # first bar: no bar before it, one after
    assert rq.crop_box(system, 1, (3000, 1200)) == (60, 60, 1940, 900, 40, 940)
    # middle bar: one either side
    assert rq.crop_box(system, 2, (3000, 1200)) == (60, 60, 2840, 900, 940, 1840)
    # last bar: clamped at the system end (2800 + 40 = 2840 fits the page)
    assert rq.crop_box(system, 3, (3000, 1200)) == (960, 60, 2840, 900, 940, 1840)
    # page clamp on the right and top
    assert rq.crop_box(system, 3, (2820, 1200))[2] == 2820
    assert rq.crop_box(dict(system, y0=10), 2, (3000, 1200))[1] == 0
    with pytest.raises(ValueError):
        rq.crop_box(system, 4, (3000, 1200))


def test_make_crop_draws_red_bracket_over_target_bar(lib):
    layout = json.loads((lib / "review" / f"{SLUG}.layout.json").read_text())
    out = lib / "crop.png"
    rq.make_crop(lib, SLUG, layout, layout["systems"][0], 2, out)
    image = Image.open(out).convert("RGB")
    assert image.width <= rq.MAX_CROP_WIDTH
    scale = image.width / 2780
    y = int(30 * scale)
    r, g, b = image.getpixel((int(1400 * scale), y))                 # inside the target bar
    assert r > 200 and g < 80 and b < 80
    assert image.getpixel((int(300 * scale), y)) == (255, 255, 255)  # a context bar


# ---- validate ------------------------------------------------------------------------------

def _validate(lib, edits, target=2):
    return rq.validate(lib / f"{SLUG}.musicxml", edits, target)


def test_validate_accepts_transpose(lib):
    data, log, before, after = _validate(lib, FIX["edits"])
    assert b"<octave>5</octave>" in data and log and before == [] and after == []


def test_validate_rejects_other_measure(lib):
    with pytest.raises(ValueError, match="outside bar 2"):
        _validate(lib, [dict(FIX["edits"][0], measure=3)])


def test_validate_rejects_structural_ops(lib):
    with pytest.raises(ValueError, match="by hand"):
        _validate(lib, [{"op": "delete_measure", "measure": 2}])
    with pytest.raises(ValueError, match="by hand"):
        _validate(lib, [{"op": "split_measure", "measure": 2}])


def test_validate_rejects_unknown_op_and_empty(lib):
    with pytest.raises(ValueError):
        _validate(lib, [{"op": "explode", "measure": 2}])
    with pytest.raises(ValueError):
        _validate(lib, [])


def test_validate_rejects_noop(lib):
    noop = [{"op": "transpose_note", "measure": 2, "staff": 1, "pitch": "C5", "semitones": 0}]
    with pytest.raises(ValueError, match="no difference"):
        _validate(lib, noop)


def test_validate_rejects_fill_worse(lib):
    quarters = [{"notes": ["C5"], "dur": "1"}] * 5
    edit = {"op": "replace_measure", "measure": 2,
            "staves": {"1": {"1": quarters}, "2": {"1": [{"notes": ["C3"], "dur": "4"}]}}}
    with pytest.raises(ValueError, match="new problem in bar 2: bar length"):
        _validate(lib, [edit])


def test_validate_leaves_no_temp_file_and_score_untouched(lib):
    before = (lib / f"{SLUG}.musicxml").read_bytes()
    _validate(lib, FIX["edits"])
    assert (lib / f"{SLUG}.musicxml").read_bytes() == before
    assert not list((lib / "review").glob(".cand-*"))


# ---- propose -------------------------------------------------------------------------------

def test_propose_ready(lib):
    before = (lib / f"{SLUG}.musicxml").read_bytes()
    seen = []
    code, payload = rq.run_propose(lib, SLUG, MARK, "m", 5, caller=_fake(FIX, seen))
    record = payload["proposal"]
    proposals = lib / "review" / f"{SLUG}.proposals"
    assert code == 0 and record["status"] == "ready" and record["measure"] == 2
    assert (proposals / f"{record['id']}.musicxml").is_file()
    assert (proposals / f"{record['id']}.png").is_file()
    assert json.loads((proposals / f"{record['id']}.json").read_text())["id"] == record["id"]
    assert record["base_sha256"] == hashlib.sha256(before).hexdigest()
    assert (lib / f"{SLUG}.musicxml").read_bytes() == before
    assert not (lib / "review" / ".queue.lock").exists()
    assert "last note looks too high" in seen[0] and "TARGET bar" in seen[0] and "Demo Piece" in seen[0]


def test_propose_prompt_includes_rejections_and_earlier_proposals(lib):
    first = rq.run_propose(lib, SLUG, MARK, "m", 5, caller=_fake(FIX))[1]["proposal"]
    _events(lib, [{"id": MARK, "kind": "mark", "system": 1, "measure": 2, "staff": 1, "note": "n", "ts": 1},
                  {"id": "r1", "kind": "reject", "mark": MARK, "note": "still wrong, wrong hand",
                   "ts": first["created"] + 1}])
    seen = []
    record = rq.run_propose(lib, SLUG, MARK, "m", 5, caller=_fake(FIX, seen))[1]["proposal"]
    assert "still wrong, wrong hand" in seen[0] and "octave too high" in seen[0]
    assert record["rejections_seen"] == 1 and record["id"] != first["id"]


def test_propose_correct_is_no_change(lib):
    answer = {"verdict": "correct", "explanation": "ok", "edits": []}
    fenced = "```json\n" + json.dumps(answer) + "\n```"
    code, payload = rq.run_propose(lib, SLUG, MARK, "m", 5, caller=_fake(fenced))
    record = payload["proposal"]
    assert code == 0 and record["status"] == "no_change" and record["explanation"] == "ok"
    assert record["proposed"] is None


def test_propose_prose_around_json_is_parsed(lib):
    text = 'Sure! {"note": 1} then ' + json.dumps(FIX) + " done."
    assert rq.run_propose(lib, SLUG, MARK, "m", 5, caller=_fake(text))[1]["proposal"]["status"] == "ready"


def test_propose_unusable_answer_fails(lib):
    record = rq.run_propose(lib, SLUG, MARK, "m", 5, caller=_fake("I cannot tell."))[1]["proposal"]
    assert record["status"] == "failed" and record["reason"] == "The checker's answer wasn't usable."


def test_propose_caller_error_fails_but_keeps_crop(lib):
    def boom(prompt, image_path, model, timeout):
        raise RuntimeError("The checker took too long.")
    code, payload = rq.run_propose(lib, SLUG, MARK, "m", 5, caller=boom)
    record = payload["proposal"]
    assert code == 0 and record["status"] == "failed" and "too long" in record["reason"]
    assert (lib / "review" / f"{SLUG}.proposals" / f"{record['id']}.png").is_file()


def test_propose_invalid_edit_fails_with_reason(lib):
    bad = dict(FIX, edits=[{"op": "delete_measure", "measure": 2}])
    record = rq.run_propose(lib, SLUG, MARK, "m", 5, caller=_fake(bad))[1]["proposal"]
    assert record["status"] == "failed" and "by hand" in record["reason"]


def test_propose_withdrawn_mark_exits_2(lib, capsys):
    _events(lib, [{"id": MARK, "kind": "mark", "system": 1, "measure": 2, "staff": 1, "note": "", "ts": 1},
                  {"id": "w1", "kind": "withdraw", "mark": MARK}], extra_lines=["{broken", ""])
    assert rq.main(["propose", "--library", str(lib), SLUG, MARK]) == 2
    assert _last_json(capsys)["ok"] is False


def test_propose_unknown_slug_and_bad_ids_exit_2(lib, capsys):
    assert rq.main(["propose", "--library", str(lib), "nope", MARK]) == 2
    assert rq.main(["propose", "--library", str(lib), "Bad Slug", MARK]) == 2
    assert rq.main(["propose", "--library", str(lib), SLUG, "../x"]) == 2
    assert rq.main(["propose", "--library", str(lib)]) == 2
    assert _last_json(capsys)["ok"] is False


def test_propose_stale_layout_exits_2(lib, capsys):
    (lib / f"{SLUG}.musicxml").write_text(_score_text() + "<!-- changed -->", encoding="utf-8")
    assert rq.main(["propose", "--library", str(lib), SLUG, MARK]) == 2
    assert "out of date" in _last_json(capsys)["error"]


def test_propose_busy_when_lock_held_by_live_pid(lib, capsys):
    lock = lib / "review" / ".queue.lock"
    lock.write_text(str(os.getpid()))
    assert rq.main(["propose", "--library", str(lib), SLUG, MARK]) == 3
    assert _last_json(capsys) == {"ok": False, "error": "Another check is running."}
    assert lock.exists()


def test_stale_lock_is_replaced(lib):
    (lib / "review" / ".queue.lock").write_text("999999999")
    code, _ = rq.run_propose(lib, SLUG, MARK, "m", 5, caller=_fake(FIX))
    assert code == 0 and not (lib / "review" / ".queue.lock").exists()


def test_propose_deferred_when_memory_is_short(lib, capsys, monkeypatch):
    monkeypatch.setattr(rq, "available_ram_gb", lambda: 1)
    assert rq.main(["propose", "--library", str(lib), SLUG, MARK]) == 4
    assert "short of memory" in _last_json(capsys)["error"]
    assert not (lib / "review" / ".queue.lock").exists()


# ---- apply ---------------------------------------------------------------------------------

def _second_fix():
    return {"verdict": "fix", "explanation": "E is wrong.",
            "edits": [{"op": "transpose_note", "measure": 2, "staff": 1, "pitch": "E5", "semitones": -12}]}


def test_apply_writes_orig_once_logs_and_refuses_on_sha_mismatch(lib, capsys):
    score = lib / f"{SLUG}.musicxml"
    original = score.read_bytes()
    one = rq.run_propose(lib, SLUG, MARK, "m", 5, caller=_fake(FIX))[1]["proposal"]
    two = rq.run_propose(lib, SLUG, MARK, "m", 5, caller=_fake(_second_fix()))[1]["proposal"]
    assert one["status"] == two["status"] == "ready"

    assert rq.main(["apply", "--library", str(lib), SLUG, one["id"]]) == 0
    result = _last_json(capsys)
    assert result["ok"] and result["before"] != result["after"] and result["after"] == _sha(score)
    assert any("transpose_note" in line for line in result["log"])
    assert b"<octave>6</octave>" not in score.read_bytes()
    assert (lib / f"{SLUG}.musicxml.orig").read_bytes() == original

    # the second proposal was made against the old score
    assert rq.main(["apply", "--library", str(lib), SLUG, two["id"]]) == 5
    assert "changed" in _last_json(capsys)["error"]

    path = lib / "review" / f"{SLUG}.proposals" / f"{two['id']}.json"
    record = json.loads(path.read_text())
    record["base_sha256"] = _sha(score)
    path.write_text(json.dumps(record))
    assert rq.main(["apply", "--library", str(lib), SLUG, two["id"]]) == 0
    capsys.readouterr()
    assert (lib / f"{SLUG}.musicxml.orig").read_bytes() == original
    log = (lib / "review" / f"{SLUG}.log").read_text(encoding="utf-8")
    assert log.count(" accept proposal=") == 2 and f"proposal={one['id']} mark={MARK} bar=2" in log
    assert "  [transpose_note] m2" in log
    assert not (lib / "review" / ".queue.lock").exists()


def test_apply_refuses_proposal_that_is_not_ready(lib, capsys):
    answer = {"verdict": "correct", "explanation": "ok", "edits": []}
    record = rq.run_propose(lib, SLUG, MARK, "m", 5, caller=_fake(answer))[1]["proposal"]
    assert rq.main(["apply", "--library", str(lib), SLUG, record["id"]]) == 5
    assert rq.main(["apply", "--library", str(lib), SLUG, "missing"]) == 2
    assert _last_json(capsys)["ok"] is False


def test_apply_busy(lib):
    (lib / "review" / ".apply.lock").write_text(str(os.getpid()))
    assert rq.main(["apply", "--library", str(lib), SLUG, "abc"]) == 3


def test_apply_does_not_wait_behind_a_running_check(lib):
    record = rq.run_propose(lib, SLUG, MARK, "m", 5, caller=_fake(FIX))[1]["proposal"]
    (lib / "review" / ".queue.lock").write_text(str(os.getpid()))
    assert rq.run_apply(lib, SLUG, record["id"])[0] == 0
