import { useEffect, useState } from 'react';
import type { InviteState } from '../../../main/invite';

// "Bring in the tutor" (#5154): asks Pantheon to put Jarvis + Karen on him live.
// It ends 10 min after his last note (main's timer) or when he presses it again.

export function TutorButton() {
  const [state, setState] = useState<InviteState | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const bridge = window.tutorBridge;
    if (!bridge?.inviteStatus) return;
    void bridge.inviteStatus().then((r) => setState(r.state));
    return bridge.onCommand((cmd) => {
      if (cmd.type !== 'invite') return;
      setState(cmd.state);
      setNow(Date.now());
    });
  }, []);

  const active = !!state?.active;
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, [active]);

  if (!state) return null;
  const toggle = async () => {
    const bridge = window.tutorBridge;
    if (busy || !bridge?.inviteToggle) return;
    setBusy(true);
    setError('');
    try {
      const r = await bridge.inviteToggle();
      setState(r.state);
      setError(r.error ?? '');
      setNow(Date.now());
    } finally {
      setBusy(false);
    }
  };
  const minutes = Math.max(1, Math.ceil(((state.endsAt ?? now) - now) / 60_000));

  return (
    <div className="flex items-center gap-2 text-xs">
      {error && <span className="text-amber-400">{error}</span>}
      <button
        onClick={() => void toggle()}
        disabled={busy}
        title={active
          ? 'Jarvis and Karen are with you. It ends 10 minutes after your last note, or press to end it now.'
          : 'Ask Jarvis and Karen to join you at the piano.'}
        className={`rounded-md px-3 py-1 font-medium transition-colors disabled:opacity-60 ${
          active
            ? 'bg-emerald-600 text-white shadow-[0_0_12px_rgba(16,185,129,0.7)] hover:bg-emerald-500'
            : 'text-gray-400 hover:bg-gray-800/60 hover:text-gray-200'
        }`}
      >
        {busy && !active ? 'Calling…' : active ? `Tutor on · ${minutes} min left` : 'Bring in the tutor'}
      </button>
    </div>
  );
}
