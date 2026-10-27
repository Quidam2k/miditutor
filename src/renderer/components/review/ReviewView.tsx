import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import {
  Circle,
  Layout,
  LayoutSystem,
  MarkCheck,
  MarkState,
  Proposal,
  ReviewEvent,
  ReviewState,
  cropToPage,
  staffAtY,
  systemRange,
} from '../../../shared/review';
import { BarSpan, MarkNote, NoteBox, barsUnder, describeNotes, markNotes, notesInCircle, notesInShare } from '../../../shared/reviewCircle';
import { addBeams } from '../../engine/autoBeam';
import { useSettingsStore } from '../../store/useSettingsStore';
import { PieceTrust, trustMark } from '../../../shared/trust';

// Scan review (#9664): check an OMR'd score against the scan, one printed line at
// a time. He circles what's wrong on either side (as many as he likes; a circle
// over a bar line marks each bar), or confirms the line. The app only appends
// events through the bridge; everything shown is the returned state.

interface Summary {
  slug: string;
  file: string;
  title: string;
  trust: { status?: string; note?: string; source?: string } | null;
  match: 'exact' | 'partial' | 'none' | null;
  systems: number;
  confirmed: number;
  openMarks: number;
  verified: boolean;
}

interface Piece {
  slug: string;
  title: string;
  musicxml: string;
  sha: string;
  layout: Layout | null;
  events: ReviewEvent[];
  state: ReviewState;
  checks: Record<string, MarkCheck>;
}

type AppendEvent =
  | { kind: 'mark'; system: number; measure: number | null; staff: number | null; note: string; circle: Circle; notes?: MarkNote[] }
  | { kind: 'confirm_system'; system: number }
  | { kind: 'withdraw'; mark: string }
  | { kind: 'reject'; mark: string; note: string };

interface ReviewBridge {
  reviewList(): Promise<Summary[]>;
  reviewPiece(slug: string): Promise<Piece>;
  reviewCrop(slug: string, rel: string): Promise<string>;
  reviewAppend(slug: string, event: AppendEvent): Promise<Piece>;
  reviewAccept(slug: string, proposal: string): Promise<Piece>;
  reviewRecheck(slug: string, mark: string): Promise<Piece>;
  reviewProposal(slug: string, proposal: string): Promise<{ crop: string; musicxml: string | null }>;
}

const getBridge = () => (window as unknown as { tutorBridge?: ReviewBridge }).tutorBridge;
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

const CHECK_POLL_MS = 4000;
const OSMD_OPTIONS = {
  autoResize: false,
  backend: 'svg',
  drawTitle: false,
  drawSubtitle: false,
  drawComposer: false,
  drawLyricist: false,
  drawPartNames: false,
  drawMeasureNumbers: true,
  // Beams come from addBeams (#9764); OSMD's own pass only picks up what that leaves, like tuplets.
  autoBeam: true,
} as const;
const LEARNING = ['o-from-o', 'the-stormy-sea', 'sorcerers-apprentice', 'let-me-fall-from-quidam'];

// ---- list ordering ----

const trustRank = (s: Summary) => (s.trust?.status === 'issues' ? 0 : s.trust?.status === 'checked' || s.trust?.status === 'verified' ? 2 : 1);
const matchRank = (s: Summary) => (s.match === 'exact' ? 2 : s.match === 'partial' ? 1 : 0);
const byTitle = (a: Summary, b: Summary) => a.title.localeCompare(b.title, undefined, { numeric: true });

function worstFirst(a: Summary, b: Summary): number {
  return (
    Number(a.verified) - Number(b.verified) ||
    trustRank(a) - trustRank(b) ||
    b.openMarks - a.openMarks ||
    matchRank(a) - matchRank(b) ||
    byTitle(a, b)
  );
}

function learningFirst(list: Summary[], favorites: string[]): Summary[] {
  const learning = LEARNING.flatMap((slug) => list.filter((s) => s.slug === slug));
  const rest = list.filter((s) => !LEARNING.includes(s.slug));
  const favs = rest.filter((s) => favorites.includes(s.title)).sort(byTitle);
  const others = rest.filter((s) => !favorites.includes(s.title)).sort(worstFirst);
  return [...learning, ...favs, ...others];
}

function summaryTrust(s: Summary): PieceTrust | undefined {
  if (s.verified) return { status: 'verified', note: s.trust?.note ?? '' };
  const status = s.trust?.status;
  if (status === 'checked' || status === 'issues' || status === 'unverified' || status === 'verified') {
    return { status, note: s.trust?.note ?? '' };
  }
  return undefined;
}

// ---- OSMD bar boxes ----

interface StaffBand {
  y0: number;
  y1: number;
}
interface BarBox {
  measure: number;
  x: number;
  y: number;
  w: number;
  h: number;
  staves: StaffBand[];
}
interface OsmdBox {
  AbsolutePosition: { x: number; y: number };
  BorderLeft: number;
  BorderRight: number;
  BorderTop: number;
  BorderBottom: number;
}

// Pixel box of each bar from..to (all staves), in the OSMD <svg> user frame.
function barBoxes(osmd: OpenSheetMusicDisplay, from: number, to: number): BarBox[] {
  const space = 10 * osmd.Zoom;
  const list = osmd.GraphicSheet.MeasureList as unknown as ({
    PositionAndShape?: OsmdBox;
    ParentMusicSystem?: unknown;
  } | undefined)[][];
  const boxes: BarBox[] = [];
  for (let measure = from; measure <= to; measure++) {
    const staves = (list[measure - 1] ?? []).flatMap((m) =>
      m?.PositionAndShape && m.ParentMusicSystem ? [m.PositionAndShape] : [],
    );
    if (staves.length === 0) continue;
    const top = staves[0];
    const bottom = staves[staves.length - 1];
    boxes.push({
      measure,
      x: (top.AbsolutePosition.x + top.BorderLeft) * space,
      y: (top.AbsolutePosition.y + top.BorderTop) * space,
      w: (top.BorderRight - top.BorderLeft) * space,
      h: (bottom.AbsolutePosition.y + bottom.BorderBottom - top.AbsolutePosition.y - top.BorderTop) * space,
      staves: staves.map((s) => ({
        y0: (s.AbsolutePosition.y + s.BorderTop) * space,
        y1: (s.AbsolutePosition.y + s.BorderBottom) * space,
      })),
    });
  }
  return boxes;
}

