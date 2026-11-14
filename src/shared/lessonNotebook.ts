// #6112: the lesson notebook (lesson-notebook.jsonl in the pieces folder), written by
// scripts/lesson_notebook_add.py. LESSON CONTENT ONLY. Read defensively: a bad line is skipped,
// never fatal, and the text is shown as plain text (never HTML).

export interface LessonNote {
  /** YYYY-MM-DD */
  date: string;
  summary: string;
}

export const MAX_NOTE_CHARS = 20_000;
export const MAX_NOTES = 200;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The valid entries of a notebook file, newest first. Bad, empty or oversized lines are skipped. */
export function parseNotebook(text: string): LessonNote[] {
  const notes: LessonNote[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.length > MAX_NOTE_CHARS * 2) continue; // JSON escaping can double a line
    try {
      const entry = JSON.parse(line) as { date?: unknown; summary_md?: unknown };
      if (typeof entry?.date !== 'string' || !DATE.test(entry.date)) continue;
      if (typeof entry.summary_md !== 'string') continue;
      const summary = entry.summary_md.trim();
      if (!summary || summary.length > MAX_NOTE_CHARS) continue;
      notes.push({ date: entry.date, summary });
    } catch {
      continue;
    }
  }
  notes.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return notes.slice(0, MAX_NOTES);
}
