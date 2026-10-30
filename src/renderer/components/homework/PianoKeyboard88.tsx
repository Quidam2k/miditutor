import { useMemo, type MouseEvent } from 'react';
import { isWhiteKey } from '../../engine/MusicTheory';

interface Props {
  green?: ReadonlySet<number>;
  red?: ReadonlySet<number>;
  held?: ReadonlySet<number>;
  /** Text drawn on a key, e.g. the finger number for a lit key (#5153). */
  labels?: ReadonlyMap<number, string>;
  /** The key being edited (#10238): outranks every other colour. */
  yellow?: number | null;
  onKeyHover?: (midi: number | null) => void;
  onKeyClick?: (midi: number, ev: MouseEvent) => void;
  heightRatio?: number;
  /** Lowest MIDI note drawn (default 21 = A0). */
  low?: number;
  /** Highest MIDI note drawn (default 108 = C8). */
  high?: number;
}

const WHITE_W = 10;
const BLACK_W = WHITE_W * 0.6;
const OUTLINE = '#475569';

interface KeyGeom {
  midi: number;
  x: number;
  white: boolean;
}

/** x positions of every key in low..high; black keys sit centred on the boundary between whites. */
function layout(low: number, high: number): { keys: KeyGeom[]; width: number } {
  const keys: KeyGeom[] = [];
  let whites = 0;
  for (let midi = low; midi <= high; midi++) {
    if (isWhiteKey(midi)) {
      keys.push({ midi, x: whites * WHITE_W, white: true });
      whites++;
    } else {
      keys.push({ midi, x: whites * WHITE_W - BLACK_W / 2, white: false });
    }
  }
  return { keys, width: whites * WHITE_W };
}

/** Display-only 88-key piano that scales to its container; keys light red / green / held. */
export function PianoKeyboard88({ green, red, held, labels, yellow, onKeyHover, onKeyClick, low = 21, high = 108, heightRatio = 7 }: Props) {
  const { keys, width } = useMemo(() => layout(low, high), [low, high]);
  const height = Math.round(width / heightRatio);
  const blackH = height * 0.62;

  const fill = (k: KeyGeom): string => {
    if (yellow === k.midi) return '#ffe600';
    if (red?.has(k.midi)) return '#ef4444';
    if (green?.has(k.midi)) return '#22c55e';
    if (held?.has(k.midi)) return '#818cf8';
    return k.white ? '#f8fafc' : '#111827';
  };
  const middleC = keys.find((k) => k.midi === 60);
  // Only a strip that edits notes reacts to the pointer.
  const events = (k: KeyGeom) =>
    onKeyHover || onKeyClick
      ? {
          'data-midi': k.midi,
          'data-yellow': yellow === k.midi ? 'true' : undefined,
          onMouseEnter: () => onKeyHover?.(k.midi),
          onClick: (ev: MouseEvent) => onKeyClick?.(k.midi, ev),
          style: { cursor: 'pointer' },
        }
      : {};

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      role="img"
      aria-label="Piano keyboard"
      style={{ display: 'block' }}
      onMouseLeave={onKeyHover && (() => onKeyHover(null))}
    >
      {keys.filter((k) => k.white).map((k) => (
        <rect key={k.midi} x={k.x} y={0} width={WHITE_W} height={height} fill={fill(k)} stroke={OUTLINE} strokeWidth={0.4} {...events(k)} />
      ))}
      {keys.filter((k) => !k.white).map((k) => (
        <rect key={k.midi} x={k.x} y={0} width={BLACK_W} height={blackH} fill={fill(k)} stroke={OUTLINE} strokeWidth={0.4} {...events(k)} />
      ))}
      {/* A finger number on middle C takes the dot's place. */}
      {middleC && !labels?.has(60) && <circle cx={middleC.x + WHITE_W / 2} cy={height - WHITE_W * 0.9} r={WHITE_W * 0.2} fill="#9ca3af" />}
      {labels && keys.filter((k) => labels.has(k.midi)).map((k) => (
        <text
          key={`label-${k.midi}`}
          x={k.x + (k.white ? WHITE_W : BLACK_W) / 2}
          y={k.white ? height - WHITE_W * 0.35 : blackH - BLACK_W * 0.3}
          textAnchor="middle"
          fontSize={k.white ? WHITE_W * 0.8 : BLACK_W * 0.9}
          fontWeight="bold"
          fill={k.white || yellow === k.midi ? '#111827' : '#ffffff'}
          pointerEvents="none"
        >
          {labels.get(k.midi)}
        </text>
      ))}
    </svg>
  );
}
