/** Stable outcome fixtures and collection identity/persistence regression checks. */
import assert from "node:assert/strict";
import { Collection } from "../../src/game/collection.ts";
import { resolve, getWonPrizes, type ResultKind } from "../../src/game/outcome.ts";
import { MODES, type ModeId } from "../../src/game/config.ts";

const memory = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => memory.set(key, value),
  },
});

// Verified against the original repository implementation at 9ebe6d0.
const fixtures: [ModeId, number, ResultKind, number, number, string | null][] = [
  ["plush", 0, "grab", 7.05, 1.41, "plush-heart"],
  ["plush", 3, "bonus", 14.1, 2.82, "plush-heart"],
  ["plush", 4, "whiff", 0, 0, null],
  ["plush", 61, "slip", 1, 0.2, null],
  ["gadget", 0, "slip", 1, 0.2, null],
  ["gadget", 1, "whiff", 0, 0, null],
  ["gadget", 2, "grab", 10.875, 2.175, "gad-webcam"],
  ["gadget", 3, "bonus", 21.75, 4.35, "gad-chip"],
  ["vault", 0, "whiff", 0, 0, null],
  ["vault", 6, "grab", 22.63, 4.526, "vault-chip-stack"],
  ["vault", 12, "bonus", 67.89, 13.578, "vault-crown"],
  ["vault", 100, "slip", 1, 0.2, null],
];

for (const [mode, n, kind, payout, payoutX, prizeKey] of fixtures) {
  const seed = "0x" + n.toString(16).padStart(64, "0");
  const outcome = resolve(seed, mode, 5);
  assert.deepEqual(
    { kind: outcome.kind, payout: outcome.payout, payoutX: outcome.payoutX, prizeKey: outcome.prizeKey },
    { kind, payout, payoutX, prizeKey },
    `${mode} seed ${n} must keep its existing payout and primary prize`,
  );
  const unchanged = structuredClone(outcome);
  const prizes = getWonPrizes(outcome);
  assert.deepEqual(getWonPrizes(outcome), prizes, "cosmetic rewards must be repeatable");
  assert.deepEqual(outcome, unchanged, "collection helpers must not mutate an outcome");
  assert.equal(prizes.length, kind === "bonus" ? 2 : kind === "grab" ? 1 : 0);
  assert.equal(new Set(prizes.map(prize => prize.key)).size, prizes.length, "bonus prizes must be distinct");
  assert.ok(prizes.every(prize => prize.mode === mode), "bonus prizes must remain in the active machine");
  if (prizes.length) assert.equal(prizes[0]!.key, prizeKey);

  memory.clear();
  const collection = new Collection();
  for (const prize of prizes) assert.equal(collection.record(prize.key, seed), true);
  assert.equal(collection.caughtCount(), prizes.length, "every rendered prize must enter the shelf");
  assert.equal(collection.totalGrabs(), prizes.length);
  const restored = new Collection();
  for (const prize of prizes) {
    assert.equal(restored.has(prize.key), true, "collection must survive a reload");
    assert.equal(restored.record(prize.key, seed), false, "duplicate copies are not new collectibles");
    assert.equal(restored.entry(prize.key)?.count, 2);
    assert.equal(restored.entry(prize.key)?.firstSeed, seed);
  }
  assert.equal(restored.caughtCount(), prizes.length);
  assert.equal(restored.totalGrabs(), prizes.length * 2);
  restored.reset();
  assert.equal(new Collection().caughtCount(), 0);
}

const expectedChances: Record<ModeId, number> = { plush: 0.6336, gadget: 0.408, vault: 0.1804 };
for (const mode of Object.keys(expectedChances) as ModeId[]) {
  const config = MODES[mode];
  assert.ok(Math.abs(config.grab * (1 - config.slip) - expectedChances[mode]) < 1e-12);
}

// Browsers with disabled storage must still support collecting in memory.
Object.assign(globalThis, {
  localStorage: { getItem() { throw new Error("Storage blocked"); }, setItem() { throw new Error("Storage blocked"); } },
});
const transient = new Collection();
assert.equal(transient.record("plush-heart", "0x" + "00".repeat(32)), true);
assert.equal(transient.has("plush-heart"), true);
console.log("Outcome/collection checks passed: unchanged payouts, deterministic distinct bonus prizes, complete shelf awards, persistence and blocked-storage fallback.");
