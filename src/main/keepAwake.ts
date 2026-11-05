// #5522: keep the display awake while he plays. macOS idle sleep ignores MIDI, so after
// an hour of playing with no mouse or key press the screen went black (11/4). Each note
// holds a display-sleep blocker; 15 min after the last one it is let go, so his own
// sleep settings are back the moment he stops.
export interface Blocker {
  start(): number;
  stop(id: number): void;
}

export const KEEP_AWAKE_IDLE_MS = 15 * 60_000;

export class KeepAwake {
  private id: number | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private enabled: boolean;

  constructor(private readonly opts: {
    blocker: Blocker;
    idleMs?: number;
    enabled?: boolean;
  }) {
    this.enabled = opts.enabled ?? true;
  }

  noteOn(): void {
    if (!this.enabled) return;
    this.id ??= this.opts.blocker.start();
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = setTimeout(
      () => this.dispose(),
      this.opts.idleMs ?? KEEP_AWAKE_IDLE_MS,
    );
    this.timer.unref?.();
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) this.dispose();
  }

  get held(): boolean {
    return this.id !== undefined;
  }

  dispose(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.id !== undefined) this.opts.blocker.stop(this.id);
    this.id = undefined;
  }
}
