/**
 * All sound is synthesised with WebAudio — no audio files, so the bundle stays
 * tiny and the game loads instantly. Call sfx.unlock() from the first user
 * gesture (browsers block audio until then).
 *
 * Signal chain: every voice -> its own gain -> { master bus, reverb send }.
 * master bus -> compressor -> destination. reverb send -> convolver (a
 * synthesised short room IR) -> master bus. The convolver + compressor are
 * what keep layered synth tones from reading as bare oscillator beeps — a
 * cheap "produced in a room" quality instead of a dry test tone.
 */

type Ctx = AudioContext;

function makeImpulse(ac: Ctx, seconds: number, decay: number): AudioBuffer {
  const rate = ac.sampleRate;
  const len = Math.max(1, Math.floor(rate * seconds));
  const buf = ac.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
  }
  return buf;
}

class Sfx {
  private ac: Ctx | null = null;
  private master: GainNode | null = null;
  private reverbSend: GainNode | null = null;
  private ambienceOn = false;
  muted = false;

  unlock(): void {
    if (this.ac) {
      void this.ac.resume();
      return;
    }
    const AC: typeof AudioContext =
      (window.AudioContext ?? (window as any).webkitAudioContext) as typeof AudioContext;
    const ac = new AC();
    this.ac = ac;

    const compressor = ac.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 18;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.18;
    compressor.connect(ac.destination);

    const master = ac.createGain();
    master.gain.value = 0.9;
    master.connect(compressor);
    this.master = master;

    const convolver = ac.createConvolver();
    convolver.buffer = makeImpulse(ac, 1.1, 2.6);
    const reverbSend = ac.createGain();
    reverbSend.gain.value = 0.5;
    reverbSend.connect(convolver);
    convolver.connect(master);
    this.reverbSend = reverbSend;

    this.startAmbience();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.9;
  }

  private get t(): number {
    return this.ac ? this.ac.currentTime : 0;
  }

  /** Connects a voice's final node to the dry bus and, at `wet` amount, the reverb send. */
  private route(node: AudioNode, wet: number): void {
    if (!this.master || !this.reverbSend) return;
    node.connect(this.master);
    if (wet > 0) {
      const send = this.ac!.createGain();
      send.gain.value = wet;
      node.connect(send).connect(this.reverbSend);
    }
  }

  private tone(
    freq: number,
    dur: number,
    opts: {
      type?: OscillatorType;
      vol?: number;
      slideTo?: number;
      delay?: number;
      attack?: number;
      detune?: number; // a second, slightly-detuned voice layered under the first for thickness
      filterFreq?: number;
      filterSweepTo?: number;
      filterQ?: number;
      wet?: number;
      pan?: number; // -1..1, for ambience voices that should sit off-centre
    } = {},
  ): void {
    if (!this.ac || !this.master || this.muted) return;
    const {
      type = "square", vol = 0.25, slideTo, delay = 0, attack = 0.005,
      detune, filterFreq, filterSweepTo, filterQ = 1, wet = 0.12, pan,
    } = opts;
    const t0 = this.t + delay;
    const g = this.ac.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.001, vol), t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    let out: AudioNode = g;
    if (filterFreq != null) {
      const f = this.ac.createBiquadFilter();
      f.type = "lowpass";
      f.Q.value = filterQ;
      f.frequency.setValueAtTime(filterFreq, t0);
      f.frequency.exponentialRampToValueAtTime(Math.max(40, filterSweepTo ?? filterFreq), t0 + dur);
      g.connect(f);
      out = f;
    }
    if (pan != null) {
      const p = this.ac.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      out.connect(p);
      out = p;
    }
    this.route(out, wet);

