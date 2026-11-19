"""Tests for scripts/review_layout.py (scan systems mapped to MusicXML measures)."""
import importlib.util
import json
import os
import sys
from pathlib import Path

import pytest

SCRIPTS = Path(__file__).resolve().parent.parent / "scripts"
sys.path.insert(0, str(SCRIPTS))
_path = Path(os.environ.get("REVIEW_LAYOUT_PATH", SCRIPTS / "review_layout.py"))
_spec = importlib.util.spec_from_file_location("review_layout", _path)
review_layout = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(review_layout)

sys.path.insert(0, str(SCRIPTS))
import localcfg  # noqa: E402

LIBRARY = Path(localcfg.get("library", "MIDITUTOR_LIBRARY", "piano-library-not-set"))
needs_library = pytest.mark.skipif(not LIBRARY.is_dir(), reason="piano library not present")


# ---- map_measures --------------------------------------------------------------------------

def test_exact_match_assigns_cumulatively():
    got = review_layout.map_measures([3, 4, 3], [1, 4, 8], 10)
    assert got == [(1, 3), (4, 7), (8, 10)]


def test_merged_system_still_maps_exactly():
    scan = [5, 5, 5, 5, 5, 5, 5, 5, 4, 5]
    breaks = [1, 6, 11, 16, 21, 31, 36, 41, 45]
    got = review_layout.map_measures(scan, breaks, 49)
    assert None not in got
    assert got[0] == (1, 5)
    assert got[5] == (26, 30)
    assert got[-1] == (45, 49)
    assert got == sorted(got)
    assert all(a[1] + 1 == b[0] for a, b in zip(got, got[1:]))


def test_extra_bar_maps_prefix_and_suffix_only():
    breaks = [1, 6, 11, 16, 21, 26, 31]
    got = review_layout.map_measures([5, 5, 6, 5, 5, 5, 5], breaks, 35)
    assert got == [(1, 5), (6, 10), None, (16, 20), (21, 25), (26, 30), (31, 35)]


def test_error_page_systems_stay_unmapped():
    breaks = [1, 6, 11, 16, 21, 26]
    got = review_layout.map_measures([5, 5, None, None, 5, 5], breaks, 30)
    assert got == [(1, 5), (6, 10), None, None, (21, 25), (26, 30)]


def test_disagreeing_boundary_is_not_guessed():
    # scan [4,4,4] = 12 bars but the XML has 13: the third system's end (13) is not a boundary
    got = review_layout.map_measures([4, 4, 4], [1, 5, 9], 13)
    assert got == [(1, 4), (5, 8), None]


def test_mapped_ranges_never_overlap():
    for scan in ([2, 2, 2], [9, 1], [1, 1, 1, 1, 1, 1], [4]):
        got = [s for s in review_layout.map_measures(scan, [1, 3, 5], 6) if s]
        for a, b in zip(got, got[1:]):
            assert a[1] < b[0]


def test_empty_scan():
    assert review_layout.map_measures([], [1], 4) == []


# ---- real data -----------------------------------------------------------------------------

@needs_library
def test_o_holy_night_layout(tmp_path):
    data = review_layout.layout_piece(LIBRARY, "o-holy-night", out_dir=tmp_path)
    assert data["scan"]["systems"] == 10
    assert [s["bars"] for s in data["systems"]] == [5, 5, 5, 5, 5, 5, 5, 5, 4, 5]
    assert data["match"] == "exact"
    assert data["systems"][5]["measures"] == [26, 30]
    assert all(p["status"] == "ok" for p in data["pages"])
    for s in data["systems"]:
        assert (tmp_path / s["crop"]).is_file()
        assert 0 <= s["y0"] < s["y1"]
    saved = json.loads((tmp_path / "review" / "o-holy-night.layout.json").read_text(encoding="ascii"))
    assert saved == data


@needs_library
def test_fur_elise_layout(tmp_path):
    data = review_layout.layout_piece(LIBRARY, "fur-elise", out_dir=tmp_path)
    assert data["scan"]["systems"] == 4
    assert [s["bars"] for s in data["systems"]] == [6, 5, 5, 6]
    assert data["match"] == "exact"


@needs_library
def test_courtesy_key_after_last_barline_is_not_a_bar(tmp_path):
    # Love Dance line 8 ends on a double bar, then a courtesy key change with no closing line (#5731).
    data = review_layout.layout_piece(LIBRARY, "love-dance-from-ka", out_dir=tmp_path)
    assert data["systems"][7]["bars"] == 4
    assert data["match"] == "exact"
    assert data["systems"][1]["measures"] == [4, 6]


@needs_library
def test_cli_skips_current_layout(tmp_path, capsys):
    args = ["--library", str(LIBRARY), "--out-dir", str(tmp_path), "fur-elise"]
    assert review_layout.main(args) == 0
    assert "fur-elise: exact scan=22 xml=22 systems=4" in capsys.readouterr().out
    assert review_layout.main(args) == 0
    assert "fur-elise: skipped (current)" in capsys.readouterr().out


