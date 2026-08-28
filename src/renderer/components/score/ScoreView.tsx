import { useEffect, useRef, useState } from 'react';
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
// eslint-disable-next-line import/no-unresolved -- Vite ?raw import, not resolvable by eslint-plugin-import
import sampleXml from '../../assets/sample-score.musicxml?raw';

// Milestone 1c: import ONE MusicXML file and render it with a cursor you can
// step manually (prev / next / reset). NO auto-following yet — that is M2.
// OSMD handles real scores; the existing VexFlow path stays for generated drills.

const STEP_NAMES = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

// Best-effort note-letter readout from the notes currently under the cursor.
// Defensive: OSMD internals vary, so any failure just yields an empty list
// rather than crashing the view. Octave is intentionally omitted here to avoid
// asserting an octave convention; precise MIDI matching lands in M2.
function notesUnderCursor(osmd: OpenSheetMusicDisplay): string[] {
  try {
    const notes = osmd.cursor?.NotesUnderCursor?.() ?? [];
    return notes
      .map((n: unknown) => {
        const pitch = (n as { Pitch?: { FundamentalNote?: number; Accidental?: number } }).Pitch;
        if (!pitch || pitch.FundamentalNote == null) return null; // rest
        const letter = STEP_NAMES[pitch.FundamentalNote] ?? '?';
        // OSMD AccidentalEnum: SHARP=0, FLAT=1, NONE=2, NATURAL=3.
        const acc = pitch.Accidental === 0 ? '#' : pitch.Accidental === 1 ? 'b' : '';
        return `${letter}${acc}`;
      })
      .filter((x): x is string => x !== null);
  } catch {
    return [];
  }
}

export function ScoreView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const osmdRef = useRef<OpenSheetMusicDisplay | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [cursorNotes, setCursorNotes] = useState<string[]>([]);
  const [atEnd, setAtEnd] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let disposed = false;

    const osmd = new OpenSheetMusicDisplay(container, {
      autoResize: true,
      backend: 'svg',
      drawTitle: true,
    });
    osmdRef.current = osmd;

    osmd
      .load(sampleXml)
      .then(() => {
        if (disposed) return;
        osmd.render();
        osmd.cursor.show();
        setCursorNotes(notesUnderCursor(osmd));
        setAtEnd(false);
        setStatus('ready');
      })
      .catch((err: unknown) => {
        if (disposed) return;
        setErrorMsg(err instanceof Error ? err.message : String(err));
        setStatus('error');
      });

    return () => {
      disposed = true;
      try {
        osmd.cursor?.hide();
      } catch {
        /* ignore */
      }
      container.innerHTML = '';
      osmdRef.current = null;
    };
  }, []);

  const syncCursor = () => {
    const osmd = osmdRef.current;
    if (!osmd) return;
    setCursorNotes(notesUnderCursor(osmd));
    setAtEnd(Boolean(osmd.cursor?.iterator?.EndReached));
  };

  const next = () => {
    osmdRef.current?.cursor.next();
    syncCursor();
  };
  const prev = () => {
    osmdRef.current?.cursor.previous();
    syncCursor();
  };
  const reset = () => {
    const osmd = osmdRef.current;
    if (!osmd) return;
    osmd.cursor.reset();
    osmd.cursor.show();
    syncCursor();
  };

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="flex items-center gap-2">
        <button
          onClick={prev}
          disabled={status !== 'ready'}
          className="rounded-md bg-gray-800 px-3 py-1 text-sm font-medium text-gray-200 hover:bg-gray-700 disabled:opacity-40"
        >
          ◀ Prev
        </button>
        <button
          onClick={next}
          disabled={status !== 'ready' || atEnd}
          className="rounded-md bg-indigo-600 px-3 py-1 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
        >
          Next ▶
        </button>
        <button
          onClick={reset}
          disabled={status !== 'ready'}
          className="rounded-md bg-gray-800 px-3 py-1 text-sm font-medium text-gray-200 hover:bg-gray-700 disabled:opacity-40"
        >
          Reset
        </button>
        <div className="ml-2 text-sm text-gray-400">
          {status === 'ready' && (
            <>
              Under cursor:{' '}
              <span className="font-mono font-semibold text-indigo-300">
                {cursorNotes.length ? cursorNotes.join(' ') : '—'}
              </span>
              {atEnd && <span className="ml-2 text-gray-500">(end of piece)</span>}
            </>
          )}
        </div>
      </div>

      {status === 'error' && (
        <p className="rounded-md border border-red-800/50 bg-red-900/20 p-3 text-sm text-red-300">
          Failed to render score: {errorMsg}
        </p>
      )}
      {status === 'loading' && <p className="text-sm text-gray-500">Loading score…</p>}

      {/* OSMD draws black notation, so give it a light panel. */}
      <div className="overflow-x-auto rounded-lg bg-white p-4">
        <div ref={containerRef} />
      </div>
    </div>
  );
}
