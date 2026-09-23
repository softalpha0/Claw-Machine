/** Quiet original arcade music with short, restrained action cues. */
import { GameAmbience } from "./ambience.ts";

type Sound = "click" | "move" | "grip" | "win";
export type MovementPhase =
  | "aim"
  | "descend"
  | "lift"
  | "carry"
  | "park"
  | "whiff";
type MovementProfile = { level: number; rate: number; duration: number };
const MOVEMENT: Record<MovementPhase, MovementProfile> = {
  aim: { level: 0.25, rate: 0.97, duration: 0.72 },
  descend: { level: 0.19, rate: 0.88, duration: 0.76 },
  lift: { level: 0.25, rate: 0.94, duration: 0.76 },
  carry: { level: 0.22, rate: 1.02, duration: 0.9 },
  park: { level: 0.12, rate: 0.85, duration: 0.65 },
  whiff: { level: 0.15, rate: 0.89, duration: 0.68 },
};
type Voice = {
  source: AudioBufferSourceNode;
  gain: GainNode;
  stopping?: boolean;
};
const FILES: Record<Sound, string> = {
  click: "select-click.mp3",
  move: "move-soft-loop.wav",
  grip: "grip-close.wav",
  win: "small-win.wav",
};
const LEVELS: Record<Sound, number> = {
  click: 0.46,
  move: 1,
  grip: 0.44,
  win: 0.28,
};
const LENGTHS: Partial<Record<Sound, number>> = { click: 0.34, win: 1.32 };

class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private ambience: GameAmbience | null = null;
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
      this.ambience = new GameAmbience(this.ctx);
      this.ambience.setMuted(this.muted);
      this.ready = Promise.allSettled(
        (Object.keys(FILES) as Sound[]).map(async (key) => {
          const response = await fetch(
            new URL(
              `${import.meta.env.BASE_URL}audio/collector/${FILES[key]}`,
              document.baseURI,
            ),
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
    this.ambience?.unlock();
  }
  setMuted(muted: boolean): void {
    this.muted = muted;
    this.ambience?.setMuted(muted);
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
  private hold(param: AudioParam, now: number): void {
    if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(now);
    else {
      const value = param.value;
      param.cancelScheduledValues(now);
      param.setValueAtTime(value, now);
    }
  }
  private shapeMovement(
    voice: Voice,
    profile: MovementProfile,
    starting: boolean,
  ): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const gain = voice.gain.gain;
    const rate = voice.source.playbackRate;
    this.hold(gain, now);
    this.hold(rate, now);
    if (starting) {
      gain.setValueAtTime(0, now);
      rate.setValueAtTime(profile.rate * 0.88, now);
    }
    // Ease into speed, then soften as the carriage reaches the next stop.
    // Adjacent movement beats reshape this voice instead of replaying attack.
    gain.linearRampToValueAtTime(profile.level, now + 0.12);
    gain.setValueAtTime(profile.level, now + profile.duration * 0.65);
    gain.linearRampToValueAtTime(profile.level * 0.52, now + profile.duration);
    rate.linearRampToValueAtTime(profile.rate, now + 0.13);
    rate.setValueAtTime(profile.rate, now + profile.duration * 0.72);
    rate.linearRampToValueAtTime(profile.rate * 0.91, now + profile.duration);
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
    // Tame the small motor's high-frequency whine without muffling UI feedback.
    const filter = key === "move" || key === "grip"
      ? this.ctx.createBiquadFilter()
      : null;
    if (filter) {
      filter.type = "lowpass";
      filter.frequency.value = key === "move" ? 1800 : 2400;
      filter.Q.value = 0.5;
      source.connect(filter);
      filter.connect(gain);
    } else source.connect(gain);
    gain.connect(this.master);
    const now = this.ctx.currentTime,
      level = LEVELS[key] * scale;
    const duration = LENGTHS[key] ?? buffer.duration;
    gain.gain.setValueAtTime(loop ? 0 : level, now);
    if (loop) {
      source.loop = true;
      // PCM derivative has an 80 ms wrap crossfade baked into its whole loop.
      source.loopStart = 0;
      source.loopEnd = buffer.duration;
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
      filter?.disconnect();
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
  startMovement(phase: MovementPhase | number = "aim"): void {
    if (this.muted || document.hidden) return;
    const profile =
      typeof phase === "number"
        ? {
            ...MOVEMENT.aim,
            level: MOVEMENT.aim.level * Math.max(0, Math.min(phase, 1.5)),
          }
        : MOVEMENT[phase];
    if (this.movement && !this.movement.stopping) {
      this.shapeMovement(this.movement, profile, false);
      return;
    }
    this.unlock();
    // Only the most recent phase requested while assets load is allowed to start.
    const version = ++this.movementVersion;
    void Promise.all([this.ready, this.resumed]).then(() => {
      if (version !== this.movementVersion) return;
      this.movement = this.voice("move", 1, true);
      if (this.movement) this.shapeMovement(this.movement, profile, true);
    });
  }
  stopMovement(): void {
    this.movementVersion++;
    if (this.movement) {
      this.fadeStop(this.movement, 0.1);
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
    this.stopMovement();
    this.play("grip");
  }
  win(_multiplier: number): void {
    this.stopMovement();
    this.play("win");
  }
  jackpot(): void {
    this.stopMovement();
    this.play("win", 1.05);
  }
  gantry(): void {
    this.startMovement("aim");
  }
  descend(): void {
    this.startMovement("descend");
  }
  lift(): void {
    this.startMovement("lift");
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
