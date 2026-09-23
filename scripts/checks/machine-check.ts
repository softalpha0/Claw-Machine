/** Headless regression checks for the cosmetic reveal; no wagers or SDK calls. */
import assert from "node:assert/strict";
import { ClawMachine } from "../../src/game/machine.ts";
import { getWonPrizes, type Outcome, type ResultKind } from "../../src/game/outcome.ts";

let frame: FrameRequestCallback | null = null;
let clock = 0;
let hidden = false;
const listeners = new Map<string, () => void>();
const gradient = { addColorStop() {} };
const context = new Proxy({
  createLinearGradient: () => gradient,
  createRadialGradient: () => gradient,
}, { get(target, key) { return Reflect.get(target, key) ?? (() => {}); } });
const canvas = {
  width: 800, height: 500,
  getContext: () => context,
  getBoundingClientRect: () => ({ width: 800, height: 500 }),
} as unknown as HTMLCanvasElement;

Object.assign(globalThis, {
  window: { devicePixelRatio: 1, matchMedia: () => ({ matches: false }), setTimeout },
  document: {
    baseURI: "http://localhost/",
    createElement: () => ({ width: 256, height: 256, getContext: () => context }),
    get hidden() { return hidden; },
    addEventListener: (name: string, fn: () => void) => listeners.set(name, fn),
    removeEventListener: (name: string) => listeners.delete(name),
  },
  Image: class { onload = null; src = ""; naturalWidth = 0; naturalHeight = 0; },
  ResizeObserver: class { observe() {} disconnect() {} },
  Path2D: class { moveTo() {} bezierCurveTo() {} },
  requestAnimationFrame: (fn: FrameRequestCallback) => { frame = fn; return 1; },
  cancelAnimationFrame: () => { frame = null; },
});

const outcome = (kind: ResultKind): Outcome => ({
  mode: "plush", bet: 5, kind,
  payoutX: kind === "bonus" ? 2.82 : kind === "grab" ? 1.41 : kind === "slip" ? 0.2 : 0,
  payout: kind === "bonus" ? 14.1 : kind === "grab" ? 7.05 : kind === "slip" ? 1 : 0,
  prizeKey: kind === "grab" || kind === "bonus" ? "plush-bandit-bear" : null,
  seedHex: "0x" + "11".repeat(32), rolls: { held: 0.1, slip: 0.3, bonus: 0.01 },
});

async function tick() {
  clock += 40;
  frame?.(clock);
  await Promise.resolve();
}
async function until(machine: ClawMachine, phase: string) {
  for (let i = 0; i < 300 && machine.phase !== phase; i++) await tick();
  assert.equal(machine.phase, phase, `must reach ${phase}`);
}

for (const kind of ["whiff", "slip", "grab", "bonus"] as const) {
  const machine = new ClawMachine(canvas);
  const beats: string[] = [];
  machine.onBeat = beat => beats.push(beat);
  const result = outcome(kind);
  const play = machine.play(result);
  if (kind === "grab" || kind === "bonus") {
    await until(machine, "lift");
    assert.equal(machine.heldCount, kind === "bonus" ? 2 : 1);
    const state = machine as unknown as { held: { prize: { key: string } }[]; falling: { y: number; scale: number }[] };
    assert.deepEqual(state.held.map(item => item.prize.key), getWonPrizes(result).map(prize => prize.key));
    await until(machine, "drop");
    assert.equal(machine.heldCount, 0, "released prizes must stop following the claw immediately");
    assert.equal(state.falling.length, kind === "bonus" ? 2 : 1);
    const before = { ...state.falling[0]! };
    for (let i = 0; i < 7; i++) await tick();
    assert.ok(state.falling[0]!.y > before.y, "released prize must fall towards the chute");
    assert.ok(state.falling[0]!.scale < before.scale, "released prize must shrink into the chute");
    await until(machine, kind === "bonus" ? "bonus" : "win");
    assert.equal(machine.heldCount, 0);
    assert.equal(state.falling.length, 0);
  } else if (kind === "slip") {
    await until(machine, "lift");
    assert.equal(machine.heldCount, 1);
  }
  for (let i = 0; i < 300 && machine.isBusy; i++) await tick();
  await play;
  assert.equal(machine.isBusy, false);
  assert.equal(machine.phase, "idle");
  assert.equal(machine.heldCount, 0, `${kind} must finish with an empty claw`);
  assert.equal(beats.at(-1), "settle");
  machine.setMode("gadget");
  assert.equal(machine.heldCount, 0, "mode changes must not carry prizes between machines");
  machine.destroy();
  assert.equal(listeners.has("visibilitychange"), false);
}

const interrupted = new ClawMachine(canvas);
const emitted: string[] = [];
interrupted.onBeat = beat => emitted.push(beat);
const pending = interrupted.play(outcome("bonus"));
await until(interrupted, "lift");
assert.equal(interrupted.heldCount, 2);
const beforeHide = emitted.length;
hidden = true;
listeners.get("visibilitychange")?.();
await pending;
assert.equal(interrupted.heldCount, 0);
assert.equal(interrupted.isBusy, false);
assert.deepEqual(emitted.slice(beforeHide), ["settle"], "hidden tabs must not burst queued sound beats");
interrupted.destroy();
console.log("Machine checks passed: whiff, slip, win, double grab, chute drop, mode reset, hidden-tab completion.");
