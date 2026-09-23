/** Ambience playback races under controlled browser activation and fade timers. */
import assert from "node:assert/strict";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

let clock = 0;
let hidden = false;
let listeners: (() => void)[] = [];
let mediaElements: FakeAudio[] = [];
let resumeGate: ReturnType<typeof deferred<void>> | null = null;
let playGate: ReturnType<typeof deferred<void>> | null = null;
let playThrows = false;
let timerId = 0;
let timers = new Map<number, { at: number; callback: () => void }>();

class FakeParam {
  value = 1;
  target = 1;
  ramps: { value: number; time: number }[] = [];
  cancelAndHoldAtTime() {}
  cancelScheduledValues() {}
  setValueAtTime(value: number) { this.value = value; }
  linearRampToValueAtTime(value: number, time: number) {
    this.target = value;
    this.ramps.push({ value, time });
  }
}
class FakeGain {
  gain = new FakeParam();
  connectedTo: unknown = null;
  connect(target: unknown) { this.connectedTo = target; }
}
class FakeAudio {
  paused = true;
  loop = false;
  preload = "auto";
  currentTime = 0;
  plays = 0;
  pauses = 0;
  constructor(readonly src: string) { mediaElements.push(this); }
  play() {
    this.plays++;
    if (playThrows) throw new Error("Media unavailable");
    this.paused = false;
    // Deliberately simulate a late start even if pause was already requested.
    return (playGate?.promise ?? Promise.resolve()).then(() => {
      this.paused = false;
    });
  }
  pause() { this.paused = true; this.pauses++; }
}
class FakeContext {
  state = "suspended";
  destination = {};
  gains: FakeGain[] = [];
  sources: { media: FakeAudio; target: unknown }[] = [];
  resumes = 0;
  get currentTime() { return clock / 1000; }
  createGain() {
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain;
  }
  createMediaElementSource(media: FakeAudio) {
    const source = { media, target: null as unknown };
    this.sources.push(source);
    return { connect: (target: unknown) => { source.target = target; } };
  }
  resume() {
    this.resumes++;
    return (resumeGate?.promise ?? Promise.resolve()).then(() => {
      this.state = "running";
    });
  }
}