interface OsmdNoteShape {
  sourceNote?: { halfTone: number; isRest(): boolean; Pitch?: { FundamentalNote: number; AccidentalHalfTones: number } };
  PositionAndShape?: OsmdBox;
}
interface OsmdStaffEntryShape {
  relInMeasureTimestamp?: { RealValue: number };
  graphicalVoiceEntries?: { notes?: OsmdNoteShape[] }[];
}
const LETTERS: Record<number, string> = { 0: 'C', 2: 'D', 4: 'E', 5: 'F', 7: 'G', 9: 'A', 11: 'B' };

// "F#4" from OSMD's spelling; its halfTone + 12 is the MIDI number (C4 = 60).
function noteName(n: NonNullable<OsmdNoteShape['sourceNote']>): string {
  const midi = n.halfTone + 12;
  const p = n.Pitch;
  if (!p || LETTERS[p.FundamentalNote] === undefined) return String(midi);
  const acc = p.AccidentalHalfTones;
  const octave = Math.floor((midi - p.FundamentalNote - acc) / 12) - 1;
  return `${LETTERS[p.FundamentalNote]}${acc > 0 ? '#'.repeat(acc) : 'b'.repeat(-acc)}${octave}`;
}

// Every drawn note head of bars from..to, in the OSMD <svg> user frame.
function noteBoxes(osmd: OpenSheetMusicDisplay, from: number, to: number): NoteBox[] {
  const space = 10 * osmd.Zoom;
  const list = osmd.GraphicSheet.MeasureList as unknown as ({
    staffEntries?: OsmdStaffEntryShape[];
    ParentMusicSystem?: unknown;
    parentSourceMeasure?: { ActiveTimeSignature?: { Denominator: number } };
  } | undefined)[][];
  const out: NoteBox[] = [];
  for (let measure = from; measure <= to; measure++) {
    (list[measure - 1] ?? []).forEach((m, staffIdx) => {
      if (!m?.ParentMusicSystem) return;
      const unit = m.parentSourceMeasure?.ActiveTimeSignature?.Denominator ?? 4;
      for (const se of m.staffEntries ?? []) {
        const beat = 1 + Math.round((se.relInMeasureTimestamp?.RealValue ?? 0) * unit * 100) / 100;
        for (const ve of se.graphicalVoiceEntries ?? []) {
          for (const gn of ve.notes ?? []) {
            const src = gn.sourceNote;
            const pos = gn.PositionAndShape?.AbsolutePosition;
            if (!src || src.isRest() || !pos) continue;
            out.push({ measure, staff: staffIdx + 1, x: pos.x * space, y: pos.y * space, name: noteName(src), beat });
          }
        }
      }
    });
  }
  return out;
}

// The bar a score-side circle centre falls in (else the nearest sideways), and the staff.
function scoreHit(boxes: BarBox[], cx: number, cy: number): { measure: number | null; staff: number | null } {
  if (boxes.length === 0) return { measure: null, staff: null };
  const gap = (b: BarBox) => (cx < b.x ? b.x - cx : cx >= b.x + b.w ? cx - (b.x + b.w) : 0);
  const box = boxes.reduce((best, b) => (gap(b) < gap(best) ? b : best));
  const staff = box.staves.findIndex((s) => cy >= s.y0 && cy <= s.y1);
  return { measure: box.measure, staff: staff >= 0 ? staff + 1 : null };
}

// ---- drawing overlay ----

interface Frame {
  w: number;
  h: number;
}
interface Pt {
  x: number;
  y: number;
}
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface Tint extends Rect {
  tone: 'amber' | 'red';
  /** Just an outline: his circle says what's wrong, the bar is context. */
  outline?: boolean;
}

const TINT = { amber: 'rgba(245, 158, 11, 0.32)', red: 'rgba(239, 68, 68, 0.28)' };
const OUTLINE = { amber: 'rgba(245, 158, 11, 0.9)', red: 'rgba(239, 68, 68, 0.7)' };
const CLICK_PX = 8;
const CLICK_RADIUS_PX = 12;

// An svg laid over a panel whose viewBox is the panel's own frame (OSMD svg size, or
// the crop's natural px), so shapes and pointer positions share one coordinate system.
function DrawOverlay(props: {
  testId: string;
  frame: Frame;
  disabled?: boolean;
  circles: Circle[];
  tints: Tint[];
  onCircle: (c: { cx: number; cy: number; r: number }) => void;
}) {
  const { testId, frame, disabled, circles, tints, onCircle } = props;
  const [stroke, setStroke] = useState<Pt[] | null>(null);
  const strokeRef = useRef<Pt[] | null>(null);

  const toFrame = (e: React.PointerEvent<SVGSVGElement>): Pt => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) * frame.w) / (rect.width || 1),
      y: ((e.clientY - rect.top) * frame.h) / (rect.height || 1),
    };
  };

  const down = (e: React.PointerEvent<SVGSVGElement>) => {
    if (disabled || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    strokeRef.current = [toFrame(e)];
    setStroke(strokeRef.current);
  };
  const move = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!strokeRef.current) return;
    strokeRef.current = [...strokeRef.current, toFrame(e)];
    setStroke(strokeRef.current);
  };
  const up = (e: React.PointerEvent<SVGSVGElement>) => {
    const pts = strokeRef.current;
    strokeRef.current = null;
    setStroke(null);
    if (!pts) return;
    const scale = frame.w / (e.currentTarget.getBoundingClientRect().width || 1); // frame units per display px
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    if ((x1 - x0) / scale < CLICK_PX && (y1 - y0) / scale < CLICK_PX) {
      onCircle({ cx: pts[pts.length - 1].x, cy: pts[pts.length - 1].y, r: CLICK_RADIUS_PX * scale });
    } else {
      onCircle({ cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, r: Math.max(x1 - x0, y1 - y0) / 2 });
    }
  };
  const cancel = () => {
    strokeRef.current = null;
    setStroke(null);
  };

  return (
    <svg
      data-testid={testId}
      viewBox={`0 0 ${frame.w} ${frame.h}`}
      preserveAspectRatio="none"
      className={`absolute inset-0 h-full w-full touch-none ${disabled ? '' : 'cursor-crosshair'}`}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={cancel}
    >
      {tints.map((t, i) => (
        <rect
          key={i}
          x={t.x}
          y={t.y}
          width={t.w}
          height={t.h}
          fill={t.outline ? 'none' : TINT[t.tone]}
          stroke={t.outline ? OUTLINE[t.tone] : 'none'}
          strokeWidth={1.5}
          strokeDasharray={t.outline ? '6 4' : undefined}
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
        />
      ))}
      {circles.map((c, i) => (
        <circle
          key={i}
          cx={c.cx}
          cy={c.cy}
          r={c.r}
          fill="none"
          stroke="#ef4444"
          strokeWidth={2.5}
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
        />
      ))}
      {stroke && (
        <polyline
          points={stroke.map((p) => `${p.x},${p.y}`).join(' ')}
          fill="none"
          stroke="#ef4444"
          strokeWidth={2.5}
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
        />
      )}
    </svg>
  );
}

