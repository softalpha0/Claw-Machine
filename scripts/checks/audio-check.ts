/** Sample-playback lifecycle regressions with controlled loading and audio clocks. */
import assert from "node:assert/strict";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const names = [
  "select-click.mp3",
  "move-soft-loop.wav",
  "grip-close.wav",
  "small-win.wav",
];
const nativePerformance = Object.getOwnPropertyDescriptor(
  globalThis,
  "performance",
)!;
const nativeWarn = console.warn;
let clock = 0;
let hidden = false;
let listeners: (() => void)[] = [];
let requests = new Map<string, ReturnType<typeof deferred<Response>>>();
let resumeGate: ReturnType<typeof deferred<void>> | null = null;
let contexts: FakeContext[] = [];

class FakeParam {
  value = 1;
  target = 1;
  ramps: { value: number; time: number }[] = [];
  setValueAtTime(value: number) {
    this.value = value;
  }
  linearRampToValueAtTime(value: number, time: number) {
    this.target = value;
    this.ramps.push({ value, time });
  }
  setTargetAtTime(value: number) {
    this.target = value;
  }
  cancelAndHoldAtTime() {}
  cancelScheduledValues() {}
}
class FakeGain {
  gain = new FakeParam();
  connect() {}
  disconnect() {}
}
class FakeFilter {
  type = "lowpass";
  frequency = new FakeParam();
  Q = new FakeParam();
  connect() {}
  disconnect() {}
}
class FakeMedia {
  paused = true;
  loop = false;
  preload = "none";
  async play() { this.paused = false; }
  pause() { this.paused = true; }
}
class FakeSource {
  buffer: { duration: number; name: string } | null = null;
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  onended: (() => void) | null = null;
  started = false;
  stopped = false;
  playbackRate = new FakeParam();
  connect() {}
  disconnect() {}
  start() {
    this.started = true;
  }
  stop() {
    this.stopped = true;
  }
}
class FakeContext {
  state = "suspended";
  destination = {};
  sources: FakeSource[] = [];
  gains: FakeGain[] = [];
  filters: FakeFilter[] = [];
  constructor() {
    contexts.push(this);
  }
  get currentTime() {
    return clock / 1000;
  }
  createGain() {
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain;
  }
  createBufferSource() {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  }
  createMediaElementSource() { return { connect() {} }; }
  createBiquadFilter() {
    const filter = new FakeFilter();
    this.filters.push(filter);
    return filter;
  }
  resume() {
    return (resumeGate?.promise ?? Promise.resolve()).then(() => {
      this.state = "running";
    });
  }
  async decodeAudioData(bytes: ArrayBuffer) {
    const name = new TextDecoder().decode(bytes);
    return {
      name,
      duration:
        name === "move-soft-loop.wav"
          ? 0.76
          : name === "grip-close.wav"
            ? 0.238333
            : 1.6,
    };
  }
}
Object.defineProperty(globalThis, "performance", {
  configurable: true,
  value: { now: () => clock },
});
Object.assign(globalThis, {
  Audio: FakeMedia,
  window: { AudioContext: FakeContext },
  document: {
    baseURI: "http://localhost/",
    get hidden() {
      return hidden;
    },
    addEventListener: (_name: string, callback: () => void) =>
      listeners.push(callback),
  },
  fetch: (url: URL) => {
    const name = url.pathname.split("/").at(-1)!;
    const request = deferred<Response>();
    requests.set(name, request);
    return request.promise;
  },
});
console.warn = () => {};
const { sfx } = await import("../../src/game/audio.ts");
type AudioHarness = Pick<
  typeof sfx,
  "click" | "grab" | "win" | "startMovement" | "stopMovement" | "setMuted"
>;
const Audio = sfx.constructor as new () => AudioHarness;
function fresh(): AudioHarness {
  clock = 0;
  hidden = false;
  listeners = [];
  requests = new Map();
  resumeGate = null;
  contexts = [];
  return new Audio();
}
function respond(name: string, ok = true) {
  const bytes = new TextEncoder().encode(name).buffer;
  requests
    .get(name)!
    .resolve({ ok, arrayBuffer: async () => bytes } as Response);
}
function respondAll(failed?: string) {
  for (const name of names) respond(name, name !== failed);
}
async function drain() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}
const sourceCount = () => contexts[0]?.sources.length ?? 0;
function hide() {
  hidden = true;
  for (const listener of listeners) listener();
}

