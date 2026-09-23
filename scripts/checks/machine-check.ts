/** Headless reveal/continuity checks; no wagers or SDK calls. */
import assert from "node:assert/strict";
import { ClawMachine } from "../../src/game/machine.ts";
import {
  getWonPrizes,
  type Outcome,
  type ResultKind,
} from "../../src/game/outcome.ts";
import { PRIZES, type Prize } from "../../src/game/prizes.ts";

let frame: FrameRequestCallback | null = null;
let clock = 0;
let hidden = false;
const listeners = new Map<string, () => void>();
const gradient = { addColorStop() {} };
const context = new Proxy(
  {
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
  },
  {
    get(target, key) {
      return Reflect.get(target, key) ?? (() => {});
    },
  },
);
const canvas = {
  width: 800,
  height: 500,
  getContext: () => context,
  getBoundingClientRect: () => ({ width: 800, height: 500 }),
} as unknown as HTMLCanvasElement;
Object.assign(globalThis, {
  window: {
    devicePixelRatio: 1,
    matchMedia: () => ({ matches: false }),
    setTimeout,
  },
  document: {
    baseURI: "http://localhost/",
    createElement: () => ({
      width: 256,
      height: 256,
      getContext: () => context,
    }),
    get hidden() {
      return hidden;
    },
    addEventListener: (name: string, fn: () => void) => listeners.set(name, fn),
    removeEventListener: (name: string) => listeners.delete(name),
  },
  Image: class {
    onload = null;
    src = "";
    naturalWidth = 0;
    naturalHeight = 0;
  },
  ResizeObserver: class {
    observe() {}
    disconnect() {}
  },
  Path2D: class {
    moveTo() {}
    bezierCurveTo() {}
  },
  requestAnimationFrame: (fn: FrameRequestCallback) => {
    frame = fn;
    return 1;
  },
  cancelAnimationFrame: () => {
    frame = null;
  },
});
interface Item {
  prize: Prize;
  x: number;
  y: number;
  homeX: number;
  homeY: number;
  rot: number;
  size: number;
  scale: number;
  grabbed: boolean;
}
type State = {
  held: Item[];
  falling: Item[];
  pile: Item[];
  carriageX: number;
  clawY: number;
  tl: { forceFinish(): void };
};
const state = (machine: ClawMachine) => machine as unknown as State;
const pose = (item: Item) => ({
  x: item.x,
  y: item.y,
  rot: item.rot,
  scale: item.scale,
  size: item.size,
});
const almost = (actual: number, expected: number, message: string) =>
  assert.ok(
    Math.abs(actual - expected) < 1e-8,
    `${message}: ${actual} vs ${expected}`,
  );
function samePose(
  actual: Item,
  expected: ReturnType<typeof pose>,
  message: string,
) {
  for (const property of ["x", "y", "rot", "scale", "size"] as const)
    almost(actual[property], expected[property], `${message}: ${property}`);
}
const outcome = (kind: ResultKind, prize = PRIZES[0]!): Outcome => ({
  mode: prize.mode,
  bet: 5,
  kind,
  payoutX:
    kind === "bonus"
      ? 2.82
      : kind === "grab"
        ? 1.41
        : kind === "slip"
          ? 0.2
          : 0,
  payout:
    kind === "bonus" ? 14.1 : kind === "grab" ? 7.05 : kind === "slip" ? 1 : 0,
  prizeKey: kind === "grab" || kind === "bonus" ? prize.key : null,
  seedHex: "0x" + "11".repeat(32),
  rolls: { held: 0.1, slip: 0.3, bonus: 0.01 },
});
async function tick() {
  clock += 20;
  frame?.(clock);
  await Promise.resolve();
}
async function until(machine: ClawMachine, phase: string) {
  for (let i = 0; i < 1000 && machine.phase !== phase; i++) await tick();
  assert.equal(machine.phase, phase, `must reach ${phase}`);
}

// Every identity, including edge/rare collectibles, is physically present and
// reachable before play. Pickup must retain the exact same object and pose.
for (const prize of PRIZES) {
  const machine = new ClawMachine(canvas);
  machine.setMode(prize.mode);
  const pile = state(machine).pile;
  const before = pile.map((item) => ({
    item,
    key: item.prize.key,
    pose: pose(item),
  }));
  const target = pile.find((item) => item.prize.key === prize.key)!;
  assert.ok(
    target &&
      target.scale > 0 &&
      target.x > 70 &&
      target.x < 635 &&
      target.y < 460,
  );
  const play = machine.play(outcome("grab", prize));
  for (const entry of before) {
    assert.equal(
      entry.item.prize.key,
      entry.key,
      "starting a round must not replace any prize identity",
    );
    samePose(
      entry.item,
      entry.pose,
      "starting a round must not move or resize any prize",
    );
  }
  await until(machine, "grab");
  const contact = pose(target);
  almost(
    state(machine).carriageX,
    target.x,
    "claw must reach this exact object's centre",
  );
  almost(
    target.y - state(machine).clawY,
    62,
    "prongs must surround the body at contact",
  );
  await until(machine, "lift");
  assert.equal(
    state(machine).held[0],
    target,
    "pickup must use the already-visible object",
  );
  samePose(
    target,
    contact,
    "attaching must not teleport, rotate or shrink the object",
  );
  await tick();
  assert.ok(
    target.y < contact.y,
    "the original item must then rise with the claw",
  );
  assert.equal(target.scale, contact.scale, "lift must preserve body size");
  state(machine).tl.forceFinish();
  await play;
  assert.equal(
    state(machine).pile,
    pile,
    "settling must preserve the pile, not replace it",
  );
  machine.destroy();
}

