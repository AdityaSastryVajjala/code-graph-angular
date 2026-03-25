/**
 * RollingDebounce — accumulates ChangedFileSets and fires once the rolling window expires.
 *
 * Each call to `push()` resets the timer and merges the incoming files.
 * While the timer is pending, a countdown is written to stdout every second.
 * When the timer fires, `onFlush` is called with the full accumulated set.
 */

import { ChangedFile, ChangedFileSet, ChangeKind } from '../../core/types/graph-ir.js';

export class RollingDebounce {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private countdownInterval: ReturnType<typeof setInterval> | null = null;
  private accumulated = new Map<string, ChangeKind>();
  private timerStart = 0;

  constructor(
    private readonly windowMs: number = 30_000,
    private readonly onFlush: (set: ChangedFileSet) => void,
  ) {}

  push(set: ChangedFileSet): void {
    // Merge incoming files (later events win)
    for (const f of set.files) {
      this.accumulated.set(f.path, f.kind);
    }

    // Reset the rolling window
    this.clearTimer();
    this.timerStart = Date.now();

    this.timer = setTimeout(() => {
      this.clearCountdown();
      this.flush();
    }, this.windowMs);

    // Start per-second countdown
    this.startCountdown();
  }

  private flush(): void {
    if (this.accumulated.size === 0) return;
    const files: ChangedFile[] = Array.from(this.accumulated.entries()).map(([path, kind]) => ({
      path,
      kind,
    }));
    this.accumulated.clear();
    this.clearTimer();
    process.stdout.write('\r' + ' '.repeat(60) + '\r'); // clear countdown line
    this.onFlush({ files, detectedAt: new Date() });
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private clearCountdown(): void {
    if (this.countdownInterval !== null) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }
  }

  private startCountdown(): void {
    this.clearCountdown();
    this.countdownInterval = setInterval(() => {
      const elapsed = Date.now() - this.timerStart;
      const remaining = Math.max(0, Math.ceil((this.windowMs - elapsed) / 1000));
      const pending = this.accumulated.size;
      process.stdout.write(`\rIndexing in ${remaining}s... (${pending} files pending)   `);
      if (remaining === 0) this.clearCountdown();
    }, 1000);
  }

  /** Immediately flush without waiting for the window to expire. */
  forceFlush(): void {
    this.clearTimer();
    this.clearCountdown();
    this.flush();
  }

  /** Cancel any pending flush and discard accumulated state. */
  cancel(): void {
    this.clearTimer();
    this.clearCountdown();
    this.accumulated.clear();
  }
}
