import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/**
 * #6054: a click-to-open popover for a one-handed trackball: no hover, no chords, no right-click.
 * Plain left click opens and closes it; a click outside, Escape or Enter closes it. It stays open
 * while he ticks several boxes. The panel is capped to the window so it fits without scrolling the page.
 */
export function Popover({ label, badge, testId, btn, children }: {
  label: string;
  badge?: string;
  testId: string;
  btn: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [dx, setDx] = useState(0);

  // Slide the panel sideways so it always sits inside the window, wherever the toolbar wrapped the button.
  useLayoutEffect(() => {
    if (!open || !ref.current || !panelRef.current) return;
    const left = ref.current.getBoundingClientRect().left;
    const width = panelRef.current.offsetWidth;
    const want = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    setDx(Math.round(want - left));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        data-testid={testId}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`${btn} ${badge ? 'ring-2 ring-sky-400' : ''}`}
      >
        {label}
        {badge ? <span data-testid={`${testId}-badge`} className="ml-1 rounded bg-sky-600 px-1 text-xs text-white">{badge}</span> : null}
        <span aria-hidden> ▾</span>
      </button>
      {open && (
        <div
          ref={panelRef}
          data-testid={`${testId}-panel`}
          style={{ left: dx }}
          // A button that does something (Sight-read, Hand zones...) closes the menu so it never covers the music;
          // boxes stay open for ticking several; data-stay keeps it open for a repeat press (the miss-sound Test).
          onClick={(e) => {
            const b = (e.target as HTMLElement).closest('button');
            if (b && !b.hasAttribute('data-stay')) setOpen(false);
          }}
          onKeyDown={(e) => {
            const t = e.target as HTMLElement;
            if (e.key === 'Enter' && t.tagName !== 'BUTTON' && t.tagName !== 'TEXTAREA') setOpen(false);
          }}
          className={`absolute top-full z-40 mt-1 flex max-h-[calc(100vh-9rem)] w-[min(26rem,calc(100vw-2rem))] flex-col gap-2 overflow-y-auto rounded-md border border-gray-700 bg-gray-900 p-3 text-sm text-gray-300 shadow-lg`}
        >
          {children}
        </div>
      )}
    </div>
  );
}
