import { useEffect, useRef, useState } from 'react';
import { parseBar, stepBar, wheelNotch } from './noteEdit';

// #10236: a bar number he can type. Lands on Enter or leaving the field; anything that
// isn't a bar goes back to what it was, and so does one the caller turns down.
// #10254: the wheel over it steps the number, and lands once he stops. Only the wheel starts that
// wait: a number he's part way through typing stays until he says so.
export function BarInput({ value, onCommit, testId, disabled, focus, title, from, last }: {
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
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  const dropRef = useRef(false);
  const wheelRunRef = useRef({ at: 0, delta: 0, dir: 0 });
  const wheelTimerRef = useRef(0);
  useEffect(() => {
    if (focus) ref.current?.select();
  }, [focus]);
  const commit = () => {
    window.clearTimeout(wheelTimerRef.current);
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
    window.clearTimeout(wheelTimerRef.current);
    wheelTimerRef.current = window.setTimeout(() => latest.current.commit(), 300);
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
      onBlur={commit}
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