const original = new Map(
  ["Audio", "document", "setTimeout", "clearTimeout"].map((key) =>
    [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  ),
);
Object.assign(globalThis, {
  Audio: FakeAudio,
  document: {
    baseURI: "http://localhost/qa/reveal.html",
    get hidden() { return hidden; },
    addEventListener: (_type: string, listener: () => void) => listeners.push(listener),
  },
  setTimeout: (callback: () => void, delay: number) => {
    const id = ++timerId;
    timers.set(id, { at: clock + delay, callback });
    return id;
  },
  clearTimeout: (id: number) => timers.delete(id),
});
const { GameAmbience } = await import("../../src/game/ambience.ts");

function fresh() {
  clock = 0;
  hidden = false;
  listeners = [];
  mediaElements = [];
  resumeGate = null;
  playGate = null;
  playThrows = false;
  timers = new Map();
  const context = new FakeContext();
  return {
    context,
    ambience: new GameAmbience(context as unknown as AudioContext),
  };
}
async function drain() {
  for (let index = 0; index < 15; index++) await Promise.resolve();
}
function visibility(value: boolean) {
  hidden = value;
  for (const listener of listeners) listener();
}
function advance(milliseconds: number) {
  clock += milliseconds;
  for (const [id, timer] of [...timers]) {
    if (timer.at <= clock) {
      timers.delete(id);
      timer.callback();
    }
  }
}

try {
  let { ambience, context } = fresh();
  visibility(true);
  visibility(false);
  assert.equal(mediaElements.length, 0, "page visibility must not count as first interaction");
  ambience.unlock();
  const first = mediaElements[0]!;
  assert.equal(first.plays, 1, "HTML play must be called synchronously inside the first gesture");
  assert.equal(context.resumes, 1);
  assert.equal(first.src, "http://localhost/audio/arcade-loop.mp3");
  assert.equal(first.loop, true);
  assert.equal(first.preload, "none", "stream the original bed instead of decoding the entire song");
  assert.equal(context.gains[0]!.gain.value, 0, "stream must begin at zero Web Audio gain");
  assert.equal(context.sources[0]!.target, context.gains[0]);
  assert.equal(context.gains[0]!.connectedTo, context.destination, "iPhone volume must use the shared context gain");
  await drain();
  assert.equal(context.gains[0]!.gain.target, 0.035);
  assert.equal(context.gains[0]!.gain.ramps.at(-1)!.time, 2, "entrance must fade over two seconds");
  first.currentTime = 42;
  const rampCount = context.gains[0]!.gain.ramps.length;
  ambience.unlock();
  ambience.unlock();
  await drain();
  assert.equal(first.plays, 1, "repeated game interactions must not restart the bed");
  assert.equal(first.currentTime, 42);
  assert.equal(context.sources.length, 1);
  assert.equal(context.gains[0]!.gain.ramps.length, rampCount, "repeated interactions must not keep resetting the entrance fade");

  ambience.setMuted(true);
  assert.equal(first.paused, false, "mute must fade rather than abruptly pause audible music");
  assert.equal(context.gains[0]!.gain.target, 0);
  advance(1500);
  ambience.setMuted(false);
  await drain();
  advance(1000);
  assert.equal(first.paused, false, "an old mute timer must not pause the new fade-in");
  assert.equal(first.plays, 1);
  ambience.setMuted(true);
  advance(2100);
  assert.equal(first.paused, true, "completed fade must stop the media stream");
  ambience.setMuted(false);
  await drain();
  assert.equal(first.plays, 2);
  assert.equal(first.currentTime, 42, "resume must preserve track position");

  visibility(true);
  assert.equal(context.gains[0]!.gain.target, 0);
  advance(500);
  visibility(false);
  await drain();
  advance(2000);
  assert.equal(first.paused, false, "quick tab return must cancel the stale background pause");
  visibility(true);
  advance(2100);
  assert.equal(first.paused, true);
  visibility(false);
  await drain();
  assert.equal(first.paused, false, "a previously active bed resumes after returning");
  ambience.setMuted(true);
  visibility(true);
  advance(2100);
  const beforeReturn = first.plays;
  visibility(false);
  await drain();
  assert.equal(first.plays, beforeReturn, "returning to a muted tab must stay silent");

  ({ ambience, context } = fresh());
  ambience.setMuted(true);
  ambience.unlock();
  assert.equal(mediaElements.length, 0, "stored mute prevents both stream loading and playback");
  ambience.setMuted(false);
  await drain();
  assert.equal(mediaElements[0]!.plays, 1);

  ({ ambience, context } = fresh());
  playGate = deferred<void>();
  resumeGate = deferred<void>();
  ambience.unlock();
  ambience.unlock();
  ambience.unlock();
  assert.equal(mediaElements[0]!.plays, 1, "pending media activation must be coalesced");
  assert.equal(context.resumes, 1);
  ambience.setMuted(true);
  advance(3000);
  playGate.resolve();
  resumeGate.resolve();
  await drain();
  assert.equal(mediaElements[0]!.paused, true, "late play/resume must not resurrect muted ambience");
  assert.equal(context.gains[0]!.gain.value, 0);
  assert.equal(context.gains[0]!.gain.ramps.length, 0, "a pending initial start must never schedule an audible gain");

  ({ ambience, context } = fresh());
  playGate = deferred<void>();
  ambience.unlock();
  await drain();
  visibility(true);
  advance(3000);
  visibility(false);
  playGate.resolve();
  await drain();
  assert.equal(mediaElements[0]!.paused, false, "latest visible state wins while the initial play is still pending");
  assert.equal(context.gains[0]!.gain.target, 0.035);
  assert.equal(mediaElements[0]!.plays, 1);

  ({ ambience, context } = fresh());
  playGate = deferred<void>();
  ambience.unlock();
  await drain();
  visibility(true);
  playGate.resolve();
  await drain();
  advance(2100);
  assert.equal(mediaElements[0]!.paused, true, "a hidden pending start remains stopped");

  ({ ambience, context } = fresh());
  playGate = deferred<void>();
  ambience.unlock();
  playGate.reject(new Error("Autoplay blocked"));
  await drain();
  assert.equal(mediaElements[0]!.paused, true);
  playGate = null;
  ambience.unlock();
  await drain();
  assert.equal(mediaElements[0]!.paused, false, "a fresh gesture may retry a rejected first play");
  assert.equal(context.sources.length, 1, "retry must reuse the same media source");

  ({ ambience, context } = fresh());
  playThrows = true;
  resumeGate = deferred<void>();
  ambience.unlock();
  resumeGate.reject(new Error("Context unavailable"));
  await drain();
  assert.equal(mediaElements[0]!.paused, true, "synchronous play and async resume failures are both contained");

  console.log("Ambience checks passed: first gesture, stream gain, continuous playback, smooth fades, mute and visibility races, late starts and rejected activation.");
} finally {
  for (const [key, descriptor] of original) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
}
