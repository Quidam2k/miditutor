import { useEffect, useRef } from 'react';
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import { useTutorStore } from '../../store/useTutorStore';
import { chordToMusicXml } from '../../../shared/music';

// A persona's "play this chord" task. Only the chord NAME is shown while he
// works it out (Todd's rule: the answer is never given away up front). Once he
// has played, the verdict appears and the written chord is revealed.

export function TaskPanel() {
  const task = useTutorStore((s) => s.task);
  const notationRef = useRef<HTMLDivElement>(null);
  const result = task?.result ?? null;
  const reveal = result !== null;

  useEffect(() => {
    const el = notationRef.current;
    if (!el || !task || !reveal) return;
    const osmd = new OpenSheetMusicDisplay(el, { backend: 'svg', drawTitle: false, autoResize: false });
    osmd
      .load(chordToMusicXml(task.label, task.notes))
      .then(() => osmd.render())
      .catch(() => {
        /* the verdict text still stands without notation */
      });
    return () => {
      el.innerHTML = '';
    };
  }, [task?.id, task?.label, task?.notes, reveal]);

  if (!task) return null;

  const tone =
    result?.verdict === 'correct'
      ? 'border-green-600/60 bg-green-900/20'
      : result
        ? 'border-red-600/60 bg-red-900/20'
        : 'border-indigo-600/60 bg-indigo-900/20';

  return (
    <div className={`flex flex-col gap-2 rounded-lg border p-4 ${tone}`} data-testid="task-panel">
      <div className="flex items-baseline gap-3">
        <span className="text-sm text-gray-400">Play</span>
        <span className="text-3xl font-bold text-white">{task.label}</span>
      </div>
      {result && (
        <div className="text-sm" data-testid="task-verdict">
          {result.verdict === 'correct' ? (
            <span className="font-semibold text-green-400">✓ Yes, {result.names.join(' ')}</span>
          ) : (
            <span className="text-red-300">
              ✗ You played {result.names.join(' ')}
              {result.missing.length > 0 && <> · missing {result.missing.join(', ')}</>}
              {result.extra.length > 0 && <> · not in the chord: {result.extra.join(', ')}</>}
            </span>
          )}
        </div>
      )}
      {reveal && <div ref={notationRef} className="max-w-xs rounded bg-white p-2" />}
    </div>
  );
}
