import { useEffect, useCallback } from 'react';
import { WebMidi, Input } from 'webmidi';
import { useMidiStore } from '../../store/useMidiStore';

export function useMidi() {
  const {
    setDevices,
    setActiveDevice,
    setLastNoteOn,
    setEnabled,
    setError,
    setConnected,
  } = useMidiStore();

  const enable = useCallback(async () => {
    try {
      await WebMidi.enable({ sysex: false });
      setEnabled(true);
      setError(null);

      const devices = WebMidi.inputs.map((input: Input) => ({
        id: input.id,
        name: input.name ?? 'Unknown Device',
        manufacturer: input.manufacturer ?? 'Unknown',
      }));
      setDevices(devices);

      // Auto-connect to first device
      if (WebMidi.inputs.length > 0) {
        const firstInput = WebMidi.inputs[0];
        setActiveDevice({
          id: firstInput.id,
          name: firstInput.name ?? 'Unknown Device',
          manufacturer: firstInput.manufacturer ?? 'Unknown',
        });

        firstInput.addListener('noteon', (e) => {
          setLastNoteOn({
            note: e.note.number,
            velocity: Math.round((e.note.attack ?? 0.5) * 127),
            timestamp: Date.now(),
          });
        });
      }

      // Listen for device changes
      WebMidi.addListener('connected', () => {
        const updatedDevices = WebMidi.inputs.map((input: Input) => ({
          id: input.id,
          name: input.name ?? 'Unknown Device',
          manufacturer: input.manufacturer ?? 'Unknown',
        }));
        setDevices(updatedDevices);

        if (updatedDevices.length > 0 && !useMidiStore.getState().activeDevice) {
          const firstInput = WebMidi.inputs[0];
          setActiveDevice({
            id: firstInput.id,
            name: firstInput.name ?? 'Unknown Device',
            manufacturer: firstInput.manufacturer ?? 'Unknown',
          });
          firstInput.addListener('noteon', (e) => {
            setLastNoteOn({
              note: e.note.number,
              velocity: Math.round((e.note.attack ?? 0.5) * 127),
              timestamp: Date.now(),
            });
          });
        }
      });

      WebMidi.addListener('disconnected', () => {
        const updatedDevices = WebMidi.inputs.map((input: Input) => ({
          id: input.id,
          name: input.name ?? 'Unknown Device',
          manufacturer: input.manufacturer ?? 'Unknown',
        }));
        setDevices(updatedDevices);

        if (updatedDevices.length === 0) {
          setActiveDevice(null);
          setConnected(false);
        }
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to enable MIDI');
      setEnabled(false);
    }
  }, [setDevices, setActiveDevice, setLastNoteOn, setEnabled, setError, setConnected]);

  useEffect(() => {
    enable();
    return () => {
      if (WebMidi.enabled) {
        WebMidi.disable();
      }
    };
  }, [enable]);
}
