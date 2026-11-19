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


# ---- begin-repeat, curled staves, staff gaps (#6488/#6489/#6490) ---------------------------

def test_begin_repeat_is_thick_then_thin():
    # #6490: A begin repeat has a thick stroke followed by a thin stroke.
    system = [list(range(100, 181, 20)), list(range(300, 381, 20))]
    run = {"x0": 95, "x1": 125}
    cases = [
        ("thick then thin", [(100, 107), (112, 115)], True),
        ("thin then thick", [(100, 103), (108, 115)], False),
        ("single thin stroke", [(100, 103)], False),
    ]

    for shape, strokes, expected in cases:
        dark = np.zeros((500, 400), dtype=bool)
        for staff in system:
            for x0, x1 in strokes:
                dark[staff[0] - 2 : staff[-1] + 3, x0 : x1 + 1] = True
        assert review_layout._begin_repeat(dark, system, run) == expected, shape


def test_gap_groups_keeps_grand_staves_and_splits_singles():
    # #6488: Small gaps join grand staves, while larger gaps separate systems.
    staves = []
    y = 100
    for _ in range(3):
        staves.append([y + 16 * line for line in range(5)])
        y = staves[-1][-1] + 40
        staves.append([y + 16 * line for line in range(5)])
        y = staves[-1][-1] + 150

    for _ in range(3):
        staves.append([y + 16 * line for line in range(5)])
        y = staves[-1][-1] + 150

    assert review_layout.gap_groups(staves) == [
        staves[0:2],
        staves[2:4],
        staves[4:6],
        staves[6:7],
        staves[7:8],
        staves[8:9],
    ]


@needs_library
@pytest.mark.parametrize(
    ("slug", "expected"),
    [
        ("quidam-musicnotes-vocal-arrangement", 120),
        ("alegria-from-alegria", 69),
        ("alone-from-delirium", 40),
        ("allegro-in-f-major-k-1c", None),
    ],
)
def test_repeat_layout_matches_xml_measure_count(slug, expected, tmp_path):
    # #6490: The scan bar count matches the XML measure count.
    data = review_layout.layout_piece(LIBRARY, slug, out_dir=tmp_path)

    assert data["match"] == "exact"
    assert data["scan"]["bars"] == data["xml"]["measures"]
    if expected is not None:
        assert data["scan"]["bars"] == expected


@needs_library
def test_let_me_fall_curled_piano_staves_found(tmp_path):
    # #6489: Both curled piano systems retain their two staves.
    data = review_layout.layout_piece(
        LIBRARY, "let-me-fall-musicnotes-vocal-arrangement", out_dir=tmp_path
    )

    assert data["match"] == "exact"
    systems = data["systems"]
    assert systems[2]["measures"] == [8, 10]
    assert len(systems[2]["staves"]) == 2
    assert systems[10]["measures"] == [33, 36]
    assert len(systems[10]["staves"]) == 2


@needs_library
def test_front_run_is_not_exact(tmp_path):
    # #6488: A layout that maps only a front run of the measures is not exact.
    data = review_layout.layout_piece(
        LIBRARY, "bright-lights-boogie", out_dir=tmp_path
    )

    if data["xml"]["measures"] == 28:
        assert data["match"] != "exact"
    else:
        pytest.skip("score already fixed")


# ---- line breaks and fainter barlines (#6491) ---------------------------------


# #6491: The lenient threshold keeps a barline with a gap in the second staff.
def test_barline_runs_lenient_level_keeps_broken_line():
    dark = np.zeros((500, 400), dtype=bool)
    system = [list(range(100, 181, 20)), list(range(300, 381, 20))]
    for staff in system:
        dark[staff[0] - 2 : staff[-1] + 3, 200:203] = True
    dark[330:338, 200:203] = False

    second_staff = system[1]
    ink_fraction = dark[second_staff[0] - 1 : second_staff[-1] + 2, 201].mean()
    assert 0.9 < ink_fraction < 0.95

    strict = review_layout.barline_runs(dark, system, 50, 350)
    lenient = review_layout.barline_runs(
        dark, system, 50, 350, level=review_layout.LENIENT_BARLINE_DARK
    )
    assert not any(run["x0"] <= 201 <= run["x1"] for run in strict)
    assert any(run["x0"] <= 201 <= run["x1"] for run in lenient)


