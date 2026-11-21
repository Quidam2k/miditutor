// #6654: finger edits a save refused are kept (main writes them to userData/unsaved-edits.json)
// and saved later (#6661: tie marks too). Each one is put back by note position with setMark, so an edit whose
// note is no longer there (the score changed) is dropped and named, never forced onto another note.
import { setMark, type NoteMark, type XmlImpl } from '../../../shared/fingering';
import type { UnsavedEdit } from '../../../main/scoreFiles';

export interface Requeued {
  xml: string;
  applied: UnsavedEdit[];
  dropped: { edit: UnsavedEdit; reason: string }[];
}

/** Put the queued edits back on `xml`, oldest first. Re-applying one already there changes nothing. */
export function applyQueued(xml: string, edits: readonly UnsavedEdit[], impl?: XmlImpl): Requeued {
  let out = xml;
  const applied: UnsavedEdit[] = [];
  const dropped: Requeued['dropped'] = [];
  for (const e of edits) {
    const r = setMark(out, { measure: e.measure, staff: e.staff, onset: e.onset, midi: e.midi }, e.digit as NoteMark, impl);
    if (r.ok) {
      out = r.xml;
      applied.push(e);
    } else {
      dropped.push({ edit: e, reason: r.reason });
    }
  }
  return { xml: out, applied, dropped };
}

/** A save error that retrying can't fix: the piece has no file of its own (or never will). */
export function isFinalSaveError(message: string): boolean {
  return /bad piece name|no such piece|not a MusicXML score/.test(message);
}

/** The line under the toolbar while edits wait. */
export function waitingLine(count: number): string {
  return `Fingering not saved yet: ${count} change${count === 1 ? '' : 's'} kept, saving again with your next change or when you reopen the piece.`;
}

/** What to say about edits that no longer fit the score. */
export function droppedLine(dropped: Requeued['dropped']): string {
  if (dropped.length === 0) return '';
  const names = dropped.slice(0, 4).map((d) => `${d.edit.name ?? 'a note'} (bar ${d.edit.measure})`).join(', ');
  const more = dropped.length > 4 ? ` and ${dropped.length - 4} more` : '';
  return `${dropped.length} saved-for-later finger change${dropped.length === 1 ? '' : 's'} no longer fit the score and were left off: ${names}${more}.`;
}
