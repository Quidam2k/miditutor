import { useMidiStore } from '../../store/useMidiStore';

export function MidiStatus() {
  const { connected, activeDevice, devices, error } = useMidiStore();

  if (error) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-red-900/30 border border-red-800/50 text-red-300 text-sm">
        <div className="w-2 h-2 rounded-full bg-red-500" />
        <span>MIDI Error: {error}</span>
      </div>
    );
  }

  if (!connected) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-800/50 border border-gray-700/50 text-gray-400 text-sm">
        <div className="w-2 h-2 rounded-full bg-gray-500 animate-pulse" />
        <span>
          {devices.length === 0
            ? 'No MIDI device detected — connect a keyboard'
            : 'Connecting...'}
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-900/30 border border-emerald-800/50 text-emerald-300 text-sm">
      <div className="w-2 h-2 rounded-full bg-emerald-400" />
      <span>{activeDevice?.name ?? 'MIDI Connected'}</span>
    </div>
  );
}
