import { Pitch, Clef } from '../../types/music';
import { useVexFlow } from './useVexFlow';

interface StaffDisplayProps {
  notes: Pitch[];
  clef: Clef;
  highlightColor?: string | null;
  wrongNotes?: Pitch[];
}

export function StaffDisplay({ notes, clef, highlightColor = null, wrongNotes }: StaffDisplayProps) {
  const containerRef = useVexFlow({ notes, clef, highlightColor, wrongNotes });

  return (
    <div
      ref={containerRef}
      // VexFlow draws in black: give it paper, not the dark card it was unreadable on (#5059).
      className="w-full bg-white rounded-xl border border-white/10 overflow-hidden"
      style={{ minHeight: 200 }}
    />
  );
}
