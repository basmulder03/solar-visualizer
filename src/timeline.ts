/**
 * Drives a bounded [0, max] playhead: scrubbing, play/pause animation via
 * requestAnimationFrame, and speed control. Knows nothing about astronomy or
 * the DOM beyond rAF, so it can back both the day slider (max = one day in
 * minutes) and the eclipse scrubber (max = 1000, an arbitrary 0-1 fraction
 * scale) with the same engine.
 */

export const MINUTES_PER_DAY = 24 * 60;

export interface RangePlayerOptions {
  max: number;
  initialValue?: number;
  speedPerSecond?: number;
  onTick: (value: number) => void;
  onPlayingChange?: (playing: boolean) => void;
  /**
   * If provided, called instead of pausing when playback would exceed `max`,
   * with the overflow amount past `max`. Playback continues from the
   * returned value (e.g. the day timeline uses this to roll into the next
   * calendar day and keep playing). Omit to just clamp-and-pause at `max`.
   */
  onOverflow?: (overflow: number) => number;
}

export class RangePlayer {
  value: number;
  private readonly max: number;
  private speedPerSecond: number;
  private playing = false;
  private rafId: number | null = null;
  private lastTimestamp: number | null = null;
  private readonly onTick: (value: number) => void;
  private readonly onPlayingChange: (playing: boolean) => void;
  private readonly onOverflow?: (overflow: number) => number;

  constructor(options: RangePlayerOptions) {
    this.max = options.max;
    this.value = options.initialValue ?? 0;
    this.speedPerSecond = options.speedPerSecond ?? 15;
    this.onTick = options.onTick;
    this.onPlayingChange = options.onPlayingChange ?? (() => {});
    this.onOverflow = options.onOverflow;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  setValue(value: number): void {
    this.value = Math.min(Math.max(value, 0), this.max);
    this.onTick(this.value);
  }

  setSpeed(perSecond: number): void {
    this.speedPerSecond = perSecond;
  }

  play(): void {
    if (this.playing) return;
    if (this.value >= this.max) this.setValue(0);
    this.playing = true;
    this.lastTimestamp = null;
    this.onPlayingChange(true);
    this.rafId = requestAnimationFrame(this.tick);
  }

  pause(): void {
    if (!this.playing) return;
    this.playing = false;
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.onPlayingChange(false);
  }

  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  private readonly tick = (timestamp: number): void => {
    if (!this.playing) return;
    if (this.lastTimestamp !== null) {
      const dtSeconds = (timestamp - this.lastTimestamp) / 1000;
      const next = this.value + dtSeconds * this.speedPerSecond;
      if (next >= this.max) {
        if (this.onOverflow) {
          this.setValue(this.onOverflow(next - this.max));
        } else {
          this.setValue(this.max);
          this.pause();
          return;
        }
      } else {
        this.setValue(next);
      }
    }
    this.lastTimestamp = timestamp;
    this.rafId = requestAnimationFrame(this.tick);
  };
}