for (const kind of ["whiff", "slip", "grab", "bonus"] as const) {
  const machine = new ClawMachine(canvas);
  const beats: string[] = [];
  machine.onBeat = (beat) => beats.push(beat);
  const result = outcome(kind),
    expectedPrizes = getWonPrizes(result);
  const originalPile = state(machine).pile;
  const play = machine.play(result);
  if (kind === "grab" || kind === "bonus") {
    for (let pickup = 0; pickup < expectedPrizes.length; pickup++) {
      const original = originalPile.find(
        (item) => item.prize.key === expectedPrizes[pickup]!.key,
      )!;
      const beforeGrip = pose(original);
      await until(machine, "lift");
      assert.equal(machine.pickupIndex, pickup + 1);
      assert.equal(machine.pickupTotal, expectedPrizes.length);
      assert.equal(
        machine.heldCount,
        1,
        "Double Grab must physically retrieve one actual object at a time",
      );
      assert.equal(state(machine).held[0], original);
      samePose(original, beforeGrip, "each bonus pickup must stay continuous");
      await until(machine, "drop");
      assert.equal(
        machine.heldCount,
        0,
        "release must stop the prize following the claw immediately",
      );
      assert.equal(
        state(machine).falling[0],
        original,
        "the carried object must become the falling object",
      );
      const beforeFall = pose(original);
      almost(
        beforeFall.scale,
        beforeGrip.scale,
        "carry-to-drop handoff must retain scale",
      );
      for (let i = 0; i < 7; i++) await tick();
      assert.ok(
        original.y > beforeFall.y,
        "released prize must fall towards the chute",
      );
      assert.ok(
        original.scale < beforeFall.scale,
        "released prize must move into chute depth",
      );
      while (machine.phase === "drop") await tick();
      assert.equal(
        original.scale,
        0,
        "collected slot stays empty until explicit restocking",
      );
      if (pickup + 1 < expectedPrizes.length)
        assert.equal(machine.phase, "aim");
    }
    await until(machine, kind === "bonus" ? "bonus" : "win");
    assert.equal(machine.heldCount, 0);
    assert.equal(state(machine).falling.length, 0);
    await until(machine, "restock");
    for (const prize of expectedPrizes) {
      const item = originalPile.find((item) => item.prize.key === prize.key)!;
      assert.ok(
        item.y < 0,
        "stock must enter from outside the glass, not pop into its slot",
      );
      const startY = item.y;
      await tick();
      assert.ok(item.y >= startY, "restock must descend continuously");
    }
  } else if (kind === "slip") {
    await until(machine, "lift");
    assert.equal(machine.heldCount, 1);
    const target = state(machine).held[0]!;
    await until(machine, "slip");
    const before = pose(target);
    while (machine.heldCount) await tick();
    almost(target.scale, before.scale, "slipping must not resize the prize");
    assert.ok(
      Math.abs(target.y - before.y) < 5,
      "release into fall must start at the held position",
    );
  } else {
    await until(machine, "grab");
    const before = originalPile.map((item) => ({ item, pose: pose(item) }));
    await until(machine, "whiff");
    assert.equal(machine.heldCount, 0);
    for (const entry of before)
      samePose(entry.item, entry.pose, "a miss must leave the pile unchanged");
  }
  for (let i = 0; i < 1000 && machine.isBusy; i++) await tick();
  await play;
  assert.equal(machine.isBusy, false);
  assert.equal(machine.phase, "idle");
  assert.equal(machine.heldCount, 0, `${kind} must finish with an empty claw`);
  assert.equal(beats.at(-1), "settle");
  assert.equal(
    state(machine).pile,
    originalPile,
    "no automatic pile replacement at settle",
  );
  if (kind === "bonus")
    assert.equal(beats.filter((beat) => beat === "grab").length, 2);
  machine.setMode("gadget");
  assert.equal(machine.heldCount, 0);
  machine.destroy();
  assert.equal(listeners.has("visibilitychange"), false);
}

const interrupted = new ClawMachine(canvas);
const emitted: string[] = [];
interrupted.onBeat = (beat) => emitted.push(beat);
const pending = interrupted.play(outcome("bonus"));
await until(interrupted, "lift");
assert.equal(interrupted.heldCount, 1);
const beforeHide = emitted.length;
hidden = true;
listeners.get("visibilitychange")?.();
await pending;
assert.equal(interrupted.heldCount, 0);
assert.equal(interrupted.isBusy, false);
assert.deepEqual(
  emitted.slice(beforeHide),
  ["settle"],
  "hidden tabs must not burst queued sound beats",
);
for (const item of state(interrupted).pile) {
  almost(
    item.x,
    item.homeX,
    "hidden completion must replenish the original slot",
  );
  almost(item.y, item.homeY, "hidden completion must finish stock descent");
  assert.equal(item.scale, 1);
}
interrupted.destroy();
console.log(
  "Machine checks passed: all 30 identities, continuous grip/scale, sequential bonus, slip/drop, visible restock, unchanged pile and hidden-tab completion.",
);
