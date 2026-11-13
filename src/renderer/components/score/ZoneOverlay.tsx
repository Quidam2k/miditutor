// #11354 item 4 (JP homework 11/6): each hand's positions shaded over its staff, two tints
// taking turns so a change of position shows, and a red mark where the hand jumps
// mid-phrase ("fishing"). Hover a mark for how far it moves.

export interface ZoneBand {
  x: number;
  y: number;
  w: number;
  h: number;
  hand: 'L' | 'R';
  index: number;
}

export interface ZoneMark {
  x: number;
  y: number;
  size: number;
  title: string;
}

const TINTS = { R: ['#38bdf8', '#a78bfa'], L: ['#34d399', '#fbbf24'] } as const;

// #6086: Block mode reuses this layer for the current position, in one yellow tint
// (prefix 'block' keeps its test ids apart from the Hand zones overlay).
export function ZoneOverlay({ bands, marks, prefix = 'zone', tint }: { bands: ZoneBand[]; marks: ZoneMark[]; prefix?: string; tint?: string }) {
  if (bands.length === 0 && marks.length === 0) return null;
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" data-testid={`${prefix}-overlay`}>
      {bands.map((b, i) => (
        <rect
          key={`z-${i}`}
          x={b.x}
          y={b.y}
          width={b.w}
          height={b.h}
          rx={3}
          fill={tint ?? TINTS[b.hand][b.index % 2]}
          fillOpacity={tint ? 0.28 : 0.16}
          data-testid={`${prefix}-band`}
          data-hand={b.hand}
        />
      ))}
      {marks.map((m, i) => (
        <g key={`f-${i}`} className="pointer-events-auto" data-testid="fishing-mark">
          <title>{m.title}</title>
          <polygon
            points={`${m.x},${m.y - m.size} ${m.x - m.size * 0.8},${m.y + m.size * 0.6} ${m.x + m.size * 0.8},${m.y + m.size * 0.6}`}
            fill="#dc2626"
            fillOpacity={0.85}
          />
        </g>
      ))}
    </svg>
  );
}
