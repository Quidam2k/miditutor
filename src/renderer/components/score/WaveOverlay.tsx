// Clean-run celebration (#5521): after a clean lap the loop's noteheads flare softly and
// fade fast, one beat after another left to right like a crowd wave. Default off.
// The parent remounts this overlay to replay the animation.

export interface WaveDot {
  x: number;
  y: number;
  r: number;
  delayMs: number;
}

export function waveDelays(beats: number[], perBeatMs = 90, maxMs = 1200): number[] {
  if (beats.length === 0) return [];
  const minBeat = Math.min(...beats);
  const maxBeat = Math.max(...beats);
  if (minBeat === maxBeat) return beats.map(() => 0);
  const span = maxBeat - minBeat;
  const step = span * perBeatMs > maxMs ? maxMs / span : perBeatMs;
  return beats.map((beat) => Math.round((beat - minBeat) * step));
}

export const WAVE_FLARE_MS = 450;

export function WaveOverlay({ dots, peak = 0.45 }: { dots: WaveDot[]; peak?: number }) {
  if (dots.length === 0) return null;
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" data-testid="wave-overlay">
      <style>{`
        @keyframes mt-wave {
          0% { opacity: 0; transform: scale(.6); }
          30% { opacity: var(--mt-wave-peak); }
          100% { opacity: 0; transform: scale(1.5); }
        }
      `}</style>
      {dots.map(({ x, y, r, delayMs }, i) => (
        <circle
          key={i}
          cx={x}
          cy={y}
          r={r}
          fill="#fbbf24"
          data-wave-dot=""
          style={{
            opacity: 0,
            transformBox: 'fill-box',
            transformOrigin: 'center',
            animation: `mt-wave ${WAVE_FLARE_MS}ms ease-out ${delayMs}ms both`,
            ['--mt-wave-peak' as string]: peak,
          }}
        />
      ))}
    </svg>
  );
}
