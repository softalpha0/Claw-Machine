/** The original arcade bed, streamed quietly through the shared audio context. */
const AMBIENCE_LEVEL = 0.035;
const FADE_SECONDS = 2;

export class GameAmbience {
  private readonly context: AudioContext;
  private media: HTMLAudioElement | null = null;
  private gain: GainNode | null = null;
  private unlocked = false;
  private muted = false;
  private starting: Promise<void> | null = null;
  private pauseTimer: ReturnType<typeof setTimeout> | null = null;
  private fadeVersion = 0;
  private target = 0;

  constructor(context: AudioContext) {
    this.context = context;
    document.addEventListener("visibilitychange", () => this.reconcile());
  }

  /** Called by the existing first-interaction sound unlock. */
  unlock(): void {
    this.unlocked = true;
    this.reconcile();
  }

  setMuted(muted: boolean): void {
    if (this.muted === muted) return;
    this.muted = muted;
    this.reconcile();
  }

  private get wanted(): boolean {
    return this.unlocked && !this.muted && !document.hidden;
  }

  private createMedia(): void {
    if (this.media) return;
    const media = new Audio(
      new URL(
        `${import.meta.env.BASE_URL}audio/arcade-loop.mp3`,
        document.baseURI,
      ).href,
    );
    media.loop = true;
    media.preload = "none";
    const gain = this.context.createGain();
    gain.gain.value = 0;
    // HTML media volume is ignored on some iPhones. The Web Audio gain is the
    // authoritative level, with one media source for this element's lifetime.
    this.context.createMediaElementSource(media).connect(gain);
    gain.connect(this.context.destination);
    this.media = media;
    this.gain = gain;
  }

  private fadeTo(level: number): void {
    if (!this.gain || this.target === level) return;
    this.target = level;
    const param = this.gain.gain;
    const now = this.context.currentTime;
    if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(now);
    else {
      const value = param.value;
      param.cancelScheduledValues(now);
      param.setValueAtTime(value, now);
    }
    param.linearRampToValueAtTime(level, now + FADE_SECONDS);
  }

  private cancelPause(): void {
    this.fadeVersion++;
    if (this.pauseTimer !== null) clearTimeout(this.pauseTimer);
    this.pauseTimer = null;
  }

  private quiet(): void {
    if (!this.media || !this.gain || this.pauseTimer !== null) return;
    this.fadeTo(0);
    if (this.media.paused || this.context.state !== "running") {
      this.media.pause();
      return;
    }
    const version = ++this.fadeVersion;
    this.pauseTimer = setTimeout(() => {
      if (version !== this.fadeVersion || this.wanted) return;
      this.pauseTimer = null;
      this.media?.pause();
    }, FADE_SECONDS * 1000 + 30);
  }

  private reconcile(): void {
    if (!this.wanted) {
      this.quiet();
      return;
    }
    this.cancelPause();
    if (this.starting) return;
    try {
      this.createMedia();
      const media = this.media!;
      if (!media.paused && this.context.state === "running") {
        this.fadeTo(AMBIENCE_LEVEL);
        return;
      }
      // Invoke both while still in the user gesture. Waiting for resume before
      // play would lose HTML media's activation on Safari. Loading this track
      // is independent from decoding and playing the short game effects.
      const attempt = (action: () => Promise<void>): Promise<void> => {
        try {
          return action();
        } catch (error) {
          return Promise.reject(error);
        }
      };
      const resume = this.context.state === "running"
        ? Promise.resolve()
        : attempt(() => this.context.resume());
      const play = media.paused ? attempt(() => media.play()) : Promise.resolve();
      this.starting = Promise.allSettled([resume, play]).then((results) => {
        this.starting = null;
        if (!this.wanted) {
          // A pending play may resolve after its fade timer has already fired.
          if (this.pauseTimer === null) media.pause();
          return;
        }
        if (
          results.every((result) => result.status === "fulfilled") &&
          this.context.state === "running"
        ) {
          this.fadeTo(AMBIENCE_LEVEL);
        } else {
          // Autoplay or asset failure is harmless; a later gesture may retry.
          media.pause();
          this.fadeTo(0);
        }
      }).catch(() => {
        this.starting = null;
        media.pause();
      });
    } catch {
      this.media?.pause();
    }
  }
}
