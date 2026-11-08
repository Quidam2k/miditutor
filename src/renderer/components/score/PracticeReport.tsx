// #5657 (f): where he keeps missing in this piece over the last week, from the practice log.
// The same roll-up is on the tutor API (GET /rollup) for "Bring in the tutor" and the bots.
import { useState } from 'react';
import type { PieceRollup, Rollup } from '../../../shared/practiceRollup';

const getBridge = () =>
  (window as unknown as { tutorBridge?: { practiceRollup?: (days: number) => Promise<Rollup | null> } }).tutorBridge;
const pct = (rate: number) => `${Math.round(rate * 100)}%`;
const HAND = { L: 'Left', R: 'Right', '?': '' } as const;

export function PracticeReport({ btn, piece, onLoopBar, onBlockBar, disabled }: {
  btn: string; piece: string; onLoopBar: (bar: number) => void; onBlockBar?: (bar: number) => void; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<PieceRollup | null | 'none'>(null);
  const [error, setError] = useState('');

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (!next) return;
    setData(null);
    setError('');
    const call = getBridge()?.practiceRollup;
    if (!call) {
      setError("The practice log isn't available here.");
      return;
    }
    call(7)
      .then((r) => setData(r?.pieces.find((p) => p.piece === piece) ?? 'none'))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };

  return (
    <div className="relative">
      <button onClick={toggle} className={btn} data-testid="practice-report" title="Which bars and fingers you miss most, last 7 days">
        Where I miss
      </button>
      {open && (
        <div
          className="absolute right-0 top-full z-40 mt-1 flex w-80 flex-col gap-2 rounded-md border border-gray-700 bg-gray-900 p-3 text-sm text-gray-300 shadow-lg"
          data-testid="practice-report-panel"
        >
          {error && <p className="text-red-400">{error}</p>}
          {!error && data === null && <p>Reading the practice log…</p>}
          {data === 'none' && <p>No practice on this piece in the last 7 days.</p>}
          {data && data !== 'none' && (
            <>
              <p>
                Last 7 days: {data.misses} missed of {data.strikes} keys ({pct(data.rate)})
                {data.laps > 0 && `, ${data.cleanLaps} of ${data.laps} laps clean`}.
              </p>
              <div>
                <div className="mb-1 text-xs uppercase tracking-wide text-gray-500">Bars you miss most</div>
                {data.worstBars.length === 0 && <p>None stand out.</p>}
                {data.worstBars.map((b) => (
                  <div key={b.bar} className="flex items-center gap-1">
                    <button
                      onClick={() => onLoopBar(b.bar)}
                      disabled={disabled}
                      className="flex flex-1 justify-between rounded px-1 text-left hover:bg-gray-800 disabled:opacity-40"
                      title="Loop this bar"
                      data-testid="report-bar"
                    >
                      <span>Bar {b.bar}</span>
                      <span className="text-gray-400">{b.misses} of {b.strikes} ({pct(b.rate)})</span>
                    </button>
                    {/* #5657c: a bar he keeps missing is the one to block. */}
                    {onBlockBar && (
                      <button
                        onClick={() => onBlockBar(b.bar)}
                        disabled={disabled}
                        className="rounded px-1 text-xs text-yellow-300 hover:bg-gray-800 disabled:opacity-40"
                        title="Block this bar: each hand position as one chord, three clean holds each"
                        data-testid="report-block-bar"
                      >
                        Block
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <div>
                <div className="mb-1 text-xs uppercase tracking-wide text-gray-500">Fingers on missed keys</div>
                {!data.fingerData && <p>No finger data yet: it's logged from today on, for bars with written fingers.</p>}
                {data.fingers.slice(0, 5).map((f) => (
                  <div key={`${f.hand}${f.finger}`} className="flex justify-between px-1" data-testid="report-finger">
                    <span>{HAND[f.hand]} {f.finger}</span>
                    <span className="text-gray-400">{f.misses} missed</span>
                  </div>
                ))}
              </div>
              {data.days.length > 1 && (
                <div className="text-xs text-gray-400">
                  By day: {data.days.map((d) => `${d.date.slice(5)} ${pct(d.rate)}`).join(' · ')}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
