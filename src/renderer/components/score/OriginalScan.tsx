import { useEffect, useRef, useState } from 'react';
import type { Layout, LayoutSystem } from '../../../shared/review';

// #9988 phase 1: the scanned line holding the bar he is on, with that bar boxed, so he
// can compare the page with what OMR made of it. Uses the Review tab's layout and
// crops (review:piece / review:crop); a piece without a scan layout shows nothing.
// Self-contained (slug + bar in), so any score layout can host it (#5153).

interface Bridge {
  reviewPiece(slug: string): Promise<{ layout: Layout | null }>;
  reviewCrop(slug: string, rel: string): Promise<string>;
}
const getBridge = () => (window as unknown as { tutorBridge?: Partial<Bridge> }).tutorBridge;

/** The layout for a scanned piece, or null (no review folder, or not a scanned piece). */
export function useScanLayout(slug: string | null): Layout | null {
  const [layout, setLayout] = useState<Layout | null>(null);
  useEffect(() => {
    setLayout(null);
    const bridge = getBridge();
    if (!slug || !bridge?.reviewPiece) return;
    let live = true;
    bridge
      .reviewPiece(slug)
      .then((p) => live && setLayout(p.layout?.systems.length ? p.layout : null))
      .catch(() => undefined); // not a scanned piece: no Original button
    return () => {
      live = false;
    };
  }, [slug]);
  return layout;
}

const systemFor = (layout: Layout, bar: number): LayoutSystem | undefined =>
  layout.systems.find((s) => s.measures && bar >= s.measures[0] && bar <= s.measures[1]);

export function OriginalScan({ slug, layout, bar }: { slug: string; layout: Layout; bar: number }) {
  const sys = systemFor(layout, bar);
  const crops = useRef(new Map<string, string>());
  const [url, setUrl] = useState('');
  const [width, setWidth] = useState(0);
  const rel = sys?.crop ?? '';

  useEffect(() => {
    const bridge = getBridge();
    if (!rel || !bridge?.reviewCrop) return;
    const cached = crops.current.get(rel);
    if (cached) {
      setUrl(cached);
      return;
    }
    let live = true;
    bridge
      .reviewCrop(slug, rel)
      .then((u) => {
        crops.current.set(rel, u);
        if (live) setUrl(u);
      })
      .catch(() => live && setUrl(''));
    return () => {
      live = false;
    };
  }, [slug, rel]);

  if (!sys || !sys.measures) {
    return <div className="rounded-md bg-gray-900/60 px-3 py-2 text-sm text-gray-400">No scan of bar {bar}.</div>;
  }
  // Barlines are page px; the crop is the page scaled by crop_scale from x = 0.
  const k = bar - sys.measures[0];
  const x0 = (sys.barlines[k] ?? 0) * layout.crop_scale;
  const x1 = (sys.barlines[k + 1] ?? 0) * layout.crop_scale;
  return (
    <div className="relative overflow-hidden rounded-md bg-white" data-testid="original-scan">
      {url && (
        <img src={url} alt={`Scan of bar ${bar}`} className="block w-full" onLoad={(e) => setWidth(e.currentTarget.naturalWidth)} />
      )}
      {url && width > 0 && x1 > x0 && (
        <div
          className="pointer-events-none absolute inset-y-0 border-2 border-indigo-500 bg-indigo-500/10"
          style={{ left: `${(x0 / width) * 100}%`, width: `${((x1 - x0) / width) * 100}%` }}
        />
      )}
    </div>
  );
}
