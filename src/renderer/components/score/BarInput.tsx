import { useEffect, useRef, useState } from 'react';
import { parseBar } from './noteEdit';

// #10236: a bar number he can type. Lands on Enter or leaving the field; anything that
// isn't a bar goes back to what it was, and so does one the caller turns down.
export function BarInput({ value, onCommit, testId, disabled, focus, title }: {
  value: number | null;
  onCommit: (bar: number) => void;
  testId: string;
  disabled?: boolean;
  focus?: boolean;
  title?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  const dropRef = useRef(false);
  useEffect(() => {
    if (focus) ref.current?.select();
  }, [focus]);
  const commit = () => {
    const bar = draft === null || dropRef.current ? null : parseBar(draft);
    dropRef.current = false;
    setDraft(null);
    if (bar !== null && bar !== value) onCommit(bar);
  };
  return (
    <input
      ref={ref}
      value={draft ?? value ?? ''}
      disabled={disabled}
      title={title}
      inputMode="numeric"
      data-testid={testId}
      onChange={(e) => setDraft(e.target.value)}
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