// ---- piece view ----

interface Pending {
  /** Keys this pending mark in the list (circles can share a bar). */
  key: number;
  circle: Circle;
  measure: number;
  staff: number | null;
  notes: MarkNote[];
  note: string;
}

interface ScoreData {
  key: string; // "from-to": boxes only count for the range they were measured on
  frame: Frame;
  boxes: BarBox[];
  notes: NoteBox[];
}

const STATUS_ORDER: Record<MarkState['status'], number> = { open: 0, applied: 1, withdrawn: 2 };

const staffWords = (staff: number | null) => (staff ? (staff === 1 ? ', upper staff' : ', lower staff') : '');

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}

/** Bars with a lint flag on this line, in order (a bar flagged twice counts once). */
const suspectBars = (s: LayoutSystem | undefined): number[] =>
  [...new Set((s?.suspects ?? []).map((f) => f.measure))].sort((a, b) => a - b);

const KEYS: [string, string][] = [
  ['Space / C', 'this line matches, next line'],
  ['J / K', 'next / previous suspect bar'],
  ['← / →', 'previous / next line'],
  ['Enter', 'save the circled marks'],
  ['Esc', 'drop the last circle'],
];

function nextUnconfirmed(p: Piece, from: number): number {
  const systems = p.layout?.systems ?? [];
  for (let k = 1; k <= systems.length; k++) {
    const i = (from + k) % systems.length;
    if (p.state.confirmed[systems[i].index] === undefined) return i;
  }
  return -1;
}

