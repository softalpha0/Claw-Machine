/**
 * All sound is synthesised with WebAudio — no audio files, so the bundle stays
 * tiny and the game loads instantly. Call sfx.unlock() from the first user
 * gesture (browsers block audio until then).
 */

type Ctx = AudioContext;

class Sfx {
  private ac: Ctx | null = null;
  private master: GainNode | null = null;
  muted = false;

  unlock(): void {
    if (this.ac) {
      void this.ac.resume();
      return;
    }
    const AC: typeof AudioContext =
      (window.AudioContext ?? (window as any).webkitAudioContext) as typeof AudioContext;
    this.ac = new AC();
    this.master = this.ac.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(this.ac.destination);
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.9;
  }

  private get t(): number {
    return this.ac ? this.ac.currentTime : 0;
  }

  private tone(
    freq: number,
    dur: number,
    opts: { type?: OscillatorType; vol?: number; slideTo?: number; delay?: number; attack?: number } = {},
  ): void {
    if (!this.ac || !this.master || this.muted) return;
    const { type = "square", vol = 0.25, slideTo, delay = 0, attack = 0.005 } = opts;
    const t0 = this.t + delay;
    const osc = this.ac.createOscillator();
    const g = this.ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo != null) osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  private noise(dur: number, opts: { vol?: number; hp?: number; lp?: number; delay?: number } = {}): void {
    if (!this.ac || !this.master || this.muted) return;
    const { vol = 0.2, hp = 300, lp = 6000, delay = 0 } = opts;
    const t0 = this.t + delay;
    const frames = Math.floor(this.ac.sampleRate * dur);
    const buf = this.ac.createBuffer(1, frames, this.ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < frames; i++) d[i] = Math.random() * 2 - 1;
    const src = this.ac.createBufferSource();
    src.buffer = buf;
    const hpf = this.ac.createBiquadFilter();
    hpf.type = "highpass";
    hpf.frequency.value = hp;
    const lpf = this.ac.createBiquadFilter();
    lpf.type = "lowpass";
    lpf.frequency.value = lp;
    const g = this.ac.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(hpf).connect(lpf).connect(g).connect(this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  click(): void {
    this.tone(520, 0.05, { type: "square", vol: 0.12 });
  }
  coin(): void {
    this.tone(880, 0.06, { type: "square", vol: 0.14 });
  }
  toggle(): void {
    this.tone(300, 0.05, { type: "triangle", vol: 0.14, slideTo: 460 });
  }

  gantry(): void {
    // sliding motor whirr
    this.noise(0.5, { vol: 0.06, hp: 800, lp: 2200 });
    this.tone(140, 0.5, { type: "sawtooth", vol: 0.05, slideTo: 150 });
  }
  descend(): void {
    this.tone(420, 0.55, { type: "sawtooth", vol: 0.09, slideTo: 120 });
  }
  grab(): void {
    this.noise(0.12, { vol: 0.3, hp: 200, lp: 3500 });
    this.tone(90, 0.14, { type: "square", vol: 0.28, slideTo: 60 });
  }
  lift(): void {
    this.tone(120, 0.5, { type: "sawtooth", vol: 0.07, slideTo: 300 });
  }
  tick(): void {
    this.tone(1200, 0.03, { type: "square", vol: 0.08 });
  }

  whiff(): void {
    this.tone(300, 0.25, { type: "triangle", vol: 0.18, slideTo: 90 });
    this.noise(0.2, { vol: 0.08, hp: 200, lp: 1200, delay: 0.02 });
  }
  slip(): void {
    // "so close" descending wah
    this.tone(440, 0.16, { type: "sawtooth", vol: 0.2, slideTo: 330 });
    this.tone(330, 0.18, { type: "sawtooth", vol: 0.2, slideTo: 220, delay: 0.15 });
    this.tone(220, 0.28, { type: "sawtooth", vol: 0.18, slideTo: 150, delay: 0.32 });
  }
  win(size: number): void {
    // coin cascade — count scales with payout size
    const n = Math.min(26, 6 + Math.floor(size * 3));
    for (let i = 0; i < n; i++) {
      const f = 660 + Math.random() * 900 + i * 12;
      this.tone(f, 0.09, { type: "square", vol: 0.12, delay: i * 0.035 });
    }
    this.tone(523, 0.18, { type: "triangle", vol: 0.2, delay: 0.02 });
    this.tone(784, 0.22, { type: "triangle", vol: 0.2, delay: 0.1 });
  }
  jackpot(): void {
    const notes = [523, 659, 784, 1047, 1319];
    notes.forEach((f, i) => this.tone(f, 0.5, { type: "square", vol: 0.22, delay: i * 0.09 }));
    notes.forEach((f, i) => this.tone(f * 1.5, 0.6, { type: "triangle", vol: 0.14, delay: 0.5 + i * 0.09 }));
    this.noise(0.5, { vol: 0.1, hp: 4000, lp: 12000, delay: 0.1 });
  }
  newPrize(): void {
    this.tone(880, 0.1, { type: "triangle", vol: 0.2 });
    this.tone(1175, 0.14, { type: "triangle", vol: 0.2, delay: 0.09 });
    this.tone(1568, 0.2, { type: "triangle", vol: 0.18, delay: 0.19 });
  }
}

export const sfx = new Sfx();
