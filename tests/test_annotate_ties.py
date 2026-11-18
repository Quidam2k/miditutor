"""Ties read off the page go in only when they are real ties (#5085)."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import annotate_scan as an  # noqa: E402


def _note(step, octave, duration=4, tie=None, staff=1):
    tied = f'<tie type="{tie}"/>' if tie else ""
    notations = f'<notations><tied type="{tie}"/></notations>' if tie else ""
    return (f"<note><pitch><step>{step}</step><octave>{octave}</octave></pitch>"
            f"<duration>{duration}</duration>{tied}<voice>1</voice><staff>{staff}</staff>{notations}</note>")


def _rest(duration=4):
    return f"<note><rest/><duration>{duration}</duration><voice>1</voice><staff>1</staff></note>"


ATTRS = "<attributes><divisions>4</divisions><time><beats>2</beats><beat-type>4</beat-type></time></attributes>"


def _score(tmp_path, *measures):
    body = "".join(f'<measure number="{i}">{ATTRS if i == 1 else ""}{m}</measure>'
                   for i, m in enumerate(measures, 1))
    path = tmp_path / "s.musicxml"
    path.write_text('<?xml version="1.0"?><score-partwise><part-list/><part id="P1">'
                    f"{body}</part></score-partwise>", encoding="utf-8")
    return path


def _run(tmp_path, score, *ties):
    reads = tmp_path / "r.json"
    reads.write_text(json.dumps({"page": "01.png", "ties": list(ties)}), encoding="utf-8")
    out, report = tmp_path / "out.musicxml", tmp_path / "rep.json"
    result = an.annotate(score, [reads], out, report)
    text = out.read_text(encoding="utf-8")
    return result, text.count('<tie type="start"'), text.count('<tie type="stop"')


def tie(measure, pitch, nth=1, to=None, confidence=0.9, staff=1):
    item = {"measure": measure, "staff": staff, "pitch": pitch, "nth": nth, "confidence": confidence}
    if to is not None:
        item["to_measure"] = to
    return item


def test_tie_across_the_bar_line_is_placed(tmp_path):
    score = _score(tmp_path, _note("C", 4) + _note("C", 5), _note("C", 5) + _note("D", 5))
    result, starts, stops = _run(tmp_path, score, tie(1, "C5", to=2))
    assert result["placed"]["ties"] == 1 and (starts, stops) == (1, 1)
    assert result["unmatched"] == []


def test_tie_inside_a_bar_is_placed(tmp_path):
    score = _score(tmp_path, _note("E", 4) + _note("E", 4))
    result, starts, stops = _run(tmp_path, score, tie(1, "E4"))
    assert result["placed"]["ties"] == 1 and (starts, stops) == (1, 1)


def test_wrong_pitch_is_refused(tmp_path):
    score = _score(tmp_path, _note("C", 4) + _note("C", 5), _note("D", 5) + _note("D", 5))
    result, starts, _ = _run(tmp_path, score, tie(1, "C5", to=2))
    assert starts == 0 and result["unmatched"][0]["reason"] == "not-adjacent"


def test_not_the_next_onset_is_refused(tmp_path):
    # A rest between the two C5s: a curve over them is a slur, not a tie.
    score = _score(tmp_path, _note("C", 5) + _rest(), _note("C", 5) + _rest())
    result, starts, _ = _run(tmp_path, score, tie(1, "C5", to=2))
    assert starts == 0 and result["unmatched"][0]["reason"] == "not-adjacent"


def test_skipping_past_the_next_one_is_refused(tmp_path):
    # The read says bar 1 ties to bar 3, but bar 2 holds the next C5.
    score = _score(tmp_path, _rest() + _note("C", 5), _note("C", 5) + _rest(), _note("C", 5) + _rest())
    result, starts, _ = _run(tmp_path, score, tie(1, "C5", to=3))
    assert starts == 0 and result["unmatched"][0]["reason"] == "wrong-partner"


def test_low_confidence_is_refused(tmp_path):
    score = _score(tmp_path, _note("E", 4) + _note("E", 4))
    result, starts, _ = _run(tmp_path, score, tie(1, "E4", confidence=0.6))
    assert starts == 0 and result["unmatched"][0]["reason"] == "low-confidence"


def test_other_staff_is_refused(tmp_path):
    score = _score(tmp_path, _note("E", 4) + _note("E", 4))
    result, starts, _ = _run(tmp_path, score, tie(1, "E4", staff=2))
    assert starts == 0 and result["unmatched"][0]["reason"] == "no-note"


def test_already_tied_is_left_alone(tmp_path):
    score = _score(tmp_path, _note("E", 4, tie="start") + _note("E", 4, tie="stop"))
    result, starts, stops = _run(tmp_path, score, tie(1, "E4"))
    assert result["placed"]["ties"] == 0 and result["unmatched"] == []
    assert (starts, stops) == (1, 1)


def test_audit_counts_a_held_note_into_the_same_pitch_untied(tmp_path):
    import omr_audit
    untied = _score(tmp_path, _note("C", 4) + _note("C", 5), _note("C", 5) + _note("D", 5))
    assert omr_audit.possible_missed_ties(an.Score(untied)) == 1
    tied = _score(tmp_path, _note("C", 4) + _note("C", 5, tie="start"), _note("C", 5, tie="stop") + _note("D", 5))
    assert omr_audit.possible_missed_ties(an.Score(tied)) == 0


def test_ties_go_in_after_fingerings_so_nth_does_not_shift(tmp_path):
    # Page 1 ties E4 #1 to E4 #2; a later page's fingering on E4 nth 2 must still find the second E4.
    score = _score(tmp_path, _note("E", 4) + _note("E", 4))
    first = tmp_path / "a.ties.json"
    first.write_text(json.dumps({"page": "01.png", "ties": [tie(1, "E4")]}), encoding="utf-8")
    second = tmp_path / "b.json"
    second.write_text(json.dumps({"page": "02.png", "fingerings": [
        {"measure": 1, "staff": 1, "pitch": "E4", "nth": 2, "digit": 3, "confidence": 0.9}]}), encoding="utf-8")
    result = an.annotate(score, [first, second], tmp_path / "out.musicxml")
    assert result["placed"] == {"fingerings": 1, "chords": 0, "expressions": 0, "ties": 1}
