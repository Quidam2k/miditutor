# Lesson notebook (#6112)

MidiTutor reads a growing notebook of piano-lesson summaries: the player reads it in the app
(Score tab > ⚙ Practice > "Lesson notes…"), and the tutor can fetch it with `GET /notebook`
on the tutor API. The tutor never volunteers it: it only answers a request.

## What may go in it: LESSON CONTENT ONLY

Technique, feel, what to fix, what was assigned, in plain text or light markdown. **Nothing else.**
The source write-ups can also carry non-piano material (meals, health, errands, other people);
that must never reach the summary file, because the app, the tutor API and the Pinocchio copy all read it.

## Adding a lesson

    python scripts/lesson_notebook_add.py --date 2026-11-13 --summary-file lesson.md            # preview
    python scripts/lesson_notebook_add.py --date 2026-11-13 --summary-file lesson.md --write    # save + push

- `--date` the lesson's date, `YYYY-MM-DD`. `--summary-file` UTF-8 text (or `-` for stdin), 1 to 20,000 characters.
- Writes `lesson-notebook.jsonl` in the library folder (the configured piano library, never in git), newest first, one JSON line
  per lesson `{date, source, summary_md, sha256, added_at}`, then copies it to Pinocchio's `MidiTutor Pieces/`
  like `homework_sync.py` (a failed push is retried on the next run). `--no-push` skips the copy.
- **Idempotent:** the same date and text changes nothing; the same date with new text replaces that date's entry.
- **Backfill is by hand:** run it once per past lesson, in any order. Re-running is safe.
- The last stdout line is a JSON summary (`written`, `pushed`, `flags`); exit 0 ok, 1 bad input, 2 push failed.

The calling agent just runs the command above after each lesson summary is written.

## Reader rules

The app skips bad, empty or oversized (over 20,000 chars) lines and shows summaries as plain text (never HTML);
at most 200 entries. Code: `src/shared/lessonNotebook.ts`, `LessonNotes.tsx`, IPC `notebook:get`.
