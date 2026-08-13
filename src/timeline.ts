/**
 * Drives a "minutes since midnight" playhead for a single calendar day:
 * scrubbing, play/pause animation via requestAnimationFrame, and speed
 * control. Knows nothing about astronomy or the DOM beyond rAF, so the
 * polar plot and (later) horizon view can share one time source.
 */

export const MINUTES_PER_DAY = 24 * 60;

export interface DayTimelineOptions {
  initialMinutes?: number;
  speedMinutesPerSecond?: number;
  onTick: (minutesOfDay: number) => void;
  onPlayingChange?: (playing: boolean) => void;
}

export class DayTimeline {
  minutesOfDay: number;
  private speedMinutesPerSecond: number;
  private playing = false;
  private rafId: number | null = null;
  private lastTimestamp: number | null = null;
  private readonly onTick: (minutesOfDay: number) => void;
  private readonly onPlayingChange: (playing: boolean) => void;

  constructor(options: DayTimelineOptions) {
    this.minutesOfDay = options.initialMinutes ?? 0;
    this.speedMinutesPerSecond = options.speedMinutesPerSecond ?? 15;
    this.onTick = options.onTick;
    this.onPlayingChange = options.onPlayingChange ?? (() => {});
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  setMinutes(minutes: number): void {
    this.minutesOfDay = Math.min(Math.max(minutes, 0), MINUTES_PER_DAY);
    this.onTick(this.minutesOfDay);
  }

  setSpeed(minutesPerSecond: number): void {
    this.speedMinutesPerSecond = minutesPerSecond;
  }

  play(): void {
    if (this.playing) return;
    if (this.minutesOfDay >= MINUTES_PER_DAY) this.setMinutes(0);
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
      const next = this.minutesOfDay + dtSeconds * this.speedMinutesPerSecond;
      if (next >= MINUTES_PER_DAY) {
        this.setMinutes(MINUTES_PER_DAY);
        this.pause();
        return;
      }
      this.setMinutes(next);
    }
    this.lastTimestamp = timestamp;
    this.rafId = requestAnimationFrame(this.tick);
  };
}
