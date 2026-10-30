import { Pitch, Clef } from '../../types/music';
import { MajorKey } from '../../engine/MusicTheory';
import { useVexFlow } from './useVexFlow';

interface StaffDisplayProps {
  notes: Pitch[];
  clef: Clef;
  highlightColor?: string | null;
  wrongNotes?: Pitch[];
  musicKey?: MajorKey | null;
}

export function StaffDisplay({ notes, clef, highlightColor = null, wrongNotes, musicKey }: StaffDisplayProps) {
  const containerRef = useVexFlow({ notes, clef, highlightColor, wrongNotes, musicKey });

  return (
    <div
      ref={containerRef}
      // VexFlow draws in black: give it paper, not the dark card it was unreadable on (#5059).
      className="w-full bg-white rounded-xl border border-white/10 overflow-hidden"
      style={{ minHeight: 200 }}
    />
  );
}
