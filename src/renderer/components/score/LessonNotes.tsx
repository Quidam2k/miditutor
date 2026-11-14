// #6112: the lesson notebook, read only. Plain text only: summaries are rendered as text, never HTML.
import { useEffect, useState } from 'react';
import type { LessonNote } from '../../../shared/lessonNotebook';

export function LessonNotes({ onClose }: { onClose: () => void }) {
  const [notes, setNotes] = useState<LessonNote[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const get = window.tutorBridge?.getNotebook;
    (get ? get() : Promise.resolve([]))
      .then((list) => {
        if (!live) return;
        setNotes(list);
        setOpen(list[0]?.date ?? null); // the newest lesson starts open
      })
      .catch(() => live && setNotes([]));
    return () => {
      live = false;
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" data-testid="lesson-notes">
      <div className="flex max-h-full w-full max-w-2xl flex-col rounded-lg border border-gray-700 bg-gray-900 shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-700 px-4 py-2">
          <h2 className="text-lg font-semibold text-gray-100">Lesson notes</h2>
          <button onClick={onClose} className="rounded px-2 py-1 text-gray-300 hover:bg-gray-800" data-testid="lesson-notes-close">
            Close
          </button>
        </div>
        <div className="flex flex-col gap-2 overflow-y-auto p-4 text-sm text-gray-200">
          {notes === null && <div className="text-gray-400">Loading…</div>}
          {notes?.length === 0 && <div className="text-gray-400">No lesson notes yet. They appear here after each lesson.</div>}
          {notes?.map((n) => (
            <div key={n.date} className="rounded border border-gray-700" data-testid="lesson-note">
              <button
                onClick={() => setOpen(open === n.date ? null : n.date)}
                className="flex w-full items-center justify-between px-3 py-2 text-left font-semibold hover:bg-gray-800"
              >
                {n.date}
                <span className="text-gray-500">{open === n.date ? '−' : '+'}</span>
              </button>
              {open === n.date && <div className="whitespace-pre-wrap border-t border-gray-700 px-3 py-2">{n.summary}</div>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
