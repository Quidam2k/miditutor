// Todd's play-along design (#4045): what he PLAYS is drawn in blue over the
// black written notes, so a miss shows as a head that doesn't overlap. A wrong
// accidental gets a small red sharp/flat/natural beside his note. A wrong note is
// drawn red (#4045: "the note and just the note in red"). The loop range (#5004) is
// shaded underneath.

export interface PlayedMark {
  id: number;
  x: number; // notehead centre, px, relative to the overlay layer
  y: number;
  /** One staff space in px (sizes the head and ledger lines). */
  space: number;
  /** Ledger line offsets in px relative to y (for heads off the staff). */
  ledgers: number[];
  accidental: 'sharp' | 'flat' | 'natural' | null;
  /** Not a note the score asked for here: drawn red instead of blue. */
  wrong?: boolean;
}

/** A shaded rectangle (px, relative to the overlay layer). */
export interface Band {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const PLAYED_BLUE = '#2563eb';
const ACC_RED = '#dc2626';
const GLYPH = { sharp: '♯', flat: '♭', natural: '♮' } as const;

export function PlayedOverlay({ marks, bands = [] }: { marks: PlayedMark[]; bands?: Band[] }) {
  if (marks.length === 0 && bands.length === 0) return null;
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" data-testid="played-overlay">
      {bands.map((b, i) => (
        <rect key={`band-${i}`} x={b.x} y={b.y} width={b.w} height={b.h} fill="#facc15" fillOpacity={0.22} data-testid="loop-band" />
      ))}
      {marks.map((m) => (
        <g key={m.id} data-accidental={m.accidental ?? undefined} data-wrong={m.wrong ? 'true' : undefined}>
          {m.ledgers.map((dy) => (
            <line
              key={dy}
              x1={m.x - m.space}
              x2={m.x + m.space}
              y1={m.y + dy}
              y2={m.y + dy}
              stroke={m.wrong ? ACC_RED : PLAYED_BLUE}
              strokeWidth={Math.max(1, m.space * 0.12)}
            />
          ))}
          <ellipse
            cx={m.x}
            cy={m.y}
            rx={m.space * 0.62}
            ry={m.space * 0.45}
            transform={`rotate(-20 ${m.x} ${m.y})`}
            fill={m.wrong ? ACC_RED : PLAYED_BLUE}
            fillOpacity={m.wrong ? 0.9 : 0.75}
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
