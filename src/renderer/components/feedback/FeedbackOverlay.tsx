import { useEffect, useState } from 'react';
import { ExerciseResult } from '../../types/exercise';
import { midiNumberToPitch, pitchToDisplayName } from '../../engine/MusicTheory';

interface FeedbackOverlayProps {
  result: ExerciseResult | null;
  visible: boolean;
}

export function FeedbackOverlay({ result, visible }: FeedbackOverlayProps) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (visible) {
      setShow(true);
    } else {
      const timer = setTimeout(() => setShow(false), 300);
      return () => clearTimeout(timer);
    }
  }, [visible]);

  if (!result || !show) return null;

  const correct = result.correct;

  return (
    <div
      className={`
        absolute inset-0 flex items-center justify-center pointer-events-none z-10
        transition-opacity duration-300
        ${visible ? 'opacity-100' : 'opacity-0'}
      `}
    >
      <div
        className={`
          px-8 py-4 rounded-2xl text-2xl font-bold
          ${correct
            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
            : 'bg-red-500/20 text-red-400 border border-red-500/30'
          }
        `}
      >
        {correct ? (
          'Correct!'
        ) : (
          <div className="text-center">
            <div>Wrong</div>
            <div className="text-base font-normal mt-1 text-red-300">
              Expected: {result.expected.map((m) => pitchToDisplayName(midiNumberToPitch(m))).join(', ')}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
