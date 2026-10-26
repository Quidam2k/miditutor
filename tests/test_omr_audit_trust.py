"""Tests for OMR audit trust computation and merge-only persistence."""

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import omr_audit as oa


def test_bar_ranges_groups_sorted_unique_bars():
    assert oa.bar_ranges([8, 2, 1, 3, 7, 5, 2]) == "1-3, 5, 7-8"
    assert oa.bar_ranges([27]) == "27"
    assert oa.bar_ranges([]) == ""


def test_bar_ranges_limits_groups_and_counts_omitted_groups():
    bars = [1, 2, 3, 5, 7, 8, 10]
    assert oa.bar_ranges(bars, limit=2) == "1-3, 5 (+2 more)"
    assert oa.bar_ranges(bars, limit=4) == "1-3, 5, 7-8, 10"
    assert oa.bar_ranges(range(1, 16, 2)) == "1, 3, 5, 7, 9, 11 (+2 more)"


def test_confirmed_bars_reads_only_tagged_bullets_in_confirmed_section():
    report = """# Audit report

### outside-before
- m1 [real_misread]

## Suspected errors
### suspect
- m2 [real_misread]

## Confirmed errors, piece by piece
- m3 [real_misread] No piece heading yet.

### first-piece
- m27 s1 [real_misread] Wrong note; compare m99.
- m28-m31 [real_misread] Wrong notes across four bars.
- m29 [real_misread] Duplicate finding.
- m32 [false_positive] Not a confirmed misread.
- m33 Untagged finding.
- explanation mentioning m34 [real_misread]
* m35 [real_misread]
Text mentioning m36 [real_misread].

### second-piece
- m4 [real_misread] Wrong note.

### untagged-piece
- m5 [false_positive]

## Follow-up
### first-piece
- m90 [real_misread]
### outside-after
- m91 [real_misread]
"""
    assert oa.confirmed_bars(report) == {
        "first-piece": {27, 28, 29, 30, 31},
        "second-piece": {4},
    }


def test_rhythm_bars_ignores_raw_only_underfull_and_pitch_flags():
    ignored = [
        {"check": "time_signature", "measure": 1, "raw_only": True},
        {
            "check": "bar_length",
            "detail": "overfull: raw score",
            "measure": 2,
            "raw_only": True,
        },
        {
            "check": "bar_length",
            "detail": "underfull: short voice",
            "measure": 3,
        },
        {"check": "leap", "detail": "large leap", "measure": 6},
    ]
    assert oa.rhythm_bars({"flags": ignored}) == (False, set())

    flags = ignored + [
        {"check": "time_signature", "measure": 1},
        {
            "check": "bar_length",
            "detail": "overfull: long voice",
            "measure": 4,
        },
        {
            "check": "bar_length",
            "detail": "overfull: another voice",
            "measure": 4,
        },
        {
            "check": "bar_length",
            "detail": "overfull: long voice",
            "measure": 5,
        },
    ]
    assert oa.rhythm_bars({"flags": flags}) == (True, {4, 5})
    assert oa.rhythm_bars({}) == (False, set())


def test_issue_note_wording_and_part_order():
    time_signature = {"check": "time_signature", "measure": 1}
    timing = [
        {"check": "bar_length", "detail": "overfull: long voice", "measure": bar}
        for bar in (4, 5, 8)
    ]

    assert oa.issue_note({"flags": []}, set()) is None
    assert oa.issue_note(
        {"flags": [time_signature]}, set()
    ) == "wrong time signature"
    assert oa.issue_note(
        {"flags": timing}, set()
    ) == "timing off in bars 4-5, 8"
    assert oa.issue_note(
        {"flags": []}, {27, 28, 31}
    ) == "notes misread in bars 27-28, 31"
    assert oa.issue_note(
        {"flags": [time_signature] + timing}, {27, 28, 31}
    ) == (
        "wrong time signature; timing off in bars 4-5, 8; "
        "notes misread in bars 27-28, 31"
    )


def test_piece_trust_issues_beat_fully_checked_repair_and_comparison():
    repair = {"fully_checked": True, "remaining_note": ""}
    comparison = {"piece_agreement": 1.0}

    assert oa.piece_trust({"flags": []}, {27}, repair, comparison) == {
        "status": "issues",
        "note": "notes misread in bars 27",
        "source": "omr_audit",
    }
    assert oa.piece_trust(
        {"flags": [{"check": "time_signature", "measure": 1}]},
        set(),
        repair,
        comparison,
    ) == {
        "status": "issues",
        "note": "wrong time signature",
        "source": "omr_audit",
    }


def test_piece_trust_repair_requires_fully_checked_and_no_remaining_note():
    assert oa.piece_trust(
        {"flags": []},
        set(),
        {"fully_checked": True, "remaining_note": ""},
        None,
    ) == {
        "status": "checked",
        "note": "checked against the page",
        "source": "omr_audit",
    }

    for repair in (
        {"fully_checked": True, "remaining_note": "Check the final page"},
        {"fully_checked": False, "remaining_note": ""},
        {"remaining_note": ""},
    ):
        assert oa.piece_trust({"flags": []}, set(), repair, None) == {
            "status": "unverified",
            "note": "not yet checked against the page",
            "source": "omr_audit",
        }


def test_piece_trust_comparison_threshold_and_bar_count_mismatch():
    for agreement in (0.70, 0.95):
        assert oa.piece_trust(
            {"flags": []}, set(), None, {"piece_agreement": agreement}
        ) == {
            "status": "checked",
            "note": "checked against the page",
            "source": "omr_audit",
        }

    for comparison in (
        {"piece_agreement": 0.699},
        {
            "piece_agreement": 0.99,
            "bar_count_mismatch": {"library": 12, "homr": 13},
        },
        {},
    ):
        assert oa.piece_trust({"flags": []}, set(), None, comparison) == {
            "status": "unverified",
            "note": "not yet checked against the page",
            "source": "omr_audit",
        }