function PieceReview({ slug, onBack }: { slug: string; onBack: () => void }) {
  const [piece, setPiece] = useState<Piece | null>(null);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [lineIdx, setLineIdx] = useState(0);
  const [pending, setPending] = useState<Pending[]>([]);
  const [notice, setNotice] = useState('');
  // The suspect bar J/K landed on; it only shows on its own line.
  const [focus, setFocus] = useState<{ system: number; measure: number } | null>(null);
  const pendingKey = useRef(0);

  // Scan side.
  const crops = useRef(new Map<string, string>());
  const [cropUrl, setCropUrl] = useState('');
  const [natural, setNatural] = useState<{ url: string; w: number; h: number } | null>(null);

  // Score side.
  const scoreHostRef = useRef<HTMLDivElement>(null);
  const [engine, setEngine] = useState<OpenSheetMusicDisplay | null>(null);
  const [scoreError, setScoreError] = useState('');
  const [scoreData, setScoreData] = useState<ScoreData | null>(null);

  useEffect(() => {
    const bridge = getBridge();
    if (!bridge) {
      setLoadError("Review isn't available here.");
      return;
    }
    let disposed = false;
    setPiece(null);
    setLoadError('');
    bridge
      .reviewPiece(slug)
      .then((p) => {
        if (disposed) return;
        setPiece(p);
        const systems = p.layout?.systems ?? [];
        const first = systems.findIndex((s) => p.state.confirmed[s.index] === undefined);
        setLineIdx(first >= 0 ? first : 0);
      })
      .catch((e) => !disposed && setLoadError(errText(e)));
    return () => {
      disposed = true;
    };
  }, [slug]);

  const layout = piece?.layout ?? null;
  const systems = useMemo(() => layout?.systems ?? [], [layout]);
  const hasLines = systems.length > 0;
  const sys: LayoutSystem | undefined = systems[Math.min(lineIdx, systems.length - 1)];
  const range = layout && sys ? systemRange(layout, sys.index) : null;
  const rangeKey = range ? `${range.from}-${range.to}` : '';
  const mapped = !!range?.mapped;
  const sha = piece?.sha ?? '';

  const canConfirmRef = useRef(false);
  const go = useCallback(
    (i: number) => setLineIdx(Math.max(0, Math.min(i, systems.length - 1))),
    [systems.length],
  );

  // Pending marks belong to the line they were drawn on: moving on drops them, and says so.
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  useEffect(() => {
    const dropped = pendingRef.current.length;
    setPending([]);
    setNotice(dropped ? `${dropped} unsaved circle${dropped > 1 ? 's' : ''} dropped when you left that line.` : '');
  }, [lineIdx, slug]);

  // Keys run whatever this render's handlers are (set below, once they exist).
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => undefined);
  useEffect(() => {
    if (!hasLines) return;
    const onKey = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hasLines]);

  // Crop for the current line.
  const cropRel = sys?.crop ?? '';
  useEffect(() => {
    const bridge = getBridge();
    if (!bridge || !cropRel) return;
    const key = `${slug}/${cropRel}`;
    const cached = crops.current.get(key);
    if (cached) {
      setCropUrl(cached);
      return;
    }
    let disposed = false;
    setCropUrl('');
    bridge
      .reviewCrop(slug, cropRel)
      .then((url) => {
        crops.current.set(key, url);
        if (!disposed) setCropUrl(url);
      })
      .catch((e) => !disposed && setError(errText(e)));
    return () => {
      disposed = true;
    };
  }, [slug, cropRel]);

  // One OSMD per opened piece (and per score revision); the XML loads once.
  const xmlRef = useRef('');
  xmlRef.current = piece?.musicxml ?? '';
  useEffect(() => {
    const host = scoreHostRef.current;
    if (!host || !sha) return;
    let disposed = false;
    setEngine(null);
    setScoreData(null);
    setScoreError('');
    const osmd = new OpenSheetMusicDisplay(host, {
      ...OSMD_OPTIONS,
      // Each render is one line, which OSMD would leave unstretched as a "last" line: fill the width like the scan.
      stretchLastSystemLine: true,
    });
    osmd
      .load(addBeams(xmlRef.current))
      .then(() => !disposed && setEngine(osmd))
      .catch((e) => !disposed && setScoreError(errText(e)));
    return () => {
      disposed = true;
      host.innerHTML = '';
    };
  }, [sha, hasLines]);

  // Render just this line's bars and measure them.
  useEffect(() => {
    const host = scoreHostRef.current;
    if (!engine || !host) return;
    if (!range) {
      engine.clear();
      setScoreData(null);
      return;
    }
    try {
      engine.setOptions({ drawFromMeasureNumber: range.from, drawUpToMeasureNumber: range.to });
      engine.render();
      const svg = host.querySelector('svg');
      if (!svg) throw new Error('The score did not draw.');
      const box = svg.getBoundingClientRect();
      const w = parseFloat(svg.getAttribute('width') ?? '') || box.width;
      const h = parseFloat(svg.getAttribute('height') ?? '') || box.height;
      setScoreData({
        key: `${range.from}-${range.to}`, frame: { w, h },
        boxes: barBoxes(engine, range.from, range.to), notes: noteBoxes(engine, range.from, range.to),
      });
      setScoreError('');
    } catch (e) {
      setScoreError(errText(e));
    }
    // range is derived from rangeKey
  }, [engine, rangeKey]);

  const score = scoreData && scoreData.key === rangeKey ? scoreData : null;
  const scanFrame = natural && natural.url === cropUrl ? { w: natural.w, h: natural.h } : null;

  // Write path: every change goes through main, and the reply replaces the piece.
  const act = async (call: (bridge: ReviewBridge) => Promise<Piece>): Promise<Piece | null> => {
    const bridge = getBridge();
    if (!bridge) return null;
    setBusy(true);
    try {
      const p = await call(bridge);
      setPiece(p);
      setError('');
      return p;
    } catch (e) {
      setError(errText(e));
      return null;
    } finally {
      setBusy(false);
    }
  };
  const append = (event: AppendEvent) => act((b) => b.reviewAppend(slug, event));

  // A re-check takes a minute or so: look again every few seconds while one is pending.
  const pendingChecks = Object.values(piece?.checks ?? {}).some((c) => c.state === 'checking' || c.state === 'waiting');
  useEffect(() => {
    const bridge = getBridge();
    if (!bridge || !pendingChecks) return;
    const timer = setInterval(() => {
      bridge.reviewPiece(slug).then(setPiece, () => undefined);
    }, CHECK_POLL_MS);
    return () => clearInterval(timer);
  }, [slug, pendingChecks]);

  const scanBar = (m: number | null): Rect | null => {
    if (m === null || !sys?.measures || !layout || !scanFrame) return null;
    const i = m - sys.measures[0];
    if (i < 0 || i >= sys.bars) return null;
    const x0 = sys.barlines[i] * layout.crop_scale;
    const x1 = sys.barlines[i + 1] * layout.crop_scale;
    return { x: x0, y: 0, w: x1 - x0, h: scanFrame.h };
  };
  const scoreBar = (m: number | null): Rect | null =>
    (m === null ? undefined : score?.boxes.find((x) => x.measure === m)) ?? null;
  const tinted = (r: Rect | null, tone: Tint['tone']): Tint[] => (r ? [{ x: r.x, y: r.y, w: r.w, h: r.h, tone }] : []);

  const focusBar = focus && sys && focus.system === sys.index ? focus.measure : null;
  const openHere = (piece?.state.marks ?? []).filter((m) => m.status === 'open' && sys && m.system === sys.index);
  // His circle shows what's wrong; the bar is only outlined (a mark from before circles kept notes is filled).
  const circlesOn = (side: Circle['side']): Circle[] => [
    ...openHere.flatMap((m) => (m.circle?.side === side ? [m.circle] : [])),
    ...pending.flatMap((pm, i) =>
      pm.circle.side === side && pending.findIndex((q) => q.circle === pm.circle) === i ? [pm.circle] : []),
  ];
  const tintsOn = (bar: (m: number | null) => Rect | null): Tint[] => [
    ...openHere.flatMap((m) => tinted(bar(m.measure), 'red').map((t) => ({ ...t, outline: !!m.circle }))),
    ...pending.flatMap((pm) => tinted(bar(pm.measure), 'amber').map((t) => ({ ...t, outline: true }))),
    ...(focusBar !== null ? tinted(bar(focusBar), 'amber').map((t) => ({ ...t, outline: true })) : []),
  ];
  const suspectHere = focusBar === null ? [] : (sys?.suspects ?? []).filter((f) => f.measure === focusBar);

  // One pending mark per bar the circle covers, each with the notes inside it.
  const addPending = (circle: Circle, perBar: { measure: number; staff: number | null; notes: NoteBox[] }[]) => {
    if (perBar.length === 0) {
      setNotice("That circle isn't on a bar of this line, so it wasn't kept.");
      return;
    }
    setNotice('');
    setPending((list) => [...list, ...perBar.map((b) => ({
      key: ++pendingKey.current, circle, measure: b.measure, staff: b.staff, notes: markNotes(b.notes), note: '',
    }))]);
  };
  const onScanCircle = (c: { cx: number; cy: number; r: number }) => {
    const first = sys?.measures?.[0];
    if (!layout || !sys || first === undefined) return;
    const scale = layout.crop_scale;
    const spans: BarSpan[] = Array.from({ length: sys.bars }, (_, i) => ({
      measure: first + i, x0: sys.barlines[i] * scale, x1: sys.barlines[i + 1] * scale,
    }));
    const staff = staffAtY(sys, cropToPage(layout, sys, c.cx, c.cy).y);
    addPending({ side: 'scan', ...c }, barsUnder(spans, c.cx, c.r).map((measure) => {
      const span = spans.find((b) => b.measure === measure) as BarSpan;
      const box = score?.boxes.find((b) => b.measure === measure);
      const share = (x: number) => (x - span.x0) / (span.x1 - span.x0);
      const notes = box && score ? notesInShare(score.notes, measure, staff, box, share(c.cx - c.r), share(c.cx + c.r)) : [];
      return { measure, staff, notes };
    }));
  };
  const onScoreCircle = (c: { cx: number; cy: number; r: number }) => {
    const boxes = score?.boxes ?? [];
    const spans: BarSpan[] = boxes.map((b) => ({ measure: b.measure, x0: b.x, x1: b.x + b.w }));
    // A note's position is its head's corner: a little slack so a snug circle still catches it.
    const reach = { ...c, r: c.r * 1.15 + 4 };
    addPending({ side: 'score', ...c }, barsUnder(spans, c.cx, c.r).map((measure) => ({
      measure,
      staff: scoreHit(boxes.filter((b) => b.measure === measure), c.cx, c.cy).staff,
      notes: score ? notesInCircle(score.notes, measure, reach) : [],
    })));
  };

  // One save at a time (a held Enter or Enter-then-click would save the rest twice).
  const savingRef = useRef(false);
  const submitMarks = async () => {
    if (!sys || savingRef.current) return;
    savingRef.current = true;
    setNotice('');
    try {
      for (const { key } of pending) {
        // Read it fresh: leaving the line drops what's left, and a note may have been typed meanwhile.
        const pm = pendingRef.current.find((q) => q.key === key);
        if (!pm) return;
        const p = await append({
          kind: 'mark', system: sys.index, measure: pm.measure, staff: pm.staff,
          note: pm.note.trim(), circle: pm.circle, notes: pm.notes,
        });
        if (!p) return; // the error shows; what's left stays pending
        setPending((list) => list.filter((q) => q.key !== key));
      }
    } finally {
      savingRef.current = false;
    }
  };
  const dropLast = () => {
    const last = pending[pending.length - 1];
    if (!last) return;
    setPending(pending.slice(0, -1));
    setNotice(`Dropped the circle on bar ${last.measure}; it wasn't saved.`);
  };

  const confirmLine = async () => {
    if (!sys || !piece || busy) return;
    if (!canConfirmRef.current) {
      if (openHere.length) setNotice("This line has an open mark, so it can't be confirmed yet.");
      else if (pending.length) setNotice('Save or drop the circled marks first.');
      else if (!mapped) setNotice("This line doesn't line up with the score, so it can't be confirmed.");
      else if (piece.state.confirmed[sys.index] !== undefined) {
        const next = nextUnconfirmed(piece, lineIdx);
        if (next >= 0) go(next);
        else setNotice('Every line is confirmed.');
      }
      return;
    }
    const p = await append({ kind: 'confirm_system', system: sys.index });
    if (!p) return;
    const next = nextUnconfirmed(p, lineIdx);
    if (next >= 0) go(next);
  };

  // J/K: the next or previous lint-flagged bar, across lines. Only moves; never confirms.
  const jumpSuspect = (dir: 1 | -1) => {
    const all = systems.flatMap((s, i) => suspectBars(s).map((measure) => ({ i, system: s.index, measure })));
    if (all.length === 0) {
      setNotice('No suspect bars in this piece.');
      return;
    }
    const at = focusBar ?? -Infinity;
    const cmp = (a: { i: number; measure: number }) => a.i - lineIdx || a.measure - at;
    const target = dir > 0
      ? all.find((a) => cmp(a) > 0) ?? all[0]
      : [...all].reverse().find((a) => cmp(a) < 0) ?? all[all.length - 1];
    if (target.i !== lineIdx) go(target.i);
    setFocus({ system: target.system, measure: target.measure });
  };

  keyRef.current = (e: KeyboardEvent) => {
    // A circle's note box handles its own Enter / Esc.
    if (isTyping(e.target) || e.ctrlKey || e.altKey || e.metaKey) return;
    // A held key repeats: that may move, never confirm or save one line after another.
    if (e.repeat && (e.key === ' ' || e.key === 'Enter' || e.key.toLowerCase() === 'c')) {
      e.preventDefault();
      return;
    }
    const onButton = e.target instanceof HTMLElement && !!e.target.closest('button, [role="button"]');
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (key === 'ArrowLeft') go(lineIdx - 1);
    else if (key === 'ArrowRight') go(lineIdx + 1);
    else if (key === 'j') jumpSuspect(1);
    else if (key === 'k') jumpSuspect(-1);
    else if (key === 'Escape') dropLast();
    else if (key === ' ' || key === 'c') void confirmLine();
    else if (key === 'Enter' && !onButton) void (pending.length ? submitMarks() : confirmLine());
    else return;
    e.preventDefault();
  };

  if (loadError || !piece) {
    return (
      <div data-testid="review-piece">
        <button onClick={onBack} className="mb-3 text-sm text-gray-400 hover:text-white">← All pieces</button>
        {loadError
          ? <p className="text-red-400" data-testid="review-error">{loadError}</p>
          : <p className="text-gray-400">Lining up the scan…</p>}
      </div>
    );
  }

  const { state } = piece;
  const confirmedCount = systems.filter((s) => state.confirmed[s.index] !== undefined).length;
  const isConfirmed = !!sys && state.confirmed[sys.index] !== undefined;
  const hasOpen = openHere.length > 0;
  const canConfirm = !!sys && mapped && !hasOpen && !isConfirmed && !busy && pending.length === 0;
  canConfirmRef.current = canConfirm;

  const jumpToMark = (m: MarkState) => {
    const i = systems.findIndex((s) => s.index === m.system);
    if (i >= 0) go(i);
  };

  return (
    <div className="w-full" data-testid="review-piece">
      <button onClick={onBack} className="mb-3 text-sm text-gray-400 hover:text-white">← All pieces</button>
      <div className="mb-3 flex flex-wrap items-baseline gap-x-4">
        <h2 className="text-xl font-semibold">{piece.title}</h2>
        {state.verified ? (
          <span className="text-sm text-green-400">Verified by you</span>
        ) : (
          <span className="text-sm text-gray-400">{confirmedCount}/{systems.length} lines confirmed</span>
        )}
      </div>
      {state.externalChange && (
        <p className="mb-3 text-sm text-amber-400">
          The score changed since you confirmed some lines; those need confirming again.
        </p>
      )}
      {error && <p className="mb-3 text-sm text-red-400" data-testid="review-error">{error}</p>}
      {!hasLines && <p className="mb-3 text-gray-300">This scan could not be lined up with the score.</p>}

      {hasLines && sys && (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <button
              data-testid="review-prev"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => go(lineIdx - 1)}
              disabled={lineIdx <= 0}
              className="rounded bg-gray-800 px-3 py-1 text-sm hover:bg-gray-700 disabled:opacity-40"
            >
              Prev
            </button>
            <span data-testid="review-line-label" className="text-sm text-gray-200">
              Line {lineIdx + 1} of {systems.length}
            </span>
            <button
              data-testid="review-next"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => go(lineIdx + 1)}
              disabled={lineIdx >= systems.length - 1}
              className="rounded bg-gray-800 px-3 py-1 text-sm hover:bg-gray-700 disabled:opacity-40"
            >
              Next
            </button>
            <div className="ml-2 flex flex-wrap gap-1">
              {systems.map((s, i) => {
                const open = state.marks.some((m) => m.status === 'open' && m.system === s.index);
                const tone = open
                  ? 'bg-red-700 hover:bg-red-600'
                  : state.confirmed[s.index] !== undefined
                    ? 'bg-green-700 hover:bg-green-600'
                    : 'bg-gray-700 hover:bg-gray-600';
                const suspects = suspectBars(s).length;
                return (
                  <button
                    key={s.index}
                    data-testid={`review-line-${s.index}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => go(i)}
                    title={suspects ? `${suspects} suspect bar${suspects > 1 ? 's' : ''}` : undefined}
                    className={`relative h-6 min-w-6 rounded px-1 text-xs ${tone} ${i === lineIdx ? 'ring-2 ring-white' : ''}`}
                  >
                    {s.index}
                    {suspects > 0 && (
                      <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-amber-400" data-testid="review-suspect-dot" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mb-1 text-xs uppercase tracking-wide text-gray-500">Scan</div>
          {!mapped && (
            <p className="mb-1 text-sm text-amber-300">
              This line doesn't line up with the score: circle the bar on the score side.
            </p>
          )}
          <div className="relative mb-3 min-h-16 overflow-hidden rounded bg-white">
            {cropUrl && (
              <img
                src={cropUrl}
                alt={`Scan of line ${sys.index}`}
                draggable={false}
                className="block w-full select-none"
                onLoad={(e) =>
                  setNatural({ url: cropUrl, w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })
                }
              />
            )}
            {scanFrame && (
              <DrawOverlay
                testId="review-scan-overlay"
                frame={scanFrame}
                disabled={!mapped}
                circles={circlesOn('scan')}
                tints={tintsOn(scanBar)}
                onCircle={onScanCircle}
              />
            )}
          </div>

          <div className="mb-1 text-xs uppercase tracking-wide text-gray-500">Score</div>
          <div className="relative mb-3 min-h-16 overflow-hidden rounded bg-white text-black">
            <div ref={scoreHostRef} />
            {score && (
              <DrawOverlay
                testId="review-score-overlay"
                frame={score.frame}
                circles={circlesOn('score')}
                tints={tintsOn(scoreBar)}
                onCircle={onScoreCircle}
              />
            )}
            {!range && <p className="p-3 text-sm text-gray-600">No score bars for this line.</p>}
            {scoreError && <p className="p-3 text-sm text-red-600">{scoreError}</p>}
          </div>

          {suspectHere.length > 0 && (
            <p className="mb-2 text-sm text-amber-300" data-testid="review-suspect">
              Suspect bar {focusBar}: {suspectHere.map((f) => f.detail).join('; ')}
            </p>
          )}
          {notice && <p className="mb-2 text-sm text-amber-300" data-testid="review-notice">{notice}</p>}

          {pending.length > 0 && (
            <div className="mb-3 space-y-2 rounded bg-gray-900 p-3" data-testid="review-pending">
              {pending.map((pm, i) => (
                <div key={pm.key} className="flex flex-wrap items-center gap-2" data-testid="review-pending-mark">
                  <span className="text-sm text-amber-300">
                    Bar {pm.measure}{staffWords(pm.staff)}
                    {pm.notes.length > 0 && <span className="text-amber-200">: {describeNotes(pm.notes)}</span>}
                  </span>
                  <input
                    data-testid="review-mark-input"
                    autoFocus={i === pending.length - 1}
                    placeholder="what's wrong? (optional)"
                    value={pm.note}
                    onChange={(e) => {
                      const note = e.target.value;
                      setPending((list) => list.map((q) => (q.key === pm.key ? { ...q, note } : q)));
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void submitMarks();
                      else if (e.key === 'Escape') dropLast();
                    }}
                    className="min-w-48 flex-1 rounded border border-gray-700 bg-gray-950 px-2 py-1 text-sm text-white"
                  />
                </div>
              ))}
              <div className="flex gap-2">
                <button
                  data-testid="review-mark-submit"
                  onClick={() => void submitMarks()}
                  disabled={busy}
                  className="rounded bg-red-700 px-3 py-1 text-sm hover:bg-red-600 disabled:opacity-40"
                >
                  Save {pending.length > 1 ? `${pending.length} marks` : 'mark'}
                </button>
                <button
                  data-testid="review-mark-drop"
                  onClick={dropLast}
                  className="rounded bg-gray-800 px-3 py-1 text-sm hover:bg-gray-700"
                >
                  Drop last
                </button>
              </div>
            </div>
          )}

          <div className="mb-6 flex flex-wrap items-center gap-x-6 gap-y-2">
            <button
              data-testid="review-confirm"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => void confirmLine()}
              disabled={!canConfirm}
              className="rounded bg-green-700 px-4 py-2 font-medium hover:bg-green-600 disabled:opacity-40"
            >
              {isConfirmed ? '✔ Confirmed' : 'This line matches'}
            </button>
            <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-400" data-testid="review-keys">
              {KEYS.map(([k, what]) => (
                <div key={k} className="flex gap-1">
                  <dt><kbd className="rounded bg-gray-800 px-1 text-gray-200">{k}</kbd></dt>
                  <dd>{what}</dd>
                </div>
              ))}
            </dl>
          </div>
        </>
      )}

      <MarksList
        slug={slug}
        musicxml={piece.musicxml}
        marks={state.marks}
        checks={piece.checks ?? {}}
        busy={busy}
        onJump={jumpToMark}
        onWithdraw={(id) => void append({ kind: 'withdraw', mark: id })}
        onAccept={(proposal) => void act((b) => b.reviewAccept(slug, proposal))}
        onReject={(mark, text) => void append({ kind: 'reject', mark, note: text })}
        onRecheck={(mark) => void act((b) => b.reviewRecheck(slug, mark))}
      />
    </div>
  );
}

function MarksList(props: {
  slug: string;
  musicxml: string;
  marks: MarkState[];
  checks: Record<string, MarkCheck>;
  busy: boolean;
  onJump: (m: MarkState) => void;
  onWithdraw: (id: string) => void;
  onAccept: (proposal: string) => void;
  onReject: (mark: string, note: string) => void;
  onRecheck: (mark: string) => void;
}) {
  const sorted = [...props.marks].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.ts - b.ts);
  return (
    <div data-testid="review-marks">
      <h3 className="mb-2 text-sm font-semibold text-gray-300">Marks</h3>
      {sorted.length === 0 && <p className="text-sm text-gray-500">No marks yet.</p>}
      <ul className="space-y-2">
        {sorted.map((m) => (
          <li
            key={m.id}
            data-testid={`review-mark-${m.id}`}
            role="button"
            tabIndex={0}
            onClick={() => props.onJump(m)}
            onKeyDown={(e) => e.key === 'Enter' && props.onJump(m)}
            className={`cursor-pointer rounded bg-gray-900 px-3 py-2 text-sm hover:bg-gray-800 ${m.status === 'withdrawn' ? 'opacity-50' : ''}`}
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-medium">
                Line {m.system}, bar {m.measure ?? '?'}{staffWords(m.staff)}
                {m.notes.length > 0 && <span className="font-normal text-gray-300">: {describeNotes(m.notes)}</span>}
              </span>
              {m.note && <span className="text-gray-300">{m.note}</span>}
              <span className="ml-auto flex items-center gap-2 text-xs">
                {m.status === 'open' && (
                  <>
                    <CheckBadge check={props.checks[m.id]} />
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        props.onWithdraw(m.id);
                      }}
                      disabled={props.busy}
                      className="rounded bg-gray-800 px-2 py-0.5 text-gray-200 hover:bg-gray-700 disabled:opacity-40"
                    >
                      Withdraw
                    </button>
                  </>
                )}
                {m.status === 'applied' && <span className="text-green-400">fixed</span>}
                {m.status === 'withdrawn' && <span className="text-gray-400">withdrawn</span>}
              </span>
            </div>
            {m.status === 'open' && (
              <CheckDetail
                slug={props.slug}
                musicxml={props.musicxml}
                mark={m}
                check={props.checks[m.id]}
                busy={props.busy}
                onAccept={props.onAccept}
                onReject={props.onReject}
                onRecheck={props.onRecheck}
              />
            )}
            {m.rejections.length > 0 && (
              <ul className="mt-1 text-xs text-gray-500">
                {m.rejections.map((r, i) => (
                  <li key={i}>Still wrong{r ? `: ${r}` : ''}</li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function CheckBadge({ check }: { check: MarkCheck | undefined }) {
  if (!check || check.state === 'checking' || check.state === 'needed') {
    return (
      <>
        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-amber-400" />
        <span className="text-amber-300">checking…</span>
      </>
    );
  }
  if (check.state === 'waiting') return <span className="text-amber-300">waiting</span>;
  const status = check.proposal.status;
  return status === 'ready'
    ? <span className="text-sky-300">fix proposed</span>
    : <span className="text-gray-300">{status === 'no_change' ? 'no change found' : "couldn't check"}</span>;
}

/** Under an open mark: why a check waits, or its proposal with the scan beside the proposed bar. */
function CheckDetail(props: {
  slug: string;
  musicxml: string;
  mark: MarkState;
  check: MarkCheck | undefined;
  busy: boolean;
  onAccept: (proposal: string) => void;
  onReject: (mark: string, note: string) => void;
  onRecheck: (mark: string) => void;
}) {
  const { check, mark } = props;
  const [view, setView] = useState<{ crop: string; musicxml: string | null } | null>(null);
  const [text, setText] = useState('');
  const proposal: Proposal | null = check?.state === 'done' ? check.proposal : null;
  const proposalId = proposal?.id ?? '';
  useEffect(() => {
    const bridge = getBridge();
    setView(null);
    if (!bridge || !proposalId) return;
    let disposed = false;
    bridge.reviewProposal(props.slug, proposalId).then((v) => !disposed && setView(v), () => undefined);
    return () => {
      disposed = true;
    };
  }, [props.slug, proposalId]);

  // Clicks in here are not "jump to this mark".
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const retry = (
    <button
      onClick={() => props.onRecheck(mark.id)}
      disabled={props.busy}
      className="rounded bg-gray-800 px-2 py-0.5 text-xs text-gray-200 hover:bg-gray-700 disabled:opacity-40"
    >
      Try again
    </button>
  );
  if (check?.state === 'waiting') {
    return (
      <div className="mt-1 flex items-center gap-2 text-xs text-amber-200" onClick={stop}>
        <span>{check.reason}</span>
        {mark.measure !== null && retry}
      </div>
    );
  }
  if (!proposal) return null;
  if (proposal.status === 'failed') {
    return (
      <div className="mt-1 flex items-center gap-2 text-xs text-red-300" onClick={stop}>
        <span>{proposal.reason}</span>
        {retry}
      </div>
    );
  }
  const ready = proposal.status === 'ready';
  return (
    <div className="mt-2 space-y-2 border-t border-gray-800 pt-2" data-testid={`review-proposal-${mark.id}`} onClick={stop} onKeyDown={stop}>
      <p className="text-gray-200">
        {ready ? 'Proposed fix: ' : 'The checker thinks this bar matches the scan: '}
        {proposal.explanation}
      </p>
      {view && <img src={view.crop} alt="The scan around this bar" className="max-h-56 rounded bg-white" />}
      {ready && view?.musicxml && (
        <div className="grid grid-cols-2 gap-2">
          <BarRender label="Now" xml={props.musicxml} measure={proposal.measure} />
          <BarRender label="Proposed" xml={view.musicxml} measure={proposal.measure} />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {ready && (
          <button
            data-testid="review-accept"
            onClick={() => props.onAccept(proposal.id)}
            disabled={props.busy || !view?.musicxml}
            className="rounded bg-green-700 px-3 py-1 font-medium hover:bg-green-600 disabled:opacity-40"
          >
            Accept
          </button>
        )}
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="What's still wrong? (optional)"
          className="min-w-0 flex-1 rounded bg-gray-800 px-2 py-1 text-sm"
        />
        <button
          data-testid="review-still-wrong"
          onClick={() => {
            props.onReject(mark.id, text.trim());
            setText('');
          }}
          disabled={props.busy}
          className="rounded bg-gray-700 px-3 py-1 hover:bg-gray-600 disabled:opacity-40"
        >
          Still wrong
        </button>
      </div>
    </div>
  );
}

/** One bar of a score, drawn on its own. */
function BarRender({ label, xml, measure }: { label: string; xml: string; measure: number }) {
  const host = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState('');
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let disposed = false;
    setFailed('');
    const osmd = new OpenSheetMusicDisplay(el, {
      ...OSMD_OPTIONS,
      drawFromMeasureNumber: measure,
      drawUpToMeasureNumber: measure,
    });
    osmd
      .load(xml)
      .then(() => !disposed && osmd.render())
      .catch((e) => !disposed && setFailed(errText(e)));
    return () => {
      disposed = true;
      el.innerHTML = '';
    };
  }, [xml, measure]);
  return (
    <div className="rounded bg-white p-1 text-black" data-testid={`review-bar-${label.toLowerCase()}`}>
      <div className="text-xs text-gray-600">{label}</div>
      <div ref={host} />
      {failed && <p className="text-xs text-red-600">{failed}</p>}
    </div>
  );
}

// ---- list view ----

type SortMode = 'learning' | 'worst';

function ReviewList({ sort, onSort, onOpen }: { sort: SortMode; onSort: (s: SortMode) => void; onOpen: (slug: string) => void }) {
  const favorites = useSettingsStore((s) => s.favoritePieces);
  const [list, setList] = useState<Summary[] | null>(null);
  const [error, setError] = useState('');

  // Mounted fresh each time the list is shown, so this reloads every time.
  useEffect(() => {
    const bridge = getBridge();
    if (!bridge) {
      setError("Review isn't available here.");
      return;
    }
    let disposed = false;
    bridge
      .reviewList()
      .then((l) => !disposed && setList(l))
      .catch((e) => !disposed && setError(errText(e)));
    return () => {
      disposed = true;
    };
  }, []);

  const shown = useMemo(
    () => (list ? (sort === 'learning' ? learningFirst(list, favorites) : [...list].sort(worstFirst)) : []),
    [list, sort, favorites],
  );

  const toggle = (mode: SortMode) =>
    `rounded px-3 py-1 text-sm ${sort === mode ? 'bg-blue-700 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`;

  return (
    <div className="mx-auto max-w-3xl" data-testid="review-list">
      <h2 className="mb-3 text-xl font-semibold">Review</h2>
      <div className="mb-4 flex gap-2">
        <button data-testid="review-sort-learning" onClick={() => onSort('learning')} className={toggle('learning')}>
          Learning first
        </button>
        <button data-testid="review-sort-worst" onClick={() => onSort('worst')} className={toggle('worst')}>
          Worst first
        </button>
      </div>
      {error && <p className="text-red-400" data-testid="review-error">{error}</p>}
      {!list && !error && <p className="text-gray-400">Loading…</p>}
      <div className="space-y-1">
        {shown.map((s) => (
          <button
            key={s.slug}
            data-testid={`review-row-${s.slug}`}
            onClick={() => onOpen(s.slug)}
            className="block w-full rounded bg-gray-900 px-3 py-2 text-left hover:bg-gray-800"
          >
            <div>
              <span className="mr-2">{trustMark(summaryTrust(s))}</span>
              {s.title}
            </div>
            <div className="text-xs text-gray-500">
              {s.verified ? (
                <span className="text-green-400">Verified by you</span>
              ) : (
                `${s.confirmed}/${s.systems} lines confirmed`
              )}
              {s.openMarks > 0 && ` · ${s.openMarks} open mark${s.openMarks === 1 ? '' : 's'}`}
              {s.match === 'partial' && " · some lines don't line up"}
              {(s.match === 'none' || s.match === null) && ' · scan not lined up'}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

export function ReviewView() {
  const [slug, setSlug] = useState<string | null>(null);
  const [sort, setSort] = useState<SortMode>('learning');
  return (
    <div className="text-white">
      {slug ? (
        <PieceReview key={slug} slug={slug} onBack={() => setSlug(null)} />
      ) : (
        <ReviewList sort={sort} onSort={setSort} onOpen={setSlug} />
      )}
    </div>
  );
}
