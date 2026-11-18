import { useEffect, useRef, useState } from 'react';
import { parseBar, stepBar, wheelNotch } from './noteEdit';

// #10236: a bar number he can type. Lands on Enter or leaving the field; anything that
// isn't a bar goes back to what it was, and so does one the caller turns down.
// #10254: the wheel over it steps the number, and lands once he stops. Only the wheel starts that
// wait: a number he's part way through typing stays until he says so.
// #6369: a spin only changes the number (and the caller's preview); it lands when the pointer
// leaves the box or after WHEEL_LAND_MS still, so a slow spin is one change, not one per pause.
export const WHEEL_LAND_MS = 1000;

export function BarInput({ value, onCommit, testId, disabled, focus, title, from, last, onPreview }: {
  value: number | null;
  onCommit: (bar: number) => void;
  testId: string;
  disabled?: boolean;
  focus?: boolean;
  title?: string;
  /** Where the wheel starts when the box is empty. */
  from?: number | null;
  /** The wheel stops here. */
  last?: number;
  /** The bar a spin is showing before it lands; null once it lands or drops. */
  onPreview?: (bar: number | null) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  const dropRef = useRef(false);
  // #5944: the click that focuses the box selects it all; the mouse-up must not undo that.
  const freshRef = useRef(false);
  const wheelRunRef = useRef({ at: 0, delta: 0, dir: 0 });
  const wheelTimerRef = useRef(0);
  const spinningRef = useRef(false);
  useEffect(() => {
    if (focus) ref.current?.select();
  }, [focus]);
  const commit = () => {
    window.clearTimeout(wheelTimerRef.current);
    if (spinningRef.current) {
      spinningRef.current = false;
      onPreview?.(null);
    }
    const bar = draft === null || dropRef.current ? null : parseBar(draft);
    dropRef.current = false;
    setDraft(null);
    if (bar !== null && bar !== value) onCommit(bar);
  };
  const onWheel = (ev: WheelEvent) => {
    if (disabled) return;
    // Not passive: the page underneath must not scroll as well.
    ev.preventDefault();
    const notch = wheelNotch(wheelRunRef.current, ev.deltaMode === 1 ? ev.deltaY * 40 : ev.deltaY, performance.now());
    if (notch === 0) return;
    const shown = draft === null ? null : parseBar(draft);
    const next = stepBar(shown ?? value ?? from ?? null, notch, last);
    if (next === null) return;
    setDraft(String(next));
    spinningRef.current = true;
    onPreview?.(next);
    window.clearTimeout(wheelTimerRef.current);
    wheelTimerRef.current = window.setTimeout(() => latest.current.commit(), WHEEL_LAND_MS);
  };
  const latest = useRef({ commit, onWheel });
  latest.current = { commit, onWheel };
  useEffect(() => {
    const box = ref.current;
    const listen = (ev: WheelEvent) => latest.current.onWheel(ev);
    box?.addEventListener('wheel', listen, { passive: false });
    return () => {
      box?.removeEventListener('wheel', listen);
      window.clearTimeout(wheelTimerRef.current);
    };
  }, []);
  return (
    <input
      ref={ref}
      value={draft ?? value ?? ''}
      disabled={disabled}
      title={title}
      inputMode="numeric"
      data-testid={testId}
      data-bar-input
      onChange={(e) => {
        window.clearTimeout(wheelTimerRef.current);
        setDraft(e.target.value);
      }}
      onFocus={(e) => e.currentTarget.select()}
      onMouseDown={(e) => { freshRef.current = document.activeElement !== e.currentTarget; }}
      onMouseUp={(e) => { if (freshRef.current) e.preventDefault(); }}
      onBlur={commit}
      onMouseLeave={() => { if (spinningRef.current) commit(); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          // Only the typing: Esc anywhere else clears the loop.
          e.stopPropagation();
          dropRef.current = true;
          e.currentTarget.blur();
        }
      }}
      className="w-12 rounded bg-gray-800 px-1 text-center font-mono text-gray-100 disabled:opacity-40"
    />
  );
}