def test_piece_trust_defaults_to_unverified_without_page_checks():
    assert oa.piece_trust({"flags": []}, set(), None, None) == {
        "status": "unverified",
        "note": "not yet checked against the page",
        "source": "omr_audit",
    }


def test_merge_trust_preserves_other_sources_and_reconciles_owned_entries():
    midi_entry = {
        "status": "unverified",
        "note": "Converted from MIDI",
        "source": "midi_to_score",
    }
    manual_entry = {
        "status": "checked",
        "note": "Checked manually",
        "source": "manual",
    }
    legacy_entry = {"status": "unverified", "note": "Legacy note"}
    replacement = {
        "status": "issues",
        "note": "notes misread in bars 9",
        "source": "omr_audit",
    }
    existing = {
        "converted.musicxml": midi_entry,
        "manual.musicxml": manual_entry,
        "current.musicxml": {
            "status": "unverified",
            "note": "Old audit",
            "source": "omr_audit",
        },
        "stale.musicxml": {
            "status": "checked",
            "note": "Old audit",
            "source": "omr_audit",
        },
        "legacy.musicxml": legacy_entry,
        "legacy-updated.musicxml": {"status": "unverified"},
    }
    computed = {
        "converted.musicxml": replacement,
        "current.musicxml": replacement,
        "legacy-updated.musicxml": replacement,
        "new.musicxml": replacement,
    }

    assert oa.merge_trust(existing, computed) == {
        "converted.musicxml": midi_entry,
        "manual.musicxml": manual_entry,
        "current.musicxml": replacement,
        "legacy.musicxml": legacy_entry,
        "legacy-updated.musicxml": replacement,
        "new.musicxml": replacement,
    }


def test_load_trust_missing_file_and_valid_object(tmp_path):
    path = tmp_path / "trust.json"
    assert oa.load_trust(path) == {}

    data = {
        "piece.musicxml": {
            "status": "checked",
            "note": "checked against the page",
            "source": "omr_audit",
        }
    }
    path.write_text(json.dumps(data), encoding="utf-8")
    assert oa.load_trust(path) == data


def test_load_trust_rejects_non_object_json(tmp_path):
    path = tmp_path / "trust.json"
    for value in ([], ["piece.musicxml"], None, "text", 42):
        path.write_text(json.dumps(value), encoding="utf-8")
        with pytest.raises(ValueError):
            oa.load_trust(path)


def test_load_trust_raises_on_corrupt_json(tmp_path):
    path = tmp_path / "trust.json"
    path.write_text('{"piece.musicxml":', encoding="utf-8")

    with pytest.raises(json.JSONDecodeError):
        oa.load_trust(path)


def test_write_trust_uses_two_space_indent_and_sorted_keys(tmp_path):
    path = tmp_path / "trust.json"
    data = {
        "z.musicxml": {
            "status": "unverified",
            "source": "omr_audit",
            "note": "not yet checked against the page",
        },
        "a.musicxml": {
            "status": "checked",
            "source": "omr_audit",
            "note": "checked against the page",
        },
    }

    oa.write_trust(path, data)

    text = path.read_text(encoding="utf-8")
    assert text.rstrip("\n") == json.dumps(data, indent=2, sort_keys=True)
    assert json.loads(text) == data


def test_trust_command_computes_entries_and_preserves_midi_trust(tmp_path):
    library = tmp_path / "library"
    library.mkdir()
    annotate = tmp_path / "annotate" / "omr_audit"
    annotate.mkdir(parents=True)

    for name in ("audited.musicxml", "converted.musicxml"):
        (library / name).write_text("<score-partwise/>", encoding="utf-8")

    lint = {
        "pieces": {
            "audited": {
                "flags": [
                    {
                        "check": "bar_length",
                        "detail": "overfull: long voice",
                        "measure": 4,
                    }
                ]
            },
            "converted": {"flags": []},
        }
    }
    (annotate / "lint.json").write_text(json.dumps(lint), encoding="utf-8")

    report = tmp_path / "report.md"
    report.write_text(
        "## Confirmed errors, piece by piece\n"
        "### audited\n"
        "- m27 [real_misread] Wrong note.\n",
        encoding="utf-8",
    )

    midi_entry = {
        "status": "unverified",
        "note": "Converted from MIDI: no fingering.",
        "source": "midi_to_score",
    }
    out = library / "trust.json"
    out.write_text(
        json.dumps(
            {
                "converted.musicxml": midi_entry,
                "stale.musicxml": {
                    "status": "checked",
                    "note": "Old audit",
                    "source": "omr_audit",
                },
            }
        ),
        encoding="utf-8",
    )

    computed = oa.trust_command(library, annotate, report, out)

    audited_entry = {
        "status": "issues",
        "note": "timing off in bars 4; notes misread in bars 27",
        "source": "omr_audit",
    }
    assert computed == {
        "audited.musicxml": audited_entry,
        "converted.musicxml": {
            "status": "unverified",
            "note": "not yet checked against the page",
            "source": "omr_audit",
        },
    }

    written = json.loads(out.read_text(encoding="utf-8"))
    assert set(written) == {"audited.musicxml", "converted.musicxml"}
    assert written["audited.musicxml"] == audited_entry
    assert written["converted.musicxml"] == midi_entry