    const mkOsc = (det: number) => {
      const osc = this.ac!.createOscillator();
      osc.type = type;
      osc.detune.value = det;
      osc.frequency.setValueAtTime(freq, t0);
      if (slideTo != null) osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t0 + dur);
      osc.connect(g);
      osc.start(t0);
      osc.stop(t0 + dur + 0.03);
    };
    mkOsc(0);
    if (detune) mkOsc(detune);
  }

  private noise(
    dur: number,
    opts: { vol?: number; hp?: number; lp?: number; delay?: number; wet?: number } = {},
  ): void {
    if (!this.ac || !this.master || this.muted) return;
    const { vol = 0.2, hp = 300, lp = 6000, delay = 0, wet = 0.15 } = opts;
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
    src.connect(hpf).connect(lpf).connect(g);
    this.route(g, wet);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  /** A short bright metallic ping — prongs touching metal, coin edges. */
  private metal(freq: number, dur: number, opts: { vol?: number; delay?: number } = {}): void {
    if (!this.ac || !this.master || this.muted) return;
    const { vol = 0.18, delay = 0 } = opts;
    const t0 = this.t + delay;
    const g = this.ac.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    this.route(g, 0.3);
    // two close, slightly inharmonic partials read as metal rather than a pure tone
    for (const mult of [1, 2.76]) {
      const osc = this.ac.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq * mult, t0);
      osc.frequency.exponentialRampToValueAtTime(freq * mult * 0.85, t0 + dur);
      osc.connect(g);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    }
  }

  /** A motor/servo whirr: filtered sawtooth with a light vibrato + grit noise bed. */
  private motor(freq: number, slideTo: number, dur: number, opts: { vol?: number; delay?: number } = {}): void {
    if (!this.ac || !this.master || this.muted) return;
    const { vol = 0.08, delay = 0 } = opts;
    const t0 = this.t + delay;
    const osc = this.ac.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(freq, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);

    const vibrato = this.ac.createOscillator();
    vibrato.frequency.value = 7;
    const vibGain = this.ac.createGain();
    vibGain.gain.value = 6;
    vibrato.connect(vibGain).connect(osc.frequency);
    vibrato.start(t0);
    vibrato.stop(t0 + dur + 0.03);

    const filt = this.ac.createBiquadFilter();
    filt.type = "lowpass";
    filt.Q.value = 3;
    filt.frequency.setValueAtTime(Math.max(freq, slideTo) * 3, t0);
    filt.frequency.exponentialRampToValueAtTime(Math.max(40, Math.min(freq, slideTo) * 2), t0 + dur);

    const g = this.ac.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(filt).connect(g);
    this.route(g, 0.1);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);

    this.noise(dur, { vol: vol * 0.35, hp: 600, lp: 3000, delay, wet: 0.05 });
  }

  /**
   * A continuous arcade-room bed — meant to feel like standing in a small
   * arcade, not a lone hum. Three layers:
   *   1. a low pad with a faster, two-LFO "breathing" filter sweep
   *   2. a quiet wide mid-register shimmer (two voices panned hard apart)
   *   3. frequent, varied, panned "other machines" chatter — plain blips,
   *      metallic coin-plinks, and the occasional tiny idle jingle
   */
  private startAmbience(): void {
    if (this.ambienceOn || !this.ac || !this.master) return;
    this.ambienceOn = true;
    const ac = this.ac;

    // 1. low pad
    const bed = ac.createGain();
    bed.gain.value = 0.032;
    const filt = ac.createBiquadFilter();
    filt.type = "lowpass";
    filt.frequency.value = 420;
    filt.Q.value = 0.8;
    filt.connect(bed);
    this.route(bed, 0.25);
    for (const [f, det] of [[55, 0], [55, 7]] as [number, number][]) {
      const osc = ac.createOscillator();
      osc.type = "sine";
      osc.frequency.value = f;
      osc.detune.value = det;
      osc.connect(filt);
      osc.start();
    }
    // two summed LFOs (not one) so the filter "breathes" rather than
    // metronomically ticks back and forth
    for (const [rate, depth] of [[0.11, 150], [0.29, 60]] as [number, number][]) {
      const lfo = ac.createOscillator();
      lfo.frequency.value = rate;
      const lfoGain = ac.createGain();
      lfoGain.gain.value = depth;
      lfo.connect(lfoGain).connect(filt.frequency);
      lfo.start();
    }

    // 2. wide mid shimmer — two voices panned hard apart, so the room has width
    for (const [f, pan] of [[221, -0.55], [219, 0.55]] as [number, number][]) {
      const osc = ac.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = f;
      const shimmerFilt = ac.createBiquadFilter();
      shimmerFilt.type = "bandpass";
      shimmerFilt.frequency.value = 700;
      shimmerFilt.Q.value = 0.6;
      const g = ac.createGain();
      g.gain.value = 0.014;
      const p = ac.createStereoPanner();
      p.pan.value = pan;
      osc.connect(shimmerFilt).connect(g).connect(p);
      this.route(p, 0.35);
      osc.start();
    }

    // 3. other machines — the arcade isn't silent between your own drops
    const scheduleChatter = () => {
      if (!this.ambienceOn) return;
      if (!this.muted) {
        const pan = Math.random() * 1.6 - 0.8;
        const roll = Math.random();
        if (roll < 0.15) {
          // a tiny 3-note idle jingle from a nearby machine
          const root = 440 + Math.random() * 300;
          [1, 1.26, 1.5].forEach((mult, i) =>
            this.tone(root * mult, 0.16, {
              type: "triangle", vol: 0.02, delay: i * 0.1, attack: 0.02, filterFreq: 2200, wet: 0.45, pan,
            }),
          );
        } else if (roll < 0.4) {
          this.metal(1200 + Math.random() * 900, 0.09, { vol: 0.028, delay: 0 });
        } else {
          const f = 450 + Math.random() * 1400;
          this.tone(f, 0.22, { type: "sine", vol: 0.024, attack: 0.04, filterFreq: 2600, wet: 0.4, pan });
        }
      }
      window.setTimeout(scheduleChatter, 1200 + Math.random() * 2200);
    };
    window.setTimeout(scheduleChatter, 1500);
  }

  click(): void {
    this.tone(520, 0.05, { type: "square", vol: 0.12, filterFreq: 3000 });
  }
  coin(): void {
    this.metal(1400, 0.08, { vol: 0.13 });
  }
  toggle(): void {
    this.tone(300, 0.06, { type: "triangle", vol: 0.14, slideTo: 460, filterFreq: 1800 });
  }

  gantry(): void {
    this.motor(140, 150, 0.5, { vol: 0.07 });
  }
  descend(): void {
    this.motor(420, 120, 0.55, { vol: 0.1 });
  }
  grab(): void {
    this.noise(0.1, { vol: 0.26, hp: 250, lp: 3200, wet: 0.15 });
    this.tone(95, 0.15, { type: "square", vol: 0.24, slideTo: 55, detune: 9, filterFreq: 900, filterSweepTo: 200 });
    this.metal(1900, 0.1, { vol: 0.1, delay: 0.01 });
  }
  lift(): void {
    this.motor(120, 300, 0.5, { vol: 0.06 });
  }
  tick(): void {
    this.tone(1200, 0.03, { type: "square", vol: 0.08 });
  }

  whiff(): void {
    this.tone(300, 0.26, { type: "triangle", vol: 0.16, slideTo: 85, filterFreq: 1200, filterSweepTo: 300 });
    this.noise(0.22, { vol: 0.09, hp: 200, lp: 1200, delay: 0.02 });
  }
  slip(): void {
    // "so close" — a descending wah with a metallic scrape underneath
    this.tone(440, 0.16, { type: "sawtooth", vol: 0.18, slideTo: 330, detune: 8, filterFreq: 2200, filterSweepTo: 700 });
    this.tone(330, 0.18, { type: "sawtooth", vol: 0.18, slideTo: 220, delay: 0.15, filterFreq: 1600, filterSweepTo: 500 });
    this.tone(220, 0.3, { type: "sawtooth", vol: 0.16, slideTo: 150, delay: 0.32, filterFreq: 1100, filterSweepTo: 300 });
    this.noise(0.35, { vol: 0.05, hp: 1500, lp: 5000, delay: 0.02, wet: 0.2 });
  }
  win(size: number): void {
    // coin cascade — count and brightness scale with payout size
    const n = Math.min(26, 6 + Math.floor(size * 3));
    for (let i = 0; i < n; i++) {
      const f = 900 + Math.random() * 1100 + i * 10;
      this.metal(f, 0.11, { vol: 0.1, delay: i * 0.032 });
    }
    this.tone(523, 0.2, { type: "triangle", vol: 0.2, delay: 0.02, detune: 5, filterFreq: 2400, wet: 0.25 });
    this.tone(784, 0.26, { type: "triangle", vol: 0.2, delay: 0.1, detune: 5, filterFreq: 2800, wet: 0.25 });
  }
  jackpot(): void {
    const notes = [523, 659, 784, 1047, 1319];
    notes.forEach((f, i) =>
      this.tone(f, 0.5, { type: "square", vol: 0.2, delay: i * 0.09, detune: 6, filterFreq: 2600, wet: 0.3 }),
    );
    notes.forEach((f, i) =>
      this.tone(f * 1.5, 0.6, { type: "triangle", vol: 0.13, delay: 0.5 + i * 0.09, detune: 5, wet: 0.35 }),
    );
    this.noise(0.5, { vol: 0.1, hp: 4000, lp: 12000, delay: 0.1, wet: 0.25 });
  }
  newPrize(): void {
    this.tone(880, 0.1, { type: "triangle", vol: 0.2, filterFreq: 3200 });
    this.tone(1175, 0.14, { type: "triangle", vol: 0.2, delay: 0.09, filterFreq: 3600 });
    this.tone(1568, 0.2, { type: "triangle", vol: 0.18, delay: 0.19, filterFreq: 4200, wet: 0.3 });
  }
}

export const sfx = new Sfx();