# #6491: Only reread 4 uses the lenient barline threshold.
def test_lenient_level_is_only_for_reread_4(monkeypatch, tmp_path):
    levels = []

    def fake_read_page(path, *args, barline_level, **kwargs):
        levels.append(barline_level)
        return {"file": path.name, "status": "ok", "warnings": []}, [], None, False

    monkeypatch.setattr(review_layout, "_read_page", fake_read_page)
    monkeypatch.setattr(review_layout, "best_angle", lambda *args: 0)
    page = tmp_path / "01.png"
    Image.new("RGB", (50, 50), "white").save(page)

    for reread in range(5):
        review_layout.analyze_page(page, per_system=2, reread=reread)

    assert levels == [review_layout.BARLINE_DARK] * 4 + [review_layout.LENIENT_BARLINE_DARK]


# #6491: Triangle Tango's mapped systems start at every score line break.
@needs_library
def test_triangle_tango_lines_start_where_the_score_does(tmp_path):
    data = review_layout.layout_piece(LIBRARY, "triangle-tango-from-corteo", out_dir=tmp_path)

    assert data["match"] == "exact"
    assert data["scan"]["bars"] == 51
    page_three = [system["measures"] for system in data["systems"] if system["page"] == "03.png"]
    assert page_three == [[23, 25], [26, 28], [29, 31], [32, 34]]
    starts = {system["measures"][0] for system in data["systems"]}
    assert set(data["xml"]["breaks"]) <= starts


# #6491: Quidam's fourth system on page two spans measures 21 through 24.
@needs_library
def test_quidam_page_2_line_4_has_four_bars(tmp_path):
    data = review_layout.layout_piece(LIBRARY, "quidam-from-quidam", out_dir=tmp_path)

    assert data["match"] == "exact"
    assert data["scan"]["bars"] == 60
    system = next((s for s in data["systems"] if s["measures"] == [21, 24]), None)
    assert system is not None
    assert system["page"] == "02.png"
    assert system["bars"] == 4


# #6491: A full bar count yields a partial match when a score break falls inside a system.
@pytest.mark.parametrize(
    ("bar_counts", "expected_match"), [((2, 4), "partial"), ((3, 3), "exact")]
)
def test_exact_count_with_break_off_line_start_is_partial(
    monkeypatch, tmp_path, bar_counts, expected_match
):
    score_path = tmp_path / "score.musicxml"
    score_path.write_bytes(b"<score-partwise/>")
    score = {
        "measures": [(i, str(i)) for i in range(1, 7)],
        "breaks": [1, 4],
        "staves_per_system": 2,
    }

    def fake_analyze_page(page, per_system, reread):
        systems = []
        for y0, bars in zip((0, 50), bar_counts):
            systems.append({
                "y0": y0,
                "y1": y0 + 50,
                "spacing": 4,
                "staves": [list(range(y0 + offset, y0 + offset + 20, 4)) for offset in (4, 28)],
                "x_left": 10,
                "x_right": 90,
                "barlines": [10 + 80 * i // bars for i in range(bars + 1)],
                "bars": bars,
            })
        info = {"file": page.name, "status": "ok", "warnings": []}
        return info, systems, Image.new("RGB", (100, 100), "white")

    monkeypatch.setattr(review_layout, "analyze_page", fake_analyze_page)
    monkeypatch.setattr(review_layout, "make_crop", lambda *args: None)

    data, _ = review_layout._build(
        tmp_path, "score", score, score_path, [tmp_path / "01.png"], reread=0
    )

    assert data["scan"]["bars"] == 6
    assert [system["measures"][0] for system in data["systems"]] == [1, bar_counts[0] + 1]
    assert data["match"] == expected_match