try {
  let audio = fresh();
  audio.startMovement();
  audio.stopMovement();
  respondAll();
  await drain();
  assert.equal(
    sourceCount(),
    0,
    "stopped movement must not start after asynchronous loading",
  );

  audio = fresh();
  audio.startMovement("aim");
  respondAll();
  await drain();
  const motor = contexts[0]!.sources[0]!;
  const motorGain = contexts[0]!.gains[2]!.gain;
  assert.equal(contexts[0]!.filters[0]!.frequency.value, 1800);
  assert.equal(motor.loopStart, 0);
  assert.equal(
    motor.loopEnd,
    motor.buffer!.duration,
    "use the complete crossfaded PCM loop",
  );
  assert.ok(motorGain.ramps[0]!.time > 0, "motor attack must be faded");
  clock = 720;
  audio.startMovement("descend");
  await drain();
  assert.equal(
    sourceCount(),
    1,
    "adjacent movement phases must share one source",
  );
  assert.equal(motor.stopped, false, "phase changes must not cut the motor");
  assert.ok(
    motor.playbackRate.ramps.some((ramp) => ramp.time > clock / 1000),
    "speed changes must ramp, not jump",
  );
  audio.startMovement("park");
  await drain();
  assert.equal(sourceCount(), 1);
  assert.ok(
    motorGain.target < 0.25,
    "return movement should settle at a low level",
  );
  audio.grab();
  await drain();
  assert.equal(motor.stopped, true, "claw closure must stop the travel motor");
  assert.equal(contexts[0]!.sources.at(-1)!.buffer!.name, "grip-close.wav");
  assert.equal(contexts[0]!.filters.at(-1)!.frequency.value, 2400);
  assert.equal(
    contexts[0]!.sources.at(-1)!.loop,
    false,
    "the short closure must never loop",
  );

  audio = fresh();
  audio.startMovement("aim");
  audio.startMovement("descend");
  audio.startMovement("park");
  respondAll();
  await drain();
  assert.equal(
    sourceCount(),
    1,
    "loading across several phases must not stack motor voices",
  );
  assert.ok(
    contexts[0]!.gains[2]!.gain.target < 0.25,
    "latest phase controls the deferred motor",
  );

  audio = fresh();
  audio.click();
  clock = 400;
  respondAll();
  await drain();
  assert.equal(sourceCount(), 0, "a late click must not replay out of context");
  audio.click();
  await drain();
  assert.equal(
    sourceCount(),
    1,
    "a fresh click should still work after loading",
  );

  audio = fresh();
  resumeGate = deferred<void>();
  audio.click();
  respondAll();
  await drain();
  assert.equal(sourceCount(), 0, "audio must wait for browser context resume");
  resumeGate.resolve();
  await drain();
  assert.equal(
    sourceCount(),
    1,
    "first interaction must play after resume completes",
  );

  audio = fresh();
  audio.click();
  respondAll("small-win.wav");
  await drain();
  assert.equal(
    sourceCount(),
    1,
    "a failed win asset must not disable a loaded click",
  );
  audio.startMovement();
  await drain();
  assert.equal(
    contexts[0]!.sources.at(-1)!.loop,
    true,
    "movement still works with a missing unrelated sample",
  );

  audio = fresh();
  audio.click();
  respondAll();
  await drain();
  audio.startMovement();
  audio.grab();
  await drain();
  hide();
  assert.ok(
    contexts[0]!.sources.every((source) => source.stopped),
    "hiding the tab must stop every active voice",
  );
  const beforeHidden = sourceCount();
  audio.click();
  audio.startMovement();
  await drain();
  assert.equal(
    sourceCount(),
    beforeHidden,
    "hidden tabs must never start new sounds",
  );

  audio = fresh();
  audio.click();
  audio.startMovement();
  hide();
  hidden = false;
  respondAll();
  await drain();
  assert.equal(
    sourceCount(),
    0,
    "queued sounds must not resume after a hide/show cycle",
  );

  audio = fresh();
  audio.click();
  respondAll();
  await drain();
  audio.startMovement();
  audio.grab();
  await drain();
  audio.setMuted(true);
  assert.equal(
    contexts[0]!.gains[0]!.gain.target,
    0,
    "mute must fade the master level to zero",
  );
  assert.ok(
    contexts[0]!.sources.every((source) => source.stopped),
    "mute must cancel one-shot tails as well as movement",
  );
  const beforeMuted = sourceCount();
  audio.click();
  await drain();
  assert.equal(
    sourceCount(),
    beforeMuted,
    "muted interaction must stay silent",
  );

  audio = fresh();
  audio.click();
  audio.setMuted(true);
  audio.setMuted(false);
  respondAll();
  await drain();
  assert.equal(sourceCount(), 0, "mute/unmute must discard queued old clicks");
  audio.click();
  await drain();
  assert.equal(sourceCount(), 1, "new sounds work immediately after unmuting");
  console.log(
    "Audio checks passed: continuous phase-shaped motor, closure stop, deferred phase coalescing, async cancellation, stale cues, resume, missing samples, hidden tabs and mute.",
  );
} finally {
  console.warn = nativeWarn;
  Object.defineProperty(globalThis, "performance", nativePerformance);
}
