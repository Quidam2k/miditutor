// #6771 (asg 14108): renderer errors go to main, which sends them to Pantheon (main/errorReport.ts).
type Report = { where: string; message: string; stack?: string | null; piece?: string | null };
const bridge = () => (window as unknown as { tutorBridge?: { reportError?: (r: Report) => void } }).tutorBridge;

let sending = false;
/** Never throws, never calls itself (a failing bridge must not feed the window error handler). */
export function reportError(where: string, err: unknown, piece: string | null = null): void {
  if (sending) return;
  sending = true;
  try {
    const e = err as { message?: unknown; stack?: unknown } | null;
    const message = typeof e?.message === 'string' ? e.message : String(err);
    bridge()?.reportError?.({ where, message, stack: typeof e?.stack === 'string' ? e.stack : null, piece });
  } catch {
    // nothing to do: reporting must never become the error
  } finally {
    sending = false;
  }
}

/** window error + unhandled rejection, once at startup. */
export function installErrorHandlers(): void {
  window.addEventListener('error', (ev) => reportError('window', ev.error ?? ev.message));
  window.addEventListener('unhandledrejection', (ev) => reportError('unhandled rejection', ev.reason));
}