@needs_library
@pytest.mark.parametrize("slug", ["o-from-o", "the-stormy-sea", "sorcerers-apprentice", "let-me-fall-from-quidam"])
def test_learning_first_pieces_map_exactly(tmp_path, slug):
    # The pieces he reviews first (O, Stormy Sea, Sorcerer's, Let Me Fall): each bar must land on its line.
    data = review_layout.layout_piece(LIBRARY, slug, out_dir=tmp_path)
    assert data["match"] == "exact", [s["bars"] for s in data["systems"]]


def test_suspects_are_the_current_scores_flags_per_line(monkeypatch):
    import omr_audit
    flags = [
        {"measure": 2, "number": "2", "staff": 1, "check": "bar_length", "detail": "underfull"},
        {"measure": 4, "number": "4", "staff": None, "check": "time_signature", "detail": "old", "raw_only": True},
        {"measure": 5, "number": "5", "staff": 2, "check": "range", "detail": "low"},
    ]
    monkeypatch.setattr(omr_audit, "lint_piece", lambda path: {"flags": flags})
    data = {"systems": [{"measures": [1, 3]}, {"measures": [4, 6]}, {"measures": None}]}
    review_layout.add_suspects(data, "unused.musicxml")
    assert data["systems"][0]["suspects"] == [{"measure": 2, "staff": 1, "check": "bar_length", "detail": "underfull"}]
    assert data["systems"][1]["suspects"] == [{"measure": 5, "staff": 2, "check": "range", "detail": "low"}]
    assert data["systems"][2]["suspects"] == []


# ---- second read (#6487) ------------------------------------------------------------------

import numpy as np  # noqa: E402
from PIL import Image, ImageDraw  # noqa: E402


def test_wide_deskew_finds_three_degrees():
    # The narrow search hits its limit on a scan skewed by three degrees (#6487).
    image = Image.new("L", (2000, 1400), 255)
    draw = ImageDraw.Draw(image)
    for top in (420, 840):
        for y in range(top, top + 100, 20):
            draw.line((100, y, 1899, y), fill=0, width=3)
    image = image.rotate(-3.0, Image.Resampling.BILINEAR, fillcolor=255)

    angle = review_layout.best_angle(image, review_layout.WIDE_ANGLE_TENTHS)
    assert angle == pytest.approx(3.0, abs=0.3)
    assert abs(review_layout.best_angle(image)) == 2.0


def test_robust_peak_ignores_black_edge_row():
    # A black scan edge can hide faint staff lines with the default threshold (#6487).
    dark = np.zeros((1200, 1500), dtype=bool)
    lines = [300, 320, 340, 360, 380]
    for y in lines:
        dark[y:y + 2, :675] = True
    dark[10:13, :] = True

    assert review_layout.find_staves(dark)[0] == []
    staves, _, _ = review_layout.find_staves(dark, robust=True)
    assert len(staves) == 1
    assert staves[0] == pytest.approx(lines, abs=1)


def test_group_systems_joins_piano_and_leaves_vocal_alone():
    # The left connector joins only the two piano staves (#6487).
    dark = np.zeros((700, 2000), dtype=bool)
    vocal = list(range(100, 200, 20))
    piano1 = list(range(300, 400, 20))
    piano2 = list(range(500, 600, 20))
    for staff in (vocal, piano1, piano2):
        for y in staff:
            dark[y - 1:y + 2, 200:1801] = True
    dark[piano1[0]:piano2[-1] + 1, 200:203] = True
    border = np.zeros(dark.shape[1], dtype=bool)

    systems = review_layout.group_systems(dark, [vocal, piano1, piano2], 20, border)
    assert systems == [[vocal], [piano1, piano2]]


@needs_library
@pytest.mark.parametrize(
    ("slug", "expected_bars"),
    [
        ("kum-ba-yah", 16),
        ("la-moldau", 32),
        ("minuet-in-d-minor", 32),
        ("let-me-fall-musicnotes-vocal-arrangement", 73),
    ],
)
def test_second_read_recovers_exact_layout(slug, expected_bars, tmp_path):
    # These scans need a second read to recover the expected bar count (#6487).
    result = review_layout.layout_piece(LIBRARY, slug, out_dir=tmp_path)

    assert result["match"] == "exact"
    assert result["scan"]["bars"] == expected_bars
    assert all(page["status"] == "ok" for page in result["pages"])
    assert any(
        warning.startswith("second read:")
        for page in result["pages"]
        for warning in page["warnings"]
    )


@needs_library
def test_exact_piece_skips_second_read(tmp_path):
    # An exact first read needs no retry (#6487).
    result = review_layout.layout_piece(LIBRARY, "fur-elise", out_dir=tmp_path)

    assert result["match"] == "exact"
    assert not any(
        warning.startswith("second read:")
        for page in result["pages"]
        for warning in page["warnings"]
    )
