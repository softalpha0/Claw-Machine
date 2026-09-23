/** Selected stock recordings, played once per physical action. No music bed. */
type Sound = "click" | "move" | "grip" | "win";
type Voice = {
  source: AudioBufferSourceNode;
  gain: GainNode;
  stopping?: boolean;
};
const FILES: Record<Sound, string> = {
  click: "select-click.mp3",
  move: "move-camera.mp3",
  grip: "grip-servo.mp3",
  win: "small-win.wav",
};
const LEVELS: Record<Sound, number> = {
  click: 0.642,
  move: 0.68,
  grip: 0.78,
  win: 0.365,
};
const LENGTHS: Partial<Record<Sound, number>> = { click: 0.34, win: 1.32 };

class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private muted = false;
  private ready: Promise<void> | null = null;
  private resumed: Promise<void> = Promise.resolve();
  private buffers = new Map<Sound, AudioBuffer>();
  private movement: Voice | null = null;
  private movementVersion = 0;
  private voices = new Set<Voice>();
  private visibilityVersion = 0;

  constructor() {
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) return;
      this.visibilityVersion++;
      this.stopMovement();
      for (const voice of this.voices) this.fadeStop(voice);
    });
  }
  unlock(): void {
    if (!this.ctx) {
      const Constructor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      if (!Constructor) return;
      this.ctx = new Constructor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.78;
      this.master.connect(this.ctx.destination);
      this.ready = Promise.allSettled(
        (Object.keys(FILES) as Sound[]).map(async (key) => {
          const response = await fetch(
            new URL(`audio/collector/${FILES[key]}`, document.baseURI),
          );
          if (!response.ok) throw new Error(`Audio unavailable: ${key}`);
          this.buffers.set(
            key,
            await this.ctx!.decodeAudioData(await response.arrayBuffer()),
          );
        }),
      ).then((results) => {
        if (results.some((result) => result.status === "rejected"))
          console.warn("[claw] Some sounds could not load");
      });
    }
    this.resumed = this.ctx.resume().catch(() => {});
  }
  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.ctx && this.master)
      this.master.gain.setTargetAtTime(
        muted ? 0 : 0.78,
        this.ctx.currentTime,
        0.025,
      );
    if (muted) {
      this.visibilityVersion++;
      this.stopMovement();
      for (const voice of this.voices) this.fadeStop(voice);
    }
  }
  private fadeStop(voice: Voice, seconds = 0.07): void {
    if (!this.ctx || voice.stopping) return;
    voice.stopping = true;
    const now = this.ctx.currentTime;
    if (voice.gain.gain.cancelAndHoldAtTime)
      voice.gain.gain.cancelAndHoldAtTime(now);
    else {
      const value = voice.gain.gain.value;
      voice.gain.gain.cancelScheduledValues(now);
      voice.gain.gain.setValueAtTime(value, now);
    }
    voice.gain.gain.linearRampToValueAtTime(0, now + seconds);
    voice.source.stop(now + seconds + 0.01);
  }
  private voice(key: Sound, scale = 1, loop = false): Voice | null {
    if (
      !this.ctx ||
      !this.master ||
      this.muted ||
      document.hidden ||
      this.ctx.state !== "running"
    )
      return null;
    const buffer = this.buffers.get(key);
    if (!buffer) return null;
    const source = this.ctx.createBufferSource(),
      gain = this.ctx.createGain();
    source.buffer = buffer;
    source.connect(gain);
    gain.connect(this.master);
    const now = this.ctx.currentTime,
      level = LEVELS[key] * scale;
    const duration = LENGTHS[key] ?? buffer.duration;
    gain.gain.setValueAtTime(loop ? 0 : level, now);
    if (loop) {
      source.loop = true;
      source.loopStart = 0.1;
      source.loopEnd = Math.min(buffer.duration - 0.14, 0.985);
      gain.gain.linearRampToValueAtTime(level, now + 0.06);
    } else if (key === "win" || key === "click") {
      const fade = key === "win" ? 0.19 : 0.05;
      gain.gain.setValueAtTime(level, now + duration - fade);
      gain.gain.linearRampToValueAtTime(0, now + duration);
    }
    const voice = { source, gain };
    this.voices.add(voice);
    source.onended = () => {
      this.voices.delete(voice);
      source.disconnect();
      gain.disconnect();
      if (this.movement === voice) this.movement = null;
    };
    if (loop) source.start();
    else source.start(0, 0, Math.min(duration, buffer.duration));
    return voice;
  }
  private play(key: Sound, scale = 1): void {
    if (this.muted || document.hidden) return;
    this.unlock();
    const version = this.visibilityVersion,
      requestedAt = performance.now();
    void Promise.all([this.ready, this.resumed]).then(() => {
      if (
        version === this.visibilityVersion &&
        performance.now() - requestedAt < 250
      )
        this.voice(key, scale);
    });
  }
  startMovement(scale = 1): void {
    this.stopMovement();
    if (this.muted || document.hidden) return;
    this.unlock();
    const version = this.movementVersion;
    void Promise.all([this.ready, this.resumed]).then(() => {
      if (version === this.movementVersion)
        this.movement = this.voice("move", scale, true);
    });
  }
  stopMovement(): void {
    this.movementVersion++;
    if (this.movement) {
      this.fadeStop(this.movement);
      this.movement = null;
    }
  }
  click(): void {
    this.play("click");
  }
  toggle(): void {
    this.click();
  }
  grab(): void {
    this.play("grip");
  }
  win(_multiplier: number): void {
    this.play("win");
  }
  jackpot(): void {
    this.play("win", 1.05);
  }
  gantry(): void {
    this.startMovement();
  }
  descend(): void {
    this.startMovement();
  }
  lift(): void {
    this.startMovement();
  }
  whiff(): void {
    this.stopMovement();
  }
  slip(): void {
    this.stopMovement();
  }
  newPrize(): void {
    /* The win cue already acknowledges the same reward. */
  }
}
export const sfx = new GameAudio();
