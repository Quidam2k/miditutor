import { Pitch, Clef } from '../../types/music';
import { useVexFlow } from './useVexFlow';

interface StaffDisplayProps {
  notes: Pitch[];
  clef: Clef;
  highlightColor?: string | null;
}

export function StaffDisplay({ notes, clef, highlightColor = null }: StaffDisplayProps) {
  const containerRef = useVexFlow({ notes, clef, highlightColor });

  return (
    <div
      ref={containerRef}
      className="w-full bg-white/5 rounded-xl border border-white/10 overflow-hidden"
      style={{ minHeight: 200 }}
    />
  );
}
