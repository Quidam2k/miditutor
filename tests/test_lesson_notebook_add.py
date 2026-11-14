import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import lesson_notebook_add as add  # noqa: E402


def run(tmp_path, date, text, *extra):
    summary = tmp_path / "s.md"
    summary.write_text(text, encoding="utf-8")
    return add.main(["--date", date, "--summary-file", str(summary), "--library", str(tmp_path), "--no-push", *extra])


def entries(tmp_path):
    return [json.loads(l) for l in (tmp_path / "lesson-notebook.jsonl").read_text(encoding="utf-8").splitlines()]


def test_preview_writes_nothing(tmp_path):
    assert run(tmp_path, "2026-11-06", "Block hand positions.") == 0
    assert not (tmp_path / "lesson-notebook.jsonl").exists()


def test_add_is_idempotent_and_newest_first(tmp_path):
    run(tmp_path, "2026-10-28", "Older lesson.", "--write")
    run(tmp_path, "2026-11-06", "Newer lesson.", "--write")
    before = (tmp_path / "lesson-notebook.jsonl").read_text(encoding="utf-8")
    run(tmp_path, "2026-11-06", "Newer lesson.", "--write")  # same date + text: nothing changes
    assert (tmp_path / "lesson-notebook.jsonl").read_text(encoding="utf-8") == before
    assert [e["date"] for e in entries(tmp_path)] == ["2026-11-06", "2026-10-28"]


def test_same_date_new_text_replaces(tmp_path):
    run(tmp_path, "2026-11-06", "First draft.", "--write")
    run(tmp_path, "2026-11-06", "Corrected.", "--write")
    got = entries(tmp_path)
    assert len(got) == 1 and got[0]["summary_md"] == "Corrected."


def test_bad_date_empty_and_oversized_refused(tmp_path):
    assert run(tmp_path, "11/06", "x", "--write") == 1
    assert run(tmp_path, "2026-11-06", "   ", "--write") == 1
    assert run(tmp_path, "2026-11-06", "x" * (add.MAX_SUMMARY_CHARS + 1), "--write") == 1
    assert not (tmp_path / "lesson-notebook.jsonl").exists()


def test_bad_existing_lines_are_dropped_not_fatal(tmp_path):
    (tmp_path / "lesson-notebook.jsonl").write_text(
        'not json\n{"date":"2026-10-01","summary_md":"ok"}\n{"date":5}\n', encoding="utf-8")
    run(tmp_path, "2026-11-06", "New.", "--write")
    assert [e["date"] for e in entries(tmp_path)] == ["2026-11-06", "2026-10-01"]
