import { useMidiStore } from '../../store/useMidiStore';

// Milestone 1a: the "did the keyboard connect and is it sending notes?" oracle.
// Lists every detected input and shows a live log of note-on/off with name,
// MIDI number, velocity, channel, and time. This is what makes the first
// physical Roland test unambiguous.

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number, w = 2) => n.toString().padStart(w, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(
    d.getMilliseconds(),
    3,
  )}`;
}

export function MidiMonitor() {
  const { devices, activeDevice, enabled, error, noteLog, clearLog } = useMidiStore();

  return (
    <div className="flex w-full flex-col gap-4">
      {/* Devices */}
      <section className="rounded-lg border border-gray-800 bg-gray-900/40 p-4">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-gray-400">
          Inputs
        </h2>
        {error ? (
          <p className="text-sm text-red-400">MIDI error: {error}</p>
        ) : !enabled ? (
          <p className="text-sm text-gray-500">Enabling Web MIDI…</p>
        ) : devices.length === 0 ? (
          <p className="text-sm text-gray-500">
            No MIDI inputs detected. Connect a keyboard (or use the dev virtual keyboard below).
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {devices.map((d) => (
              <li
                key={d.id}
                className={`flex items-center gap-2 text-sm ${
                  activeDevice?.id === d.id ? 'text-emerald-300' : 'text-gray-300'
                }`}
              >
                <span
                  className={`h-2 w-2 rounded-full ${
                    activeDevice?.id === d.id ? 'bg-emerald-400' : 'bg-gray-600'
                  }`}
                />
                <span className="font-medium">{d.name}</span>
                <span className="text-gray-500">· {d.manufacturer}</span>
                {activeDevice?.id === d.id && (
                  <span className="ml-1 text-xs text-emerald-500/80">(listening)</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Log */}
      <section className="rounded-lg border border-gray-800 bg-gray-900/40 p-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-400">
            Note log
          </h2>
          <button
            onClick={clearLog}
            className="rounded bg-gray-800 px-2 py-0.5 text-xs text-gray-400 hover:bg-gray-700"
          >
            Clear
          </button>
        </div>
        {noteLog.length === 0 ? (
          <p className="text-sm text-gray-500">
            Waiting for notes… press a key and it should appear here instantly.
          </p>
        ) : (
          <div className="max-h-80 overflow-y-auto font-mono text-xs">
            <table className="w-full text-left">
              <thead className="sticky top-0 bg-gray-900/90 text-gray-500">
                <tr>
                  <th className="py-1 pr-3 font-normal">Time</th>
                  <th className="py-1 pr-3 font-normal">Event</th>
                  <th className="py-1 pr-3 font-normal">Note</th>
                  <th className="py-1 pr-3 font-normal">MIDI</th>
                  <th className="py-1 pr-3 font-normal">Vel</th>
                  <th className="py-1 pr-3 font-normal">Ch</th>
                  <th className="py-1 font-normal">Src</th>
                </tr>
              </thead>
              <tbody>
                {noteLog.map((e) => (
                  <tr key={e.id} className="border-t border-gray-800/60">
                    <td className="py-0.5 pr-3 text-gray-500">{fmtTime(e.timestamp)}</td>
                    <td
                      className={`py-0.5 pr-3 ${
                        e.kind === 'noteon' ? 'text-emerald-400' : 'text-gray-500'
                      }`}
                    >
                      {e.kind === 'noteon' ? 'ON' : 'off'}
                    </td>
                    <td className="py-0.5 pr-3 font-semibold text-gray-200">{e.noteName}</td>
                    <td className="py-0.5 pr-3 text-gray-400">{e.note}</td>
                    <td className="py-0.5 pr-3 text-gray-400">{e.velocity}</td>
                    <td className="py-0.5 pr-3 text-gray-400">{e.channel}</td>
                    <td className="py-0.5 text-gray-500">{e.source === 'virtual' ? 'virt' : 'hw'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
