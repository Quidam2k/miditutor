// Todd's play-along design (#4045): what he PLAYS is drawn in blue over the
// black written notes, so a miss shows as a head that doesn't overlap. A wrong
// accidental gets a small red sharp/flat/natural beside his note.

export interface PlayedMark {
  id: number;
  x: number; // notehead centre, px, relative to the overlay layer
  y: number;
  /** One staff space in px (sizes the head and ledger lines). */
  space: number;
  /** Ledger line offsets in px relative to y (for heads off the staff). */
  ledgers: number[];
  accidental: 'sharp' | 'flat' | 'natural' | null;
}

export const PLAYED_BLUE = '#2563eb';
const ACC_RED = '#dc2626';
const GLYPH = { sharp: '♯', flat: '♭', natural: '♮' } as const;

export function PlayedOverlay({ marks }: { marks: PlayedMark[] }) {
  if (marks.length === 0) return null;
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" data-testid="played-overlay">
      {marks.map((m) => (
        <g key={m.id} data-accidental={m.accidental ?? undefined}>
          {m.ledgers.map((dy) => (
            <line
              key={dy}
              x1={m.x - m.space}
              x2={m.x + m.space}
              y1={m.y + dy}
              y2={m.y + dy}
              stroke={PLAYED_BLUE}
              strokeWidth={Math.max(1, m.space * 0.12)}
            />
          ))}
          <ellipse
            cx={m.x}
            cy={m.y}
            rx={m.space * 0.62}
            ry={m.space * 0.45}
            transform={`rotate(-20 ${m.x} ${m.y})`}
            fill={PLAYED_BLUE}
            fillOpacity={0.75}
          />
          {m.accidental && (
            <text
              x={m.x - m.space * 1.4}
              y={m.y}
              fill={ACC_RED}
              fontSize={m.space * 1.8}
              fontWeight={700}
              textAnchor="middle"
              dominantBaseline="central"
            >
              {GLYPH[m.accidental]}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}
