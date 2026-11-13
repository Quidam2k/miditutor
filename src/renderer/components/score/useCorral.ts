import { useCallback, useEffect, useRef, useState } from 'react';
import { SESSION_QUIET_MS, clockEvent, emptyCorral, frontRow, newClock, recordUse, type CorralData, type SessionClock, type Usage } from '../../engine/Corral';
import { useMidiStore } from '../../store/useMidiStore';

/** Read control-usage.json defensively: anything odd means "no data" for that part. */
export function parseUsage(raw: unknown): CorralData {
  const r = raw as { sessions?: unknown; controls?: Record<string, Partial<Usage>> } | null;
  const out = emptyCorral();
  if (typeof r?.sessions === 'number' && Number.isFinite(r.sessions) && r.sessions >= 0) out.sessions = Math.floor(r.sessions);
  for (const [id, u] of Object.entries(r?.controls ?? {})) {
    if (!u || typeof u.uses !== 'number') continue;
    out.controls[id] = {
      uses: u.uses,
      lastUsedAt: typeof u.lastUsedAt === 'number' ? u.lastUsedAt : 0,
      ...(typeof u.lastSession === 'number' ? { lastSession: u.lastSession } : {}),
      perDay: u.perDay && typeof u.perDay === 'object' ? u.perDay : {},
    };
  }
  return out;
}

/**
 * #6062: which controls are on the front row. The visible set is a snapshot, taken once the usage file
 * has loaded and again only after SESSION_QUIET_MS without a note or click: it never changes under his
 * hand. A control he uses from the More menu is promoted at once.
 */
export function useCorral(order: readonly string[], staticFront: (id: string) => boolean, on: (id: string) => boolean) {
  const [front, setFront] = useState<Set<string>>(() => new Set(order.filter(staticFront)));
  const dataRef = useRef<CorralData | null>(null);
  const clockRef = useRef<SessionClock>(newClock());
  const onRef = useRef(on);
  onRef.current = on;
  const quietTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // While the More menu is open a control he just used stays in it (so a box he is ticking does not jump away
  // under the pointer); it comes forward the moment the menu closes.
  const holding = useRef(false);
  const pending = useRef<Set<string>>(new Set());

  const commit = useCallback((next: CorralData) => {
    dataRef.current = next;
    window.tutorBridge?.controlUsageSave?.(next);
  }, []);

  const snapshot = useCallback(() => {
    if (dataRef.current) setFront(new Set(frontRow(dataRef.current, order, staticFront, (id) => onRef.current(id))));
  }, [order, staticFront]);

  // The recompute happens only at a quiet gap, never on a note or click.
  const activity = useCallback(() => {
    if (quietTimer.current) clearTimeout(quietTimer.current);
    quietTimer.current = setTimeout(snapshot, SESSION_QUIET_MS);
  }, [snapshot]);

  const sessionEvent = useCallback((kind: 'invite-on' | 'invite-off' | 'note') => {
    const before = clockRef.current.started;
    clockRef.current = clockEvent(clockRef.current, kind, Date.now());
    if (clockRef.current.started > before && dataRef.current) commit({ ...dataRef.current, sessions: dataRef.current.sessions + 1 });
    if (kind !== 'invite-off') activity();
  }, [commit, activity]);

  useEffect(() => {
    let alive = true;
    const bridge = window.tutorBridge;
    void (bridge?.controlUsageLoad?.() ?? Promise.resolve(null)).catch(() => null).then((raw) => {
      if (!alive) return;
      const loaded = parseUsage(raw);
      dataRef.current = loaded;
      setFront(new Set(frontRow(loaded, order, staticFront, () => false)));
    });
    const unsub = bridge?.onCommand((cmd) => {
      if (cmd.type === 'invite') sessionEvent(cmd.state.active ? 'invite-on' : 'invite-off');
    });
    return () => {
      alive = false;
      unsub?.();
      if (quietTimer.current) clearTimeout(quietTimer.current);
    };
  }, [order, staticFront, sessionEvent]);

  useEffect(() => useMidiStore.subscribe((s, prev) => {
    if (s.lastNoteOn && s.lastNoteOn !== prev.lastNoteOn) sessionEvent('note');
  }), [sessionEvent]);

  /** A click or change on control `id`. Coming from More, it comes forward at once. */
  const use = useCallback((id: string) => {
    if (!dataRef.current) return;
    commit(recordUse(dataRef.current, id, Date.now()));
    if (holding.current) pending.current.add(id);
    else setFront((f) => (f.has(id) ? f : new Set(f).add(id)));
    activity();
  }, [commit, activity]);

  /** The More menu opened (true) or closed (false): closing brings forward what he used while it was open. */
  const hold = useCallback((on: boolean) => {
    holding.current = on;
    if (on || pending.current.size === 0) return;
    const ids = [...pending.current];
    pending.current.clear();
    setFront((f) => new Set([...f, ...ids]));
  }, []);

  /** Everything on the front row now. Each hidden control counts as used, so it stays N sessions. */
  const showEverything = useCallback(() => {
    if (!dataRef.current) return;
    let next = dataRef.current;
    const now = Date.now();
    for (const id of order) if (!front.has(id)) next = recordUse(next, id, now);
    commit(next);
    pending.current.clear();
    setFront(new Set(order));
  }, [order, front, commit]);

  return { front, use, hold, showEverything };
}
