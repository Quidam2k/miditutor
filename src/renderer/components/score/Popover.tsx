import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * #6054: a click-to-open popover for a one-handed trackball: no hover, no chords, no right-click.
 * Plain left click opens and closes it; a click outside, Escape or Enter closes it. It stays open
 * while he ticks several boxes. The badge floats over the button's corner: it never changes the button's size, so nothing next to it moves. The panel is capped to the window so it fits without scrolling the page.
 */
export function Popover({ label, badge, testId, btn, onOpenChange, children }: {
  label: string;
  badge?: string;
  testId: string;
  btn: string;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const notify = useRef(onOpenChange);
  notify.current = onOpenChange;
  useEffect(() => {
    notify.current?.(open);
    return () => notify.current?.(false);
  }, [open]);
  const [pos, setPos] = useState<{ left: number; top: number; maxH: number } | null>(null);

  // The panel is drawn on the body, fixed under the button: inside the toolbar it would stretch an
  // ancestor's scroll area and a scrollbar would shove the toolbar sideways. Placed inside the window.
  useLayoutEffect(() => {
    if (!open || !ref.current || !panelRef.current) return;
    const rect = ref.current.getBoundingClientRect();
    const width = panelRef.current.offsetWidth;
    const top = Math.round(rect.bottom + 4);
    setPos({
      left: Math.round(Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))),
      top,
      maxH: Math.max(120, Math.floor(window.innerHeight - top - 8)),
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current && !ref.current.contains(t) && !panelRef.current?.contains(t)) setOpen(false);
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
        {badge ? <span data-testid={`${testId}-badge`} className="pointer-events-none absolute -right-1 -top-2 whitespace-nowrap rounded bg-sky-600 px-1 text-[10px] leading-4 text-white">{badge}</span> : null}
        <span aria-hidden> ▾</span>
      </button>
      {open && createPortal(
        <div
          ref={panelRef}
          data-testid={`${testId}-panel`}
          style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, maxHeight: pos?.maxH, visibility: pos ? 'visible' : 'hidden' }}
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
          className={`fixed z-50 flex w-[min(26rem,calc(100vw-2rem))] flex-col gap-2 overflow-y-auto rounded-md border border-gray-700 bg-gray-900 p-3 text-sm text-gray-300 shadow-lg`}
        >
          {children}
        </div>,
        document.body,
      )}
    </div>
  );
}
