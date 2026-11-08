// #11354 item 6 (JP 10/23: "Who's moving where? Who stays the same?"): from each chord to its
// next in the same hand, a blue ring on a key that stays and an amber ring with "+2" / "-1" on
// one that moves. A violet tag over the chord: "same move" when it repeats the last change,
// "all +5" when the whole hand shifts.

export interface ChordRing {
  x: number;
  y: number;
  r: number;
  kind: 'stay' | 'move' | 'new';
  label: string;
  title: string;
}

export interface ChordTag {
  x: number;
  y: number;
  text: string;
}

const RING = { stay: '#0284c7', move: '#d97706', new: '#6b7280' } as const;

export function ChordOverlay({ rings, tags }: { rings: ChordRing[]; tags: ChordTag[] }) {
  if (rings.length === 0 && tags.length === 0) return null;
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" data-testid="chord-overlay">
      {rings.map((c, i) => (
        <g key={`c-${i}`} className="pointer-events-auto" data-testid="chord-ring" data-kind={c.kind}>
          <title>{c.title}</title>
          <circle cx={c.x} cy={c.y} r={c.r} fill="none" stroke={RING[c.kind]} strokeWidth={2} strokeOpacity={0.9} />
          {c.label && (
            <text x={c.x + c.r * 1.3} y={c.y + c.r * 0.45} fontSize={c.r * 1.3} fontWeight={700} fill={RING[c.kind]}>
              {c.label}
            </text>
          )}
        </g>
      ))}
      {tags.map((t, i) => (
        <text key={`t-${i}`} x={t.x} y={t.y} fontSize={11} fontWeight={700} fill="#7c3aed" textAnchor="middle" data-testid="chord-tag">
          {t.text}
        </text>
      ))}
    </svg>
  );
}
