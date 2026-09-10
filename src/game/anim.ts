/** Minimal tween helpers for the reveal timeline. */

export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
export const easeOut = (t: number) => 1 - (1 - t) ** 3;
export const easeIn = (t: number) => t * t * t;
export const bounceOut = (t: number) => {
  const n = 7.5625, d = 2.75;
  if (t < 1 / d) return n * t * t;
  if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
  if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
  return n * (t -= 2.625 / d) * t + 0.984375;
};

export interface Phase {
  name: string;
  dur: number;
  onEnter?: () => void;
  update: (t: number) => void; // t is 0..1 progress within the phase
  onExit?: () => void;
}

/** Runs a list of phases back-to-back, returns a Promise that resolves at the end. */
export class Timeline {
  private phases: Phase[] = [];
  private idx = -1;
  private elapsed = 0;
  private resolveFn: (() => void) | null = null;
  running = false;

  add(p: Phase): this {
    this.phases.push(p);
    return this;
  }

  start(): Promise<void> {
    this.running = true;
    this.idx = 0;
    this.elapsed = 0;
    this.phases[0]?.onEnter?.();
    return new Promise((res) => (this.resolveFn = res));
  }

  tick(dt: number): void {
    if (!this.running) return;
    const phase = this.phases[this.idx];
    if (!phase) return this.finish();
    this.elapsed += dt;
    const t = phase.dur <= 0 ? 1 : clamp01(this.elapsed / phase.dur);
    phase.update(t);
    if (this.elapsed >= phase.dur) {
      phase.onExit?.();
      this.idx += 1;
      this.elapsed = 0;
      const next = this.phases[this.idx];
      if (next) next.onEnter?.();
      else this.finish();
    }
  }

  /**
   * Snap through every remaining phase synchronously and resolve. Used when the
   * rAF clock stalls (tab hidden) so the game never soft-locks mid-drop — the
   * payout is already decided, the reveal is only cosmetic.
   */
  forceFinish(): void {
    if (!this.running) return;
    for (let i = Math.max(0, this.idx); i < this.phases.length; i++) {
      const p = this.phases[i]!;
      if (i !== this.idx || this.elapsed === 0) p.onEnter?.();
      try {
        p.update(1);
      } catch {
        /* ignore render math on a 0-size / detached canvas */
      }
      p.onExit?.();
    }
    this.idx = this.phases.length;
    this.finish();
  }

  private finish(): void {
    this.running = false;
    this.resolveFn?.();
    this.resolveFn = null;
  }
}
