import { useEffect, useCallback } from 'react';
import { WebMidi, Input, NoteMessageEvent } from 'webmidi';
import { useMidiStore } from '../../store/useMidiStore';
import { MidiDevice } from '../../types/midi';

function toDevice(input: Input): MidiDevice {
  return {
    id: input.id,
    name: input.name ?? 'Unknown Device',
    manufacturer: input.manufacturer ?? 'Unknown',
  };
}

export function useMidi() {
  const { setDevices, setActiveDevice, ingestNote, setEnabled, setError, setConnected } =
    useMidiStore();

  // Attach note-on / note-off listeners that funnel through the store's single
  // ingestion path — the same path the virtual dev keyboard uses.
  const attachListeners = useCallback(
    (input: Input) => {
      input.addListener('noteon', (e: NoteMessageEvent) => {
        ingestNote({
          kind: 'noteon',
          note: e.note.number,
          velocity: Math.round((e.note.attack ?? 0.5) * 127),
          channel: e.message?.channel ?? 0,
          source: 'hardware',
          timestamp: Date.now(),
        });
      });
      input.addListener('noteoff', (e: NoteMessageEvent) => {
        ingestNote({
          kind: 'noteoff',
          note: e.note.number,
          velocity: 0,
          channel: e.message?.channel ?? 0,
          source: 'hardware',
          timestamp: Date.now(),
        });
      });
    },
    [ingestNote],
  );

  const connectFirstInput = useCallback(() => {
    setDevices(WebMidi.inputs.map(toDevice));
    if (WebMidi.inputs.length > 0 && !useMidiStore.getState().activeDevice) {
      const firstInput = WebMidi.inputs[0];
      setActiveDevice(toDevice(firstInput));
      attachListeners(firstInput);
    }
  }, [setDevices, setActiveDevice, attachListeners]);

  const enable = useCallback(async () => {
    try {
      await WebMidi.enable({ sysex: false });
      setEnabled(true);
      setError(null);

      connectFirstInput();

      WebMidi.addListener('connected', connectFirstInput);
      WebMidi.addListener('disconnected', () => {
        setDevices(WebMidi.inputs.map(toDevice));
        if (WebMidi.inputs.length === 0) {
          setActiveDevice(null);
          setConnected(false);
        }
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to enable MIDI');
      setEnabled(false);
    }
  }, [connectFirstInput, setDevices, setActiveDevice, setEnabled, setError, setConnected]);

  useEffect(() => {
    enable();
    return () => {
      if (WebMidi.enabled) {
        WebMidi.disable();
      }
    };
  }, [enable]);
}
